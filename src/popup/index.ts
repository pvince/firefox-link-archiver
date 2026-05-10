/**
 * Popup logic for quick URL submission
 */

import { storage } from '../shared/storage';
import { queueManager } from '../shared/queue';
import { logger } from '../shared/logger';

interface PopupElements {
  urlInput: HTMLTextAreaElement;
  tagsInput: HTMLInputElement;
  submitBtn: HTMLButtonElement;
  settingsBtn: HTMLButtonElement;
  submissionStatus: HTMLDivElement;
  quickQueueSize: HTMLSpanElement;
  quickLastSync: HTMLSpanElement;
  lastErrorContainer: HTMLDivElement;
  lastError: HTMLSpanElement;
}

let elements: PopupElements;

function getElements(): PopupElements {
  return {
    urlInput: document.getElementById('urlInput') as HTMLTextAreaElement,
    tagsInput: document.getElementById('tagsInput') as HTMLInputElement,
    submitBtn: document.getElementById('submitBtn') as HTMLButtonElement,
    settingsBtn: document.getElementById('settingsBtn') as HTMLButtonElement,
    submissionStatus: document.getElementById(
      'submissionStatus'
    ) as HTMLDivElement,
    quickQueueSize: document.getElementById(
      'quickQueueSize'
    ) as HTMLSpanElement,
    quickLastSync: document.getElementById('quickLastSync') as HTMLSpanElement,
    lastErrorContainer: document.getElementById(
      'lastErrorContainer'
    ) as HTMLDivElement,
    lastError: document.getElementById('lastError') as HTMLSpanElement,
  };
}

function showStatus(
  message: string,
  type: 'success' | 'error' | 'info'
): void {
  elements.submissionStatus.textContent = message;
  elements.submissionStatus.className = `status ${type}`;
}

async function getCurrentTabUrl(): Promise<string | null> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0 && tabs[0].url) {
      return tabs[0].url;
    }
  } catch (err) {
    // Tabs API may not be available on Android
    await logger.debug('Could not get current tab', { error: err });
  }
  return null;
}

async function autoFillCurrentTab(): Promise<void> {
  const url = await getCurrentTabUrl();
  if (url && !elements.urlInput.value) {
    elements.urlInput.value = url;
  }
}

async function submitUrls(): Promise<void> {
  const urlsText = elements.urlInput.value.trim();
  const tagsText = elements.tagsInput.value.trim();

  if (!urlsText) {
    showStatus('Please enter at least one URL', 'error');
    return;
  }

  // Parse URLs (split by newline)
  const urls = urlsText
    .split('\n')
    .map((u) => u.trim())
    .filter((u) => u.length > 0);

  // Parse tags (split by comma)
  const tags = tagsText
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (urls.length === 0) {
    showStatus('No valid URLs found', 'error');
    return;
  }

  elements.submitBtn.disabled = true;
  showStatus(`Queuing ${urls.length} URL${urls.length > 1 ? 's' : ''}...`, 'info');

  try {
    await queueManager.enqueue(urls, tags.length > 0 ? tags : undefined);

    showStatus(
      `✓ Added ${urls.length} URL${urls.length > 1 ? 's' : ''} to queue!`,
      'success'
    );

    // Clear inputs
    elements.urlInput.value = '';
    elements.tagsInput.value = '';

    // Update status
    setTimeout(updateStatus, 500);

    // Auto-close popup after 2 seconds
    setTimeout(() => {
      window.close();
    }, 2000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showStatus(`✗ Error: ${message}`, 'error');
  } finally {
    elements.submitBtn.disabled = false;
  }
}

async function updateStatus(): Promise<void> {
  try {
    const queueSize = await queueManager.getQueueSize();
    elements.quickQueueSize.textContent = String(queueSize);

    const syncState = await storage.getSyncState();
    if (syncState.lastHistorySync || syncState.lastBookmarksSync) {
      const lastSync = Math.max(
        syncState.lastHistorySync || 0,
        syncState.lastBookmarksSync || 0
      );
      const ago = formatTimeDiff(Date.now() - lastSync);
      elements.quickLastSync.textContent = `${ago} ago`;
    } else {
      elements.quickLastSync.textContent = 'Never';
    }

    // Get last error if any
    const queue = await storage.getQueue();
    const lastError = queue.find((item) => item.lastError);
    if (lastError) {
      elements.lastError.textContent = lastError.lastError || 'Unknown error';
      elements.lastErrorContainer.style.display = 'flex';
    } else {
      elements.lastErrorContainer.style.display = 'none';
    }
  } catch (err) {
    await logger.error('Failed to update status', { error: err });
  }
}

function formatTimeDiff(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

async function openSettings(): Promise<void> {
  await browser.runtime.openOptionsPage();
  window.close();
}

async function initialize(): Promise<void> {
  elements = getElements();

  // Try to auto-fill current tab URL
  await autoFillCurrentTab();

  // Update status
  await updateStatus();

  // Event listeners
  elements.submitBtn.addEventListener('click', submitUrls);
  elements.settingsBtn.addEventListener('click', openSettings);

  // Allow Enter key for submission (Shift+Enter for new line)
  elements.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      submitUrls();
    }
  });

  await logger.info('Popup initialized');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
