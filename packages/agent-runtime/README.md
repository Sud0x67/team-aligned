# packages/agent-runtime

[中文说明](./README.zh-CN.md)

This package contains the local Agent runtime used by the MVP.

Implemented:

- Conversation snapshot assembly
- `/skills`, `/mcp`, `/<skill-id>`, `/<prompt-alias>`
- Run start/cancel and status synchronization
- Direct-agent runs and team-group run orchestration
- Team-context sync and internal messages
- DeepAgents/LangChain/LangGraph direct-chat execution chain
- Skill registry sync, install, activation, and script execution
- Custom prompt alias persistence, expansion, and per-turn injection
- MCP registry sync, configuration, health checks, and tool discovery
- Local file/search/command tool layer
- Local persistence with SQLite + Drizzle
- Notifications, workspace handling, and starter seeding

Current strengthening directions:

- Better unification between chat feedback and run feedback
- MCP tool-level whitelist
- OAuth-based MCP support
- Stronger failure recovery/checkpoint strategy
- Export, full-text search, and broader testing
