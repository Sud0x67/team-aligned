# 群组运行时设计（Handoff + 双轨输出）

## 当前设计目标

群聊默认体验应当像真实团队聊天：

- 用户 `@谁`，谁先接话
- 没有 `@` 时，系统选择最相关成员
- 多轮对话保持“接棒”连续感
- 执行时持续输出过程，而不是只在开始和结束说一句

对应实现是：

```text
handoff 状态机 + messages/updates 双轨输出 + execution subagent
```

## 核心机制

### 1. handoff 状态机

`TeamContext` 现在持久化 `handoff`：

- `activeAgentId`
- `lastSpeakerId`
- `nextAgentIds`
- `reason`
- `revision`
- `updatedAt`

规则：

- 用户显式 `@Agent`：该 Agent 直接接棒。
- 如果用户显式 `@Agent` 且请求属于执行型任务，该 Agent 必须成为 `execution work item` owner；即使 planner 漏掉或误判成 chat，也会用 fallback 执行计划补齐。
- 无显式 `@`：优先延续 `activeAgentId`，再结合语义选择。
- Agent 消息里 `@` 下一位：下一小轮由被 `@` 成员接棒。
- 每轮结束后写回 handoff 状态，保证下一条用户消息具备连续上下文。

### 2. messages + updates 双轨输出

群聊运行中同时输出两类信息：

- `messages`：公开聊天消息（用户可见气泡，含流式文本）
- `updates`：运行过程更新（system run updates，用于“思考中/进行中”过程反馈）

工具调用现在会同时转成短的公开过程消息，例如：

- “我先看一下现有文件和上下文。”
- “我开始把这部分改进文件里。”
- “命令已经跑完了，我继续往下处理。”
- “我在 read_text_file 这一步遇到了问题：...”

这些消息会进入聊天主线程，但带有 `teamProcess` 元数据，并在下一轮 planner history 中被过滤，避免工具流水账污染后续意图识别。

`updates` 现在覆盖：

- 选人完成
- 接棒变化
- 并行批次开始/完成
- 依赖等待
- 工具调用开始/成功/失败
- 子任务完成/失败

这样即使某个 Agent 正在执行工具链，主线程也不会“静默像卡住”。

### 3. execution subagent（执行重活下沉）

执行模式不由主对话 Agent 直接做重活，而是由 `execution work item` 对应的独立 worker 执行：

- 独立 `thread_id`
- 独立工具观测
- 可流式回写文本
- 可上报阶段更新（started/streaming/completed/failed）

主线程只承载自然过程消息和结果消息，不暴露底层调度术语。

## 模式与限制

### 群成员上限

- 每个群组最多 `5` 个 Agent。
- UI 和存储层都做兜底裁剪。

### 对话轮次与消息上限

- 每个 `team turn` 最多 `5` 个小轮
- 每个 Agent 每个 turn 最多发言 `10` 次
- 每个 `team turn` 最多 `50` 条 Agent 消息

### 执行上限

- 每个 Agent 每个 turn 最多 `5` 个 work item
- 同时最多 `5` 个 work item 并行执行

## 模式选择

- `focused`：普通问题，优先 1~2 位成员
- `multi_voice`：多视角问题，优先 2~4 位成员
- `collaboration`：复杂协作，可扩展至 5 位成员并允许受控接力

## 用户可见体验

群聊里默认看到的是自然协作表达：

- 谁开始了
- 谁在继续
- 谁在等待前置依赖
- 谁完成了当前步骤
- 工具调用开始、完成或失败的简短自然说明
- 用户点击停止后，群聊主线程会明确说明本轮已取消并等待下一条指令

不默认展示：

- manager/specialist 术语
- 批处理实现细节
- work item id 或调度内部字段

## 当前实现状态

当前代码已落地：

- handoff 状态持久化与跨轮延续
- 显式 `@` 在执行模式中的 owner 兜底修正
- 选人时对 `activeAgentId` 的偏好
- 受控多轮接棒（含 Agent 间 @）
- messages/updates 双轨输出
- execution subagent 阶段更新回传
- 群聊过程中的工具调用自然化输出
- 群聊停止后重置 handoff 并输出公开取消反馈
- `/clear` 清理会话消息、run、transcript、team memory，并重置 handoff

## 后续可继续优化

- 长任务“心跳式”节奏更新（防长时间等待焦虑）
- handoff 可解释性（例如右侧栏显示最近接棒原因）
- execution updates 的密度自适应（避免过多刷屏）
