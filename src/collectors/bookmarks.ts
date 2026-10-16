/**
 * Browser bookmarks collector
 */

import { storage } from '../shared/storage';
import { queueManager } from '../shared/queue';
import { logger } from '../shared/logger';

export class BookmarksCollector {
  /**
   * Collect new bookmarks since last sync
   */
  async collectNewBookmarks(): Promise<string[]> {
    try {
      // Guard: check if bookmarks API is available
      if (typeof globalThis.browser?.bookmarks === 'undefined') {
        await logger.debug('Bookmarks API not available (likely Android)');
        return [];
      }

      const syncState = await storage.getSyncState();
      const lastSync = syncState.lastBookmarksSync || 0;

      // Get bookmark tree
      const tree = await globalThis.browser.bookmarks.getTree();

      // Recursively collect bookmarks created since last sync
      const urls: string[] = [];
      const collect = (items: browser.bookmarks.BookmarkTreeNode[]): void => {
        for (const item of items) {
          if (item.dateAdded && item.dateAdded > lastSync && item.url) {
            // This is a bookmark (has URL) created since last sync
            urls.push(item.url);
          }
          if (item.children) {
            collect(item.children);
          }
        }
      };

      if (tree && tree.length > 0) {
        collect(tree);
      }

      if (urls.length === 0) {
        await logger.debug('No new bookmarks since last sync');
        return [];
      }

      // Dedupe
      const deduped = Array.from(new Set(urls));

      await logger.info('Bookmarks collected', {
        urls: deduped.length,
      });

      // Enqueue for submission
      if (deduped.length > 0) {
        await queueManager.enqueue(deduped, ['browser-bookmarks']);
      }

      // Update sync timestamp
      await storage.updateSyncState({
        lastBookmarksSync: Date.now(),
      });

      return deduped;
    } catch (err) {
      await logger.error('Failed to collect bookmarks', { error: err });
      return [];
    }
  }
}

export const bookmarksCollector = new BookmarksCollector();
