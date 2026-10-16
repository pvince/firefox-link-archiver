/**
 * Unit tests for background queue processing behavior.
 */

jest.mock('../shared/storage', () => ({
  storage: {
    getConfig: jest.fn(),
    setConfig: jest.fn(),
    setAuthHealth: jest.fn(),
    getAuthHealth: jest.fn(),
  },
}));

jest.mock('../shared/queue', () => ({
  queueManager: {
    expireAuthBlockedItems: jest.fn(),
    getAuthBlockedItems: jest.fn(),
    dequeueBatch: jest.fn(),
    releaseAuthBlockedItems: jest.fn(),
    markSuccess: jest.fn(),
    markAuthBlocked: jest.fn(),
    markFailure: jest.fn(),
  },
}));

jest.mock('../archivebox/client', () => ({
  archiveBoxClient: {
    submitUrls: jest.fn(),
  },
}));

jest.mock('../archivebox/auth', () => ({
  authManager: {
    ensureAuthenticated: jest.fn(),
  },
}));

jest.mock('../collectors/history', () => ({
  historyCollector: {
    collectNewHistory: jest.fn(),
  },
}));

jest.mock('../collectors/bookmarks', () => ({
  bookmarksCollector: {
    collectNewBookmarks: jest.fn(),
  },
}));

jest.mock('../shared/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { AuthHealthStatus } from '../shared/types';
import { storage } from '../shared/storage';
import { queueManager } from '../shared/queue';
import { authManager } from '../archivebox/auth';

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

type BackgroundTestBrowser = {
  action: Record<string, jest.Mock>;
  alarms: {
    create: jest.Mock;
    onAlarm: { addListener: jest.Mock };
  };
  runtime: {
    onMessage: { addListener: jest.Mock };
  };
};

let mockBrowser: BackgroundTestBrowser;

async function processSyncQueueForTest(): Promise<void> {
  const background = globalThis as typeof globalThis & {
    processSyncQueue: () => Promise<void>;
  };
  await background.processSyncQueue();
}

describe('background processSyncQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (storage.getConfig as jest.Mock).mockResolvedValue({
      archiveBoxUrl: 'https://archive.example.com',
      username: 'alice',
      batchInterval: 10000,
      blocklistPatterns: [],
    });
    (storage.getAuthHealth as jest.Mock).mockResolvedValue({
      status: AuthHealthStatus.SessionValid,
      updatedAt: Date.now(),
      retryCount: 0,
      requiresUserAction: false,
      recoveryAction: 'none',
    });
    (queueManager.expireAuthBlockedItems as jest.Mock).mockResolvedValue([]);
    (queueManager.getAuthBlockedItems as jest.Mock).mockResolvedValue([]);
    (queueManager.dequeueBatch as jest.Mock).mockResolvedValue([]);
    (authManager.ensureAuthenticated as jest.Mock).mockResolvedValue(undefined);

    mockBrowser = {
      action: {},
      alarms: {
        create: jest.fn().mockResolvedValue(undefined),
        onAlarm: {
          addListener: jest.fn(),
        },
      },
      runtime: {
        onMessage: {
          addListener: jest.fn(),
        },
      },
    };
    Object.assign(globalThis, { browser: mockBrowser });
  });

  test('refreshes badge when sync exits early on empty queue', async () => {
    await import('../background/index');
    await flushMicrotasks();

    const setBadgeText = jest.fn().mockResolvedValue(undefined);
    const setBadgeBackgroundColor = jest.fn().mockResolvedValue(undefined);
    mockBrowser.action.setBadgeText = setBadgeText;
    mockBrowser.action.setBadgeBackgroundColor = setBadgeBackgroundColor;

    await processSyncQueueForTest();

    expect(setBadgeText).toHaveBeenCalledWith({ text: '' });
  });

  test('releases auth-blocked items before empty-queue early return', async () => {
    (queueManager.getAuthBlockedItems as jest.Mock).mockResolvedValue([
      { id: 'blocked-1' },
    ]);

    await import('../background/index');
    await flushMicrotasks();

    await processSyncQueueForTest();

    expect(authManager.ensureAuthenticated).toHaveBeenCalled();
    expect(queueManager.releaseAuthBlockedItems).toHaveBeenCalled();

    const releaseOrder = (queueManager.releaseAuthBlockedItems as jest.Mock)
      .mock.invocationCallOrder[0];
    const dequeueOrder = (queueManager.dequeueBatch as jest.Mock).mock.invocationCallOrder[0];
    expect(releaseOrder).toBeLessThan(dequeueOrder);
  });
});