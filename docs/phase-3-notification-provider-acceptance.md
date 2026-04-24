# 第 3 期验收清单：通知链路 + Provider 错误一致性

更新时间：2026-04-24（第四次回填）

## 目标

确保以下两条链路达到 beta 可发布标准：

1. 通知行为与设置一致，且前台不弹系统通知。
2. Provider 在“测试连接 / 保存并启用 / 实际聊天失败”三处给出一致且可操作的错误提示。

## 本轮已完成（代码与自动化）

### A. 通知策略收口

- 新增可测试策略函数：
  - `apps/desktop/src/main/notification-policy.ts`
- 主进程系统通知分发改为使用统一策略函数：
  - `apps/desktop/src/main/index.ts`
- 新增策略烟测：
  - `apps/desktop/src/main/notification-policy.test.ts`

覆盖场景：

- 后台 + 开关打开 + 系统支持 => 允许通知
- 前台 => 禁止系统通知
- 开关关闭 => 禁止系统通知
- 缺失关联会话 => 禁止系统通知

### B. Provider 错误提示统一

- 新增 Provider 错误归一函数：
  - `packages/agent-runtime/src/deep-agent.ts#normalizeProviderErrorMessage`
- `testProviderConnection` 改为返回归一化错误提示。
- 单聊真实调用失败路径改为使用同一归一化提示。
- 群聊执行 work item 失败路径改为使用同一归一化提示。
- 新增归一化烟测：
  - `packages/agent-runtime/src/deep-agent.test.ts`

覆盖场景：

- 鉴权错误（401 / invalid key）
- 超时错误
- 模型不存在（404 / model not found）
- SDK 嵌套错误（`Connection error` 外层 + `cause/error` 内层根因）
- 非 Provider 已知错误时保留原始错误

## 自动化验收结果

执行命令：

- `npm run test:smoke`
- `npm run beta:check`

结果：

- 所有烟测通过（当前 25 条）
- `typecheck` / `lint` / `build` 全通过
- 新增覆盖：`incorrect_api_key_error` + `Troubleshooting URL` 这类供应商错误格式

## 本轮实机回放结果（2026-04-23）

### 已确认

- [x] 设置页“打开系统通知设置”按钮会给出明确引导文案（“已打开系统通知设置...”）。
- [x] 点击后系统设置应用会被唤起并进入“通知”页（macOS）。
- [x] 主进程已补充 macOS 通知设置 URI 回退（`Notifications-Settings.extension` + `com.apple.preference.notifications`），降低跳转失败率。
- [x] 设置页“测试连接”在无效 API Key 时，展示统一中文可操作提示（鉴权失败 + 排查链接），不再直接透传供应商原始英文报错。

### 本轮新增回填（2026-04-24）

- [x] 前台单聊触发时命中 `decision: foreground`，不发系统通知。
- [x] 后台单聊触发时命中 `decision: allowed` 且出现 `notification:show`。
- [x] 后台群聊普通消息触发时命中 `decision: allowed` 且出现 `notification:show`。
- [x] 后台群聊 `@你` 触发时命中 `decision: allowed` 且出现 `notification:show`。
- [x] 关闭“Agent 消息”后，后台单聊触发命中 `decision: disabled_setting`。
- [x] 关闭“群组消息通知”后，后台群聊普通消息触发命中 `decision: disabled_setting`。
- [x] 关闭“@提及通知”后，后台 `@你` 触发命中 `decision: disabled_setting`。
- [x] 点击系统通知后回会话：已人工实机验证通过（2026-04-24）。

### 仍需回填

- [ ] （可选）补一轮“保存并启用失败 / 聊天真实失败”的实机截图留档（程序和 UI 路径已统一）。

## 实机验收步骤（手动）

> 下面 8 项建议在 macOS 上逐项勾选。通过后可认为第 3 期“通知 + Provider”已完成发布验收。

### 1) 通知前后台行为

- [x] 前台打开应用，触发一条单聊新消息：不出现系统横幅，仅应用内通知中心增加记录。
- [x] 应用切到后台（最小化或切走焦点），触发单聊新消息：出现系统横幅。
- [x] 后台触发群聊普通消息：出现系统横幅（受“群组消息通知”开关控制）。
- [x] 后台触发群聊 `@你`：出现系统横幅（受“@提及通知”开关控制）。

### 2) 通知点击回流

- [x] 点击系统通知后，应用前置并自动定位到对应会话。（已人工验证）

### 3) 通知开关一致性

- [x] 关闭“Agent 消息”后，后台单聊不再弹系统通知。
- [x] 关闭“群组消息通知”后，后台群聊普通消息不再弹系统通知。
- [x] 关闭“@提及通知”后，后台 `@你` 不再弹系统通知。

### 4) Provider 三处错误一致性

- [x] 设置页“测试连接”填错 API Key 时，出现鉴权失败提示（可操作）。
- [x] 设置页“保存并启用”在连接失败时，提示与测试连接语义一致。
- [x] 聊天中真实调用失败（如模型名错误 / 网络超时）时，提示语义与设置页一致。

## 结论

程序侧已完成第 3 期核心收口（策略统一 + 错误归一 + 自动化覆盖）。
剩余工作是实机逐项验收并把结果回填到本清单。
