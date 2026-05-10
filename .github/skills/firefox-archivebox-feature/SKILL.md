---
name: firefox-archivebox-feature
description: 'Plan or review Firefox WebExtension features that touch Android compatibility, Firefox APIs, ArchiveBox integration, permissions, or background lifecycle behavior.'
argument-hint: 'Describe the feature, API, or flow to plan or review.'
---

# Firefox ArchiveBox Feature Review

## When To Use

- Planning a new extension feature
- Reviewing a change that touches Firefox APIs or Manifest settings
- Checking whether an ArchiveBox flow is safe for desktop Firefox and Android Firefox

## Procedure

1. Define the target platforms: desktop Firefox, Firefox for Android, or both.
2. List the browser APIs and manifest keys the feature needs. Check whether each one works on Android before making it part of the shared path.
3. Minimize permission changes. If a permission is broad, explain why it is required.
4. Keep background behavior event-driven and restart-safe. Persist state needed after suspension or browser restart.
5. Verify the ArchiveBox endpoint and auth approach against the official docs before coding.
6. End with a short implementation plan that names likely files, tests, platform gaps, and docs updates.

## References

- See `AGENTS.md` for project-wide rules.
- ArchiveBox docs: <https://github.com/ArchiveBox/ArchiveBox> and <https://github.com/ArchiveBox/ArchiveBox/wiki>
- Firefox extension docs: <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions>