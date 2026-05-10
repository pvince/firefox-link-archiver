---
description: "Use when adding ArchiveBox integration, URL submission, auth handling, sync queues, retry logic, browser history export, bookmark export, or server connectivity code."
name: "ArchiveBox Integration Rules"
---

# ArchiveBox Integration Rules

- Verify ArchiveBox behavior against the official docs before coding: [ArchiveBox README](https://github.com/ArchiveBox/ArchiveBox) and [ArchiveBox Wiki](https://github.com/ArchiveBox/ArchiveBox/wiki).
- Keep the ArchiveBox base URL, credentials, and tokens in extension-managed storage. Never commit them, seed them into examples, or print them in logs.
- Normalize and dedupe URLs before submission so the queue can be retried safely.
- Treat auth and configuration failures as user-visible setup problems; treat network and server hiccups as retryable queue failures.
- Redact secrets and private URLs from logs, telemetry, screenshots, and tests.
- Keep data collection code separate from the ArchiveBox client so desktop-only collectors can be swapped without changing transport code.
