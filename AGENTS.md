# Project Guidelines

## Mission

Build a Firefox WebExtension that sends browser history and bookmarks to an ArchiveBox instance.
Support desktop Firefox and Firefox for Android unless a task is explicitly desktop-only.

## Platform Constraints

- Treat Android as a first-class target when choosing APIs, manifest keys, and UI.
- Firefox for Android does not support `history`, `bookmarks`, `menus`, `commands`, `sidebarAction`, or `windows`. Never make those APIs part of the required startup or install path for Android.
- If a feature needs a desktop-only API, isolate it behind capability checks and keep the Android path installable and understandable.
- Prefer Manifest V3-compatible, event-driven background logic. Keep listeners at top level, persist state in storage, and use alarms instead of relying on long-lived timers or persistent background pages.
- Firefox MV3 uses `background.scripts` (array), **not** `background.service_worker`. The `service_worker` key is Chrome-only and will break loading in Firefox. Never change `background.scripts` to `background.service_worker`.
- `npm test` requires `jest-environment-jsdom` which is not currently installed. Use `npm run build` and `npm run typecheck` as the reliable validation path until the Jest environment is fixed.
- The packaging script (`npm run package`) auto-validates the XPI structure after creation by reading the ZIP central directory in pure Node.js. Do not replace this with shell `find`/`unzip` calls — they are not cross-platform on Windows.
- Unsigned XPIs install only via `about:debugging`. The "Install Add-on from File" path in `about:addons` requires Mozilla signing and will always show a corruption error for unsigned builds. This is expected Firefox behavior, not a packaging bug.
- Installing on Firefox for Android requires either a signed XPI hosted at a reachable URL, or an AMO custom collection. The `about:debugging` remote USB flow also works for development.

## ArchiveBox Integration

- Do not invent ArchiveBox endpoints or authentication flows. Check the official docs first: [ArchiveBox README](https://github.com/ArchiveBox/ArchiveBox) and [ArchiveBox Wiki](https://github.com/ArchiveBox/ArchiveBox/wiki).
- Never hardcode the ArchiveBox server URL, credentials, or API tokens. Store them in extension-managed storage and redact them from logs, screenshots, and fixtures.
- Assume submitted URLs may be private. Avoid logging full URLs, cookies, headers, or request bodies unless a task explicitly requires secure debugging output.

## Development Conventions

- Keep the sync pipeline browser-agnostic where possible: collect candidate URLs, normalize and dedupe them, queue them, then submit through a small ArchiveBox client module.
- Separate Firefox API adapters from ArchiveBox transport code so desktop-only collectors do not leak into Android-safe code paths.
- Minimize `permissions` and `host_permissions`. Add only the APIs and hosts needed for the current feature.
- Prefer small, restart-safe modules over long-lived in-memory state.

## Repo Expectations

- The repository is currently empty. If bootstrapping code, add a README with install, build, lint, test, and temporary signing steps.
- Suggested layout for new code:
  - `src/background/` for event-driven background entrypoints
  - `src/archivebox/` for client, auth, and request/response types
  - `src/collectors/` for history, bookmark, and manual-save collectors
  - `src/platform/` for capability checks and browser-specific adapters
  - `src/options/` for ArchiveBox settings UI
  - `src/shared/` for storage, queueing, logging, and shared types
- Keep GitHub automation simple and documented. Do not add CI, release automation, or packaging workflows without user approval.