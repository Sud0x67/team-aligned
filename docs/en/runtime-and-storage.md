# Runtime and Storage

Source: [Chinese version](../runtime-and-storage.md)

## Scope

Document runtime orchestration and persistence model in the current implementation.

## Runtime Topics

- Single-chat and group-chat run lifecycle
- Steps, tool invocations, and streaming updates
- Skill/MCP/tool integration points

## Storage Topics

- Formal schemas for conversations/messages/runs
- Attachments/artifacts/tool_invocations/run_steps
- Local path strategy under `~/.teamaligned`
- No automatic import/migration from legacy roots (`~/teamaligned`, `userData/teamaligned`, or `app-state.json`)
- Runtime now fails fast with a clear message when it detects an incompatible legacy SQLite schema

## Goal

Keep data relationships explicit and behavior predictable for beta stability.
