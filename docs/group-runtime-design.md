# 群组运行时设计

## 文档目标

这份文档专门定义 `teamaligned` 中 Team 群聊的真正后端方案。

目标不是做一个传统聊天室后端，而是做一个：

- local-first
- 可审计
- 可暂停 / 恢复 / 取消
- 贴近真实团队聊天体验

的本地多 Agent 编排后端。

## 一句话方案

群组运行时应采用：

`本地 Team Orchestrator + manager 中心化调度 + specialist 协作执行 + SQLite 事件存储`

## 设计原则

### 1. local-first

群组协调、上下文维护、事件记录、artifact 落盘都应优先在本地完成。

网络只用于：

- 模型调用
- 外部 MCP
- 外部搜索

不用于群组协作本身。

### 2. 聊天优先

用户看到的永远先是一个聊天线程，而不是一个工作流编辑器。

### 3. manager 主沟通

默认由 manager 面向用户发言。

### 4. specialist 受控升级

specialist 默认不直接打断用户，只有在必要时才直接 `@用户`。

### 5. 主线程与内部线程分离

公开消息和内部协作必须分开建模，否则后续 run 详情、审计、恢复都会很乱。

### 6. 所有关键事件可持久化

消息、步骤、分派、工具调用、artifact、上下文快照都应可恢复。

## 运行时模块

```text
Team Ingress
├─ 接收用户消息
├─ 识别 @ 与命令
└─ 创建 team run

Team Orchestrator
├─ 构建上下文
├─ 运行 manager 规划
├─ 分派 specialist
├─ 调用 tool / MCP
└─ 汇总最终回复

Agent Workers
├─ manager worker
├─ specialist worker
└─ shared tool access

Context Services
├─ shared context
├─ conversation summary
└─ agent private memory

Persistence Services
├─ public messages
├─ internal messages
├─ team_runs
├─ run_steps
├─ assignments
├─ artifacts
└─ context snapshots
```

## 交互协议

### 用户消息入口

所有群组消息先进入 manager，而不是广播给所有 specialist。

manager 决定：

- 自己直接回答
- 调用 specialist
- 调用工具
- 调用 MCP
- 向用户提问

### 面向用户的默认发言规则

- manager 是默认主发言人
- specialist 默认先回给 manager
- manager 汇总后再回复用户

### specialist 直接 `@用户`

允许，但不应默认开启。

推荐触发条件：

- specialist 需要非常具体的专业输入
- manager 转述会损失精度
- 用户已经明确在和该 specialist 深入协作
- manager 已授权 specialist 直接提问

运行时上建议建模为：

- `needs_user_input`
- `manager_review`
- `user_visible_question`

也就是 specialist 先提出“需要用户确认”，再由 manager 决定是否直接升级到主线程。

## 消息模型

群组至少需要三类消息：

### 1. Public Message

主线程消息，对用户可见。

适合：

- 用户输入
- manager 回复
- specialist 经授权后直接 `@用户`
- 公开协作消息

### 2. Internal Message

默认折叠，只在内部协作视图或 run 详情中查看。

适合：

- manager 分派 specialist
- specialist 之间对齐方案
- tool / MCP 结果同步
- specialist 提交 `needs_user_input`

### 3. System Message

系统状态消息。

适合：

- run 开始 / 暂停 / 恢复 / 取消
- provider 错误
- tool 失败
- artifact 已生成

## 上下文模型

### Shared Context

所有群组成员共享：

- 群组目标
- 当前阶段
- 活跃任务
- 关键约束
- 已确认决策
- 共享 artifact

### Conversation Summary

当前线程的滚动摘要，用来控制上下文长度。

### Agent Private Memory

每个 agent 私有：

- 自己的偏好
- 自己擅长的执行模式
- 自己的历史经验

不建议把所有记忆直接混成一份共享记忆。

## 执行流程

```text
用户消息
→ Team Ingress
→ Context Builder
→ Manager 规划
→ Specialist / Tool / MCP
→ Manager 汇总
→ 主线程回复用户
→ 写入 message / run / step / artifact / summary
```

## 数据持久化建议

正式数据层至少应支持以下实体：

- `teams`
- `team_members`
- `conversations`
- `messages`
- `team_runs`
- `run_steps`
- `assignments`
- `artifacts`
- `context_snapshots`
- `tool_invocations`

其中 `messages` 建议至少具备：

- `visibility`
- `sender_kind`
- `sender_id`
- `mentions`
- `run_id`
- `parent_message_id`
- `created_at`

## 面向用户的状态表达

用户在主线程中应该看到的是轻量、接近真人团队协作的状态，而不是完整图执行细节：

- 正在讨论中
- 某成员处理中
- 等待你的确认
- 已汇总结论

更细的执行内容，例如：

- specialist 分派
- tool call
- MCP call
- 内部协作消息

应放在可展开的 run 详情里。

## 当前推荐的开发顺序

1. 用 LangGraph 重写群聊 `team run`
2. 建立 manager / specialist 的真实 worker 协议
3. 把 shared context 接入 manager prompt
4. 把 internal / public / system 三类消息彻底分开
5. 接入真实 Skills / MCP / tool layer
6. 再补 run 详情与恢复机制

## 验收标准

当下面这些条件达成时，可以认为群组后端进入 Alpha 可用：

- 群聊回复不再依赖脚本化模板
- manager 会真实调度 specialist
- specialist 默认不直接打断用户
- specialist 可以在必要时受控 `@用户`
- 群组上下文会真实影响输出
- run / step / artifact / context 可以稳定恢复
