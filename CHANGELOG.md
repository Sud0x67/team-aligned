# Changelog

[中文版本](./CHANGELOG.zh-CN.md)

All notable changes to TeamAligned are documented in this file.

## 0.4.0-beta - 2026-05-02

### Added

- Added built-in web tools for all agents:
  - `web_search` (provider-native first, automatic fallback)
  - `web_fetch` (page fetch + content extraction)
- Wired web tools into direct chat, group chat, and the built-in Nova assistant runtime.
- Added process-visible progress messages for web tool execution (start / in-progress / done).

### Improved

- Normalized web tool output contract with compact references:
  - `web_search`: normalized items and source links
  - `web_fetch`: extracted content metadata (`url`, `title`, `truncated`, `chars`)
- Extended smoke test coverage for web tool behavior and fallback reliability.

### Fixed

- Stabilized runtime wiring so team speaker-bound tool invocations emit consistent progress updates.
