/**
 * Storage abstraction for durable state persistence
 * All data is stored in browser.storage.local for restart-safety
 */

import { Config, QueueItem, SyncState, DebugLogEntry } from './types';

const STORAGE_KEYS = {
  CONFIG: 'config',
  QUEUE: 'queue',
  SYNC_STATE: 'syncState',
  DEBUG_LOGS: 'debugLogs',
};

const DEFAULT_CONFIG: Config = {
  archiveBoxUrl: '',
  username: '',
  batchInterval: 10000,
  blocklistPatterns: [],
};

const DEFAULT_SYNC_STATE: SyncState = {
  lastHistorySync: 0,
  lastBookmarksSync: 0,
};

export class StorageManager {
  async getConfig(): Promise<Config> {
    const data = await browser.storage.local.get(STORAGE_KEYS.CONFIG);
    return {
      ...DEFAULT_CONFIG,
      ...(data[STORAGE_KEYS.CONFIG] || {}),
    };
  }

  async setConfig(config: Partial<Config>): Promise<void> {
    const current = await this.getConfig();
    const updated = { ...current, ...config };
    await browser.storage.local.set({ [STORAGE_KEYS.CONFIG]: updated });
  }

  async addToQueue(urls: string[], tags?: string[]): Promise<void> {
    const queue = await this.getQueue();
    const item: QueueItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      urls,
      tags,
      createdAt: Date.now(),
      retries: 0,
      nextRetryAt: Date.now(),
    };
    queue.push(item);
    await browser.storage.local.set({ [STORAGE_KEYS.QUEUE]: queue });
  }

  async getQueue(): Promise<QueueItem[]> {
    const data = await browser.storage.local.get(STORAGE_KEYS.QUEUE);
    return data[STORAGE_KEYS.QUEUE] || [];
  }

  async removeFromQueue(ids: string[]): Promise<void> {
    const queue = await this.getQueue();
    const idSet = new Set(ids);
    const filtered = queue.filter((item) => !idSet.has(item.id));
    await browser.storage.local.set({ [STORAGE_KEYS.QUEUE]: filtered });
  }

  async updateQueueItem(
    id: string,
    updates: Partial<QueueItem>
  ): Promise<void> {
    const queue = await this.getQueue();
    const index = queue.findIndex((item) => item.id === id);
    if (index !== -1) {
      queue[index] = { ...queue[index], ...updates };
      await browser.storage.local.set({ [STORAGE_KEYS.QUEUE]: queue });
    }
  }

  async getSyncState(): Promise<SyncState> {
    const data = await browser.storage.local.get(STORAGE_KEYS.SYNC_STATE);
    return {
      ...DEFAULT_SYNC_STATE,
      ...(data[STORAGE_KEYS.SYNC_STATE] || {}),
    };
  }

  async updateSyncState(state: Partial<SyncState>): Promise<void> {
    const current = await this.getSyncState();
    const updated = { ...current, ...state };
    await browser.storage.local.set({ [STORAGE_KEYS.SYNC_STATE]: updated });
  }

  async addDebugLog(entry: DebugLogEntry): Promise<void> {
    const logs = await this.getDebugLogs();
    logs.push(entry);
    // Keep only last 100 entries
    const trimmed = logs.slice(-100);
    await browser.storage.local.set({ [STORAGE_KEYS.DEBUG_LOGS]: trimmed });
  }

  async getDebugLogs(): Promise<DebugLogEntry[]> {
    const data = await browser.storage.local.get(STORAGE_KEYS.DEBUG_LOGS);
    return data[STORAGE_KEYS.DEBUG_LOGS] || [];
  }

  async clearDebugLogs(): Promise<void> {
    await browser.storage.local.set({ [STORAGE_KEYS.DEBUG_LOGS]: [] });
  }

  async clearAll(): Promise<void> {
    await browser.storage.local.clear();
  }
}

export const storage = new StorageManager();
