---
description: "Use when editing Firefox WebExtension files such as manifest.json, background scripts, popup or options UI, and shared extension source. Covers desktop and Android Firefox compatibility, MV3-safe patterns, and permissions."
name: "Firefox WebExtension Rules"
applyTo:
  - "manifest.json"
  - "src/**/*.{ts,tsx,js,jsx,json,html,css}"
---

# Firefox WebExtension Rules

- Keep shared code compatible with desktop Firefox and Firefox for Android unless the task is explicitly desktop-only.
- Treat `history` and `bookmarks` as desktop-only capabilities unless current Firefox for Android documentation says otherwise. Guard access with capability checks before registration or use.
- Prefer `action`-based UI and layouts that still work on narrow mobile screens.
- Keep background logic restart-safe: top-level listeners, durable state in storage, and alarms instead of long-running timers.
- Minimize `permissions` and `host_permissions`, and remove any permission no longer needed by the current feature.
- Keep browser API wiring separate from core queueing, storage, and ArchiveBox transport logic.
