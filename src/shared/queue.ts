/**
 * Queue manager with exponential backoff retry logic
 */

import { QueueItem } from './types';
import { storage } from './storage';

const MAX_RETRIES = 10;
const BASE_RETRY_DELAY_MS = 2000; // 2 seconds
const MAX_RETRY_DELAY_MS = 3600000; // 1 hour

export class QueueManager {
  /**
   * Add URLs to the queue for submission
   */
  async enqueue(urls: string[], tags?: string[]): Promise<void> {
    if (!urls || urls.length === 0) {
      return;
    }
    await storage.addToQueue(urls, tags);
  }

  /**
   * Fetch a batch of URLs ready for submission
   */
  async dequeueBatch(maxSize: number = 20): Promise<QueueItem[]> {
    const queue = await storage.getQueue();
    const now = Date.now();
    const batch = queue
      .filter((item) => item.nextRetryAt <= now)
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
      await storage.removeFromQueue([id]);
    } else {
      // Calculate next retry time with exponential backoff
      const delayMs = Math.min(
        BASE_RETRY_DELAY_MS * Math.pow(2, item.retries - 1),
        MAX_RETRY_DELAY_MS
      );
      item.nextRetryAt = Date.now() + delayMs;
      await storage.updateQueueItem(id, item);
    }
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
    const filtered = queue.filter((item) => item.retries < MAX_RETRIES);
    await browser.storage.local.set({ queue: filtered });
  }

  /**
   * Get current queue size
   */
  async getQueueSize(): Promise<number> {
    const queue = await storage.getQueue();
    return queue.length;
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
