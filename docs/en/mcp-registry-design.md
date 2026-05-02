# MCP Registry Design

Source: [Chinese version](../mcp-registry-design.md)

## Purpose

Describe MCP catalog, connection lifecycle, and runtime integration behavior.

## Coverage

- Supported transport types and configuration fields
- Connection and health-check workflows
- Workspace path handling for local servers
- MCP whitelist behavior in agent/team contexts
- OAuth authorization lifecycle for hosted HTTP MCP servers
- Runtime process messages and pre-execution policy hooks

## Product Direction

MCP setup should be explicit, recoverable, and easy to understand in UI and runtime messages.

## Current Support

- `stdio npx` MCP servers with health check and `tools/list`.
- `HTTP + headers` MCP servers with real URL handshakes, timeout handling, and `tools/list`.
- `HTTP + OAuth` MCP foundation: Extensions can start authorization, the browser is opened by the main process, a local callback receives the authorization code, token state is persisted, and tool discovery is retried after authorization.
- Local connection state for connect, configure, health check, and disconnect.
- Agent-level MCP allowlists.
- `/mcp`, `/mcp use <slug>`, and `/mcp tools <slug>`.
- Runtime injection for discovered MCP tools in direct and team chats.
- Auth and permission errors surface as chat process messages so users can authorize and retry.
- A generic runtime pre-execution policy hook exists for future tool-confirmation UI.

## Current Boundaries

- MCP tool-level allowlists are not implemented yet.
- OAuth token-expiry re-authorization needs more polish.
- Full tool-confirmation UI queues are not implemented yet.
- MCP call history and richer run-detail visualization still need more work.
