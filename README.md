# Firefox ArchiveBox Auto-Sync Extension

Automatically sync your Firefox browser history and bookmarks to your ArchiveBox instance.

## Features

- ✅ Real-time history and bookmark syncing
- ✅ Buffered batch submission to reduce ArchiveBox load
- ✅ Durable queue with exponential backoff retry
- ✅ Session-based authentication
- ✅ Manual URL submission from popup
- ✅ Desktop Firefox and Firefox for Android support
- ✅ Structured error logging and debug interface

## Installation

### Prerequisites

- Node.js 16+ and npm
- Firefox 121+ (desktop or Android)
- ArchiveBox 0.7.3 or later

### Development Setup

1. Clone this repository and navigate to the directory:
```bash
cd firefox-link-archiver
```

2. Install dependencies:
```bash
npm install
```

3. Build the extension:
```bash
npm run build
```

### Loading in Firefox

#### Desktop Firefox
1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `manifest.json` from this project directory
4. The extension will load with a toolbar icon

#### Firefox for Android
1. Open Firefox for Android
2. Navigate to `about:debugging`
3. Enable "Remote Debugging" in settings
4. Use Firefox Desktop to connect and load the extension

## Configuration

1. Click the extension icon → "Open Settings"
2. Enter your ArchiveBox instance URL (e.g., `http://localhost:8000`)
3. Enter your ArchiveBox username and password
4. Click "Test Connection" to validate
5. Click "Save"

The extension will begin syncing on next browser activity.

## Usage

### Automatic Sync
- **History**: New URLs you visit are automatically queued and submitted
- **Bookmarks**: New bookmarks are automatically queued and submitted
- Submissions are batched every 10 seconds (configurable) to reduce server load

### Manual Submission
1. Click the extension icon
2. Paste URL(s) in the text box
3. Optionally add tags (comma-separated)
4. Click "Submit"

### Queue Status
1. Click the extension icon → "Open Settings"
2. View "Queue Status" section to see pending URLs and last sync time
3. Use "Sync Now" button to manually trigger submission

### Debug Logs
1. Click the extension icon → "Open Settings"
2. Scroll to "Debug Logs" section
3. View recent activity (last 20 entries)
4. Logs include collection, queueing, and submission events
5. Sensitive data (URLs, credentials) is redacted in logs

## Development

### Build
```bash
npm run build
```

### Watch Mode
```bash
npm run watch
```

### Lint
```bash
npm run lint
npm run lint:fix
```

### Test
```bash
npm run test
npm run test:watch
```

### Clean
```bash
npm run clean
```

## Temporary Signing (Development)

Firefox allows unsigned extensions in Developer Edition and Nightly. To sign your extension for release:

1. Get API credentials from [addons.mozilla.org](https://addons.mozilla.org/developers/)
2. Use `web-ext` to sign:
```bash
npm install -D web-ext
npx web-ext sign --api-key YOUR_API_KEY --api-secret YOUR_API_SECRET
```

## Architecture

- **`src/background/`** — Event-driven service worker (listens for history/bookmark events)
- **`src/archivebox/`** — ArchiveBox HTTP client and session authentication
- **`src/collectors/`** — History and bookmarks data collectors
- **`src/shared/`** — Storage abstraction, queue manager, logger
- **`src/options/`** — Settings UI (configuration, status, debug logs)
- **`src/popup/`** — Quick-access popup (manual submission, status)

## Design Principles

1. **Restart-safe**: All state persisted in `browser.storage.local`; no in-memory data survives browser restarts
2. **Event-driven**: Listeners at top level, alarms for periodic sync, no long-running timers
3. **Android-compatible**: APIs guarded with capability checks; desktop-only features skip gracefully on Android
4. **Secure**: Session-based auth, credentials stored locally, secrets redacted from logs
5. **Resilient**: Exponential backoff retry, dead-letter after 10 attempts, classified error handling

## Browser Support

| Platform | Support | Notes |
|----------|---------|-------|
| Desktop Firefox | ✅ | Full support (history, bookmarks, manual submission) |
| Firefox for Android | ✅ | Full support (history, bookmarks, manual submission) |
| Chromium (Edge, Chrome) | ❌ | Not supported (Firefox WebExtension API specific) |

## Troubleshooting

### Extension Won't Load
- Verify `manifest.json` exists in project root
- Check Firefox console for errors: `about:debugging#/runtime/this-firefox`
- Ensure `dist/` directory exists after `npm run build`

### Connection Test Fails
- Verify ArchiveBox URL is correct (e.g., `http://localhost:8000`)
- Verify username and password are correct
- Check ArchiveBox logs for auth errors
- Ensure ArchiveBox `/admin/login/` endpoint is accessible

### History/Bookmarks Not Syncing
- Open Settings → Debug Logs to check for errors
- Verify connection test passed
- Visit a new URL or create a bookmark (syncing only catches new items)
- Wait 30 seconds (2 sync cycles)
- Check ArchiveBox UI for new entries

### Queue Growing But Not Draining
- Check network connectivity to ArchiveBox
- Verify ArchiveBox is running and accessible
- Check ArchiveBox logs for submission errors
- Check Debug Logs for error messages
- Manual "Sync Now" button can trigger immediate retry

## License

MIT

## Contributing

Contributions are welcome. Please ensure code passes linting and tests before submitting.
