/**
 * Options page logic
 */

import { storage } from '../shared/storage';
import { queueManager } from '../shared/queue';
import { authManager } from '../archivebox/auth';
import { logger } from '../shared/logger';
import { buildArchiveBoxBlockPattern } from '../shared/blocklist';

interface OptionsPageElements {
  archiveBoxUrl: HTMLInputElement;
  blocklistPatterns: HTMLTextAreaElement;
  blocklistValidation: HTMLDivElement;
  username: HTMLInputElement;
  password: HTMLInputElement;
  testBtn: HTMLButtonElement;
  saveBtn: HTMLButtonElement;
  syncBtn: HTMLButtonElement;
  connectionStatus: HTMLDivElement;
  queueSize: HTMLSpanElement;
  lastSync: HTMLSpanElement;
  logsContainer: HTMLDivElement;
}

let elements: OptionsPageElements;
let testPassed = false;

function getElements(): OptionsPageElements {
  return {
    archiveBoxUrl: document.getElementById(
      'archiveBoxUrl'
    ) as HTMLInputElement,
    blocklistPatterns: document.getElementById(
      'blocklistPatterns'
    ) as HTMLTextAreaElement,
    blocklistValidation: document.getElementById(
      'blocklistValidation'
    ) as HTMLDivElement,
    username: document.getElementById('username') as HTMLInputElement,
    password: document.getElementById('password') as HTMLInputElement,
    testBtn: document.getElementById('testBtn') as HTMLButtonElement,
    saveBtn: document.getElementById('saveBtn') as HTMLButtonElement,
    syncBtn: document.getElementById('syncBtn') as HTMLButtonElement,
    connectionStatus: document.getElementById(
      'connectionStatus'
    ) as HTMLDivElement,
    queueSize: document.getElementById('queueSize') as HTMLSpanElement,
    lastSync: document.getElementById('lastSync') as HTMLSpanElement,
    logsContainer: document.getElementById('logsContainer') as HTMLDivElement,
  };
}

function parseBlocklistPatterns(rawValue: string): string[] {
  return rawValue
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function validateBlocklistPatterns(
  rawValue: string
): { valid: true } | { valid: false; message: string } {
  const lines = rawValue.split('\n');
  const invalidLines: string[] = [];

  lines.forEach((line, index) => {
    const pattern = line.trim();
    if (!pattern) {
      return;
    }

    try {
      new RegExp(pattern);
    } catch (_err) {
      invalidLines.push(`${index + 1}: ${pattern}`);
    }
  });

  if (invalidLines.length === 0) {
    return { valid: true };
  }

  return {
    valid: false,
    message: `Invalid regex on line(s): ${invalidLines.join(', ')}`,
  };
}

function showBlocklistValidation(message: string): void {
  if (!message) {
    elements.blocklistValidation.textContent = '';
    elements.blocklistValidation.classList.remove('visible');
    return;
  }

  elements.blocklistValidation.textContent = message;
  elements.blocklistValidation.classList.add('visible');
}

function showStatus(
  message: string,
  type: 'success' | 'error' | 'loading'
): void {
  elements.connectionStatus.textContent = message;
  elements.connectionStatus.className = `status ${type}`;
}

async function loadConfig(): Promise<void> {
  const config = await storage.getConfig();
  elements.archiveBoxUrl.value = config.archiveBoxUrl || '';
  if (config.blocklistPatterns.length > 0) {
    elements.blocklistPatterns.value = config.blocklistPatterns.join('\n');
  } else {
    const defaultArchivePattern = buildArchiveBoxBlockPattern(config.archiveBoxUrl);
    elements.blocklistPatterns.value = defaultArchivePattern || '';
  }
  showBlocklistValidation('');
  elements.username.value = config.username || '';
  // Don't load password for security reasons
  testPassed = false;
  updateSaveButton();
}

async function testConnection(): Promise<void> {
  const url = elements.archiveBoxUrl.value.trim();
  const username = elements.username.value.trim();
  const password = elements.password.value.trim();

  if (!url || !username || !password) {
    showStatus('Please fill in all fields', 'error');
    return;
  }

  showStatus('Testing connection...', 'loading');
  elements.testBtn.disabled = true;

  try {
    const result = await authManager.testCredentials(url, username, password);
    if (result.success) {
      showStatus('✓ Connection successful!', 'success');
      testPassed = true;
      updateSaveButton();
    } else {
      showStatus(`✗ Connection failed: ${result.error}`, 'error');
      testPassed = false;
      updateSaveButton();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showStatus(`✗ Error: ${message}`, 'error');
    testPassed = false;
    updateSaveButton();
  } finally {
    elements.testBtn.disabled = false;
  }
}

function updateSaveButton(): void {
  elements.saveBtn.disabled = !testPassed;
}

async function saveConfig(): Promise<void> {
  if (!testPassed) {
    showStatus('Please test connection first', 'error');
    return;
  }

  const url = elements.archiveBoxUrl.value.trim();
  const username = elements.username.value.trim();
  const password = elements.password.value.trim();
  const blocklistValidation = validateBlocklistPatterns(
    elements.blocklistPatterns.value
  );

  if (!blocklistValidation.valid) {
    showBlocklistValidation(blocklistValidation.message);
    showStatus('Please fix blocklist regex errors', 'error');
    return;
  }

  showBlocklistValidation('');
  const blocklistPatterns = parseBlocklistPatterns(elements.blocklistPatterns.value);
  const archiveBoxPattern = buildArchiveBoxBlockPattern(url);
  if (archiveBoxPattern && !blocklistPatterns.includes(archiveBoxPattern)) {
    blocklistPatterns.unshift(archiveBoxPattern);
    elements.blocklistPatterns.value = blocklistPatterns.join('\n');
  }

  if (!url || !username) {
    showStatus('Please fill in required fields', 'error');
    return;
  }

  elements.saveBtn.disabled = true;
  showStatus('Saving...', 'loading');

  try {
    await storage.setConfig({
      archiveBoxUrl: url,
      username,
      blocklistPatterns,
      // Note: Password is not stored, only session cookie is stored after login
      // For future versions, consider using browser.storage.sync with encryption
    });

    // Perform login to get session cookie
    const result = await authManager.login(url, username, password);
    await storage.setConfig({
      sessionCookie: result.cookie,
      lastLogin: Date.now(),
    });

    showStatus('✓ Configuration saved!', 'success');
    elements.password.value = ''; // Clear password field

    // Give user feedback before redirecting
    setTimeout(() => {
      updateStatus();
    }, 1000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showStatus(`✗ Save failed: ${message}`, 'error');
  } finally {
    elements.saveBtn.disabled = !testPassed;
  }
}

async function updateStatus(): Promise<void> {
  const queueSize = await queueManager.getQueueSize();
  elements.queueSize.textContent = String(queueSize);

  const syncState = await storage.getSyncState();
  if (syncState.lastHistorySync || syncState.lastBookmarksSync) {
    const lastSync = Math.max(
      syncState.lastHistorySync || 0,
      syncState.lastBookmarksSync || 0
    );
    const ago = formatTimeDiff(Date.now() - lastSync);
    elements.lastSync.textContent = `${ago} ago`;
  } else {
    elements.lastSync.textContent = 'Never';
  }
}

async function updateLogs(): Promise<void> {
  const logs = await storage.getDebugLogs();
  elements.logsContainer.textContent = '';

  if (logs.length === 0) {
    const empty = document.createElement('div');
    empty.style.color = '#999';
    empty.style.textAlign = 'center';
    empty.textContent = 'No logs yet';
    elements.logsContainer.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  logs
    .slice(-20)
    .reverse()
    .forEach((log) => {
      const entry = document.createElement('div');
      entry.className = `log-entry ${log.level.toLowerCase()}`;

      const row = document.createElement('div');

      const timeSpan = document.createElement('span');
      timeSpan.className = 'log-time';
      timeSpan.textContent = new Date(log.timestamp).toLocaleTimeString();

      const levelSpan = document.createElement('span');
      levelSpan.className = `log-level ${log.level.toLowerCase()}`;
      levelSpan.textContent = log.level;

      const msgSpan = document.createElement('span');
      msgSpan.textContent = log.message;

      row.appendChild(timeSpan);
      row.appendChild(levelSpan);
      row.appendChild(msgSpan);
      entry.appendChild(row);

      if (log.data) {
        const dataDiv = document.createElement('div');
        dataDiv.style.color = '#666';
        dataDiv.style.marginTop = '4px';
        dataDiv.style.fontSize = '11px';
        dataDiv.textContent = JSON.stringify(log.data);
        entry.appendChild(dataDiv);
      }

      fragment.appendChild(entry);
    });

  elements.logsContainer.appendChild(fragment);
}

async function syncNow(): Promise<void> {
  elements.syncBtn.disabled = true;
  showStatus('Syncing...', 'loading');

  try {
    // Get background script and trigger sync
    const bg = await browser.runtime.getBackgroundPage?.();
    if (bg && typeof (bg as any).processSyncQueue === 'function') {
      await (bg as any).processSyncQueue();
      showStatus('✓ Sync completed!', 'success');
    } else {
      // Fallback: trigger via background script message
      await browser.runtime.sendMessage({ action: 'syncQueue' });
      showStatus('✓ Sync triggered!', 'success');
    }

    setTimeout(() => {
      updateStatus();
      updateLogs();
    }, 1000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showStatus(`✗ Sync failed: ${message}`, 'error');
  } finally {
    elements.syncBtn.disabled = false;
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

async function initialize(): Promise<void> {
  elements = getElements();

  await loadConfig();
  await updateStatus();
  await updateLogs();

  // Event listeners
  elements.testBtn.addEventListener('click', testConnection);
  elements.saveBtn.addEventListener('click', saveConfig);
  elements.syncBtn.addEventListener('click', syncNow);

  // Auto-update status every 5 seconds
  setInterval(async () => {
    await updateStatus();
    await updateLogs();
  }, 5000);

  await logger.info('Options page loaded');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
