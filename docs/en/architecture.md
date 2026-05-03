# Architecture

[中文版本](../architecture.md)

Updated: 2026-05-02

Current version: `0.4.1-beta`

## Scope

This document describes the architecture currently implemented in the repository. It intentionally removes old prototype-era plans and stale roadmap assumptions.

TeamAligned is a local-first AI collaboration desktop app. The product surface is chat software; underneath it is a local Agent runtime, tool layer, extension system, and auditable persistence layer.

## System Shape

```text
teamaligned
├─ apps/desktop
│  ├─ Electron Main
│  ├─ Preload IPC Bridge
│  └─ React Renderer
├─ packages/agent-runtime
│  ├─ TeamalignedRuntime
│  ├─ Direct Agent Runtime
│  ├─ Team Runtime
│  ├─ Workspace / Web / Skill / MCP Tools
│  ├─ SQLite Storage
│  └─ File-backed Assets, Transcripts, Workspaces
└─ packages/shared
   ├─ Shared Types
   ├─ Default Seeds
   ├─ Slash Commands
   └─ IPC Protocol Types
```

## App Surfaces

The current main navigation has four pages:

- Chat: default entry point for direct chat, team chat, messages, attachments, run state, and the right info panel.
- Manage: create, edit, and delete Agents and teams; configure Agent Skill/MCP allowlists.
- Extensions: sync and manage Skills, MCP, and Prompt Alias.
- Settings: language, theme, notifications, Provider config, help/feedback, and diagnostics export.

The dashboard has been removed from the main navigation. If it returns later, it should first prove a distinct user job rather than pulling the product back into a dashboard-first shape.

## Default Data

On first run, TeamAligned creates:

- TeamAligned Assistant: the built-in app guide. It cannot be edited or deleted and is locked to the built-in `team-aligned-assistant` Skill.
- Product Squad: the only default team, used to demonstrate Planner, Designer, and Coder collaboration.
- Default Agents: Coder, Designer, Planner, Researcher, and the built-in TeamAligned Assistant.

Default Provider API Keys are empty. Users must explicitly configure them during onboarding or in Settings.

## Frontend Structure

`apps/desktop` owns the desktop shell and product UI:

- Electron main: window lifecycle, IPC, system notifications, folder/file selection, export, and system settings handoff.
- Preload: exposes the `window.teamaligned` API between renderer and runtime.
- React renderer: chat, manage, extensions, settings, notification panel, and profile modal.

Current chat layout:

- Left: conversation search and list.
- Center: message thread and composer.
- Right: collapsed by default info panel with tokens, workspace, open-folder action, active Skill/MCP, and recent tool calls.

The composer supports:

- Enter to send, Shift+Enter for newline.
- Attachments.
- Image previews.
- Team-chat `@` selection.
- `#` workspace file references with fuzzy search.
- `/` slash completion.
- Emoji and screenshot entry points.

## Runtime

The runtime entry point is `TeamalignedRuntime` in `packages/agent-runtime/src/runtime.ts`.

It is responsible for:

- Receiving user input.
- Routing slash commands.
- Starting direct-chat or team-chat runs.
- Injecting Providers, Skills, MCP, and local tools.
- Handling streaming output, cancel, retry, and `/clear`.
- Persisting messages, runs, attachments, artifacts, tool invocations, and run steps.
- Emitting fresh snapshots to the UI.

## Direct Agent Chat

Direct chat is connected to real model execution:

- Providers: OpenAI and Qwen through DashScope OpenAI-compatible endpoints.
- Agent runtime: DeepAgents, LangChain, and LangGraph MemorySaver.
- Prompt inputs: system prompt, user profile, conversation history, active Skill, and available MCP/tool instructions.
- User input: text, attachments, images, and multimodal content.
- Output: streaming messages, natural process messages, tool records, and artifacts.

Available direct-chat tools include:

- `workspace_list_directory`
- `workspace_read_text_file`
- `workspace_write_text_file`
- `workspace_search_rg`
- `workspace_run_command`
- `web_search`
- `web_fetch`
- Skill script tools
- MCP discovered tools

## Team Chat

Team chat is not a visible manager mode. It is natural team chat with invisible orchestration.

Core rules:

- Explicit `@Agent` wins.
- Without `@`, the planner chooses suitable speakers or execution owners.
- The planner has a default 30-second timeout; if the Provider stalls, local fallback routing prevents silent freezes.
- Fallback routing recognizes inline Agent names and workspace paths to build a basic execution plan.
- Handoff state tracks the last speaker, next speakers, reason, and revision.
- Simple questions usually involve 1-2 Agents.
- Multi-perspective questions usually involve 2-4 Agents.
- Complex collaboration can involve up to 5 Agents.
- Execution requests become work items that may run in parallel or sequence.
- Tool calls are translated into natural process messages.

Current limits:

- Maximum 5 Agents per team.
- Maximum 5 small rounds per team turn.
- Maximum 10 messages per Agent per turn.
- Maximum 50 Agent messages per team turn.
- Maximum 5 work items per Agent per turn.
- Maximum 5 concurrent work items.

Team chat currently supports:

- Explicit `@` routing.
- Semantic speaker selection without `@`.
- Multi-round handoff.
- Team image attachments.
- Visible execution process messages.
- Team cancel.
- Team `/clear`, which clears messages, runs, transcripts, team memory, and handoff state.

Current real-provider replay covers:

- Explicit `@` Agent routing.
- Semantic speaker selection without `@`.
- Multi-round handoff.
- Parallel execution.
- Dependency waiting.
- Image attachments.
- `web_fetch` tool invocation.
- Cancel.
- `/clear`.

## Slash Commands

The supported slash command set is intentionally small:

- `/skills`: view or switch the active conversation Skill.
- `/mcp`: view or switch the active conversation MCP.
- `/<skill-id>`: temporarily use a Skill.
- `/<prompt-alias>`: use a custom Prompt Alias.
- `/clear`: clear the current conversation context.

`/pause`, `/resume`, and `/cancel` are no longer primary slash commands. Cancel is exposed by turning the send button into a cancel button while a run is active.

## Skills

Skills use a remote catalog + local install + Agent allowlist + runtime injection model.

Current capabilities:

- Sync GitHub skill catalog.
- Install Skills into `~/.teamaligned/skills`.
- Bundle the built-in `team-aligned-assistant` Skill with the app instead of downloading it remotely.
- Configure Agent-level Skill allowlists.
- Set active conversation Skill.
- Inject `SKILL.md` into prompts.
- Expose Skill `scripts/` as runtime tools.
- Provide UI feedback for sync, install, remove, and enable flows.

## MCP

MCP currently supports:

- `stdio npx` MCP.
- `HTTP + headers` MCP.
- `HTTP + OAuth` MCP authorization foundation: the Extensions page can start auth, the main process opens the browser, a local callback receives the code, and the runtime stores token state before re-running tool discovery.
- Catalog sync.
- Local connection config.
- Health checks.
- Tool discovery.
- Agent-level MCP allowlists.
- Runtime injection for discovered tools.
- MCP auth/permission failures surface as chat process messages so users can authorize from Extensions and retry.
- When OAuth tokens expire or re-authorization is required, runtime clears stale token state and prompts the user to authorize again.
- High-risk tool calls now use in-chat approval cards with approve/deny actions; low-risk reads continue without interruption.

Not yet complete:

- MCP tool-level allowlists.
- Finer OAuth re-authorization states, such as token expiry, scope changes, and user revocation.
- Finer high-risk tool classification and prompts by command content, file path, and MCP tool capability.

## Web Tools

All Agents can use:

- `web_search`: provider-native search first, with built-in fallback when unsupported or failed.
- `web_fetch`: fetch a web page, extract readable content, truncate output, and return source metadata.

Web tools are open by default but have technical guards:

- HTTP/HTTPS only.
- Timeout limit.
- Redirect cap.
- Response-size cap.
- Output-size cap.

## Persistence

TeamAligned local data is fixed under `~/.teamaligned`.

### Config Layer

`~/.teamaligned/settings.json`

Stores:

- Theme
- Language
- Notification settings
- Active Provider
- User profile

### Structured Data Layer

`~/.teamaligned/app.db`

Main tables:

- `settings_entries`
- `providers`
- `agents`
- `teams`
- `conversations`
- `messages`
- `runs`
- `notifications`
- `extensions`
- `prompt_aliases`
- `skill_catalog`
- `mcp_catalog`
- `mcp_connections`
- `attachments`
- `artifacts`
- `tool_invocations`
- `run_steps`

### File Layer

Main directories:

- `~/.teamaligned/transcripts`
- `~/.teamaligned/workspaces/agents/*`
- `~/.teamaligned/workspaces/teams/*`
- `~/.teamaligned/avatars/profile`
- `~/.teamaligned/avatars/agents`
- `~/.teamaligned/avatars/teams`
- `~/.teamaligned/skills`

Agent / Team workspace runtime files live under:

```text
${workspace}/.team-aligned/
├─ artifacts/
├─ attachments/
├─ memory/
└─ sessions/
```

The workspace root itself is reserved for user-visible generated files.

## Notifications

Notifications have two layers:

- In-app notification center.
- macOS system notifications.

Rules:

- Do not send system notifications while the app is foreground.
- Do not add notification-center entries for conversations that are already read or were just read.
- Marking as read clears matching notification-center entries.
- Clicking a system notification opens the related conversation.
- Settings provides notification permission guidance and a shortcut to system settings.

## Export And Diagnostics

Currently supported:

- Conversation data export.
- Selected-message long-image export.
- Diagnostics JSON export.
- Open diagnostics folder.

Diagnostics are redacted by default:

- API Keys
- MCP environment values
- MCP request header values

## Current Boundaries

The architecture still needs improvement in:

- Real-provider team-chat replay coverage.
- Long-task checkpoint / failure recovery.
- MCP tool-level allowlists.
- OAuth MCP now has a foundational authorization loop and in-chat approval queue, but re-authorization states still need more polish.
- Project-package export for transcripts, artifacts, and attachments.
- Key chat UI component tests and Electron E2E tests.

## Next Priorities

Recommended order:

1. Real-provider team replay and failure recovery.
2. Tool permissions, MCP tool-level allowlists, and high-risk operation prompts.
3. Long-task checkpoint and recoverable execution.
4. Project-package export and full-text search.
5. Release gates, install checks, and E2E coverage.
