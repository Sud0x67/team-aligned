# 群组运行时设计

## 当前方向

`teamaligned` 的群聊不再采用默认的 `manager -> specialist` 强编排模式。

当前方案改为：

```text
自然群聊 = @ 优先 + 语义选人 + 受控多轮发言 + 不可见 orchestrator
```

用户看到的是多个 Agent 像真实群成员一样自然发言；系统内部仍然有不可见的 orchestrator 负责选择谁说话、控制轮数、限制 token 成本和避免循环。

## 设计目标

- 群聊像人类群聊一样自然。
- 默认不出现 manager 或主持人。
- 用户 `@Agent` 时，被点名 Agent 优先回应。
- 没有 `@` 时，系统按语义选择相关 Agent。
- 复杂问题可以展示多个 Agent 的交流过程。
- Agent 可以互相 `@`，但不能无限循环聊天。
- 群聊规模和每轮消息数必须有硬上限。

## 群组规模

第一版群组规则：

- 每个群组最多 `5` 个 Agent。
- 创建群组时 UI 限制最多选择 5 个成员。
- 存储层也会兜底裁剪到 5 个成员。
- 运行时只在最多 5 个有效成员中选择发言者。

这个限制是产品规则，不只是性能优化。它可以降低 token 成本，也能让用户更容易理解谁可能参与发言。

## 发言模式

运行时定义三种模式：

### 1. `focused`

用于普通问题。

- 选择 1 到 2 个 Agent。
- 不默认拉全员。
- 不默认互相 `@`。

### 2. `multi_voice`

用于多视角讨论。

- 选择 2 到 4 个 Agent。
- 每个 Agent 直接在群里给出自己的视角。
- 不强制汇总。

### 3. `collaboration`

用于脑暴、分工、复杂协作或跨多个能力域的问题。

- 选择 3 到 5 个 Agent。
- Agent 可以互相 `@`。
- 最多 2 个小轮。
- 每个用户消息最多 8 条 Agent 消息。
- 到达上限后必须停止。

## @ 优先规则

如果用户显式 `@Agent`：

- 被 `@` 的 Agent 优先发言。
- 如果只 `@` 一个 Agent，默认只让它回应。
- 如果 `@` 多个 Agent，让这些 Agent 依次回应。
- 未被 `@` 的 Agent 默认不抢话，除非后续版本明确引入补充机制。

如果没有 `@`：

- system orchestrator 根据用户语义、Agent role、capabilities、最近上下文选择 1 到 5 个 Agent。
- 普通问题通常只选 1 到 2 个。
- 只有复杂问题才选 3 到 5 个。

## 防止无限循环

第一版硬边界：

- 每个群组最多 5 个 Agent。
- 每个用户消息开启一个 `team turn`。
- 每个 `team turn` 最多 2 个小轮。
- 每个小轮最多 5 个 Agent 发言。
- 每个 `team turn` 最多 8 条 Agent 消息。
- Agent 互相 `@` 只能触发下一小轮。
- 同一个 Agent 在同一个 `team turn` 中最多发言一次。

这些规则保证群聊可以展示协作过程，但不会变成无限 Agent 对话。

## 静默规则

每个 Agent 的 prompt 都要求：

- 如果你的观点和前面 Agent 重复，请保持沉默。
- 如果你没有明显贡献，不要为了发言而发言。
- 回复要像群聊消息，不要写成长篇报告。
- 除非用户要求详细分析，否则保持简短、具体、可执行。

## 运行流程

```text
用户消息
  ↓
读取群组成员，最多 5 个
  ↓
解析用户 @
  ↓
system orchestrator 选择模式 focused / multi_voice / collaboration
  ↓
选择本轮发言 Agent
  ↓
Agent 依次生成自然群聊消息
  ↓
如果 collaboration 中出现互相 @，最多进入下一小轮
  ↓
达到终止条件
  ↓
更新 shared-memory 与 run 状态
```

## 用户可见消息

群聊主线程可见：

- 用户消息
- Agent 自然回复
- Agent 之间公开 `@`
- Agent 向用户的明确问题

默认不再显示：

- manager 分派消息
- specialist 内部报告
- 强制汇总消息

内部 run 状态仍然会落盘，但不应该抢占主线程体验。

## 当前实现状态

当前代码已经实现：

- 不可见 system orchestrator 选择发言 Agent。
- `@` 优先。
- 无 `@` 时按语义选择 1 到 5 个 Agent。
- `focused / multi_voice / collaboration` 三种模式。
- 群组最多 5 个 Agent。
- 每个 team turn 最多 2 小轮、最多 8 条 Agent 消息。
- Agent 可在复杂协作中互相 `@`，触发下一小轮。
- 群组 shared-memory 会记录本轮话题、发言成员和阶段性结论。

## 后续可优化

- 更好的 speaker selection 可解释性。
- UI 展示“本轮参与 Agent”。
- 群聊消息的轻量类型标识，例如 suggestion / question / result。
- 更强的多轮上下文压缩。
- 群聊失败恢复和 checkpoint。
