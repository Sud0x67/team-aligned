# 运行时与存储

## 存储原则

本地存储遵循三个原则：

1. 人可读内容优先存文件
2. 结构化查询优先存 SQLite
3. 会话与执行过程必须可审计

## 本地应用目录

应用主目录建议固定为：

```text
~/.teamaligned/
```

建议目录结构如下：

```text
~/.teamaligned/
  settings.json
  app.db
  transcripts/

  skills/
    summarize/SKILL.md
    planner/SKILL.md

  avatars/
    profile/
    agents/
    teams/

  workspaces/
    agents/
      designer/
        artifacts/
          attachments/
        memory/
          MEMORY.md
        sessions/
          2026-04-05-001.jsonl
    teams/
      landing-page/
        artifacts/
          attachments/
        shared-memory.md
        sessions/
          2026-04-05-001.jsonl

  logs/
    app.log
    runtime.log
```

当前实现里的目录职责如下：

- `settings.json`
  用户配置主文件
- `app.db`
  结构化运行状态
- `transcripts/`
  全局会话审计流水
- `avatars/profile/`
  个人头像资源
- `avatars/agents/`
  Agent 头像资源
- `avatars/teams/`
  群组头像资源
- `workspaces/agents/*`
  Agent 默认 workspace
- `workspaces/teams/*`
  Team 默认 workspace

如果用户显式指定了 workspace 路径，则对应 Agent / Team 的工作目录会改用用户提供的位置。

当前实现不再做旧目录兼容迁移：

- 运行时只使用 `~/.teamaligned` 作为唯一根目录
- 启动不会再自动复制 `~/teamaligned` 或 Electron `userData/teamaligned` 的历史数据
- 旧格式 `app-state.json` 不再自动导入
- 新写入的数据一律以 `~/.teamaligned` 为根目录
- 如果检测到旧版不兼容 SQLite schema，运行时会直接报错并提示先备份再重建 `app.db`

## 结合原型新增的本地数据对象

基于 Figma 原型，除了 Agent、Team、Conversation 之外，还应补充以下本地对象：

- 用户个人资料
- 通知记录
- 主题与语言偏好
- Agent / 群组头像资源
- 扩展安装状态

## 三层持久化原则

建议把本地持久层拆成三层：

1. `settings.json`
   用于保存用户可以直接阅读和编辑的配置。
2. `app.db`
   用于保存结构化状态、列表查询、统计和运行态数据。
3. `JSONL / Markdown / artifacts`
   用于保存 transcript、长期记忆、共享记忆和产物文件。

这样拆分的原因是：

- 配置和运行数据语义不同
- 用户配置更适合放到可读文件中
- 历史流水和产物更适合以文件形式审计和导出
- 结构化查询仍然交给 SQLite

## `settings.json` 作为主配置文件

建议把下面这些内容统一放在 `~/.teamaligned/settings.json`：

- 主题
- 语言
- 通知开关
- 当前激活 provider
- provider 列表
- 用户个人资料
- 后续也可扩展全局默认值，例如默认技能策略、默认 MCP 偏好等

示例：

```json
{
  "theme": "light",
  "language": "zh",
  "notifications": {
    "agentComplete": true,
    "mention": true,
    "group": true
  },
  "activeProviderId": "qwen",
  "providers": [
    {
      "id": "qwen",
      "label": "百炼 (DashScope)",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "apiKey": "env:DASHSCOPE_API_KEY",
      "defaultModel": "qwen-max",
      "supportsToolCalling": true,
      "supportsStreaming": true
    },
    {
      "id": "openai",
      "label": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "env:OPENAI_API_KEY",
      "defaultModel": "gpt-5",
      "supportsToolCalling": true,
      "supportsStreaming": true
    }
  ],
  "profile": {
    "name": "Alex Chen",
    "role": "产品经理",
    "team": "TeamAligned",
    "email": "alex@example.com",
    "bio": "关注本地优先 AI 工作流与多 Agent 协作体验。",
    "avatarPath": "/Users/bobo/.teamaligned/avatars/profile/alex-chen-ab12cd34.png"
  }
}
```

说明：

- `settings.json` 应作为用户配置的 source of truth
- API Key 后续可以支持三种形式：
  - 明文值
  - `env:VAR_NAME`
  - 未来扩展为 `keychain:provider-id`
- 配置类数据不建议优先放 SQLite，因为用户手动修改和迁移配置的需求更强

## SQLite 职责

SQLite 用于承担结构化实体、索引与统计能力。

当前版本已经实际落地的核心表包括：

- `agents`
- `teams`
- `conversations`
- `messages`
- `runs`
- `attachments`
- `artifacts`
- `tool_invocations`
- `run_steps`
- `notifications`
- `prompt_aliases`
- `skill_catalog`
- `mcp_catalog`
- `mcp_connections`

当前仓库也已经补上了 Drizzle 基线：

- `packages/agent-runtime/src/db/schema.ts`
  维护正式 schema 定义
- `packages/agent-runtime/drizzle/`
  保存基线 migration 与快照
- `npm run db:generate`
  生成新的 migration
- `npm run db:migrate`
  对 `~/.teamaligned/app.db` 应用 migration（新版本不再包含旧库自动兼容标记逻辑）

其中：

- `conversations / messages / runs`
  已经具备结构化字段列和索引，同时保留 `payload` 作为兼容字段
- `agents / teams / providers / notifications`
  也已经具备首版结构化字段列和索引，方便管理页、设置页和通知中心做稳定查询
- `attachments / artifacts / tool_invocations / run_steps`
  已经进入正式结构化表，后续可直接支撑 run 详情、审计和导出
- `prompt_aliases`
  保存用户在扩展页创建的自定义 Prompt 快捷方式，可通过 `/别名` 在聊天中调用

目前 `runs` 的结构化 metadata 已经会补充这些关联信息：

- `transcriptPath`
  全局 transcript 路径
- `workspaceTranscriptPath`
  绑定到 Agent / Team workspace 的会话 transcript 路径
- `artifactPath`
  当前 run 产物主文件路径
- `memoryPath`
  本轮更新到的 `MEMORY.md` 或 `shared-memory.md` 路径

当前聊天页已经直接消费这些表对应的数据，用于展示：

- run 详情
- 步骤时间线
- artifact 列表
- attachment 列表
- 工具与 MCP 调用记录

后续仍建议继续补的表或规范化对象包括：

- `team_members`
- `workspace_metadata`
- `conversation_context_snapshots`
- `message_mentions`
- `slash_command_history`
- `installed_skills`
- `installed_extensions`

这里刻意不把 `settings / providers / profile` 作为主存储放进 SQLite。

原因是：

- 它们更像配置，不像业务流水
- 用户可能直接打开编辑
- 导入导出和迁移机器更方便
- 不需要复杂查询能力

## 文件职责

Markdown / JSON / JSONL 文件负责：

- 长期记忆
- Skills 内容
- 会话流水
- 用户可直接编辑的配置
- 本地日志

具体建议如下：

- `settings.json`
  用户配置
- `transcripts/*.jsonl`
  全局审计流水
- `workspaces/**/sessions/*.jsonl`
  与 workspace 绑定的对话流水
- `workspaces/**/memory/MEMORY.md`
  Agent 长期记忆
- `workspaces/**/shared-memory.md`
  Team 共享记忆
- `workspaces/**/artifacts/*`
  实际产物文件
- `workspaces/**/artifacts/attachments/*`
  与 Agent / Team workspace 绑定的聊天附件
- `avatars/**`
  头像资源文件
- `skills/**`
  全局安装的 Skill 文件

## 会话记录格式

会话 transcript 建议使用 JSONL，原因是：

- 追加简单
- 易于审计
- 易于导出
- 方便流式写入

每条记录可以表达：

- 用户消息
- Agent 消息
- 工具调用
- 状态变更
- 产物引用
- 提及事件
- 命令式输入
- Agent 间内部通信

建议每条消息至少具备以下可扩展字段：

- `messageType`
- `visibility`
- `senderKind`
- `mentions`
- `replyTo`
- `runId`
- `artifactIds`

其中：

- `messageType` 可区分文本、命令、系统事件、工具事件
- `visibility` 可区分公开线程消息与内部协调消息

## 搜索设计

本地搜索建议分两层：

### 文件与代码搜索

使用：

- `ripgrep`

### 结构化全文检索

使用：

- SQLite FTS5

这样可以同时支持：

- 搜索本地代码和文档
- 搜索历史消息和运行记录
- 搜索产物摘要
- 搜索 slash command 历史
- 搜索群组内提及记录

## Provider 配置

Provider 建议直接作为 `settings.json` 的一部分，不再拆单独 `providers.json`。

Qwen 在第一版优先通过 DashScope 的 OpenAI-compatible 接口接入，这样可以最大程度复用 provider 抽象。

## 用户偏好与个人资料

结合原型中的“设置页”和“个人资料弹窗”，建议统一并入 `settings.json`。

这样做的好处是：

- 用户只需要理解一个全局配置文件
- profile 和 settings 之间不会分散
- provider 切换、个人资料和偏好设置能一起导入导出

## Skills 加载顺序

Skills 建议支持三层来源：

1. 应用内置 skills
2. 用户全局 skills
3. 当前 workspace skills

同名 skill 的覆盖顺序以后者优先。

## Slash Command 模型

为了支持单聊中的复杂交互，建议把 slash command 视为正式输入类型，而不是普通消息文本。

第一版记录结构建议包含：

- `id`
- `conversationId`
- `raw`
- `commandName`
- `args`
- `createdAt`
- `createdBy`
- `linkedRunId`

命令执行结果仍然回流到消息线程中展示。

## MCP 范围

第一版只支持：

- stdio MCP
- HTTP MCP

MCP 的静态 metadata 来自远端 registry，本地真实连接状态建议保存在 SQLite 中。

原因是：

- metadata 由 registry 管理
- connection 状态属于运行态数据
- 健康检查结果、discovered tools、最近错误更适合结构化查询

## 通知模型

由于原型中存在通知面板，建议通知作为独立对象处理。

通知可分为：

- Agent 完成任务
- 在群组中被提及
- 系统同步完成
- Run 执行失败
- 扩展安装完成

通知需要记录：

- `id`
- `type`
- `title`
- `body`
- `read`
- `createdAt`
- `relatedConversationId`
- `relatedRunId`

## Run 检查点与暂停恢复

因为你希望复杂任务可暂停，运行时需要持久化 checkpoint。

`run_checkpoints` 建议记录：

- `runId`
- `stepIndex`
- `phase`
- `agentId`
- `statePayload`
- `createdAt`

第一版 checkpoint 应优先覆盖：

- orchestrator 输出
- subagent 分配点
- tool 调用前后
- MCP 调用前后
- 产物写入前后

## 群组上下文快照

为了保证每个 Agent 知道当前群组上下文，建议引入 `conversation_context_snapshots`。

每个快照至少包含：

- `conversationId`
- `membersSummary`
- `activeTasks`
- `recentDecisions`
- `pinnedArtifacts`
- `workspaceSummary`
- `createdAt`

群组 Agent 在开始新 step 前，应读取最近一次上下文快照。

## Agent 间消息模型

群组里的 Agent 之间可以通信和互相 `@`，因此消息系统需要支持：

- 用户 → Agent
- Agent → 用户
- Agent → Agent
- manager → specialist
- specialist → manager

建议消息可见性定义为：

- `public`：展示在主线程
- `internal`：只在 run 详情或调试视图展示
- `system`：系统事件

这样可以兼顾可读性与复杂编排。

## 头像与附件存储

原型中已经支持用户、Agent、群组头像上传，因此建议本地资源单独落盘：

- 头像文件：`~/.teamaligned/avatars/`
- 聊天附件：`~/.teamaligned/workspaces/**/artifacts/attachments/`

数据库中只保存相对路径或资源引用，不保存大体积二进制。
