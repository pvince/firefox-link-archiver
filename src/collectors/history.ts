/**
 * Browser history collector
 */

import { storage } from '../shared/storage';
import { queueManager } from '../shared/queue';
import { logger } from '../shared/logger';

export class HistoryCollector {
  /**
   * Collect new history since last sync
   */
  async collectNewHistory(): Promise<string[]> {
    try {
      // Guard: check if history API is available
      if (typeof (globalThis as any).browser?.history === 'undefined') {
        await logger.debug('History API not available (likely Android)');
        return [];
      }

      const syncState = await storage.getSyncState();
      const lastSync = syncState.lastHistorySync || Date.now() - 24 * 60 * 60 * 1000; // Default: last 24 hours

      // Query history since last sync
      const items = await (globalThis as any).browser.history.search({
        text: '', // Get all URLs
        startTime: lastSync,
        maxResults: 1000, // Reasonable limit
      });

      if (!items || items.length === 0) {
        await logger.debug('No new history items since last sync');
        return [];
      }

      // Extract and normalize URLs
      const urls = (items as any[])
        .filter((item: Record<string, unknown>) => {
          const url = item.url as string | undefined;
          return url && url.startsWith('http');
        })
        .map((item: Record<string, unknown>) => item.url as string);

      // Dedupe
      const deduped = Array.from(new Set(urls)) as string[];

      await logger.info('History collected', {
        total: items.length,
        urls: deduped.length,
      });

      // Enqueue for submission
      if (deduped.length > 0) {
        await queueManager.enqueue(deduped, ['browser-history']);
      }

      // Update sync timestamp
      await storage.updateSyncState({
        lastHistorySync: Date.now(),
      });

      return deduped;
    } catch (err) {
      await logger.error('Failed to collect history', { error: err });
      return [];
    }
  }
}

export const historyCollector = new HistoryCollector();
