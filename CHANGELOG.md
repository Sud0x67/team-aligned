# Changelog

[中文版本](./CHANGELOG.zh-CN.md)

All notable changes to TeamAligned are documented in this file.

## Unreleased

- Documentation and minor UX polish for the `0.5.2-beta` hardening line.

## 0.5.2-beta - 2026-05-04

### Changed

- Bumped the app and internal workspace package versions to `0.5.2-beta`.
- Security review hardening for local tool execution and workspace-opening IPC.

## 0.5.1-beta - 2026-05-04

### Improved

- Hardened workspace path normalization for generated file operations so duplicated absolute workspace prefixes are collapsed before tool execution.
- Hardened command and stdio MCP child-process environments so ambient API keys, OAuth tokens, and other host secrets are not inherited by default.
- Hardened the open-workspace IPC path so the renderer can only ask the main process to open known TeamAligned runtime or workspace directories.
- Extended runtime visibility for long-running model and tool work, including elapsed-time status and diagnostic logging for timeout/error paths.
- Refreshed architecture, TODO, and release checklist docs to match the current `0.5.1-beta` runtime and UI behavior.

### Fixed

- Fixed documentation drift around team orchestrator timeout defaults, right-sidebar contents, and the built-in TeamAligned Assistant constraints.

## 0.5.0-beta - 2026-05-03

### Added

- Added foundational OAuth support for HTTP MCP servers, including browser authorization, local callback handling, token persistence, and post-auth tool discovery.
- Added a generic pre-execution tool policy hook for workspace, web, Skill, and MCP tools so future confirmation UI can intercept high-risk actions consistently.
- Added in-chat tool approval cards with an approve/deny queue for high-risk file, command, Skill, and MCP tool executions.

### Improved

- MCP authorization and permission failures now surface as natural chat process messages instead of silent tool failures.
- Extensions UI now exposes an OAuth authorization action for MCP connections that require browser login.
- OAuth MCP token-expiry and re-auth failures now reset stale token state and guide the user back through authorization.
- OAuth MCP servers that do not support dynamic client registration now fall back to a manual Client ID/Secret setup flow, with clearer UI copy and Slack-specific guidance.

## 0.4.0-beta - 2026-05-02

### Added

- Added built-in web tools for all agents:
  - `web_search` (provider-native first, automatic fallback)
  - `web_fetch` (page fetch + content extraction)
- Wired web tools into direct chat, group chat, and the built-in TeamAligned Assistant runtime.
- Added process-visible progress messages for web tool execution (start / in-progress / done).

### Improved

- Normalized web tool output contract with compact references:
  - `web_search`: normalized items and source links
  - `web_fetch`: extracted content metadata (`url`, `title`, `truncated`, `chars`)
- Extended smoke test coverage for web tool behavior and fallback reliability.
- Refreshed architecture and TODO documentation around the current `0.4.0-beta` product state.

### Fixed

- Stabilized runtime wiring so team speaker-bound tool invocations emit consistent progress updates.
