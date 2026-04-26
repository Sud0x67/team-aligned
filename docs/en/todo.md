# Development TODO

Source: [Chinese version](../todo.md)

## Current Phase

TeamAligned has moved from feature wiring to beta hardening.

## 0.2.1-beta Stability Goals

Goal: after the `0.2.0-beta` release, improve feedback, diagnostics, and recovery paths before expanding the product surface.

Completed in this pass:

- [x] Added a Help and feedback section to Settings.
- [x] Added GitHub Issue handoff: <https://github.com/Sud0x67/team-aligned/issues>
- [x] Added email feedback handoff: <jokeroller@163.com>
- [x] Added local diagnostics JSON export.
- [x] Diagnostics are redacted by default: API Keys, MCP environment values, and MCP request header values are not exported.
- [x] Added a shortcut to open the diagnostics folder.
- [x] Moved the development version to `0.2.1-beta`.

Next:

- [ ] Continue unifying recovery hints for provider config failures, direct chat failures, and group failures.
- [ ] Continue unifying recovery hints for MCP connection failures, health check failures, and tool timeouts.
- [ ] Re-run real-device validation for notification permission and missing-banner guidance.
- [ ] Before release, re-run `beta:check`, macOS DMG/ZIP builds, and installer experience checks.

## Priority Direction

1. Improve chat quality and continuity.
2. Validate notifications and provider recovery end-to-end.
3. Stabilize group orchestration behavior and process visibility.
4. Keep codebase clean by removing temporary logic.

## Working Rule

TODO state must stay aligned with actual code and acceptance evidence.
