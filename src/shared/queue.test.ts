/**
 * Unit tests for queue manager
 */

import { QueueManager } from '../shared/queue';
import { StorageManager } from '../shared/storage';
import { QueueItem } from '../shared/types';

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
});
