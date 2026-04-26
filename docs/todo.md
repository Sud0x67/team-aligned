# 开发 TODO

## 当前判断

更新时间：2026-04-26

当前 `teamaligned` 已经不是“功能没接上”的阶段，而是一个**可体验、可真实执行、正在收口到 beta** 的本地桌面应用。

这一阶段的重点不再是继续扩张功能面，而是：

1. 打磨聊天主链路
2. 验证通知与系统集成
3. 收口群聊稳定性与错误恢复
4. 完成导出、检索、测试、发布这些 beta 必需项

## 0.3.0-beta 单聊 Agent 体验打磨

目标：把最容易理解产品价值的“单聊 Agent”入口打磨顺滑，优先保证真实用户可以稳定发消息、看过程、取消、重试、上传附件并理解当前会话能力。

本轮已执行：

- [x] 版本号切换到 `0.3.0-beta`
- [x] 右侧会话信息栏瘦身为用户真正需要的信息：Token、workspace、打开目录、导出、当前 Skill/MCP 能力
- [x] 单聊右侧信息栏新增“重试上一条”入口，用于失败、取消或想重新生成时快速恢复
- [x] 用户消息持久化 `rawInput`，确保带附件/图片的重试不会误用展示文案作为模型输入
- [x] 文件上传增加单次数量与单文件大小保护，避免大文件导致输入区卡死
- [x] Nova / TeamAligned 内置应用助手文案更新，聚焦 Provider 配置、单聊使用、附件、Slash、重试与 `/clear`
- [x] 内置 `team-aligned-assistant` Skill 增强单聊使用说明和右侧信息栏说明

下一步继续推进：

- [ ] 继续实测单聊流式输出、取消、重试、`/clear` 在真实 Provider 下的组合场景
- [ ] 图片附件理解继续覆盖更多模型能力差异与失败提示
- [ ] 文件上传继续补充大小、类型和失败恢复提示
- [ ] Markdown 渲染继续验证代码块、列表、表格、链接和长内容滚动表现

## 0.3.0-beta 群聊真正可工作（连续感补强）

目标：版本号仍保持 `0.3.0-beta`，但把下一阶段的群聊核心体验先补上，让群聊不像“卡住”，而像真实团队持续推进。

本轮已执行：

- [x] 显式 `@` 优先继续强化：被 @ 的 Agent 在执行型请求中必须进入 work item owner
- [x] planner 误把“@Agent 执行请求”判成 chat 时，runtime 会用 fallback 执行计划兜底
- [x] 工具调用开始、成功、失败会转成 Agent 自己说出的短公开过程消息
- [x] 工具过程消息带 `teamProcess` 元数据，并从下一轮 planner history 中过滤，避免污染意图识别
- [x] 群聊取消会重置 handoff，并在主线程输出“本轮已取消”的自然反馈
- [x] 新增 @ 执行归属与 planner 误判兜底烟测

下一步继续推进：

- [ ] 做一轮真实 Provider 群聊回放：显式 @、无 @ planner 选人、并行、串行、依赖等待、停止、`/clear`
- [ ] 继续观察工具过程消息密度，避免长任务刷屏
- [ ] 验证群聊图片附件、多 Agent 多轮上下文与 Markdown 输出组合场景

## 0.2.1-beta 稳定性目标

目标：在 `0.2.0-beta` 发布后，优先补齐用户遇到问题时的反馈、诊断和恢复路径，不扩张新的主功能面。

本轮已执行：

- [x] 设置页新增“帮助与反馈”入口
- [x] 支持跳转 GitHub Issue：<https://github.com/Sud0x67/team-aligned/issues>
- [x] 支持邮件反馈：<jokeroller@163.com>
- [x] 支持导出本地诊断 JSON
- [x] 诊断信息默认脱敏：不导出 API Key、MCP 环境变量值、MCP 请求头值
- [x] 支持打开诊断目录，方便用户附加日志
- [x] 版本号切换到 `0.2.1-beta`

下一步继续推进：

- [ ] Provider 配置失败、聊天失败、群聊失败的恢复提示继续统一
- [ ] MCP 连接失败、健康检查失败、工具超时的恢复提示继续统一
- [ ] 通知权限缺失和系统通知未弹出的引导继续实机验证
- [ ] 发布前重新跑 `beta:check`、macOS DMG/ZIP 打包和安装包体验检查

## Beta 冲刺执行状态（2026-04-24）

关联文档：

- [Beta 发布执行计划](./beta-release-execution-plan.md)

本轮已执行：

- [x] 新增 slash 命令解析烟测（`packages/shared/src/commands.test.ts`）
- [x] 新增群聊执行批次烟测（`packages/agent-runtime/src/team-runtime.test.ts`）
- [x] 新增 `test:smoke` 脚本
- [x] 新增 `beta:check` 一键发布前检查脚本（typecheck/lint/smoke/build）

下一批正在推进：

- [x] 扩展 `@` 与 handoff 连续多轮场景烟测
- [x] 群聊 `@` / handoff 第二期回放验收补齐（自动化断言 + 文档记录）
- [x] 通知触发策略统一并纳入自动化烟测
- [x] Provider 错误提示在测试连接/单聊/群聊执行三处统一
- [x] 第 3 期验收清单文档落地
- [x] 最小导出能力（会话与运行信息）落地
- [x] `~/.teamaligned` 备份与恢复文档落地
- [x] 发布 checklist 与 Known Issues 文档落地

## 已完成基线

下面这些能力已经完成，不再作为当前主 TODO：

### 桌面端与页面骨架

- [x] Electron + React + Vite 桌面应用壳
- [x] 会话、管理、扩展、设置四个主页面
- [x] 左侧导航、顶部栏、通知入口、个人资料入口
- [x] 浅色 / 深色主题切换
- [x] 中英文切换
- [x] 基于 Figma 的首版 UI 对齐

### 聊天与运行时

- [x] 单 Agent 私聊
- [x] Team 群聊
- [x] 单聊接入真实 Qwen / OpenAI
- [x] 群聊接入真实自然发言编排链路
- [x] 群聊第一版执行模式（work item + 并行/串行批次）
- [x] slash command：`/skills`、`/mcp`、`/<skill-id>`、`/<prompt-alias>`
- [x] slash 结果直接以聊天消息形式展示
- [x] 单聊 / 群聊输入区支持附件上传
- [x] 图片附件预览
- [x] 单聊图片理解，多模态输入交给支持 vision 的模型
- [x] 命令结果卡片
- [x] run 详情、artifact、attachment、tool invocation 可视化
- [x] 运行中锁定输入区，并支持取消当前任务
- [x] 思考中状态与消息流联动
- [x] 会话未读数与已读行为

### Skills / MCP / Tool Layer

- [x] Skills registry 同步、全局安装、激活、移除
- [x] Agent Skill 白名单
- [x] Skill prompt 注入
- [x] Skill 脚本与附属文件接入 runtime
- [x] 自定义 Prompt Alias 创建、编辑、删除、启用与运行时展开
- [x] MCP registry 同步
- [x] `stdio npx` MCP
- [x] `HTTP + headers` MCP
- [x] MCP 本地配置、健康检查、tool discovery
- [x] Agent MCP 白名单
- [x] MCP discovered tools 注入 runtime
- [x] workspace 文件、搜索、命令工具层接入 runtime

### 持久层与本地数据

- [x] `~/.teamaligned/settings.json`
- [x] `~/.teamaligned/app.db`
- [x] transcript JSONL
- [x] agent / team workspace 初始化
- [x] avatars / attachments 物理目录
- [x] `attachments / artifacts / tool_invocations / run_steps` 正式表
- [x] `messages / conversations / runs / agents / teams / providers / notifications` 结构化列与索引
- [x] Drizzle schema 与 migration
- [x] 移除 legacy 目录与 `app-state.json` 自动迁移逻辑（仅使用 `~/.teamaligned`）

### 通知

- [x] 应用内通知中心
- [x] 系统通知主链路
- [x] 前台不触发系统通知
- [x] 设置页系统通知引导

## 当前阶段真正要完成的工作

### P0：聊天与通知体验收口

#### 1. 单聊 / 群聊聊天体验

- [ ] 继续打磨单聊消息流体验
  - 思考中、流式输出、结果落点更自然
  - slash、附件、Prompt Alias 反馈更像聊天，而不是控制台
- [ ] 继续打磨群聊体验
  - @ 优先、语义选人和多 Agent 发言更自然
  - 内部协作展开 / 折叠更易懂
  - 多轮群聊时未读、通知、最近消息摘要保持稳定
- [ ] 统一 run 与消息之间的关系
  - 让“正在做什么”和“已经回复什么”在视觉上更一致
  - 避免 run 详情和聊天主线程重复表达

#### 2. 通知机制测试与确认

- [x] 系统通知在 macOS 上做完整人工验证
  - 前台不弹
  - 后台可弹
  - 点击通知回到会话
- [x] 验证通知设置和实际行为完全一致
  - Agent 消息
  - `@提及`
  - 群组消息
- [ ] 验证通知中心已读、清除、未读计数行为
- [ ] 确认通知权限缺失时的引导是否足够清晰

#### 3. Provider 可靠性

- [x] 统一 provider 错误提示与恢复路径（测试连接/单聊/群聊 + 典型鉴权格式）
- [ ] 校准超时、取消、流式中断时的表现
- [x] 让“测试连接”“保存并启用”“实际聊天失败”三处提示语义一致

### P1：群聊稳定性与扩展能力收口

#### 4. 群聊稳定性与失败恢复

- [ ] 系统化验证复杂群聊任务
- [ ] 收口失败态恢复路径
- [ ] 减少群聊状态错乱、重复发言、长任务中断后的歧义
- [ ] 补强 checkpoint / 回放能力

#### 5. Skill / MCP 收尾

- [ ] 更明确地展示当前 Skill 已生效
- [ ] MCP 增加 tool 级白名单
- [ ] MCP 增加常见服务配置模板优化
- [ ] MCP 配置成功后的下一步引导

### P2：数据、导出、检索

#### 6. transcript / artifact / memory

- [ ] 完善 transcript / artifact / memory 的关联
- [ ] 统一 run、artifact、transcript、memory 之间的跳转
- [ ] 明确导出打包结构

#### 7. 导出与备份

- [x] 导出会话记录
- [x] 导出运行日志
- [x] 导出 artifacts
- [x] 导出 attachments
- [x] 明确 `~/.teamaligned` 的备份建议

#### 8. 本地检索

- [ ] 本地全文检索
- [ ] transcript / artifact 搜索入口

### P3：测试与交付

#### 9. 测试

- [ ] 共享类型和命令解析单元测试
- [ ] runtime 单元测试
- [ ] store 测试
- [ ] 关键聊天页面组件测试
- [ ] Electron 端到端测试

#### 10. 打包与发布

- [x] 完善 Electron 打包配置
- [ ] macOS 安装包体验检查
- [ ] 应用图标、应用名、元信息最终检查
- [ ] 崩溃日志方案
- [ ] 错误上报策略
- [ ] 开发 / 测试 / 发布环境区分

## 后续阶段待评估事项

下面这些项已经明确提出，但不属于当前 beta 收口范围：

- [ ] 重构仪表盘页面
- [ ] MCP 支持 OAuth HTTP
- [ ] 更深入的 Agent 聊天体验优化
  - 更丰富的消息组件
  - 更完整的聊天输入工具集
  - 更强的 run 与历史上下文浏览能力

## 当前阶段不继续推进的方向

- 新的主页面
- 新的模型 provider
- 和 beta 主链路无关的新功能探索
- 大规模 marketplace 能力扩张

## 建议执行顺序

1. 聊天体验收口
2. 通知机制完整验证
3. Provider / 群聊失败恢复
4. MCP tool 级白名单与模板
5. 导出与检索
6. 测试与发布链路

## 当前阶段完成标准

当下面这些项都成立时，可以认为 beta 收口基本完成：

- [x] 单聊和群聊都走真实模型与真实运行时
- [x] Skills 与 MCP 主链路跑通
- [x] 本地工具层进入 runtime
- [ ] 聊天主链路体验稳定且可理解
- [x] 通知链路在真实系统环境下验证通过
- [ ] 群聊失败恢复基本稳定
- [x] transcript / artifact / memory 可稳定导出
- [ ] 基础测试体系建立
- [ ] 基础打包与发布链路建立
