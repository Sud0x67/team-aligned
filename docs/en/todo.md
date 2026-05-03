# Development TODO

[中文版本](../todo.md)

Updated: 2026-05-03

Current version: `0.4.1-beta`

## Current State

TeamAligned has moved from feature wiring into beta hardening. The app now has a real usable core:

- Direct Agent chat: real providers, streaming, cancel, retry, `/clear`, attachments, image understanding, Markdown, and the right info panel.
- Team chat: explicit `@` priority, planner intent detection, handoff continuity, parallel/sequential execution, process messages, cancel, and context clearing.
- Local tools: workspace file read/write, search, command execution, `web_search`, and `web_fetch`.
- Extensions: Skills, Prompt Alias, MCP catalog, stdio/http/OAuth MCP, and Agent-level Skill/MCP allowlists.
- Local data: `~/.teamaligned`, SQLite, transcripts, attachments, artifacts, tool invocations, and run steps.
- System features: notification center, system notifications, diagnostics export, conversation export, share-image export, and macOS packaging config.

The default first-run experience is intentionally focused:

- Built-in TeamAligned Assistant as the app guide.
- Only one default group: Product Squad.
- Provider API Keys start empty and must be configured by the user.

## P0: Chat Reliability

Goal: users should clearly feel that Agents are working, cancellable, and recoverable after failures.

- [x] Cover real-provider direct-chat regression in the replay script: streaming, cancel, retry, `/clear`, image attachments, and long Markdown output.
- [x] Run real-provider team-chat replay: explicit `@`, no-`@` speaker routing, multi-round handoff, parallel execution, dependency waiting, image attachments, web tool invocation, cancel, and `/clear`.
- [x] Tune team process-message density so long tasks are visible without flooding the chat.
- [x] MCP OAuth authorization failures now surface in chat process messages, and Extensions provides an authorization entry point.
- [x] MCP OAuth token-expiry or re-auth failures now clear stale tokens and guide users back through authorization.
- [x] Unify failure copy for Provider, MCP, command, image-understanding, and web-tool failures.
- [x] Verify recent-message summaries, unread counts, notification center state, and read state across direct and team chats.

## P1: Tool Permissions And Explainability

Goal: users should understand what each Agent can use and when high-risk tools are being called.

- [ ] Add MCP tool-level allowlists so one MCP connection does not expose every discovered tool by default.
- [x] Add a generic pre-execution tool policy hook so file writes, commands, network tools, Skills, and MCP can be intercepted or require confirmation consistently.
- [x] Add in-chat approval cards and an approve/deny queue for high-risk shell, file-write, Skill, and MCP tool calls.
- [ ] Continue refining high-risk prompts with more precise risk explanations by MCP tool, command content, and file path.
- [ ] Keep the right info panel focused on useful information: tokens, workspace, open-folder action, active Skill/MCP, and recent tool calls.
- [ ] Keep `/skills`, `/mcp`, `/<skill-id>`, and `/<prompt-alias>` responses conversational rather than console-like.
- [ ] Keep TeamAligned Assistant non-editable, non-deletable, and locked to the built-in app-assistant Skill.

## P2: Long-Task Recovery And Auditability

Goal: when a long task fails or is cancelled, users still know what completed, where it stopped, and how to continue.

- [ ] Design a minimal checkpoint record: task phase, completed steps, failure point, and retry suggestion.
- [ ] Make run, run steps, tool invocations, artifacts, and transcripts link together consistently.
- [x] Improve team execution messages for “who is waiting,” “who completed what,” and “who continues next.”
- [ ] Continue filtering internal process messages from planner history so tool chatter does not pollute intent detection.
- [ ] Clarify recovery paths for retry last message, edit and resend, and clear context.

## P3: Export, Search, And Sharing

Goal: users should be able to take local collaboration results with them, inspect them, share them, or recover them.

- [ ] Design a project export package: messages, transcripts, artifacts, attachment index, and workspace summary.
- [ ] Improve long-image sharing: multi-select messages, long-content pagination, image attachments, and consistent Markdown rendering.
- [ ] Expand local search across conversations, transcripts, artifacts, and workspace files.
- [ ] Keep exports redacted by default so API Keys, MCP secrets, and request headers are not leaked.

## P4: Release Quality

Goal: every beta release should have a stable and repeatable release gate.

- [x] Run `npm run beta:check` before every release.
- [ ] Check macOS DMG / ZIP install experience for Apple Silicon and Intel builds.
- [ ] Verify app name, icon, DMG background, volume icon, version, and changelog.
- [x] Add key chat-page component tests plus the necessary Electron / Provider replay check entry point.
- [x] Keep crash logs and local diagnostics easy to collect for user feedback.

## Not Prioritized Yet

These should stay out of the next mainline unless user feedback strongly demands them:

- Restoring the dashboard page.
- Adding more model providers.
- Large marketplace expansion.
- Multi-user online collaboration.
- OAuth MCP has a foundational authorization loop and in-chat approval queue; the remaining lower-priority work is full tool-level permissions and finer re-authorization state handling.

## Completion Criteria

The next hardening stage is done when:

- [x] Direct chat real-provider regression is covered by the replay script.
- [x] Team chat passes real-provider replay.
- [x] Cancel, retry, and `/clear` are stable in direct and team chat.
- [x] Tool progress is visible without flooding the chat.
- [x] High-risk tool confirmation UI is usable without blocking low-risk read operations.
- [ ] Users can understand what the current Agent / Team can do.
- [x] Diagnostics, export, and release checks run reliably.
