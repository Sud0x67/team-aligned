# 系统架构

[English version](./en/architecture.md)

更新时间：2026-05-08

当前版本：`0.6.1-beta`

## 文档范围

这份文档描述当前仓库中已经实现的架构，不再保留旧原型阶段或历史路线图中的设想。

TeamAligned 是一个本地优先的 AI 协作桌面应用。产品表面是聊天软件，底层是本地 Agent runtime、工具层、扩展系统和可审计持久层。

## 总体结构

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

## 应用页面

当前主导航只保留四个页面：

- 会话：默认入口，承载单聊、群聊、消息、附件、运行状态和右侧信息栏。
- 管理：创建、编辑、删除 Agent 与群组；配置 Agent Skill/MCP 白名单。
- 扩展：同步和管理 Skills、MCP、Prompt Alias。
- 设置：语言、主题、通知、Provider、帮助反馈和诊断导出。

仪表盘已从主导航移除。后续如果恢复，需要证明它承担独立用户任务，而不是把产品重新带回 dashboard-first。

## 默认数据

新用户初始化时默认创建：

- TeamAligned Assistant：内置应用助手，不允许删除或修改，只绑定内置 `team-aligned-assistant` Skill。
- Product Squad / 产品开发组：唯一默认群组，用于展示 Planner、Designer、Coder 的协作方式。
- 默认 Agent：Coder、Designer、Planner、Researcher，以及内置 TeamAligned Assistant。

默认 Provider API Key 为空，用户必须在首次引导或设置页中显式填写。

## 前端结构

`apps/desktop` 负责桌面壳和所有界面：

- Electron main：窗口、IPC、系统通知、文件选择、导出、系统设置跳转。
- preload：暴露 `window.teamaligned` API，连接 renderer 和 runtime。
- React renderer：聊天页、管理页、扩展页、设置页、通知面板、个人信息弹窗。

聊天页当前结构：

- 左侧：会话搜索和会话列表。
- 中间：消息线程和输入区。
- 右侧：默认收起的信息栏，展示 token、workspace、打开目录、会话导出、当前 Skill/MCP 和当前运行状态。

输入区支持：

- Enter 发送，Shift+Enter 换行。
- 附件上传。
- 图片预览。
- 群聊 `@` 选择。
- `#` workspace 文件引用和模糊搜索。
- `/` slash 命令补全。
- 表情和截图入口。

## Runtime

运行时入口是 `packages/agent-runtime/src/runtime.ts` 中的 `TeamalignedRuntime`。

它负责：

- 接收用户输入。
- 路由 slash command。
- 启动单聊 run 或群聊 run。
- 注入 Provider、Skills、MCP 和本地工具。
- 处理流式输出、取消、重试、`/clear`。
- 写入 messages、runs、attachments、artifacts、tool invocations、run steps。
- 维护统一 DeepAgent streaming adapter、工具审批中断恢复和文件持久化 LangGraph checkpoint。
- 向 UI 推送最新 snapshot。

## 单聊 Agent

单聊已经接入真实模型调用链：

- Provider：OpenAI 与 Qwen（DashScope OpenAI-compatible）。
- Agent runtime：DeepAgents、LangChain、文件持久化 LangGraph checkpoint。
- Prompt：系统提示、用户身份、会话历史、当前 Skill、MCP/工具说明。
- 输入：文本、附件、图片、多模态内容。
- 输出：流式消息、自然过程消息、工具调用记录、artifact。

单聊和群聊 worker 共用统一的 DeepAgent streaming adapter：同一处处理文本流、显式 reasoning/thinking delta、工具事件、Human-in-the-loop interrupt 与恢复，避免两条聊天链路的流式行为继续漂移。

单聊可用工具包括：

- `workspace_list_directory`
- `workspace_read_text_file`
- `workspace_write_text_file`
- `workspace_search_rg`
- `workspace_run_command`
- `web_search`
- `web_fetch`
- Skill script tools
- MCP discovered tools

命令工具和 `stdio` MCP 子进程只继承运行所需的安全基础环境变量；API Key、OAuth token、MCP secret 等宿主环境敏感值默认不会透传。MCP 连接表单中显式配置的 env 仍会注入到对应连接。

## 群聊 Team

群聊不是 manager 可见模式，而是“自然团队聊天 + 不可见编排”。

核心机制：

- 显式 `@Agent` 优先。
- 无 `@` 时由 orchestrator 判断适合发言或执行的 Agent。
- orchestrator 默认 90 秒超时；超时后使用本地 fallback，避免 Provider 长尾导致群聊静默卡住。
- fallback 会识别文本里直接出现的 Agent 名称和 workspace 路径，用于生成基础执行计划。
- handoff 状态记录谁刚发言、谁应接棒、原因和 revision。
- 普通问题通常 1-2 个 Agent 发言。
- 多视角问题通常 2-4 个 Agent 发言。
- 复杂协作最多 5 个 Agent 参与。
- 执行任务拆成 work items，可并行或串行。
- 工具调用转成自然过程消息。

当前限制：

- 每个群组最多 5 个 Agent。
- 每个 team turn 最多 5 个小轮。
- 每个 Agent 每 turn 最多发言 10 次。
- 每个 team turn 最多 50 条 Agent 消息。
- 每个 Agent 每 turn 最多 5 个 work item。
- 同时最多 5 个 work item 并行执行。

群聊已支持：

- `@` 指定 Agent。
- 无 `@` 语义选人。
- handoff 多轮接棒。
- 群聊图片附件。
- 群聊执行过程输出。
- 群聊取消。
- 群聊 `/clear` 清理消息、run、transcript、team memory、DeepAgent checkpoint 和 handoff。

当前真实 Provider 回放已覆盖：

- `@` 指定 Agent。
- 无 `@` 自动选人。
- 多轮 handoff。
- 并行执行。
- 依赖等待。
- 图片附件。
- `web_fetch` 工具调用。
- 取消。
- `/clear`。

## Slash Commands

当前保留克制的 slash 命令集合：

- `/skills`：查看或切换当前会话 Skill。
- `/mcp`：查看或切换当前会话 MCP。
- `/<skill-id>`：临时使用某个 Skill。
- `/<prompt-alias>`：使用用户自定义 Prompt Alias。
- `/clear`：清空当前会话上下文。

`/pause`、`/resume`、`/cancel` 不再作为 slash 主入口。取消由发送按钮在运行中切换为取消按钮承载。

## Skills

Skills 采用“远端 catalog + 本地安装 + Agent 白名单 + runtime 按需加载”模式。

当前能力：

- 同步 GitHub skill catalog。
- 安装 Skill 到 `~/.teamaligned/skills`。
- 内置 `team-aligned-assistant` Skill 随应用打包，不依赖远端下载。
- Agent 级 Skill 白名单。
- 当前会话 active Skill。
- Runtime 只注入白名单 Skill 的轻量 catalog，模型根据任务相关性调用 `skill_load` 读取完整 `SKILL.md`。
- `skill_read_file` 支持读取 Skill 的 `references/`、`templates/`、`assets/` 等附属文件。
- `skill_run_script` 支持执行 Skill `scripts/`，并继续走工具确认策略。
- Skill 安装、同步、移除、启用的 UI 反馈。

## MCP

MCP 当前支持：

- `stdio npx` 型 MCP。
- `HTTP + headers` 型 MCP。
- `HTTP + OAuth` 型 MCP 授权基础流：扩展页可发起授权，主进程打开浏览器，本地回调接收 code，runtime 保存 token 状态并重新做 tool discovery。
- catalog 同步。
- 本地连接配置。
- 健康检查。
- tool discovery。
- Agent 级 MCP 白名单。
- runtime 注入 discovered tools。
- `stdio` MCP 进程使用受控子进程环境，只包含安全基础环境与该连接显式配置的 env。
- MCP 调用失败时，未授权/权限错误会进入聊天过程消息，引导用户回到扩展页授权后重试。
- OAuth token 过期或需要重新授权时，runtime 会清理过期 token 状态并提示重新授权。
- 高风险工具调用会进入聊天内确认卡片，用户可以 approve/deny；低风险读操作默认不打断。

当前尚未完成：

- MCP tool 级白名单当前不在主线优先级内；现阶段依靠 Agent 级 MCP 白名单和高风险工具确认。
- 更细的 OAuth 重新授权状态提示，例如 scope 变化、用户主动 revoke。
- 更细的高风险 tool 风险分级与用户提示，例如命令内容、文件路径、MCP tool 能力。

## Web Tools

所有 Agent 可用：

- `web_search`：优先使用 Provider native web search，失败或不支持时走内置 fallback。
- `web_fetch`：抓取网页、抽取正文、截断输出并返回来源信息。

Web 工具遵循开放访问策略，但有技术保护：

- 仅允许 HTTP/HTTPS。
- 限制超时。
- 限制重定向次数。
- 限制响应体大小。
- 限制输出长度。

## 持久层

TeamAligned 的本地数据固定在 `~/.teamaligned`。

### 配置层

`~/.teamaligned/settings.json`

保存：

- 主题
- 语言
- 通知设置
- 当前 Provider
- 个人信息

### 结构化数据层

`~/.teamaligned/app.db`

主要表：

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

### 文件层

主要目录：

- `~/.teamaligned/transcripts`
- `~/.teamaligned/workspaces/agents/*`
- `~/.teamaligned/workspaces/teams/*`
- `~/.teamaligned/avatars/profile`
- `~/.teamaligned/avatars/agents`
- `~/.teamaligned/avatars/teams`
- `~/.teamaligned/skills`

Agent / Team workspace 内部运行文件放在：

```text
${workspace}/.teamaligned/
├─ artifacts/
│  └─ attachments/
├─ memory/
├─ sessions/
└─ shared-memory.md
```

workspace 根目录留给用户生成和管理真实文件。

主进程打开 workspace / 文件夹时会校验路径必须位于 `~/.teamaligned` runtime 根目录或已登记的 Agent / Team workspace 下，避免 renderer 通过 IPC 打开任意本地路径。

## 通知

通知分两层：

- 应用内通知中心。
- macOS 系统通知。

规则：

- 应用在前台时不触发系统通知。
- 当前会话已读或刚读过时，不再把同一会话消息写入通知中心。
- 已读会清除通知中心对应项。
- 点击系统通知可回到对应会话。
- 设置页提供通知权限引导和系统设置跳转。

## 导出与诊断

当前支持：

- 会话数据导出。
- 选择消息导出长图。
- 诊断 JSON 导出。
- 打开诊断目录。

诊断导出默认脱敏：

- API Key
- MCP 环境变量值
- MCP 请求头值

## 当前主要边界

当前架构还需要继续增强：

- 群聊真实 Provider 回放已覆盖主链路，但复杂长链路仍需要持续观察。
- DeepAgent 图状态已落到文件型 checkpoint；更高层的 run 级阶段恢复、失败点和可重试建议仍不完整。
- MCP tool 级白名单尚未实现，且暂不作为近期主线。
- OAuth 型 MCP 已具备基础授权闭环和聊天内审批队列，但 scope 变化、用户主动 revoke 等重授权状态还需要更细打磨。
- transcript / artifact / attachment 的项目包导出仍需完善。
- Electron E2E 与 macOS 安装体验检查仍不足。

## 下一阶段建议

优先顺序：

1. 长任务 checkpoint 与失败恢复。
2. 高风险操作提示和权限解释。
3. 可恢复执行和失败后继续路径。
4. 项目包导出和全文搜索。
5. 发布检查、安装体验和 E2E 测试。
