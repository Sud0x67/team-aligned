# Development TODO

Source: [Chinese version](../todo.md)

## Current Phase

TeamAligned has moved from feature wiring to beta hardening.

## 0.3.0-beta Direct Agent Chat Polish

Goal: make direct Agent chat the smoothest and easiest entry point into TeamAligned. Users should be able to send, stream, cancel, retry, upload files/images, and understand the active conversation capability without reading internal runtime details.

Completed in this pass:

- [x] Moved the development version to `0.3.0-beta`.
- [x] Focused the right conversation info panel on user-facing information: token usage, workspace, open-folder shortcut, export, and current Skill/MCP capability.
- [x] Added a direct-chat “Retry last message” action for failed, cancelled, or unsatisfying replies.
- [x] Persisted user-message `rawInput` so retrying an attachment/image message does not reuse display-only attachment copy as model input.
- [x] Added attachment count and per-file size guards to prevent oversized uploads from freezing the composer.
- [x] Refined the built-in TeamAligned Guide copy around Provider setup, direct chat, attachments, Slash commands, retry, and `/clear`.
- [x] Updated the built-in `team-aligned-assistant` Skill guidance for direct chat and the right info panel.

Next:

- [ ] Re-test streaming, cancel, retry, and `/clear` combinations against real providers.
- [ ] Continue improving image-attachment understanding across provider capability differences and failure states.
- [ ] Add stronger file-upload size/type/recovery guidance.
- [ ] Verify Markdown rendering for code blocks, lists, tables, links, and long-scroll content.

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
