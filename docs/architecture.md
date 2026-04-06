# 系统架构

## 总体目标

`teamaligned` 要做成一套本地可运行、结构清晰、方便维护的桌面应用架构：

- 前台是聊天式桌面应用
- 中台是本地 Agent 运行时
- 底层是本地文件系统与 SQLite

## 总体结构

```text
Electron App
├─ Renderer
│  └─ React + Vite 聊天应用
├─ Main Process
│  ├─ 窗口与应用生命周期
│  ├─ IPC 权限边界
│  ├─ 本地能力代理
│  └─ Runtime 管理
└─ Local Runtime
   ├─ DeepAgents / LangGraph Runtime
   ├─ Provider Registry
   ├─ Tool Layer
   ├─ Skills Loader
   ├─ MCP Client Layer
   ├─ Session / Memory Services
   └─ Persistence Services
```

## 仓库模块规划

### `apps/desktop`

负责桌面端壳层与用户界面：

- Electron main
- preload bridge
- React renderer
- 页面路由与 UI 状态
- 消息流渲染

### `packages/agent-runtime`

负责 AI 运行时：

- DeepAgents 集成
- LangChain 模型适配
- LangGraph 执行流
- 团队调度
- 工具调用
- run 生命周期

### `packages/shared`

负责跨层共享定义：

- 领域模型
- IPC 协议
- 配置 schema
- 事件类型
- 存储实体定义

## 结合原型后的前端信息架构

Figma 原型已经明确了第一版页面结构：

- `/`：对话
- `/manage`：管理
- `/extensions`：扩展
- `/dashboard`：仪表盘
- `/settings`：设置

同时存在两个全局 UI 能力：

- 通知下拉面板
- 个人资料弹窗

因此前端建议采用“两层结构”：

### 第一层：全局应用壳

负责：

- 左侧主导航
- 顶部标题栏
- 通知入口
- 个人资料入口
- 主题切换
- 语言切换相关状态注入

### 第二层：页面级功能区

不同页面承载不同任务：

- 对话页：会话列表 + 聊天主线程
- 管理页：Agent 管理 / 群组管理
- 扩展页：Skills / MCP
- 仪表盘：概览统计
- 设置页：偏好与模型配置

## 与原始产品设想的差异与统一

我们之前定义过“三栏主布局：会话列表 / 主线程 / 右侧上下文”。

而当前 Figma 原型落地出来的是：

- 左侧全局导航
- 中左会话列表
- 中右聊天线程

右侧常驻上下文栏暂时没有出现在主稿中。

为了兼顾原型和长期产品方向，建议这样统一：

- 当前实现阶段以原型的两级聊天布局为准
- 右侧上下文能力改成可折叠抽屉、面板或详情页
- 当会话复杂度上升时，再升级为可停靠的上下文侧栏

这样不会破坏原型已有的简洁度，也保留了未来扩展空间。

## 运行时边界

### Renderer

Renderer 负责：

- 会话展示与输入
- 设置与管理页面
- 通知与状态展示
- 流式消息呈现
- 结构化事件渲染

Renderer 不应直接访问：

- 文件系统
- shell
- 密钥
- 原生 Node 权限

### Electron Main Process

Main Process 负责：

- 创建窗口
- 安全 IPC
- 本地系统能力访问
- Runtime 生命周期
- 秘钥读写

### Local Runtime

Runtime 负责：

- 加载 Agent / Team
- 选择 provider / model
- 调用工具
- 调度 subagent
- 执行技能
- 接入 MCP
- 记录运行与产物

## Agent 运行模型

### 单 Agent 私聊

当前选中的 Agent 作为主执行入口，直接响应用户请求。

在单聊中，系统需要同时支持两类输入：

- 自然语言请求
- 结构化命令输入

### 单聊命令式交互

为了支持更高效率的专业操作，单聊线程需要支持 slash command 风格输入。

第一批命令建议包括：

- `/skills`
- `/command`
- `/mcp`
- `/pause`
- `/resume`
- `/cancel`

这些命令不应完全依赖大模型解析，而应优先进入本地命令路由层。

建议语义如下：

#### `/skills`

用于列出、选择或显式调用某个 skill。

示例：

- `/skills`
- `/skills summarize`
- `/skills planner 请为这个项目拆解任务`

#### `/command`

用于让当前 Agent 在本地 workspace 中执行终端命令。

示例：

- `/command pwd`
- `/command npm test`
- `/command rg "TODO" src`

#### `/mcp`

用于列出 MCP 服务、选择服务，或调用某个 MCP tool。

示例：

- `/mcp`
- `/mcp github`
- `/mcp github list_issues`

#### `/pause` / `/resume` / `/cancel`

用于控制当前复杂任务的运行状态。

这些命令本质上是 run controller 的显式控制接口。

### Team 群聊

Team 群聊由 manager agent 对外统一发言，并在内部：

- 自己回答
- 调用 specialist subagent
- 调用工具
- 访问 workspace
- 调用 MCP

同时，群组模式需要比单聊更强的通信能力。

### 群聊后端的设计原则

群聊后端不应被设计成传统聊天室服务，而应被设计成本地优先的任务编排后端。

建议坚持：

- local-first
- manager 中心化调度
- 主线程与内部线程分离
- 所有关键事件可审计、可恢复、可回放
- 工具、MCP、memory、artifact 全部纳入统一运行时

### 群组内多 Agent 交互模型

群组中的 Agent 不只是“被动执行者”，而应该能够：

- 互相发送消息
- 互相 `@`
- 感知当前群组共享上下文
- 在必要时向用户同步中间结论

建议把群组通信拆成两层：

#### 公开线程通信

对用户可见，展示在群聊主线程中。

适合：

- Agent 回应用户
- Agent 在群里 `@` 另一个 Agent
- Agent 汇报阶段性进展
- manager 汇总团队结论

#### 受控的 specialist -> user 升级

specialist 允许直接 `@用户`，但不应是默认行为。

建议运行时中把它当作一次升级动作处理：

- specialist 先提交 `needs_user_input`
- manager 决定是否转述
- 只有在确有必要时，manager 才授权 specialist 直接对用户发言

这样既保留真实团队协作感，也避免主线程失控。

#### 内部线程通信

对用户默认折叠，只在 run 详情中展开。

适合：

- manager 分派 specialist
- specialist 互相同步
- tool call / MCP call 结果传递
- 澄清问题的内部汇总

## 群组运行时建议结构

建议把群组运行时拆成下面几个本地模块：

```text
Team Ingress
├─ 接收用户消息
├─ 创建 team run
└─ 路由到 team orchestrator

Team Orchestrator
├─ 读取共享上下文
├─ 运行 manager 规划
├─ 分派 specialist
├─ 调用工具 / MCP
└─ 汇总最终回复

Context Services
├─ shared context
├─ conversation summary
└─ agent private memory

Execution Services
├─ tool layer
├─ skills loader
├─ MCP client layer
└─ run controller

Persistence Services
├─ messages
├─ team_runs
├─ run_steps
├─ assignments
├─ artifacts
└─ context snapshots
```

### 建议执行流程

```text
用户消息
→ Team Ingress
→ Context Builder
→ Manager 规划
→ Specialist / Tool / MCP
→ Manager 汇总
→ 主线程回复用户
→ 持久化消息、状态、产物、记忆
```

### 建议存储边界

至少应明确区分：

- public messages
- internal messages
- run records
- run steps
- assignments
- artifacts
- context snapshots

这样后续才能稳定支持：

- 暂停 / 恢复 / 取消
- run 回放
- artifact 浏览
- 群组上下文摘要

#### 内部协调通信

默认不在主线程完整展开，但可在 run 详情中查看。

适合：

- 子任务交接
- 中间推理
- 工具结果转发
- manager 与 specialist 的内部协调

这样既保留复杂协作能力，又不让主线程过度噪声化。

### 群组上下文装配

每个加入群组会话的 Agent 在执行前都应收到统一的 group context bundle，至少包含：

- 群组名称与目标
- 群组成员列表与角色
- 当前会话最近消息
- pinned 决策与共享记忆
- 当前活跃任务
- 当前 workspace 摘要
- 当前运行中的 run 简述

在此基础上，每个 Agent 再叠加自己的：

- 私有 memory
- 私有 skills
- 私有 MCP 可用范围
- 私有 workspace

## Provider 架构

第一版只支持两个 provider：

- OpenAI
- Qwen

每个 provider 通过统一注册结构接入：

- `id`
- `label`
- `apiKey`
- `baseURL`
- `defaultModel`
- `supportsToolCalling`
- `supportsStreaming`

结合原型中的设置页，建议把 provider 配置拆成：

- 供应商
- Base URL
- API Key
- 默认模型

## 工具体系

第一版工具层包含：

- 文件工具
- 终端工具
- 搜索工具
- MCP 工具
- Skills

其中搜索能力不绑定模型厂商，而是提供统一的产品级 `internet_search` 工具。

## 输入解析与任务控制层

为了支撑复杂交互，建议在 Renderer 与 Runtime 之间加入一层明确的输入解析器。

```text
用户输入
→ Input Parser
→ Intent Router
→ Chat Message / Slash Command / Run Control
→ Runtime Dispatcher
```

其中：

- 普通文本进入标准对话链路
- slash command 进入本地命令路由
- 运行控制命令直接进入 run controller

## Run 状态机

复杂任务需要明确的状态机，而不是只有“运行中”与“完成”。

建议 run 生命周期至少支持：

- `queued`
- `running`
- `pausing`
- `paused`
- `resuming`
- `completed`
- `failed`
- `cancelled`

### 暂停语义

第一版建议实现“协作式暂停”：

- 在 step 边界暂停
- 在子 Agent 调度前暂停
- 在下一次工具调用前暂停
- 对可控的终端任务尝试暂停或中断并保存上下文

这比一开始强行实现完全抢占式暂停更稳妥。

## 群组编排层建议

群组编排建议在 `packages/agent-runtime` 中单独抽出 team orchestrator，职责包括：

- 维护群组共享上下文
- 决定由谁响应
- 处理 Agent 间 `@`
- 跟踪子任务分配
- 汇总公开输出
- 向 Renderer 推送多 Agent 事件

## IPC 设计建议

Renderer 不应调用“原始系统函数”，而应调用“应用语义 API”。

建议优先定义如下 IPC 意图：

- `chat.listRooms`
- `chat.loadMessages`
- `chat.sendMessage`
- `chat.parseInput`
- `agents.list`
- `agents.create`
- `teams.list`
- `teams.create`
- `extensions.listSkills`
- `extensions.listMcpServers`
- `settings.load`
- `settings.save`
- `providers.testConnection`
- `runs.listByConversation`
- `runs.pause`
- `runs.resume`
- `runs.cancel`
- `runs.loadDetails`
- `teams.loadContext`

## 事件流建议

为了支撑聊天页和通知中心，运行时建议向 Renderer 推送统一事件流：

- 新消息
- run 开始
- run 完成
- run 失败
- run 暂停
- run 恢复
- artifact 生成
- 被提及
- Agent 状态变化
- Agent 间消息
- 群组上下文更新

这样 UI 可以统一驱动：

- 聊天气泡
- 顶部通知点
- 通知下拉
- 仪表盘统计
- 运行控制条
- 群组内部协作视图
