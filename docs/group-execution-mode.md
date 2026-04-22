# 群聊执行模式（第一版）

## 目标

群聊不仅要能讨论，还要能真的“干活”：

- 读写工作区文件
- 跑命令与工具
- 调用 MCP
- 并行推进不同分工

同时保持聊天自然，不把主线程变成调度台。

## 触发条件

当用户输入具备明显执行意图时进入执行模式，例如：

- 开始做 / 直接改 / 帮我实现
- 修复 / 创建文件 / 写代码
- 设计页面 / 产出落地内容

无明确执行意图时保持自然讨论模式。

## 执行模型

### work item

每个执行任务拆为 `work item`：

- `id`
- `owner`
- `summary`
- `kickoffMessage`
- `readTargets`
- `writeTargets`
- `dependsOnAgentIds`
- `canRunInParallel`

### 批次划分

依据以下条件分批：

- 依赖关系（`dependsOnAgentIds`）
- 读写冲突（`writeTargets/readTargets`）
- 并行许可（`canRunInParallel`）

可并行则并行，有依赖/冲突则串行。

## 执行下沉到 subagent

每个 work item 由独立 execution worker 执行：

- 独立 thread_id
- 独立工具调用链
- 独立流式文本输出
- 独立阶段更新回调

这让主对话线程保持清爽，重执行逻辑集中在 worker 层。

## 双轨可见性

执行模式输出两条轨道：

- `messages`：用户可见聊天消息（kickoff、流式正文、结果）
- `updates`：system run updates（开始、等待、批次切换、工具进度、完成）

这样可避免“执行中看起来卡住”。

## 当前限制

- 群组成员上限：`5`
- 小轮上限：`5`
- 每个 Agent 发言上限：`10`
- 每个 turn Agent 消息上限：`50`
- 每个 Agent work item 上限：`5`
- 并行 work item 上限：`5`

## 当前实现结果

已实现：

- 执行意图识别
- work item 规划与批次划分
- 执行 worker 流式输出
- 工具调用自然过程消息
- 依赖等待显式输出
- 批次开始/结束连续更新
- 执行结果回写群聊主线程

## 还可继续优化

- 更细粒度的工具阶段归纳（减少重复表述）
- 超长任务心跳更新节流
- 失败后的自动重试策略与人工接管入口
