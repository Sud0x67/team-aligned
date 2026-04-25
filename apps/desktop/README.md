# apps/desktop

[中文说明](./README.zh-CN.md)

This directory contains the runnable Electron desktop MVP.

Included modules:

- Electron main process
- preload bridge
- React renderer
- Tailwind UI
- Chat, Manage, Extensions, and Settings pages
- Electron packaging configuration
- Direct chat and group chat main views
- Run details, attachment preview, and command-result cards

The desktop app is connected to the real local runtime. The UI layer is responsible for:

- Routing and snapshot state sync
- IPC-based local data read/write
- Chat composer, `@` mention selector, and `/` autocomplete
- Provider and MCP configuration + health checks
- Run/artifact/attachment/tool-invocation visualization
- In-app notification center and system notification entry
