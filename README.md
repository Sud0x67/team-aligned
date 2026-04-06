# teamaligned

`teamaligned` 是一个本地优先的 AI Team 聊天桌面应用。

它的目标不是做成一个沉重的控制台，而是让用户像使用聊天软件一样，与单个 Agent 私聊，或者与一个 Agent 团队群聊，同时保留本地执行、可审计、可扩展的能力。

当前仓库已经从“纯文档初始化”推进到“可体验的 MVP 原型”阶段：

- 产品正式名称统一为 `teamaligned`
- 当前工作目录保持为 `/Users/bobo/code/team-aligned`
- 不复用旧的 `x-team` 代码
- 已提供 Electron + React 的本地桌面原型
- 已提供本地 mock Agent runtime、SQLite 持久化和多页面交互
- 已根据 Figma 原型完成首版 UI 对齐，并做了聊天页简化

## 当前路线

目标技术路线如下：

- 桌面端：Electron
- 前端：React + Vite + Tailwind CSS
- 运行时：Node.js 22+ + TypeScript
- Agent 内核：DeepAgents + LangChain + LangGraph
- 本地数据层：SQLite + Drizzle + better-sqlite3
- 本地能力：文件系统、终端、搜索、MCP、Skills
- 模型供应商：OpenAI + Qwen

## 仓库结构

当前仓库已经包含以下可运行模块：

- `apps/desktop`：Electron + React + Vite + Tailwind 的桌面端 MVP
- `packages/agent-runtime`：本地 mock Agent runtime、run 控制与持久化
- `packages/shared`：共享类型、协议、命令解析与默认种子数据
- `docs`：产品、架构、运行时、原型对齐与 MVP 文档

## 文档索引

- [产品定位](./docs/product.md)
- [系统架构](./docs/architecture.md)
- [运行时与存储](./docs/runtime-and-storage.md)
- [界面与体验](./docs/ui-and-experience.md)
- [聊天交互与编排规范](./docs/chat-interaction-and-orchestration.md)
- [群组运行时设计](./docs/group-runtime-design.md)
- [MCP Registry 设计](./docs/mcp-registry-design.md)
- [原型对齐说明](./docs/prototype-spec.md)
- [MVP 计划](./docs/mvp-plan.md)
- [路线与 TODO](./docs/roadmap.md)
- [开发 TODO](./docs/todo.md)

## 当前已实现

- 可启动的 Electron 桌面应用壳
- 聊天主界面、管理、扩展、仪表盘、设置页面
- 单 Agent 私聊与 Team 群聊
- 单 Agent 私聊已接入真实 Qwen / OpenAI 模型调用
- `/skills`、`/command`、`/mcp`、`/pause`、`/resume`、`/cancel`
- 群聊中的共享上下文、内部消息与 Agent `@` 协作
- 本地 run 状态机与暂停/恢复/取消控制
- 本地 SQLite 持久化、JSONL transcript 与 workspace 产物落盘
- Workspace 打开入口、通知、Provider/Profile/Settings 编辑
- Agent、群组、个人资料头像上传与本地保存
- 扩展中心、管理页、设置页的 Figma 对齐首版
- Skills registry 同步、全局安装与 Agent Skill 白名单
- MCP registry 同步、本地连接配置、健康检查、Agent/Team 白名单和 `/mcp use/tools`

## 当前说明

- 当前版本已经接入本地 SQLite 持久化，目录内仍保留 JSONL transcript 与 Markdown 产物，方便审计和直接查看。
- 当前桌面端本地数据目录统一使用 `~/teamaligned`；如果旧版本数据还在 `~/.teamaligned` 或 Electron `userData` 目录中，启动时会自动迁移。
- 持久层设计正在收敛为三层：`settings.json` 保存用户配置，`app.db` 保存结构化运行状态，`JSONL / Markdown / artifacts` 保存可审计内容。
- 当前聊天页已刻意做成更简洁的版本：左侧只保留搜索与会话列表，中间保留轻量标题、消息流和输入区，不保留常驻右侧上下文面板。
- 当前版本已经在单聊场景中接入 DeepAgents + LangChain + LangGraph，并支持通过设置页配置真实 Qwen / OpenAI 模型。
- `stdio npx` MCP 与 `HTTP + headers` MCP 已接通；OAuth 型 MCP、Skill 脚本执行和更完整的 MCP run 可视化仍在后续版本中继续补齐。
- 群聊产品方向已经明确为 local-first 的“manager 主沟通 + specialist 受控协作”模式。
- 文档中的目标架构仍然有效，但实现状态请以当前代码和本 README 为准。

## 运行方式

```bash
npm install
npm run dev
```

可选检查：

```bash
npm run typecheck
npm run lint
npm run build
```

macOS 安装包：

```bash
npm run dist:mac
```

图标资源位于 `apps/desktop/build/icon.svg`，可通过 `npm run generate:icons:mac -w apps/desktop` 重新生成 `icon.png` 和 `icon.icns`。
