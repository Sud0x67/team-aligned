# 开发 TODO

## 当前原则

更新时间：2026-04-06

从现在开始，`teamaligned` 进入**范围冻结**阶段：

- 不再继续开发新的产品 feature
- 只补当前实现已经暴露出来的缺口
- 优先做稳定性、可维护性、导出能力、测试与发布准备

这份文档只保留：

- 已完成的关键基线
- 当前仍未完成、但必须收尾的工作
- 明确不再进入当前阶段的扩展项

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
- [x] 附件上传、图片预览、命令结果卡片
- [x] `@` 选择器
- [x] `/` 自动补全
- [x] run 详情、artifact、attachment、tool invocation 可视化

### 模型与运行时基线

- [x] 接入 DeepAgents
- [x] 接入 LangChain
- [x] 接入 LangGraph
- [x] 单聊接入真实 Qwen / DashScope
- [x] 单聊接入真实 OpenAI
- [x] 群聊接入真实 manager / specialist 模型协作链路
- [x] specialist 受控直接 `@用户` / manager relay 规则
- [x] 设置页 provider 配置驱动单聊模型调用
- [x] 单聊流式输出

### Skills / MCP / Tool Layer

- [x] Skills registry 同步、安装、白名单、激活
- [x] Skill prompt 注入
- [x] Skill 脚本与附属文件能力接入 runtime
- [x] MCP registry 同步
- [x] 支持 `stdio npx` MCP
- [x] 支持 `HTTP + headers` MCP
- [x] MCP 本地配置、健康检查、tool discovery
- [x] Agent / Team MCP 白名单
- [x] MCP discovered tools 注入 runtime
- [x] 文件、搜索、命令工具层并入 agent runtime

### 本地持久化基线

- [x] `~/teamaligned/settings.json`
- [x] `~/teamaligned/app.db`
- [x] transcript JSONL 落盘
- [x] agent workspace / team workspace 初始化
- [x] artifact / MEMORY.md / shared-memory.md 落盘
- [x] avatars / attachments 物理目录
- [x] `attachments / artifacts / tool_invocations / run_steps` 正式表
- [x] `messages / conversations / runs` 结构化列与索引
- [x] `agents / teams / providers / notifications` 结构化列与索引
- [x] Drizzle schema 与 migration

## 当前仍未完成的工作

下面这些项是当前阶段真正需要继续收尾的内容。

当前第一阶段链路审查结果见：

- [Beta 第一阶段审查](./beta-phase-1-audit.md)

### P0：稳定性与运行时收口

#### 1. 群聊稳定性与失败恢复

- [ ] 修复“管理页发起对话不能直接进入目标群组会话”的链路阻断
- [ ] 系统化验证群聊复杂任务下的稳定性
- [ ] 明确失败态恢复路径
- [ ] 补强 pause / resume / cancel 的边界场景
- [ ] 增强 checkpoint / 回放能力

#### 2. Provider 可靠性

- [ ] 补字段级参数错误提示与更明确的下一步引导
- [ ] 统一模型错误提示和失败态
- [ ] 补充超时、重试、取消的边界处理
- [ ] 校准流式输出在异常中断时的回退行为

#### 3. Skill / MCP 收尾

- [ ] 在消息流和 run 详情里更明确地展示当前 Skill 已生效
- [ ] Skill 安装成功后补齐下一步使用引导
- [ ] MCP 增加 tool 级白名单
- [ ] MCP 增加常见服务的配置模板优化
- [ ] MCP 配置成功后补齐下一步使用引导
- [ ] 附件上传失败增加用户可见错误提示

### P1：数据与导出

#### 4. transcript / artifact / memory 关联完善

- [ ] 完善 transcript / artifact / memory 的导出级关联
- [ ] 统一 run、artifact、transcript、memory 之间的跳转与引用
- [ ] 明确导出打包结构

#### 5. 审计与导出

- [ ] 导出会话记录
- [ ] 导出运行日志
- [ ] 导出 artifacts
- [ ] 导出 attachments

#### 6. 本地检索

- [ ] 本地全文检索
- [ ] artifact / transcript 搜索入口

### P2：测试与发布

#### 7. 测试

- [ ] 为共享类型和命令解析补单元测试
- [ ] 为 runtime 补单元测试
- [ ] 为 store 层补测试
- [ ] 为关键 UI 页面补组件测试
- [ ] 增加 Electron 端到端测试

#### 8. 打包与发布

- [ ] 完善 Electron 打包配置
- [ ] macOS 安装包体验检查
- [ ] 应用图标、应用名、元信息最终检查
- [ ] 崩溃日志方案
- [ ] 错误上报策略
- [ ] 开发 / 测试 / 发布环境区分

## 当前阶段不再继续推进的扩展项

下面这些不是 bugfix 或工程化收尾，当前阶段不再继续开发：

- workspace 级 skills 目录
- OAuth 型 MCP
- 编辑 Agent / 群组
- 删除 Agent / 群组
- 更多新的扩展中心能力
- 新的页面、新的交互模式
- 新的 provider 类型

如果未来重新开启 feature 开发，再单独开新的 roadmap，不混入当前收尾清单。

## 建议执行顺序

如果下一阶段继续推进，建议按下面顺序做：

1. 群聊稳定性、失败恢复、统一错误态
2. MCP tool 级白名单与配置模板
3. transcript / artifact / memory 导出链路
4. 全文检索
5. 测试与发布链路

## 当前阶段的完成标准

当下面这些项都完成时，可以认为当前这一轮“收尾阶段”结束：

- [x] 单聊和群聊都走真实模型与真实运行时
- [x] Skills 与 MCP 主链路跑通
- [x] 本地工具层进入 runtime
- [ ] 群聊失败恢复与错误态基本稳定
- [ ] transcript / artifact / memory 可稳定导出
- [ ] 基础测试体系建立
- [ ] 基础打包与发布链路建立
