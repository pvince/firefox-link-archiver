/**
 * Storage abstraction for durable state persistence
 * All data is stored in browser.storage.local for restart-safety
 */

import {
  Config,
  QueueItem,
  SyncState,
  DebugLogEntry,
  EncryptedCredential,
  AuthHealth,
  QueueItemStatus,
} from './types';

const STORAGE_KEYS = {
  CONFIG: 'config',
  QUEUE: 'queue',
  SYNC_STATE: 'syncState',
  DEBUG_LOGS: 'debugLogs',
  ENCRYPTED_CREDENTIAL: 'encryptedCredential',
  ENCRYPTION_SALT: 'encryptionSalt',
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
      status: QueueItemStatus.Pending,
    };
    queue.push(item);
    await browser.storage.local.set({ [STORAGE_KEYS.QUEUE]: queue });
  }

  async getQueue(): Promise<QueueItem[]> {
    const data = await browser.storage.local.get(STORAGE_KEYS.QUEUE);
    const queue = (data[STORAGE_KEYS.QUEUE] || []) as QueueItem[];
    return queue.map((item) => ({
      ...item,
      status: item.status || QueueItemStatus.Pending,
    }));
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

  async setAuthHealth(authHealth: AuthHealth): Promise<void> {
    await this.setConfig({ authHealth });
  }

  async getAuthHealth(): Promise<AuthHealth | null> {
    const config = await this.getConfig();
    return config.authHealth || null;
  }

  async clearAuthHealth(): Promise<void> {
    await this.setConfig({ authHealth: undefined });
  }

  async setEncryptedCredential(credential: EncryptedCredential): Promise<void> {
    await browser.storage.local.set({
      [STORAGE_KEYS.ENCRYPTED_CREDENTIAL]: credential,
    });
    await this.setConfig({ hasEncryptedCredential: true });
  }

  async getEncryptedCredential(): Promise<EncryptedCredential | null> {
    const data = await browser.storage.local.get(STORAGE_KEYS.ENCRYPTED_CREDENTIAL);
    return (data[STORAGE_KEYS.ENCRYPTED_CREDENTIAL] as EncryptedCredential) || null;
  }

  async clearEncryptedCredential(): Promise<void> {
    await browser.storage.local.set({ [STORAGE_KEYS.ENCRYPTED_CREDENTIAL]: undefined });
    await this.setConfig({ hasEncryptedCredential: false });
  }

  async getOrCreateEncryptionSalt(): Promise<string> {
    const data = await browser.storage.local.get(STORAGE_KEYS.ENCRYPTION_SALT);
    const existingSalt = data[STORAGE_KEYS.ENCRYPTION_SALT] as string | undefined;
    if (existingSalt) {
      return existingSalt;
    }

    const newSalt = this.generateSalt();
    await browser.storage.local.set({ [STORAGE_KEYS.ENCRYPTION_SALT]: newSalt });
    return newSalt;
  }

  private generateSalt(): string {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
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
