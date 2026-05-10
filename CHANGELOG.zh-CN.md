# 更新日志

[English Version](./CHANGELOG.md)

TeamAligned 的重要变更会记录在此文件中。

## 未发布

- 围绕 `0.6.1-beta` 稳定性分支继续做文档与轻量交互打磨。

## 0.6.1-beta - 2026-05-11

### 变更

- 将应用和内部 workspace package 版本推进到 `0.6.1-beta`。

## 0.5.2-beta - 2026-05-04

### 变更

- 将应用和内部 workspace package 版本推进到 `0.5.2-beta`。
- 补充本地工具执行与打开 workspace IPC 的安全审查加固。

## 0.5.1-beta - 2026-05-04

### 优化

- 加强 workspace 路径规范化，Agent 生成文件时会先折叠重复的绝对 workspace 前缀再执行工具。
- 加强命令工具和 stdio MCP 子进程环境变量隔离，默认不再继承宿主环境里的 API Key、OAuth token 和其他敏感值。
- 加强打开 workspace 的 IPC 路径校验，renderer 只能请求主进程打开已知的 TeamAligned runtime 或 workspace 目录。
- 增强长任务可见性，为模型和工具等待过程补充已用时状态与超时/错误诊断日志。
- 收口架构、TODO 和发布 checklist 文档，使其与当前 `0.5.1-beta` runtime 和 UI 行为一致。

### 修复

- 修复文档中群聊 orchestrator 默认超时、右侧栏展示内容、内置 TeamAligned Assistant 约束等描述漂移。

## 0.5.0-beta - 2026-05-03

### 新增

- 为 HTTP MCP 增加 OAuth 基础支持：浏览器授权、本地回调接收 code、token 持久化、授权后重新发现工具。
- 增加通用工具执行前 policy hook，workspace、web、Skill、MCP 工具都可以统一接入未来的高风险确认 UI。
- 增加聊天内工具确认卡片和 approve/deny 队列，用于文件写入、命令、Skill、MCP 等高风险工具执行。

### 优化

- MCP 未授权和权限失败会以自然聊天过程消息展示，不再像静默工具失败。
- 扩展页为需要浏览器登录的 MCP 连接提供 OAuth 授权入口。
- OAuth MCP token 过期或需要重新授权时会清理过期 token 状态，并引导用户重新授权。
- 不支持动态 Client 注册的 OAuth MCP 会自动切换到手动填写 Client ID/Secret 的流程，并提供更友好的错误提示和 Slack 专属配置引导。

## 0.4.0-beta - 2026-05-02

### 新增

- 为所有 Agent 增加内置网页能力：
  - `web_search`（优先走 provider-native，失败自动 fallback）
  - `web_fetch`（网页抓取与内容提取）
- 将网页工具接入单聊、群聊和内置 TeamAligned Assistant 运行时。
- 为网页工具执行增加可见过程消息（开始 / 处理中 / 完成）。

### 优化

- 统一网页工具输出结构并保留精简引用：
  - `web_search`：标准化搜索条目与来源链接
  - `web_fetch`：提取内容元信息（`url`、`title`、`truncated`、`chars`）
- 扩展 smoke 测试覆盖，提升网页工具与 fallback 的稳定性。
- 围绕当前 `0.4.0-beta` 产品状态收口架构与 TODO 文档。

### 修复

- 修复团队协作中按发言人绑定工具调用时的过程消息一致性问题。
