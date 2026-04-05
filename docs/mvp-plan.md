# MVP 计划

## MVP 定义

`teamaligned` 的 MVP 不是完整形态，而是一个可以稳定验证核心交互的本地桌面版本。

MVP 要证明三件事：

1. 用户可以像聊天软件一样使用单聊和群聊
2. Agent 可以在本地执行任务，并且支持暂停、继续和取消
3. Skills、MCP、workspace、memory 这些能力能以清晰的产品方式接入

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

如果继续推进开发，推荐顺序是：

1. 初始化 Electron + Vite + React 桌面壳
2. 先把 Figma 原型对应页面做成真实路由
3. 设计单聊命令解析和群聊上下文模型
4. 接入 SQLite + Drizzle 基础数据层
5. 用本地 mock data 跑通完整交互
6. 再接入真实 Agent Runtime

