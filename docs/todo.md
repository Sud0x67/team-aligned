# 开发 TODO

[English version](./en/todo.md)

更新时间：2026-05-04

当前版本：`0.6.0-beta`

## 当前状态

TeamAligned 已经从“功能接线”进入“可发布 beta 打磨”阶段。当前应用已经具备真实可用的核心链路：

- 单聊 Agent：真实 Provider、流式输出、取消、重试、`/clear`、附件、图片理解、Markdown、右侧信息栏。
- 群聊 Team：`@` 优先、orchestrator 意图识别、handoff 接棒、并行/串行执行、过程消息、取消和上下文清理。
- 本地工具：workspace 文件读写、搜索、命令执行、`web_search`、`web_fetch`。
- 扩展：Skills、Prompt Alias、MCP catalog、stdio/http/OAuth MCP、Agent 级 Skill/MCP 白名单。
- 本地数据：`~/.teamaligned`、SQLite、transcript、attachments、artifacts、tool invocations、run steps。
- 系统能力：通知中心、系统通知、诊断导出、会话导出、长图分享、macOS 打包配置。

默认新用户体验现在保持克制：

- 内置 TeamAligned Assistant 作为应用助手。
- 默认只保留一个“产品开发组 / Product Squad”群组。
- 默认 Provider API Key 为空，用户需要显式配置。

## P0：聊天主链路稳定性

目标：让用户在单聊和群聊里都能明确感到“Agent 正在工作、可以取消、失败后知道怎么恢复”。

- [x] 对真实 Provider 做单聊回归脚本覆盖：流式输出、取消、重试、`/clear`、图片附件、Markdown 长内容。
- [x] 对真实 Provider 做群聊回放：显式 `@`、无 `@` 自动选人、多轮 handoff、并行执行、依赖等待、图片附件、web 工具调用、取消、`/clear`。
- [x] 调整群聊过程消息密度，避免长任务静默，也避免工具过程刷屏。
- [x] MCP OAuth 未授权失败会在聊天过程消息里引导用户授权，扩展页也提供授权入口。
- [x] MCP OAuth token 过期或需要重新授权时会清理过期 token，并提示用户重新授权。
- [x] 统一失败态文案：Provider 失败、MCP 失败、命令失败、图片理解失败、网络工具失败。
- [x] 验证最近消息摘要、未读数、通知中心与已读状态在单聊/群聊中一致。

## P1：工具权限与可解释性

目标：让用户清楚每个 Agent 当前能用什么工具，以及高风险工具何时会被调用。

- [x] 增加通用工具执行前 policy hook，文件写入、命令、网络、Skill、MCP 均可被统一拦截或要求确认。
- [x] 为 shell / 文件写入 / Skill / MCP 等高风险工具补聊天内确认卡片和 approve/deny 队列。
- [ ] 继续细化高风险提示：按 MCP tool、命令内容、文件路径给出更精确的风险解释。
- [x] 右侧信息栏保持聚焦：token、workspace、Finder 打开、会话导出、当前 Skill/MCP 和当前运行状态。
- [ ] 优化 `/skills`、`/mcp`、`/<skill-id>`、`/<prompt-alias>` 的反馈，让它们继续保持“像聊天”而不是控制台。
- [x] 明确 TeamAligned Assistant 不能修改自身、不能删除、只绑定内置应用助手 Skill。

## P2：长任务恢复与审计

目标：长任务失败或被取消后，用户仍然知道已经完成了什么、卡在哪里、下一步怎么继续。

- [ ] 设计最小 checkpoint 记录：任务阶段、已完成步骤、失败点、可重试建议。
- [ ] 将 run、run steps、tool invocations、artifacts、transcript 的跳转关系整理成一致体验。
- [x] 为群聊执行补充“等待谁 / 谁完成了什么 / 下一步由谁继续”的更稳定表达。
- [ ] 继续过滤内部过程消息，避免污染下一轮 orchestrator 意图识别。
- [ ] 为失败后的“重试上一条 / 编辑后重发 / 清空上下文”整理清晰恢复路径。

## P3：导出、搜索与分享

目标：让用户可以把本地协作结果带走、检查、分享或恢复。

- [ ] 设计项目导出包：messages、transcripts、artifacts、attachments 索引、workspace 摘要。
- [ ] 继续完善长图分享：多选消息、长内容分页、图片附件展示、Markdown 渲染一致性。
- [ ] 扩展本地搜索范围：conversation、transcript、artifact、workspace 文件。
- [ ] 让导出结果默认脱敏，避免 API Key、MCP secrets、请求头等敏感信息泄露。

## P4：发布质量

目标：保证每次 beta 发布都有稳定、可重复的检查流程。

- [x] 发布前固定运行 `npm run beta:check`。
- [ ] 做 macOS DMG / ZIP 安装体验检查，包括 Apple Silicon 与 Intel 构建。
- [ ] 检查应用名、图标、DMG 背景、volume icon、版本号与 changelog。
- [x] 增加关键聊天页面组件测试与必要的 Electron E2E / Provider replay 检查入口。
- [x] 梳理崩溃日志和本地诊断目录，保证用户反馈可定位。

## 暂不优先

这些方向先不进入下一版主线，除非用户反馈强烈：

- 恢复仪表盘页面。
- 新增更多模型 Provider。
- 大规模 marketplace 能力扩张。
- 多用户在线协作。
- MCP tool 级白名单；当前保留 Agent 级 MCP 白名单和高风险工具确认。
- OAuth 型 MCP 已有基础授权闭环和聊天内审批队列；暂不优先的是更细的 scope 变化、用户主动 revoke 等重授权状态管理。

## 完成标准

下一阶段可以认为完成时，应满足：

- [x] 单聊真实 Provider 回归脚本覆盖通过。
- [x] 群聊真实 Provider 回放通过。
- [x] 取消、重试、`/clear` 在单聊和群聊中都稳定。
- [x] 工具过程可见但不过度刷屏。
- [x] 高风险工具确认 UI 可用，并且不会阻塞低风险读操作。
- [ ] 用户能理解当前 Agent / Team 能做什么。
- [x] 诊断、导出、发布检查可以稳定执行。
