# MVP 计划

## MVP 定义

`teamaligned` 的 MVP 不是完整形态，而是一个可以稳定验证核心交互的本地桌面版本。

MVP 要证明三件事：

1. 用户可以像聊天软件一样使用单聊和群聊
2. Agent 可以在本地执行任务，并且支持暂停、继续和取消
3. Skills、MCP、workspace、memory 这些能力能以清晰的产品方式接入

## 当前状态（2026-04-05）

当前仓库已经完成了 MVP 的“可体验骨架”部分：

- Electron 桌面应用壳可运行
- 对话、管理、扩展、仪表盘、设置五个页面已落地
- 单聊与群聊可以切换并交互
- `/skills`、`/command`、`/mcp`、`/pause`、`/resume`、`/cancel` 已接入消息流
- 单聊已接入真实 Qwen / OpenAI 模型调用
- 本地 run 状态、通知、资料弹窗、头像上传、本地 workspace 打开已可体验
- SQLite、JSONL transcript、artifact / memory / shared-memory 已开始落盘

当前还没有完全完成的部分主要是：

- 群聊真实模型调用链
- 真实 Skills 执行链
- 真实 MCP 调用链
- DeepAgents / LangGraph 在群聊与完整工具链中的替换
- 更完整的数据 schema 与导出审计能力

## MVP 目标

第一版要做到的是“可持续迭代的本地桌面骨架”，而不是静态原型。

用户至少应该能够：

- 打开桌面应用
- 浏览 Agent 会话与群组会话
- 与单个 Agent 私聊
- 在群组里和多个 Agent 协作
- 使用 `/skills`、`/command`、`/mcp` 这类命令式交互
- 对复杂任务执行暂停、继续、取消
- 管理 Agent 与群组
- 配置 OpenAI / Qwen
- 浏览并安装基础扩展
- 查看本地保存的会话历史和运行记录

从当前实现状态看，上面这些目标里，UI 和本地骨架已经基本达成；下一阶段重点是把 mock 行为替换为真实运行时。

## MVP 范围

### 平台范围

- macOS 桌面端
- 单用户
- 本地数据优先
- 单机运行

### 单聊能力范围

单 Agent 私聊需要支持：

- 自然语言输入
- `/skills` 查看、启用、禁用当前 Agent 可用技能
- `/command` 发起本地命令或任务执行
- `/mcp` 查看和调用当前可用的 MCP 能力
- 复杂任务的暂停、继续、取消
- 流式输出与执行状态展示

### 群聊能力范围

Team 群聊需要支持：

- 多个 Agent 参与同一会话
- Agent 之间互相通信
- Agent 互相 `@` 触发协作
- Agent 感知群组上下文
- manager agent 作为统一入口
- specialist subagent 之间的分工协作
- 群组任务进度和运行结果可见

### 能力范围

- OpenAI + Qwen
- 单 Agent 私聊
- Team 群聊
- 文件工具
- 终端工具
- 搜索工具
- stdio MCP
- HTTP MCP
- `SKILL.md`

### 页面范围

结合原型，MVP 至少覆盖这些页面：

- 对话页
- 管理页
- 扩展页
- 设置页
- 仪表盘页

## 明确不做

MVP 不做：

- 云同步
- 多人协作
- 过多 provider
- 分布式执行
- 托管 workspace
- 重型 SaaS 后端
- 复杂的权限市场

## MVP 验收标准

第一版可玩的本地构建应满足：

- 默认进入对话页
- 可切换 Agent 会话与群组会话
- 单聊可执行 `/skills`、`/command`、`/mcp`
- 单聊复杂任务支持暂停、继续、取消
- 群聊可以看到 Agent 间的协作与 `@` 行为
- 群组上下文会影响 Agent 回答
- 可创建 Agent 与群组
- 可切换语言和主题
- 可配置 OpenAI 或 Qwen
- 会话、设置、运行状态能持久化到本地

## 当前验收结论

截至当前版本，下面这些项已经达到：

- 默认进入对话页
- 可切换 Agent 会话与群组会话
- 单聊可执行 `/skills`、`/command`、`/mcp`
- 单聊复杂任务支持暂停、继续、取消
- 群聊可以看到 Agent 间的协作与 `@` 行为
- 可创建 Agent 与群组
- 可切换语言和主题
- 可配置 OpenAI 或 Qwen
- 会话、设置、运行状态已开始持久化到本地

仍需要进一步加强的项：

- 群组上下文对真实模型输出的影响还需要真实运行时接入来验证
- Skills、MCP、Provider 当前仍有一部分是 mock 或半 mock
- 运行状态与 artifact 需要更强的结构化展示和检索能力

## 分阶段实施建议

### 阶段 1：文档与仓库骨架

交付：

- 项目命名
- 目录结构
- 中文设计文档
- 原型对齐说明

### 阶段 2：桌面应用壳

交付：

- Electron 主进程
- preload
- React + Vite renderer
- 路由与主导航骨架

### 阶段 3：本地数据底座

交付：

- SQLite
- Drizzle schema
- agents / teams / conversations / messages / runs 基础仓储
- 本地 settings / profile / providers 读写

### 阶段 4：聊天交互 MVP

交付：

- 对话页
- 单聊命令解析
- 群聊 @ 解析
- pause / resume / cancel 状态机
- 流式消息与运行状态展示

### 阶段 5：原型级 UI 落地

交付：

- 管理页
- 扩展页
- 设置页
- 仪表盘页
- 通知面板
- 个人资料弹窗

### 阶段 6：运行时接入

交付：

- Provider Registry
- OpenAI 接入
- Qwen 接入
- DeepAgents 集成
- 消息发送与基础 Agent 响应

### 阶段 7：本地能力与扩展

交付：

- 文件工具
- 终端工具
- 搜索工具
- Skills 加载
- MCP 注册与调用

## 当前推荐的下一步

如果继续推进开发，推荐顺序已经更新为：

1. 接入真实 Provider Registry 与 OpenAI / Qwen 请求链路
2. 把 `/skills`、`/command`、`/mcp` 从 mock 行为替换为真实执行链
3. 引入 DeepAgents / LangGraph，替换当前 mock runtime
4. 用 Drizzle 把 SQLite 数据层整理成正式 schema 和 migration
5. 增强 run / artifact / transcript 的结构化展示与可审计能力
