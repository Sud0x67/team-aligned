# 路线与 TODO

## 路线总览

这份路线图按“先把可体验骨架做出来，再把 mock 替换成真实能力”的顺序推进。

## 版本 0.1：可体验 MVP 骨架

状态：已完成

已完成内容：

- Electron + React + Vite 桌面壳
- 五个主页面路由
- 左侧导航、顶部栏、通知入口、头像入口
- 单聊与群聊聊天页
- `/skills`、`/command`、`/mcp`、`/pause`、`/resume`、`/cancel`
- 管理页、扩展页、设置页、仪表盘首版
- 头像上传、主题切换、语言切换
- 本地 SQLite、JSONL transcript、workspace 目录落盘

## 版本 0.2：真实运行时接线

状态：进行中

目标：把当前“能体验”的产品变成“能真实执行”的产品。

核心任务：

- 接入真实 OpenAI / Qwen 请求链路
- 建立正式 Provider Registry
- 把 `/skills`、`/command`、`/mcp` 接到真实执行链
- 用 DeepAgents / LangGraph 替换当前 mock runtime
- 让群组中的 manager / specialist 协作进入真实调度

当前进展：

- 单聊场景的 Qwen / OpenAI 真实调用已接入
- 当前默认仍建议优先使用 Qwen 做测试
- 群聊真实调度、Skills、MCP 仍待接入

验收：

- 单聊与群聊不再依赖 mock 回复
- 运行状态与真实执行同步
- provider 切换能真实生效

## 版本 0.3：扩展与本地能力增强

状态：未开始

目标：让 Agent 可以稳定调用本地工具和外部能力。

核心任务：

- 文件工具
- 终端工具
- 本地搜索工具
- `SKILL.md` 加载与启用
- stdio MCP
- HTTP MCP
- MCP 配置与健康检查

验收：

- Agent 可稳定调用本地工具
- Skills 和 MCP 能在 UI 中看到真实生效结果

## 版本 0.4：正式数据层与审计

状态：未开始

目标：把现有持久化升级为正式可维护的数据层。

核心任务：

- Drizzle schema 与 migration
- conversations / messages / runs / artifacts 正式表结构
- transcript / artifact / memory 的索引与关联
- 导出与审计能力
- 本地全文检索

验收：

- 重启恢复稳定
- 历史运行、消息和产物可查询
- 本地数据结构清晰且可演进

## 版本 0.5：体验与交付完善

状态：未开始

目标：把当前原型级产品打磨成可持续演示和测试的桌面应用。

核心任务：

- run 详情和 artifact 浏览
- 群组上下文抽屉或详情面板
- Agent / 群组编辑与删除
- 扩展配置详情页
- 设置校验与测试连接
- Electron 打包、应用图标、发布流程
- UI 自动化与端到端测试

验收：

- 关键交互完整闭环
- 本地体验稳定
- 可进行版本化交付和回归测试
