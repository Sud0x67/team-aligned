# Beta 发布 Checklist（macOS）

[English version](./en/beta-release-checklist.md)

更新时间：2026-05-04

当前版本：`0.5.2-beta`

## 1. 自动门禁

每次 beta 发布前固定执行：

```bash
npm run beta:check
```

`beta:check` 当前覆盖：

- TypeScript typecheck
- ESLint
- Smoke tests
- Desktop build

真实 Provider 回放属于发布前增强验收，建议在本地 Provider 配置可用时额外执行：

```bash
npm run test:provider-replay
```

默认每个场景等待 180s；如果本地网络或 Provider 较慢，可以临时提高：

```bash
TA_REPLAY_TIMEOUT_MS=240000 npm run test:provider-replay
```

覆盖范围：

- 单聊：流式输出、取消、重试、`/clear`、图片附件、Markdown 长内容。
- 群聊：显式 `@`、无 `@` 自动选人、多轮 handoff、并行任务、依赖等待、图片附件、web 工具调用、取消、`/clear`。

## 2. 打包产物

执行：

```bash
npm run dist:mac
```

检查产物目录：

- `apps/desktop/dist/`
- `apps/desktop/dist-electron/`

每次发布必须确认：

- Apple Silicon DMG / ZIP 可生成并可安装。
- Intel DMG / ZIP 在 GitHub Actions 对应 runner 上生成。
- 应用名、版本号、图标、DMG background、volume icon 均正确。
- `CHANGELOG.md` 包含本次版本摘要。

## 3. 核心手动验收

- [ ] 首次启动进入 onboarding，API Key 默认为空且必填。
- [ ] Provider 测试失败时提示“发生了什么、如何恢复”。
- [ ] 单聊文本可流式返回，发送中可取消。
- [ ] 单聊可重试上一条、`/clear` 后不带旧上下文。
- [ ] 单聊图片附件可被模型理解，失败时提示重新上传或检查文件。
- [ ] 长 Markdown、表格、多行代码块渲染正常。
- [ ] 群聊显式 `@` 优先命中目标 Agent。
- [ ] 群聊无 `@` 时 orchestrator 自动选择合适 Agent。
- [ ] 群聊过程消息可见但不过度刷屏。
- [ ] 群聊取消与 `/clear` 生效。
- [ ] 已读后左侧未读数、最近消息和通知中心同步清理。
- [ ] 前台应用不触发系统通知，后台才触发。
- [ ] 会话导出和长图分享可用。
- [ ] 诊断导出会包含 startup / error / notification 日志尾部。

## 4. 用户反馈入口

发现问题时引导用户优先提交 GitHub Issue：

- [GitHub Issues](https://github.com/Sud0x67/team-aligned/issues)
- 邮件：`jokeroller@163.com`

请用户尽量附上：

- 版本号和芯片架构（Apple Silicon / Intel）。
- 操作步骤和截图。
- 设置页导出的 diagnostics JSON。
- 相关 workspace 中可公开的最小复现文件。

## 5. 已知限制

1. MCP 外部服务稳定性依赖第三方服务可用性，超时会按统一错误文案提示。
2. OAuth MCP 已支持授权入口、手动 Client ID/Secret 兼容和过期 token 清理；scope 变化、用户主动 revoke 等更细 re-auth 状态仍需继续打磨。
3. 会话导出当前是最小可用 JSON / 图片导出，不包含完整项目归档包。
4. 群聊复杂长链路仍需持续观察，尤其是多 Agent 并行与依赖等待组合。
5. Node/Electron 运行时可能出现实验性告警（例如 SQLite ExperimentalWarning），不影响核心功能。

## 6. 发布记录模板

- 版本号：
- 发布时间：
- 提交范围：
- 自动门禁：
- Provider 回放：
- 打包产物：
- 手动验收人：
- 结果：
- 阻断问题：
