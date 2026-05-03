# Changelog

[中文版本](./CHANGELOG.zh-CN.md)

All notable changes to TeamAligned are documented in this file.

## Unreleased

- No unreleased changes yet.

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
