/**
 * Event-driven background service worker
 * Handles:
 * - History collection on visit
 * - Bookmarks collection on creation
 * - Periodic batch submission to ArchiveBox
 */

import { storage } from '../shared/storage';
import { queueManager } from '../shared/queue';
import { archiveBoxClient } from '../archivebox/client';
import { authManager } from '../archivebox/auth';
import { logger } from '../shared/logger';
import { historyCollector } from '../collectors/history';
import { bookmarksCollector } from '../collectors/bookmarks';
import {
  AuthError,
  NetworkError,
  ServerError,
  ClientError,
  AuthHealthStatus,
} from '../shared/types';

const ALARM_NAME = 'syncQueue';
const DEFAULT_BATCH_INTERVAL = 10000; // 10 seconds in milliseconds

async function updateAuthBadge(): Promise<void> {
  if (typeof globalThis.browser?.action?.setBadgeText !== 'function') {
    return;
  }

  const health = await storage.getAuthHealth();
  const needsAttention =
    health?.requiresUserAction ||
    health?.status === AuthHealthStatus.SessionExpired ||
    health?.status === AuthHealthStatus.InvalidCredentials ||
    health?.status === AuthHealthStatus.NoCredentials;

  if (needsAttention) {
    await browser.action.setBadgeText({ text: '!' });
    if (typeof globalThis.browser?.action?.setBadgeBackgroundColor === 'function') {
      await browser.action.setBadgeBackgroundColor({ color: '#d32f2f' });
    }
    return;
  }

  await browser.action.setBadgeText({ text: '' });
}

/**
 * Initialize the background service worker
 */
async function initialize(): Promise<void> {
  await logger.info('Initializing background service worker');

  // Ensure config exists
  const config = await storage.getConfig();
  if (!config.batchInterval) {
    await storage.setConfig({ batchInterval: DEFAULT_BATCH_INTERVAL });
  }

  // Create alarm for periodic sync (in minutes, minimum 0.016 = ~1 second)
  const intervalMinutes = DEFAULT_BATCH_INTERVAL / 60000;
  await browser.alarms.create(ALARM_NAME, { periodInMinutes: intervalMinutes });

  await logger.info('Background worker initialized', {
    alarmInterval: DEFAULT_BATCH_INTERVAL,
  });

  await updateAuthBadge();
}

/**
 * Handle history visit event
 */
async function onHistoryVisited(result: browser.history.HistoryItem): Promise<void> {
  const url = result.url;
  if (!url || !url.startsWith('http')) {
    return;
  }

  try {
    await logger.debug('History event detected', { url });
    const urls = await historyCollector.collectNewHistory();
    if (urls.length > 0) {
      await logger.info('Queued URLs from history', { count: urls.length });
    }
  } catch (err) {
    await logger.error('Failed to handle history visit', { error: err });
  }
}

/**
 * Handle bookmarks created event
 */
async function onBookmarkCreated(
  id: string,
  bookmark: browser.bookmarks.BookmarkTreeNode
): Promise<void> {
  const url = bookmark.url;
  if (!url) {
    return;
  }

  try {
    await logger.debug('Bookmark event detected', { url });
    const urls = await bookmarksCollector.collectNewBookmarks();
    if (urls.length > 0) {
      await logger.info('Queued URLs from bookmarks', { count: urls.length });
    }
  } catch (err) {
    await logger.error('Failed to handle bookmark creation', { error: err });
  }
}

/**
 * Process queue and submit batch to ArchiveBox
 */
async function processSyncQueue(): Promise<void> {
  try {
    const expiredAuthBlocked = await queueManager.expireAuthBlockedItems();
    if (expiredAuthBlocked.length > 0) {
      await storage.setAuthHealth({
        status: AuthHealthStatus.InvalidCredentials,
        updatedAt: Date.now(),
        retryCount: expiredAuthBlocked.length,
        requiresUserAction: true,
        recoveryAction: 'save-credentials',
        lastError:
          'Some queued URLs were blocked by authentication issues for over 24h. Save credentials and requeue manually.',
      });
    }

    // Get config
    const config = await storage.getConfig();

    if (!config.archiveBoxUrl || !config.username) {
      await storage.setAuthHealth({
        status: AuthHealthStatus.NoCredentials,
        updatedAt: Date.now(),
        retryCount: 0,
        requiresUserAction: true,
        recoveryAction: 'save-credentials',
        lastError: 'ArchiveBox URL or username is missing in settings',
      });
      await updateAuthBadge();
      await logger.debug('ArchiveBox not configured, skipping sync');
      return;
    }

    const authBlockedItems = await queueManager.getAuthBlockedItems();
    if (authBlockedItems.length > 0) {
      try {
        await authManager.ensureAuthenticated();
        await queueManager.releaseAuthBlockedItems();
        await logger.info('Released auth-blocked queue items after auth recovery', {
          count: authBlockedItems.length,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await logger.warn('Auth-blocked items remain paused until authentication is healthy', {
          error: errorMessage,
          count: authBlockedItems.length,
        });
      }
    }

    // Fetch batch
    const batch = await queueManager.dequeueBatch(20);

    if (batch.length === 0) {
      await logger.debug('Queue is empty, nothing to sync');
      return;
    }

    await logger.info('Processing sync batch', { count: batch.length });

    // Flatten all URLs from batch
    const allUrls: string[] = [];
    const allTags: Set<string> = new Set();

    for (const item of batch) {
      allUrls.push(...item.urls);
      if (item.tags) {
        item.tags.forEach((tag) => allTags.add(tag));
      }
    }

    const tags = Array.from(allTags);

    // Submit to ArchiveBox
    try {
      await authManager.ensureAuthenticated();
      await queueManager.releaseAuthBlockedItems();
      await archiveBoxClient.submitUrls(config.archiveBoxUrl, allUrls, tags);

      // Mark all as success
      await queueManager.markSuccess(batch.map((item) => item.id));

      await logger.info('Batch submitted successfully', {
        urlCount: allUrls.length,
      });
      await updateAuthBadge();
    } catch (err) {
      // Classify error and mark accordingly
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (err instanceof AuthError) {
        // Auth errors: pause these items until credentials are repaired.
        for (const item of batch) {
          await queueManager.markAuthBlocked(item.id, `Auth error: ${errorMessage}`);
        }
        await logger.warn('Auth error during sync, queue items are blocked pending credential fix', {
          error: errorMessage,
        });
        await updateAuthBadge();
      } else if (err instanceof ServerError || err instanceof NetworkError) {
        // Temporary errors: mark for retry
        for (const item of batch) {
          await queueManager.markFailure(item.id, `Temporary error: ${errorMessage}`);
        }
        await logger.warn('Temporary error during sync, will retry', {
          error: errorMessage,
        });
      } else if (err instanceof ClientError) {
        // Permanent errors: dead-letter
        for (const item of batch) {
          await queueManager.markFailure(item.id, `Permanent error: ${errorMessage}`);
        }
        await logger.error('Permanent error during sync, discarding batch', {
          error: errorMessage,
        });
      } else {
        // Unknown error: mark for retry
        for (const item of batch) {
          await queueManager.markFailure(item.id, `Unknown error: ${errorMessage}`);
        }
        await logger.error('Unknown error during sync', { error: err });
      }
    }
  } catch (err) {
    await logger.error('Failed to process sync queue', { error: err });
  } finally {
    try {
      await updateAuthBadge();
    } catch (err) {
      await logger.error('Failed to refresh auth badge', { error: err });
    }
  }
}

/**
 * Handle alarm (periodic sync)
 */
async function onAlarm(alarm: browser.alarms.Alarm): Promise<void> {
  if (alarm.name === ALARM_NAME) {
    await processSyncQueue();
  }
}

/**
 * Register event listeners
 */
function registerListeners(): void {
  // History listener (desktop-only, guarded)
  if (typeof globalThis.browser?.history !== 'undefined') {
    globalThis.browser.history.onVisited.addListener(onHistoryVisited);
  }

  // Bookmarks listener (desktop-only, guarded)
  if (typeof globalThis.browser?.bookmarks !== 'undefined') {
    globalThis.browser.bookmarks.onCreated.addListener(onBookmarkCreated);
  }

  // Alarm listener (periodic sync)
  globalThis.browser.alarms.onAlarm.addListener(onAlarm);

  // Runtime message listener for explicit sync requests from UI.
  if (typeof globalThis.browser?.runtime?.onMessage !== 'undefined') {
    globalThis.browser.runtime.onMessage.addListener(
      (message: Record<string, unknown>) => {
        if (message.action === 'syncQueue') {
          return processSyncQueue().then(() => ({ success: true }));
        }
        return undefined;
      }
    );
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  await initialize();
  registerListeners();
}

// Execute on service worker startup
main().catch((err) => {
  console.error('Failed to initialize background worker:', err);
});

// Expose processSyncQueue for manual trigger from UI
(globalThis as typeof globalThis & { processSyncQueue: typeof processSyncQueue })
  .processSyncQueue = processSyncQueue;
