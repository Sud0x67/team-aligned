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
  providers.json
  mcp.json
  profile.json
  app.db

  skills/
    summarize/SKILL.md
    planner/SKILL.md

  avatars/
    user.png
    agents/
    teams/

  agents/
    designer/
      profile.json
      workspace/
      memory/
        MEMORY.md
      sessions/
        2026-04-05-001.jsonl

    frontend/
      profile.json
      workspace/
      memory/
      sessions/

  teams/
    landing-page/
      team.json
      shared-memory.md
      sessions/

  logs/
    app.log
    runtime.log
```

## 结合原型新增的本地数据对象

基于 Figma 原型，除了 Agent、Team、Conversation 之外，还应补充以下本地对象：

- 用户个人资料
- 通知记录
- 主题与语言偏好
- Agent / 群组头像资源
- 扩展安装状态

## SQLite 职责

SQLite 用于承担结构化实体、索引与统计能力。

第一版建议覆盖这些表：

- `agents`
- `teams`
- `team_members`
- `conversations`
- `messages`
- `runs`
- `artifacts`
- `notifications`
- `mcp_servers`
- `installed_skills`
- `installed_extensions`
- `workspace_metadata`
- `app_preferences`
- `run_checkpoints`
- `conversation_context_snapshots`
- `message_mentions`
- `slash_command_history`

## 文件职责

Markdown / JSON / JSONL 文件负责：

- 长期记忆
- Skills 内容
- 会话流水
- 用户可直接编辑的配置
- 本地日志

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

建议 provider 配置文件保存在 `providers.json`，每个 provider 结构统一：

```json
{
  "id": "openai",
  "label": "OpenAI",
  "apiKey": "env-or-user-secret",
  "baseURL": "https://api.openai.com/v1",
  "defaultModel": "gpt-5",
  "supportsToolCalling": true,
  "supportsStreaming": true
}
```

Qwen 在第一版优先通过 DashScope 的 OpenAI-compatible 接口接入，这样可以最大程度复用 provider 抽象。

## 用户偏好与个人资料

结合原型中的“设置页”和“个人资料弹窗”，建议拆成两类数据：

### `profile.json`

保存：

- 姓名
- 角色
- 团队
- 邮箱
- 个人简介
- 头像路径

### `settings.json`

保存：

- 语言
- 主题
- 通知开关
- 默认 provider
- 默认模型

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

注册信息集中保存在本地 `mcp.json` 或 SQLite 表中。

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

- planner 输出
- subagent 分配点
- tool 调用前后
- MCP 调用前后
- 产物写入前后

## 群组上下文快照

为了保证每个 Agent 知道当前群组上下文，建议引入 `conversation_context_snapshots`。

每个快照至少包含：

- `conversationId`
- `objective`
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
- 聊天附件：`~/.teamaligned/artifacts/attachments/`

数据库中只保存相对路径或资源引用，不保存大体积二进制。
