# 群聊执行模式设计

## 目标

`teamaligned` 的群聊不仅要能自然讨论，还要能在需要时真正开始工作：

- 创建文件
- 修改代码
- 写文档
- 调用工具与 MCP
- 运行命令

但执行方式不能像死板流水线，而应像真实团队：

- 先自然聊天
- 需要动手时自然进入执行
- 能并行就并行
- 有依赖或冲突就串行

## 一句话方案

```text
自然群聊 + work item 执行调度
```

也就是：

1. 默认先按自然群聊发言
2. 当用户明确要求“开始做 / 实现 / 修改 / 创建 / 修复”时，进入执行模式
3. system orchestrator 生成 work items
4. runtime 根据依赖和写入冲突划分执行批次
5. 可并行的批次并行执行，有依赖的批次串行执行
6. 执行结果再回到群聊主线程

## 何时进入执行模式

第一版只在“明确执行意图”时进入执行模式。

示例：

- “直接改一下这个页面”
- “开始实现”
- “帮我修复这个问题”
- “创建一个文件”
- “把这个需求落地”
- “帮我写代码”

普通讨论、头脑风暴和方案比较，不进入执行模式。

## work item

每个可执行任务都抽象成一个 `work item`。

第一版结构：

- `id`
- `owner`
- `summary`
- `kickoffMessage`
- `readTargets`
- `writeTargets`
- `dependsOnAgentIds`
- `canRunInParallel`

说明：

- `owner`：负责执行该任务的 Agent
- `summary`：任务摘要
- `kickoffMessage`：发到群里的自然启动消息
- `readTargets`：可能会读取的文件
- `writeTargets`：可能会写入的文件
- `dependsOnAgentIds`：依赖哪些 Agent 的输出
- `canRunInParallel`：是否允许并行

## 并行 / 串行策略

### 可并行

满足以下条件时可以并行：

- 没有依赖关系
- `canRunInParallel = true`
- `writeTargets` 不冲突
- 一方写、另一方只读且目标不重叠

### 必须串行

满足以下任意情况时必须串行：

- 两个任务写同一文件
- 一个任务写，另一个任务读取同一路径
- `dependsOnAgentIds` 指向对方
- 任一方 `canRunInParallel = false`

## 第一版并发限制

为了控制复杂度，第一版额外加两个硬限制：

- 同时执行的 work item 最多 `2` 个
- 每个 Agent 在一个 `team turn` 中最多拥有 `5` 个 work item

## 执行流程

```text
用户消息
  ↓
判断是否为执行型请求
  ↓
system orchestrator 生成 work items
  ↓
根据 dependsOn / readTargets / writeTargets 划分批次
  ↓
批次 1（最多 2 个）并行执行
  ↓
批次 2 串行或继续并行执行
  ↓
每个 Agent 把执行结果发回群聊主线程
  ↓
更新 shared-memory、run metadata、tool invocations
```

## 用户可见表现

用户在群聊里看到的是自然消息，而不是调度器术语。

例如：

- `Designer：我先整理设置页的信息层级。`
- `Coder：我同步拆一下 Provider 表单组件。`
- `Tester：我等前面两项完成后再补一轮验证。`
- `Coder：我已经拆好了模型配置表单，保存反馈也顺手调整了。`

不直接展示：

- DAG
- batch
- dependency graph
- write lock
- work item id

这些只作为内部运行信息存在。

## 当前第一版实现边界

第一版已经实现：

- 执行意图识别
- work item 生成
- 最多 2 个 work item 并行执行
- `writeTargets / readTargets / dependsOnAgentIds` 驱动的批次划分
- 执行结果回到群聊主线程
- shared-memory 更新
- run / tool invocation 继续落盘

第一版暂不实现：

- 动态文件锁升级
- 目录级复杂冲突图
- 多个 Agent 同时写同一文件后的自动合并
- 长时间任务抢占
- 执行失败后的自动重试编排

## 和自然群聊的关系

这不是替换自然群聊，而是在其上增加一层：

- 默认：自然发言
- 明确执行请求：进入执行模式
- 执行完成：回到自然聊天

也就是说，群聊仍然是聊天优先，只是在需要时具备真正工作的能力。
