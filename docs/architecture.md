# 系统架构

## 文档范围

这份文档以当前仓库中的真实实现为准，不再描述“计划中的理想架构”。

当前 `teamaligned` 已经是一套可运行的本地优先桌面应用，整体由四层组成：

- Electron 桌面壳
- React 渲染层
- 本地 Agent Runtime
- 本地持久层

## 当前总览

```text
teamaligned
├─ apps/desktop
│  ├─ Electron Main
│  ├─ Preload IPC Bridge
│  └─ React Renderer
├─ packages/agent-runtime
│  ├─ TeamalignedRuntime
│  ├─ DeepAgents / LangGraph 集成
│  ├─ Team Runtime
│  ├─ Skills / MCP Registry
│  ├─ Tool Layer
│  ├─ SQLite + Drizzle
│  └─ File-backed Assets / Transcript / Workspace
└─ packages/shared
   ├─ 领域类型
   ├─ 默认种子数据
   ├─ slash command 解析
   └─ IPC 共享协议
```

## 目录与职责

### `apps/desktop`

负责桌面端外壳与全部产品界面。

当前已包含：

- Electron 主进程
- preload IPC 桥接
- React renderer
- 对话、管理、扩展、设置页面
- 通知面板与个人资料弹窗
- 聊天附件上传、图片预览、`@` 选择器、`/` 自动补全

### `packages/agent-runtime`

负责本地运行时、工具接入和持久化。

当前已包含：

- `TeamalignedRuntime` 主编排器
- 单聊 DeepAgents 调用链
- 群聊自然发言编排
- Skills registry / 安装 / 激活 / 脚本执行
- MCP registry / 连接 / 健康检查 / tool discovery
- 本地工具层：文件、搜索、命令
- SQLite 持久层与 Drizzle schema / migration

### `packages/shared`

负责跨层共享的类型、默认值和协议。

当前主要承载：

- `AgentRecord`、`TeamRecord`、`ConversationRecord`、`RunRecord`
- MCP / Skill / Provider / Attachment / Artifact 类型
- 默认种子数据
- slash command 解析与共享输入协议

## 前端信息架构

当前应用的主页面与 Figma 原型保持一致，已经落成以下结构：

- `/`：会话
- `/manage`：管理
- `/extensions`：扩展
- `/settings`：设置

同时存在两个全局浮层能力：

- 通知面板
- 个人资料弹窗

### 当前聊天页结构

聊天页当前采用主聊天区 + 默认收起的信息侧栏：

- 左侧：会话搜索 + 会话列表
- 中间：消息线程 + 输入区
- 最右侧：默认收起的会话信息侧栏

会话信息侧栏展开后展示：

- Token 消耗
- workspace 与 Finder 打开入口
- 当前 Skill / MCP
- 当前 run 状态
- 最近工具调用

与旧文档不同的是，输入框上方不再常驻 run 详情卡片，避免挤占聊天输入区。

### 当前管理页结构

管理页已拆成两个子视图：

- Agent 管理
- 群组管理

支持：

- 创建 Agent
- 创建群组
- 配置头像
- 配置 Agent Skill 白名单
- 配置 Agent / Team MCP 白名单

### 当前扩展页结构

扩展页当前只保留扩展中心，分成两个 tab：

- Skills
- MCP

支持：

- 同步远端 catalog
- 安装 Skill 到本地全局目录
- 配置 MCP 连接
- 健康检查
- 查看 MCP 发现到的 tools

### 当前设置页结构

设置页当前承载四类配置：

- 外观
- 语言
- 通知
- 模型配置

模型配置当前已支持：

- OpenAI
- Qwen（通过 DashScope OpenAI-compatible 接口）

并且已经具备：

- 参数校验
- API Key 显隐
- 连通性测试
- 保存并启用反馈

## 运行时总结构

运行时入口是 `packages/agent-runtime/src/runtime.ts` 中的 `TeamalignedRuntime`。

它负责：

- 加载快照
- 接收用户输入
- 路由 slash command
- 启动单聊 run / 群聊 run
- 调度工具与 MCP
- 写入持久层
- 向 UI 推送最新 snapshot

### 运行时分层

```text
TeamalignedRuntime
├─ Snapshot / State Assembly
├─ Single Chat Runtime
│  ├─ DeepAgents
│  ├─ LangChain ChatOpenAI
│  ├─ LangGraph MemorySaver
│  ├─ Skill Prompt Injection
│  ├─ Skill Script Tools
│  ├─ Workspace Tools
│  └─ MCP Tools
├─ Team Runtime
│  ├─ Handoff State Machine
│  ├─ Natural Multi-Agent Replies
│  ├─ Execution Work Items + Subagents
│  ├─ Messages + Updates Dual Streaming
│  └─ Team Memory Updates
├─ Slash Command Router
├─ Provider Validation / Connection Test
├─ Skill Registry
├─ MCP Registry + Runtime
└─ Storage
```

## 单聊架构

### 当前真实链路

单聊不是 mock，而是已经接上真实模型调用链：

- Provider 配置来自 `settings.json`
- `deep-agent.ts` 负责创建 `ChatOpenAI`
- `createDeepAgent` 负责 agent runtime
- `MemorySaver` 提供 LangGraph 级别的短期状态保存
- 会话历史会被裁剪后注入模型
- 当前激活 Skill 的 `SKILL.md` 会进入 system prompt
- 当前可用 MCP tools 与本地工具层会一并注入 agent

### 单聊工具层

当前单聊已经可用的工具包括：

- workspace 列目录
- 读取文本文件
- 写入文本文件
- `ripgrep` 搜索
- 本地 shell 命令执行
- Skill bundle 读取
- Skill `scripts/` 执行
- MCP discovered tools

### 单聊交互能力

当前单聊已支持：

- 自然语言消息
- 附件上传
- 图片附件预览
- 图片附件作为单聊多模态输入
- slash command
- `@` 选择器
- `/` 自动补全
- 流式输出
- 发送后等待回复与取消当前任务

## 群聊架构

### 当前真实链路

群聊已经不是脚本化演示，也不再默认采用 manager 主导模型。

当前流程：

1. 用户消息进入 `TeamalignedRuntime`
2. runtime 读取群组成员，最多激活 5 个 Agent
3. `team-runtime.ts` 中不可见的 system orchestrator 判断模式
   - `focused`
   - `multi_voice`
   - `collaboration`
4. 如果用户 `@Agent`，被点名 Agent 优先发言
5. 如果没有 `@`，系统根据语义选择 1 到 5 个相关 Agent
6. 被选中的 Agent 像真实群成员一样在主线程自然发言
7. Agent `@` 会触发接棒，handoff 状态持续写回
8. 执行意图触发 work item，并由 execution subagent 执行重任务
9. messages + updates 双轨输出过程与结果

### 群聊发言控制

当前群聊的控制原则：

- 默认没有用户可见的 manager
- 群组最多 5 个 Agent
- 普通问题通常 1 到 2 个 Agent 发言
- 多视角问题 2 到 4 个 Agent 发言
- 复杂协作 3 到 5 个 Agent 发言
- 每个 team turn 最多 5 个小轮
- 每个 team turn 最多 50 条 Agent 消息
- 每个 Agent 每 turn 最多发言 10 次
- Agent 没有新增观点时应保持沉默
- Agent 互相 `@` 只能触发下一小轮，不能无限循环

### 群聊上下文

当前群聊会综合这些信息进入规划与总结：

- 群组目标
- 当前阶段
- 最近决策
- 活跃任务
- workspace 摘要
- pinned artifacts
- 最近公开消息
- handoff 状态（active/last/next/reason/revision）

### 群聊当前边界

当前群聊已具备真实协作链路，但仍有边界：

- 群聊执行中的工具状态仍需继续优化节流，避免长任务刷屏
- 工具级权限仍是下一阶段能力
- 更强的 checkpoint / failure recovery 仍待加强

## Skills 架构

### 当前实现

Skills 已经采用“远端 registry + 本地全局安装 + Agent 白名单”的模式。

当前能力包括：

- 从 GitHub skills 仓库同步 catalog
- 安装整个 skill 目录到 `~/.teamaligned/skills`
- 读取 `SKILL.md`
- 允许 Agent 配置 skill 白名单
- `/skills` 查看和切换当前会话 skill
- 将 Skill 定义注入到单聊 prompt
- 将 Skill `scripts/` 转成 runtime tools

### 当前边界

当前 Skill 已经参与 runtime，但还没有独立的“Skill 执行过程 UI”。

## MCP 架构

### 当前支持范围

第一版 MCP 当前明确支持：

- `stdio npx` 型 MCP
- `HTTP + headers` 型 MCP

当前明确不支持：

- OAuth 型 MCP

### 当前能力

MCP 当前已经具备：

- 从 GitHub MCP registry 同步 catalog
- 本地保存连接配置
- 本地连接健康检查
- tool discovery
- Agent / Team 白名单
- 将 discovered tools 注入 DeepAgents runtime
- `/mcp`、`/mcp use`、`/mcp tools`

### 当前边界

MCP 当前尚未完成：

- tool 级白名单
- OAuth 远端授权流
- 更强的服务模板与专用适配

## 持久层架构

当前持久层已经明确拆成三层：

### 1. 配置层

路径：`~/.teamaligned/settings.json`

负责：

- 外观
- 语言
- 通知开关
- 当前激活 provider
- provider 列表
- 个人资料

### 2. 结构化运行态

路径：`~/.teamaligned/app.db`

当前主要表包括：

- `settings_entries`
- `providers`
- `agents`
- `teams`
- `conversations`
- `messages`
- `runs`
- `notifications`
- `extensions`
- `skill_catalog`
- `mcp_catalog`
- `mcp_connections`
- `attachments`
- `artifacts`
- `tool_invocations`
- `run_steps`

其中 `agents / teams / providers / notifications / conversations / messages / runs`
都已经具备正式结构化列与索引，不再只是纯 payload 存储。

### 3. 文件层

路径位于 `~/.teamaligned` 下的多个目录：

- `transcripts/`
- `workspaces/agents/*`
- `workspaces/teams/*`
- `avatars/profile`
- `avatars/agents`
- `avatars/teams`
- `workspaces/**/artifacts/attachments`
- `skills/*`

当前唯一保留的兼容迁移是：启动时从旧的 `~/teamaligned` 和 Electron `userData/teamaligned` 目录补齐缺失文件到 `~/.teamaligned`，并把旧数据库中指向 `~/teamaligned/...` 的受管资源路径规范化到新根目录。新数据不再写入旧目录。

### 历史对话存储方式

当前历史对话有两份：

- SQLite `messages` 作为主查询源
- JSONL transcript 作为审计流水

也就是说：

- UI 加载历史消息主要读 SQLite
- 导出、审计、人工检查依赖 transcript 文件

## 数据与页面的映射

### 会话页

依赖：

- `conversations`
- `messages`
- `runs`
- `run_steps`
- `attachments`
- `artifacts`
- `tool_invocations`

### 管理页

依赖：

- `agents`
- `teams`
- Skill 白名单
- MCP 白名单

### 扩展页

依赖：

- `skill_catalog`
- `mcp_catalog`
- `mcp_connections`
- 本地 `skills/` 安装目录

### 设置页

依赖：

- `settings.json`
- provider 连通性测试接口

## 当前已经具备的能力

截至当前版本，项目已经具备以下核心能力：

- Electron 桌面应用可运行
- Figma 对齐后的核心 UI 已落成
- 单聊真实模型调用
- 群聊真实自然发言编排
- slash command：`/skills`、`/mcp`、`/<skill-id>`、`/<prompt-alias>`
- Skills registry / 安装 / 激活 / 脚本执行
- MCP registry / 配置 / 健康检查 / 白名单 / runtime 注入
- workspace 文件 / 搜索 / 命令工具层
- 附件上传与图片预览
- 单聊图片理解
- run 详情、artifact、attachment、tool invocation 可视化
- 应用内通知中心与系统通知主链路
- `settings.json` + `app.db` + 文件层三层持久化
- Drizzle schema 与 migration

## 当前明确尚未完成的能力

当前还没有完成，或仅完成一部分的能力包括：

- MCP tool 级白名单
- OAuth 型 MCP 授权流
- 更完整的导出与备份
- 全文搜索
- 更强的群聊失败恢复与 checkpoint
- 更系统的测试体系
- 打包、签名、发布链路

## 近期建议

如果后续继续开发，建议优先顺序是：

1. 聊天主链路体验打磨与通知机制验证
2. 群聊失败恢复与统一错误态
3. MCP tool 级白名单与配置模板
4. 导出 / transcript / artifact 打包
5. 全文搜索
6. 测试与发布链路

这几项完成后，系统会从“高级可体验原型”更进一步走向“可长期使用的本地应用”。
