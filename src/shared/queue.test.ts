/**
 * Unit tests for queue manager
 */

import { QueueManager } from '../shared/queue';
import { StorageManager } from '../shared/storage';
import { QueueItemStatus } from '../shared/types';

// Mock browser.storage.local
const mockStorage: Record<string, unknown> = {};

global.browser = {
  storage: {
    local: {
      get: jest.fn((keys) => {
        const result: Record<string, unknown> = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach((key) => {
          if (key in mockStorage) {
            result[key] = mockStorage[key];
          }
        });
        return Promise.resolve(result);
      }),
      set: jest.fn((items) => {
        Object.assign(mockStorage, items);
        return Promise.resolve();
      }),
      clear: jest.fn(() => {
        Object.keys(mockStorage).forEach((key) => {
          delete mockStorage[key];
        });
        return Promise.resolve();
      }),
    },
  },
} as any;

describe('QueueManager', () => {
  let queueManager: QueueManager;
  let storage: StorageManager;

  beforeEach(async () => {
    storage = new StorageManager();
    queueManager = new QueueManager();
    await storage.clearAll();
  });

  test('should enqueue URLs', async () => {
    const urls = ['https://example.com', 'https://example.org'];
    await queueManager.enqueue(urls);

    const queue = await storage.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].urls).toEqual(urls);
    expect(queue[0].retries).toBe(0);
  });

  test('should dedupe batch and return ready items', async () => {
    const urls1 = ['https://example.com'];
    const urls2 = ['https://example.org'];
    await queueManager.enqueue(urls1);
    await queueManager.enqueue(urls2);

    const queue = await storage.getQueue();
    expect(queue).toHaveLength(2);

    const batch = await queueManager.dequeueBatch(20);
    expect(batch).toHaveLength(2);
  });

  test('should mark success and remove from queue', async () => {
    const urls = ['https://example.com'];
    await queueManager.enqueue(urls);

    let queue = await storage.getQueue();
    const id = queue[0].id;

    await queueManager.markSuccess([id]);

    queue = await storage.getQueue();
    expect(queue).toHaveLength(0);
  });

  test('should mark failure and schedule retry', async () => {
    const urls = ['https://example.com'];
    await queueManager.enqueue(urls);

    let queue = await storage.getQueue();
    const id = queue[0].id;

    await queueManager.markFailure(id, 'Test error');

    queue = await storage.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].retries).toBe(1);
    expect(queue[0].lastError).toBe('Test error');
    expect(queue[0].nextRetryAt).toBeGreaterThan(Date.now());
  });

  test('should discard after max retries', async () => {
    const urls = ['https://example.com'];
    await queueManager.enqueue(urls);

    let queue = await storage.getQueue();
    const id = queue[0].id;

    // Simulate 10 retries
    for (let i = 0; i < 10; i++) {
      await queueManager.markFailure(id, 'Error');
      queue = await storage.getQueue();
      if (queue.length === 0) break;
    }

    queue = await storage.getQueue();
    expect(queue).toHaveLength(0);
  });

  test('should respect retry backoff timing', async () => {
    const urls = ['https://example.com'];
    await queueManager.enqueue(urls);

    let queue = await storage.getQueue();
    const id = queue[0].id;

    // First retry
    await queueManager.markFailure(id, 'Error 1');
    queue = await storage.getQueue();
    const firstRetryTime = queue[0].nextRetryAt;

    // Retry again
    await queueManager.markFailure(id, 'Error 2');
    queue = await storage.getQueue();
    const secondRetryTime = queue[0].nextRetryAt;

    // Second retry should be delayed more than first
    expect(secondRetryTime).toBeGreaterThan(firstRetryTime);
  });

  test('should return queue size', async () => {
    await queueManager.enqueue(['https://example.com']);
    await queueManager.enqueue(['https://example.org']);

    const size = await queueManager.getQueueSize();
    expect(size).toBe(2);
  });

  test('should not enqueue empty URLs', async () => {
    await queueManager.enqueue([]);

    const size = await queueManager.getQueueSize();
    expect(size).toBe(0);
  });

  test('should block URLs that match user regex blocklist patterns', async () => {
    await storage.setConfig({
      blocklistPatterns: ['^https://blocked\\.example\\.com'],
    });

    await queueManager.enqueue([
      'https://blocked.example.com/path',
      'https://allowed.example.com/path',
    ]);

    const queue = await storage.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].urls).toEqual(['https://allowed.example.com/path']);
  });

  test('should block ArchiveBox URL by default', async () => {
    await storage.setConfig({
      archiveBoxUrl: 'https://archive.example.com',
      blocklistPatterns: [],
    });

    await queueManager.enqueue([
      'https://archive.example.com/add/',
      'https://allowed.example.com/path',
    ]);

    const queue = await storage.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].urls).toEqual(['https://allowed.example.com/path']);
  });

  test('should skip enqueue when all URLs are blocked', async () => {
    await storage.setConfig({
      blocklistPatterns: ['^https://blocked\\.example\\.com'],
    });

    await queueManager.enqueue(['https://blocked.example.com/path']);

    const size = await queueManager.getQueueSize();
    expect(size).toBe(0);
  });

  test('should mark auth blocked items without incrementing retries', async () => {
    await queueManager.enqueue(['https://example.com']);

    const queue = await storage.getQueue();
    const id = queue[0].id;
    const retriesBefore = queue[0].retries;

    await queueManager.markAuthBlocked(id, 'Auth failed');

    const after = await storage.getQueue();
    expect(after[0].status).toBe(QueueItemStatus.AuthBlocked);
    expect(after[0].retries).toBe(retriesBefore);
    expect(after[0].lastError).toBe('Auth failed');
  });

  test('should exclude auth blocked items from dequeue and requeue after release', async () => {
    await queueManager.enqueue(['https://example.com']);

    const queue = await storage.getQueue();
    const id = queue[0].id;

    await queueManager.markAuthBlocked(id, 'Auth failed');
    const blockedBatch = await queueManager.dequeueBatch(20);
    expect(blockedBatch).toHaveLength(0);

    await queueManager.releaseAuthBlockedItems();
    const releasedBatch = await queueManager.dequeueBatch(20);
    expect(releasedBatch).toHaveLength(1);
    expect(releasedBatch[0].id).toBe(id);
  });

  test('should remove auth blocked items that expired over 24h', async () => {
    await queueManager.enqueue(['https://example.com']);

    const queue = await storage.getQueue();
    const id = queue[0].id;

    const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000;
    await storage.updateQueueItem(id, {
      status: QueueItemStatus.AuthBlocked,
      authBlockedAt: oldTimestamp,
      lastError: 'Auth failed',
    });

    const expired = await queueManager.expireAuthBlockedItems();
    expect(expired).toHaveLength(1);
    expect(expired[0].id).toBe(id);

    const after = await storage.getQueue();
    expect(after.some((item) => item.id === id)).toBe(false);
  });
});
