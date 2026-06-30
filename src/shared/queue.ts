/**
 * Queue manager with exponential backoff retry logic
 */

import { QueueItem, QueueItemStatus } from './types';
import { storage } from './storage';
import { filterUrlsByBlocklist } from './blocklist';

const MAX_RETRIES = 10;
const BASE_RETRY_DELAY_MS = 2000; // 2 seconds
const MAX_RETRY_DELAY_MS = 3600000; // 1 hour
const MAX_AUTH_BLOCK_MS = 24 * 60 * 60 * 1000; // 24 hours

export class QueueManager {
  /**
   * Add URLs to the queue for submission
   */
  async enqueue(urls: string[], tags?: string[]): Promise<void> {
    if (!urls || urls.length === 0) {
      return;
    }

    const config = await storage.getConfig();
    const { allowedUrls } = filterUrlsByBlocklist(urls, config);

    if (allowedUrls.length === 0) {
      return;
    }

    await storage.addToQueue(allowedUrls, tags);
  }

  /**
   * Fetch a batch of URLs ready for submission
   */
  async dequeueBatch(maxSize: number = 20): Promise<QueueItem[]> {
    const queue = await storage.getQueue();
    const now = Date.now();
    const batch = queue
      .filter((item) => {
        const status = item.status || QueueItemStatus.Pending;
        if (status === QueueItemStatus.AuthBlocked || status === QueueItemStatus.Failed) {
          return false;
        }
        return item.nextRetryAt <= now;
      })
      .slice(0, maxSize);
    return batch;
  }

  /**
   * Mark URLs as successfully submitted
   */
  async markSuccess(ids: string[]): Promise<void> {
    await storage.removeFromQueue(ids);
  }

  /**
   * Mark URL submission as failed and schedule retry
   */
  async markFailure(id: string, error: string): Promise<void> {
    const queue = await storage.getQueue();
    const item = queue.find((i) => i.id === id);

    if (!item) {
      return;
    }

    item.retries += 1;
    item.lastError = error;

    if (item.retries >= MAX_RETRIES) {
      // Dead-letter: discard after max retries
      item.status = QueueItemStatus.Failed;
      await storage.removeFromQueue([id]);
    } else {
      // Calculate next retry time with exponential backoff
      const delayMs = Math.min(
        BASE_RETRY_DELAY_MS * Math.pow(2, item.retries - 1),
        MAX_RETRY_DELAY_MS
      );
      item.nextRetryAt = Date.now() + delayMs;
      item.status = QueueItemStatus.AwaitingRetry;
      await storage.updateQueueItem(id, item);
    }
  }

  async markAuthBlocked(id: string, error: string): Promise<void> {
    const queue = await storage.getQueue();
    const item = queue.find((i) => i.id === id);

    if (!item) {
      return;
    }

    item.status = QueueItemStatus.AuthBlocked;
    item.lastError = error;
    item.authBlockedAt = item.authBlockedAt || Date.now();
    await storage.updateQueueItem(id, item);
  }

  async getAuthBlockedItems(): Promise<QueueItem[]> {
    const queue = await storage.getQueue();
    return queue.filter((item) => item.status === QueueItemStatus.AuthBlocked);
  }

  async releaseAuthBlockedItems(): Promise<void> {
    const queue = await storage.getQueue();
    const now = Date.now();
    const blocked = queue.filter((item) => item.status === QueueItemStatus.AuthBlocked);
    for (const item of blocked) {
      await storage.updateQueueItem(item.id, {
        status: QueueItemStatus.AwaitingRetry,
        nextRetryAt: now,
        authBlockedAt: undefined,
      });
    }
  }

  async expireAuthBlockedItems(): Promise<QueueItem[]> {
    const queue = await storage.getQueue();
    const now = Date.now();
    const expired = queue.filter(
      (item) =>
        item.status === QueueItemStatus.AuthBlocked &&
        !!item.authBlockedAt &&
        now - item.authBlockedAt > MAX_AUTH_BLOCK_MS
    );

    if (expired.length > 0) {
      await storage.removeFromQueue(expired.map((item) => item.id));
    }

    return expired;
  }

  /**
   * Check if an item is ready for retry
   */
  isRetryDue(item: QueueItem): boolean {
    return item.nextRetryAt <= Date.now();
  }

  /**
   * Prune dead-lettered items (optional cleanup)
   */
  async pruneDeadLetters(): Promise<void> {
    const queue = await storage.getQueue();
    const filtered = queue.filter((item) => {
      const status = item.status || QueueItemStatus.Pending;
      return item.retries < MAX_RETRIES && status !== QueueItemStatus.Failed;
    });
    await browser.storage.local.set({ queue: filtered });
  }

  /**
   * Get current queue size
   */
  async getQueueSize(): Promise<number> {
    const queue = await storage.getQueue();
    return queue.filter((item) => item.status !== QueueItemStatus.Failed).length;
  }

  /**
   * Get next retry time for debugging
   */
  async getNextRetryTime(): Promise<number | null> {
    const queue = await storage.getQueue();
    if (queue.length === 0) {
      return null;
    }
    const nextTimes = queue.map((item) => item.nextRetryAt);
    return Math.min(...nextTimes);
  }
}

export const queueManager = new QueueManager();
