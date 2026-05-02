# 更新日志

[English Version](./CHANGELOG.md)

TeamAligned 的重要变更会记录在此文件中。

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
