# 路线图归档

## 当前说明

从 2026-04-07 开始，路线重点已经从“继续补功能”切换到“收口 beta”。

因此本文件只保留历史演进脉络；当前状态和执行项请优先参考：

- [Beta 计划](./beta-plan.md)
- [开发 TODO](./todo.md)
- [系统架构](./architecture.md)

## 路线总览

这份路线图记录早期“先做可体验骨架，再替换为真实能力”的演进。当前版本已经接入真实 Provider、工具层和群聊编排。

## 版本 0.1：可体验 MVP 骨架

状态：已完成

已完成内容：

- Electron + React + Vite 桌面壳
- 主页面路由骨架
- 左侧导航、顶部栏、通知入口、头像入口
- 单聊与群聊聊天页
- `/skills`、`/mcp`、`/<skill-id>`、`/<prompt-alias>`
- 管理页、扩展页、设置页、仪表盘首版
- 头像上传、主题切换、语言切换
- 本地 SQLite、JSONL transcript、workspace 目录落盘

## 版本 0.2：真实运行时接线

状态：已完成

目标：把当前“能体验”的产品变成“能真实执行”的产品。

核心任务：

- 接入真实 OpenAI / Qwen 请求链路
- 建立正式 Provider Registry
- 把 slash 命令接到真实执行链
- 用 DeepAgents / LangGraph 接入真实 Agent runtime
- 让群组协作进入 orchestrator + handoff 调度

当前进展：

- 单聊场景的 Qwen / OpenAI 真实调用已接入
- 当前默认仍建议优先使用 Qwen 做测试
- 群聊 orchestrator / handoff 真实协作已接入
- Skills registry、安装、白名单和 prompt 注入已接入
- MCP registry、健康检查、白名单和 runtime 注入已接入
- Skill 脚本执行、工具层接线和 UI 可视化已基本落地
- 当前剩余重点已经转向体验收口与稳定性

验收：

- [x] 单聊与群聊不再依赖 mock 回复
- [x] 运行状态与真实执行同步
- [x] provider 切换能真实生效

## 版本 0.3：扩展与本地能力增强

状态：基本完成

目标：让 Agent 可以稳定调用本地工具和外部能力。

核心任务：

- [x] `SKILL.md` catalog、安装与启用
- [x] stdio MCP
- [x] HTTP MCP
- [x] MCP 配置与健康检查
- [x] Agent 级 Skill/MCP 白名单
- [x] 文件工具
- [x] 终端工具统一并入 agent tool layer
- [x] 本地搜索工具
- [x] Skill 脚本执行
- [x] run / MCP / artifact 可视化

验收：

- [x] Agent 可稳定调用本地工具
- [x] Skills 和 MCP 能在 UI 中看到真实生效结果

## 版本 0.4：正式数据层与审计

状态：大部分完成

目标：把现有持久化升级为正式可维护的数据层。

核心任务：

- [x] `attachments / artifacts / tool_invocations / run_steps` 正式表结构
- [x] `conversations / messages / runs` 结构化字段与索引
- [x] Drizzle schema 与 migration
- [ ] transcript / artifact / memory 的索引与关联
- [ ] 导出与审计能力
- [ ] 本地全文检索

验收：

- 重启恢复稳定
- 历史运行、消息和产物可查询
- 本地数据结构清晰且可演进

## 版本 0.5：体验与交付完善

状态：进行中，且已进入 beta 收口阶段

目标：把当前原型级产品打磨成可真实使用、可测试、可交付的 beta 版本。

核心任务：

- [x] run 详情和 artifact 浏览
- [x] 设置校验与测试连接
- [x] 通知中心与系统通知主链路
- [x] 仪表盘从主导航移除，聚焦核心链路
- 聊天体验继续打磨
- 通知机制测试与确认
- 群聊稳定性、失败恢复与统一错误态
- MCP tool 级白名单暂不进入近期主线；当前依靠 Agent 级 MCP 白名单和高风险确认
- transcript / artifact / memory 导出与检索
- Electron 打包、应用图标、发布流程
- 自动化测试与端到端测试
- 代码清理与结构收口

验收：

- 关键交互完整闭环
- 本地体验稳定
- 可进行版本化交付和回归测试
