# 开发 TODO

## 当前判断

更新时间：2026-04-06

当前项目已经不是纯原型，也还不是完整可交付产品。

更准确的定位是：

- 可体验的桌面应用
- 单聊已接入真实模型
- 群聊、Skills、MCP 仍处于半真实或 mock 过渡阶段
- 本地持久化已经可用，但数据层还没有正式工程化

当前完成度的主观估计：

- 产品体验完成度：约 75%
- 真实运行时完成度：约 45%
- 工程化与可交付完成度：约 35%
- 综合完成度：约 55%

一句话结论：

`teamaligned` 现在已经是一个“可体验的本地 AI Agent 桌面原型”，但距离“真实可长期使用的应用程序”还差一轮关键能力接线和工程化收口。

## 已完成基线

下面这些能力已经完成，不再作为当前主 TODO：

### 桌面应用与页面骨架

- [x] Electron + React + Vite 桌面应用壳
- [x] 对话、管理、扩展、仪表盘、设置五个主页面
- [x] 左侧导航、顶部栏、通知入口、个人资料入口
- [x] Figma 对齐后的首版 UI
- [x] 浅色 / 深色主题切换
- [x] 中英文切换

### 对话与交互基线

- [x] 单 Agent 私聊
- [x] Team 群聊
- [x] `/pause`、`/resume`、`/cancel` run 控制
- [x] `/command` 本地真实命令执行
- [x] 消息、通知、run 状态在 UI 中联动展示

### 模型与运行时基线

- [x] 接入 DeepAgents
- [x] 接入 LangChain
- [x] 接入 LangGraph
- [x] 单聊接入真实 Qwen / DashScope
- [x] 单聊接入真实 OpenAI
- [x] 设置页 provider 配置驱动单聊模型调用

### 本地持久化基线

- [x] SQLite 本地持久化
- [x] JSONL transcript 落盘
- [x] agent workspace 目录初始化
- [x] team workspace 目录初始化
- [x] artifact / MEMORY.md / shared-memory.md 落盘

### 管理与配置

- [x] 创建 Agent
- [x] 创建群组
- [x] 个人资料编辑
- [x] Agent / 群组 / 个人头像上传
- [x] Provider 设置页首版
- [x] 扩展中心首版

## 当前真实缺口

真正阻止项目从“高级原型”进入“Alpha 可用”的，不是 UI，而是下面这些运行时和工程化缺口：

1. 群聊还不是真实多 Agent 编排。
2. `/skills` 还没有接入真实 `SKILL.md` 执行链。
3. `/mcp` 还没有接入真实 stdio / HTTP MCP。
4. 单聊虽然用了真实模型，但工具层还没有真正接齐。
5. SQLite 已经在用，但还没有 Drizzle schema、migration 和正式索引。
6. 测试和发布链路还远远不够。

## P0：把原型升级为 Alpha 可用版本

### 1. 群聊真实运行时

这是当前最重要的缺口。

- [ ] 用 DeepAgents + LangGraph 建立真实的 manager / specialist 群聊运行时
- [ ] 让群组上下文真实进入 manager prompt 和协作链路
- [ ] 让 Agent 之间的 `@` 不只是展示，而是真实触发协作
- [ ] 让 specialist 输出来自真实模型，而不是脚本化文案
- [ ] 让群聊 run 状态和真实执行步骤同步
- [ ] 让群聊暂停 / 恢复 / 取消真正作用于真实运行时

Alpha 验收标准：

- 群聊不再依赖预设回复模板
- manager 会真实调度 specialist
- 群组上下文能真实影响输出

### 2. Skills 真实接线

- [ ] 读取应用内置 `SKILL.md`
- [ ] 支持用户全局 skills 目录
- [ ] 支持 workspace 级 skills 目录
- [ ] `/skills` 展示当前会话可用 skills
- [ ] `/skills use <name>` 真实切换技能上下文
- [ ] 在消息流中显示“当前技能已生效”的结果

Alpha 验收标准：

- Skills 不再只是“会话元数据”
- 技能会真实改变 prompt、行为或工具选择

### 3. MCP 真实接线

- [ ] 设计本地 MCP 注册表
- [ ] 支持 stdio MCP
- [ ] 支持 HTTP MCP
- [ ] `/mcp` 列出当前可用 MCP
- [ ] `/mcp <name>` 真实调用目标 MCP
- [ ] 扩展页展示协议、健康状态、启用状态、错误信息

Alpha 验收标准：

- MCP 能真实完成一次端到端调用
- 调用结果可以在消息流中被消费和展示

### 4. 工具层接入真实 Agent Runtime

虽然 `/command` 已经可以执行，但当前工具层还没有完整并入 DeepAgents。

- [ ] 文件读取工具接入 Agent Runtime
- [ ] 文件写入工具接入 Agent Runtime
- [ ] ripgrep 本地搜索工具接入 Agent Runtime
- [ ] 统一 `/command` 与 agent tool layer 的行为
- [ ] 让 artifact 结果可以被 Agent 后续继续引用

Alpha 验收标准：

- 单聊和群聊都能真实使用本地工具
- 工具结果不是孤立输出，而是可进入后续推理链

## P1：把产品变成可维护的真实工程

### 5. 正式数据层

当前已经使用 SQLite，但仍然偏“轻量 payload 存储”。

- [ ] 引入 Drizzle
- [ ] 设计正式 schema
- [ ] 增加 migration
- [ ] 规范 agents / teams / conversations / messages / runs / artifacts 表
- [ ] 为查询频繁字段增加索引
- [ ] 建立 transcript / artifact / memory 的关联关系

验收标准：

- 数据结构清晰可演进
- 重启恢复和历史查询更稳定

### 6. Provider 与运行时可靠性

- [ ] 设置页增加 provider 连通性测试
- [ ] API Key / Base URL / 模型参数校验
- [ ] 统一模型错误提示和失败态
- [ ] 补充超时、重试、取消的边界处理
- [ ] 让流式输出在 UI 中真实显示

### 7. 对话体验增强

- [ ] `/` 命令自动补全菜单
- [ ] `@` 成员选择器
- [ ] run 详情抽屉
- [ ] artifact 浏览入口
- [ ] 命令执行结果卡片化
- [ ] 工具调用和模型调用可视化

### 8. 管理与设置增强

- [ ] 编辑 Agent
- [ ] 编辑群组
- [ ] 删除 Agent / 群组
- [ ] provider 删除 / 重置逻辑
- [ ] 设置页表单错误提示

## P2：补齐交付所需的测试与发布能力

### 9. 测试

- [ ] 为共享类型和命令解析补单元测试
- [ ] 为 runtime 补单元测试
- [ ] 为 store 层补测试
- [ ] 为关键 UI 页面补组件测试
- [ ] 增加 Electron 端到端测试

### 10. 审计与导出

- [ ] 导出会话记录
- [ ] 导出运行日志
- [ ] 导出 artifacts
- [ ] 本地全文检索
- [ ] artifact / transcript 搜索入口

### 11. 打包与发布

- [ ] 完善 Electron 打包配置
- [ ] macOS 安装包体验检查
- [ ] 应用图标、应用名、元信息最终检查
- [ ] 崩溃日志方案
- [ ] 错误上报策略
- [ ] 开发 / 测试 / 发布环境区分

## 推荐执行顺序

如果下一阶段按最短路径推进，建议严格按下面顺序做：

1. 先完成“群聊真实运行时”
2. 再完成“Skills 真实接线”
3. 再完成“MCP 真实接线”
4. 然后补齐“工具层接入真实 Agent Runtime”
5. 再做“Drizzle + 正式数据层”
6. 然后补“Provider 校验、流式输出、run 详情”
7. 最后再做“测试、导出、打包发布”

## 进入 Alpha 的判断标准

当下面这些项都达成时，可以认为项目从“高级原型”进入“Alpha 可用版本”：

- [ ] 单聊和群聊都走真实模型与真实运行时
- [ ] `/skills` 可真实生效
- [ ] `/mcp` 可真实调用
- [ ] 本地工具可以被 Agent 真实使用
- [ ] run 状态、artifact、memory 可以稳定落盘并恢复
- [ ] 基础错误提示、暂停恢复和设置校验可用

到那一步，再去做更完整的测试和发布，会更划算。
