# Firefox ArchiveBox Auto-Sync Extension — Implementation Plan

## Overview

Build a Manifest V3 Firefox WebExtension for desktop & Android that continuously syncs browser history and bookmarks to ArchiveBox 0.7.3 via session-authenticated form submission to `POST /add/`. Use buffered batching (5–30s), durable queue with exponential backoff retry, and full Android feature parity.

---

## Phase 1: Project Bootstrap & Manifest (Steps 1–3)

### Step 1: Create project directory structure
- `src/{background, archivebox, collectors, platform, options, popup, shared}/`
- Root: `manifest.json`, `package.json`, `tsconfig.json`, `.eslintrc.json`, `README.md`

### Step 2: Create `manifest.json` (Manifest V3)
- `action`: popup for manual submission
- `background.service_worker`: event-driven sync logic
- `permissions`: `storage`, `history`, `bookmarks`
- `host_permissions`: `<all_urls>` (restricted to ArchiveBox domain at runtime)
- No desktop-only APIs in required path (history/bookmarks guarded)

### Step 3: Setup TypeScript, ESLint, build scripts
- `package.json` with build, lint, dev, test commands
- `tsconfig.json` targeting ES2020, module: esnext
- `.eslintrc.json` for code quality

---

## Phase 2: Core Storage & Sync Queue (Steps 4–5)

### Step 4: Create `src/shared/storage.ts`
Abstraction over `browser.storage.local` with three data stores:

**Config store:**
```typescript
{
  archiveBoxUrl: string,
  username: string,
  sessionCookie?: string,
  lastLogin?: number,
  batchInterval: number // ms, default 10000
}
```

**Durable queue:**
```typescript
{
  id: string,
  urls: string[],
  tags?: string[],
  createdAt: number,
  retries: number,
  nextRetryAt: number,
  lastError?: string
}[]
```

**Sync state:**
```typescript
{
  lastHistorySync: number,
  lastBookmarksSync: number
}
```

**Methods:**
- `getConfig(): Promise<Config>`
- `setConfig(config: Partial<Config>): Promise<void>`
- `addToQueue(urls: string[], tags?: string[]): Promise<void>`
- `getQueue(): Promise<QueueItem[]>`
- `removeFromQueue(ids: string[]): Promise<void>`
- `updateQueueItem(id: string, updates: Partial<QueueItem>): Promise<void>`
- `getSyncState(): Promise<SyncState>`
- `updateSyncState(state: Partial<SyncState>): Promise<void>`

### Step 5: Create `src/shared/queue.ts`

Queue manager with retry logic:

**Methods:**
- `enqueue(urls: string[], tags?: string[]): Promise<void>` — add to storage queue
- `dequeueBatch(maxSize: number): Promise<QueueItem[]>` — fetch batch ready for submission
- `markSuccess(ids: string[]): Promise<void>` — remove from queue
- `markFailure(id: string, error: string): Promise<void>` — increment retry count, calculate next backoff (exponential: 2^n, max 1 hour), persist error
- `isRetryDue(item: QueueItem): boolean` — check if nextRetryAt has passed
- `pruneDeadLetters(): Promise<void>` — remove URLs after 10 failed retries

**Retry backoff logic:**
```
retryCount 0: immediate
retryCount 1: 2 seconds
retryCount 2: 4 seconds
retryCount 3: 8 seconds
...
retryCount 10: dead-letter (discard)
```

---

## Phase 3: ArchiveBox Client & Session Auth (Steps 6–7)

### Step 6: Create `src/archivebox/auth.ts`

Session-based authentication:

**Methods:**
- `login(url: string, username: string, password: string): Promise<{cookie: string}>`
  - POST to `/admin/login/` with credentials
  - Extract session cookie from Set-Cookie header
  - Store in config
  - Throw `AuthError` on 401/403

- `testCredentials(url: string, username: string, password: string): Promise<{success: boolean, error?: string}>`
  - Login attempt without persisting
  - Used for UI validation during setup
  - Return error message on failure

- `isSessionValid(): Promise<boolean>`
  - Check if session cookie exists and not expired

- `ensureAuthenticated(): Promise<void>`
  - Re-login if needed using stored credentials
  - Throw if config missing

- `getSessionCookie(): Promise<string>`
  - Retrieve stored cookie for requests

**Error types:**
- `AuthError`: invalid credentials, expired session
- `NetworkError`: connection timeout, DNS failure
- Distinguish from other HTTP errors

### Step 7: Create `src/archivebox/client.ts`

HTTP client for ArchiveBox form submission:

**Methods:**
- `submitUrls(urls: string[], tags?: string[]): Promise<{success: boolean}>`
  - Call `ensureAuthenticated()`
  - Normalize & dedupe URLs
  - Format as multiline in `url` form field (e.g., `"url1\nurl2\nurl3"`)
  - POST to `/add/` with session cookie, `tags`, `depth=0`, `parser=auto`
  - Handle 200/3xx success
  - Throw `AuthError` on 401/403 (will trigger re-login & retry)
  - Throw `ServerError` on 5xx
  - Throw `ClientError` on 4xx (not auth)

- `normalizeUrl(url: string): string`
  - Lowercase, trim whitespace, remove fragment (#)
  - Return normalized URL

- `dedupeUrls(urls: string[]): string[]`
  - Remove duplicates, maintain order

**Error types:**
```typescript
class AuthError extends Error {}
class NetworkError extends Error {}
class ServerError extends Error {}
class ClientError extends Error {}
```

---

## Phase 4: Data Collectors (Steps 8–9)

### Step 8: Create `src/collectors/history.ts`

Browser history collector:

**Methods:**
- `collectNewHistory(): Promise<string[]>`
  - Guard with capability check: return [] if `browser.history` unavailable
  - Query `browser.history.search({startTime: lastSync})` since last sync timestamp (from storage)
  - Extract URLs, normalize & dedupe
  - Enqueue via storage
  - Update `lastHistorySync` timestamp
  - Return list of collected URLs (for logging)

### Step 9: Create `src/collectors/bookmarks.ts`

Browser bookmarks collector:

**Methods:**
- `collectNewBookmarks(): Promise<string[]>`
  - Guard with capability check: return [] if `browser.bookmarks` unavailable
  - Query `browser.bookmarks.getTree()`
  - Recursively traverse tree, filter by `dateAdded > lastSync`
  - Extract URLs, normalize & dedupe
  - Enqueue via storage with tag "bookmarks"
  - Update `lastBookmarksSync` timestamp
  - Return list of collected URLs (for logging)

---

## Phase 5: Background Service Worker (Step 10)

### Step 10: Create `src/background/index.ts`

Event-driven background script with top-level listeners and periodic sync:

**Initialization (on startup):**
- Register alarm: `browser.alarms.create("syncQueue", {periodInMinutes: 0.17})` (10 seconds)
- Initialize storage (config, queue, sync state if not present)
- Log startup

**Top-level listeners** (event-driven, restart-safe):
- `browser.history.onVisited`: guard with capability check, trigger `collectNewHistory()`
- `browser.bookmarks.onCreated`: guard with capability check, trigger `collectNewBookmarks()`
- Both:
  - Call collector
  - Enqueue returned URLs
  - Log collection

**Alarm handler** (`browser.alarms.onAlarm`):
- On "syncQueue" alarm:
  - Fetch batch from queue (max 20 URLs)
  - If batch empty: reschedule, return
  - Call `client.submitUrls(batch)`
  - On success: mark success in queue
  - On `AuthError`: log, mark failure (will trigger re-login retry on next alarm)
  - On `ServerError` or `NetworkError`: log, mark failure (will retry after backoff)
  - On `ClientError`: log, mark failure permanently (dead-letter after 10 retries)
  - Reschedule alarm

**Storage event listener** (optional, for future):
- Listen for config changes, reinit auth if needed

**Guard patterns:**
```typescript
async function ensureCapability(apiName: string): Promise<boolean> {
  return typeof browser[apiName] !== 'undefined';
}
```

---

## Phase 6: UI — Options & Popup (Steps 11–12)

### Step 11: Create `src/options/index.html` & `src/options/index.ts`

Settings page:

**Form section:**
- ArchiveBox URL (text input, e.g., "http://localhost:8000")
- Username (text input)
- Password (password input)
- "Test Connection" button
  - Call `auth.testCredentials(url, username, password)`
  - On success: show green checkmark "✓ Connection successful"
  - On error: show red error message (e.g., "401 Unauthorized — check username/password")
  - Disable "Save" button until test passes
- "Save" button: store config in storage, show success toast, redirect to popup

**Queue status section:**
- Display queue size (e.g., "5 URLs queued")
- Last sync time (e.g., "Synced 2 minutes ago")
- List of pending URLs (first 50 chars + "...")
- "Sync Now" button: manually trigger dequeue/submit, show feedback

**Debug logs section:**
- Show last 20 log entries
- Timestamp, level (DEBUG/INFO/WARN/ERROR)
- Redact URLs (first 20 chars + "..."), passwords, session cookies
- Auto-refresh every 5 seconds

### Step 12: Create `src/popup/index.html` & `src/popup/index.ts`

Popup for quick access:

**Manual submission section:**
- URL input (textarea, with placeholder "https://example.com or paste multiple URLs")
- Auto-fill with current tab URL on load: `browser.tabs.query({active: true, currentWindow: true})`
- Tags input (text, comma-separated, optional)
- "Submit" button
  - Enqueue URL(s)
  - Show feedback: "✓ Added 1 URL to queue"
  - Clear form

**Quick status section:**
- Queue size (e.g., "5 URLs queued")
- Last sync time
- Last error (if any)
- "Open Settings" link to options page

---

## Phase 7: Error Handling & Logging (Steps 13–14)

### Step 13: Create `src/shared/logger.ts`

Structured logging:

**Methods:**
- `debug(message: string, data?: any): void`
- `info(message: string, data?: any): void`
- `warn(message: string, data?: any): void`
- `error(message: string, data?: any): void`

**Behavior:**
- Store last 100 entries in `browser.storage.local` under `debugLogs`
- Each entry: `{timestamp: number, level: string, message: string, data?: any}`
- Redact function: URLs → first 20 chars + "...", passwords → "***", cookies → "***"
- Console logging in dev mode
- Auto-rotate: keep only last 100 entries

**Usage:**
```typescript
logger.info("History collected", {count: 5, urls: ["https://..."]});
```

### Step 14: Error classification in `src/archivebox/client.ts`

**Retry strategy:**
- `NetworkError` (timeout, DNS): retry with backoff
- `AuthError` (401/403): retry with backoff, trigger re-login first
- `ServerError` (5xx): retry with backoff
- `ClientError` (4xx, not auth): dead-letter after 1 attempt (no retry)
- `DeadLetterError` (after 10 retries): discard

---

## Phase 8: Testing & Validation (Steps 15–16)

### Step 15: Create unit tests (`src/**/*.test.ts`)

**Queue logic:**
- Enqueue multiple URLs
- Dequeue batch (max size respected)
- Mark success (removed from queue)
- Mark failure (retry count incremented, backoff calculated)
- Dead-letter pruning (after 10 retries)
- Retry timing (nextRetryAt compared against current time)

**URL normalization & deduplication:**
- Normalize URLs (lowercase, trim, fragment removed)
- Dedupe (duplicates removed, order maintained)
- Invalid URLs (skip gracefully)

**Storage persistence:**
- Add to queue, restart extension (simulate via storage wipe/restore)
- Queue persists and syncs on next alarm

**Mock patterns:**
- Mock `browser.storage.local` with in-memory object
- Mock `browser.history` and `browser.bookmarks` with fake data
- Mock `browser.alarms` to test periodic logic

### Step 16: Manual verification checklist

**Desktop Firefox setup:**
- Install extension (load unpacked)
- Navigate to options page
- Enter ArchiveBox URL, username, password
- Click "Test Connection" → verify success
- Click "Save"

**History sync:**
- Visit 5 new URLs (e.g., github.com, mozilla.org, etc.)
- Wait 30 seconds (2 alarm cycles + submission)
- Check ArchiveBox UI: verify all 5 URLs archived

**Bookmarks sync:**
- Create 3 new bookmarks
- Wait 30 seconds
- Check ArchiveBox UI: verify all 3 archived

**Manual submission:**
- Open popup
- Enter 2 URLs manually
- Enter tag "test"
- Click "Submit"
- Verify in queue status: +2 URLs
- Wait 30 seconds
- Check ArchiveBox UI: verify 2 URLs archived

**Rate limiting / batching:**
- Click "Submit" 10 times in rapid succession (within 2 seconds)
- Verify queue shows 10 URLs
- Wait 30 seconds
- Check ArchiveBox network logs: verify only 1–2 POST requests (not 10)

**Failure recovery:**
- Stop ArchiveBox server
- Submit 1 URL via popup
- Verify queue shows 1 URL
- Wait 30 seconds: queue still shows 1 URL (retry pending)
- Restart ArchiveBox server
- Wait 30 seconds
- Verify queue shows 0 URLs (successfully submitted after retry)

**Settings validation:**
- Enter invalid ArchiveBox URL (e.g., "http://invalid.local:9999")
- Click "Test Connection"
- Verify error message displayed, Save button disabled
- Enter invalid credentials
- Click "Test Connection"
- Verify "401 Unauthorized" error
- Correct credentials
- Click "Test Connection"
- Verify success, Save button enabled

**Firefox for Android:**
- Install extension on Android Firefox
- Navigate to options page
- Configure ArchiveBox (same as desktop)
- Verify history collector works (visit 5 URLs, wait 30s, check ArchiveBox)
- Verify bookmarks collector works (create 3 bookmarks, wait 30s, check ArchiveBox)
- Note: UI may be more compact due to mobile screen size

**Debug logs:**
- Open options page
- View debug logs section
- Verify logs show collection, queue, submission events
- Verify no plaintext passwords or session cookies in logs
- Verify URLs redacted (first 20 chars + "...")

---

## Deliverables

| File | Purpose |
|------|---------|
| `manifest.json` | Manifest V3 config, permissions, service worker registration |
| `src/background/index.ts` | Event-driven sync service worker with listeners & alarms |
| `src/archivebox/auth.ts` | Session authentication, credential storage, test endpoint |
| `src/archivebox/client.ts` | ArchiveBox HTTP client, URL submission, error classification |
| `src/collectors/history.ts` | Browser history collector with capability check |
| `src/collectors/bookmarks.ts` | Browser bookmarks collector with capability check |
| `src/shared/storage.ts` | Storage abstraction (config, queue, sync state) |
| `src/shared/queue.ts` | Queue manager with retry backoff logic |
| `src/shared/logger.ts` | Structured logging with redaction |
| `src/shared/types.ts` | TypeScript types for all major objects |
| `src/options/index.html` | Settings page HTML |
| `src/options/index.ts` | Settings page logic (test connection, save config, show queue) |
| `src/popup/index.html` | Popup HTML |
| `src/popup/index.ts` | Popup logic (manual submission, quick status) |
| `package.json` | Dependencies, build/lint/test/dev scripts |
| `tsconfig.json` | TypeScript configuration |
| `.eslintrc.json` | ESLint rules |
| `README.md` | Project overview, install, build, test, temporary signing steps |

---

## Estimated Implementation Order & Time

1. **Bootstrap (manifest, config, build)** — ~30 min
2. **Shared infrastructure (storage, queue, logger)** — ~45 min
3. **ArchiveBox client & auth** — ~60 min
4. **Data collectors** — ~45 min
5. **Background service worker** — ~60 min
6. **UI (options & popup)** — ~90 min
7. **Error handling & retry logic refinement** — ~30 min
8. **Testing & integration** — ~90 min

**Total: ~6–7 hours of focused work**

---

## Dependencies & Constraints

- **ArchiveBox 0.7.3**: Assumes `/add/` form endpoint and `/admin/login/` authentication
- **Firefox MV3**: Background service workers, storage API, history & bookmarks APIs (desktop only)
- **Android Firefox 119+**: Full feature parity expected; graceful degradation for unavailable APIs
- **Credentials storage**: Plaintext in extension storage for v1; encryption recommended for v2

---

## Next Steps

1. Execute Phase 1–2 (bootstrap & infrastructure)
2. Verify build & linting working
3. Execute Phase 3–4 (client & collectors)
4. Execute Phase 5 (background service worker)
5. Execute Phase 6–7 (UI & error handling)
6. Execute Phase 8 (testing & verification)
7. Prepare for testing on desktop and Android Firefox
