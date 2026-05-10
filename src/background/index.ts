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
} from '../shared/types';

const ALARM_NAME = 'syncQueue';
const DEFAULT_BATCH_INTERVAL = 10000; // 10 seconds in milliseconds

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
}

/**
 * Handle history visit event
 */
async function onHistoryVisited(result: Record<string, unknown>): Promise<void> {
  const url = result.url as string | undefined;
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
  bookmark: Record<string, unknown>
): Promise<void> {
  const url = bookmark.url as string | undefined;
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
    // Get config
    const config = await storage.getConfig();

    if (!config.archiveBoxUrl || !config.username) {
      await logger.debug('ArchiveBox not configured, skipping sync');
      return;
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
      await archiveBoxClient.submitUrls(config.archiveBoxUrl, allUrls, tags);

      // Mark all as success
      await queueManager.markSuccess(batch.map((item) => item.id));

      await logger.info('Batch submitted successfully', {
        urlCount: allUrls.length,
      });
    } catch (err) {
      // Classify error and mark accordingly
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (err instanceof AuthError) {
        // Auth errors: mark for retry with re-login
        for (const item of batch) {
          await queueManager.markFailure(item.id, `Auth error: ${errorMessage}`);
        }
        await logger.warn('Auth error during sync, will retry with re-login', {
          error: errorMessage,
        });
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
  }
}

/**
 * Handle alarm (periodic sync)
 */
async function onAlarm(alarm: Record<string, unknown>): Promise<void> {
  if (alarm.name === ALARM_NAME) {
    await processSyncQueue();
  }
}

/**
 * Register event listeners
 */
function registerListeners(): void {
  // History listener (desktop-only, guarded)
  if (typeof (globalThis as any).browser?.history !== 'undefined') {
    (globalThis as any).browser.history.onVisited.addListener(onHistoryVisited as any);
  }

  // Bookmarks listener (desktop-only, guarded)
  if (typeof (globalThis as any).browser?.bookmarks !== 'undefined') {
    (globalThis as any).browser.bookmarks.onCreated.addListener(onBookmarkCreated as any);
  }

  // Alarm listener (periodic sync)
  (globalThis as any).browser.alarms.onAlarm.addListener(onAlarm as any);
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
(globalThis as any).processSyncQueue = processSyncQueue;
