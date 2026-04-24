# Beta 发布 Checklist（macOS）

更新时间：2026-04-24

## 1. 发布前检查

- [x] Node / npm 版本符合仓库要求
- [x] 工作区依赖安装完成（`npm install`）
- [x] 本地配置使用 `~/.teamaligned`
- [x] 关键 smoke 已通过（slash、群聊批次、通知策略、provider 错误归一）

执行：

```bash
npm run beta:check
```

## 2. 打包

执行：

```bash
npm run dist:mac
```

产物目录（默认）：

- `apps/desktop/dist/`（应用构建）
- `apps/desktop/dist-electron/`（打包产物，具体格式取决于 electron-builder 配置）

本轮产物（2026-04-24）：

- `apps/desktop/dist/teamaligned-0.1.0-arm64-mac.zip`
- `apps/desktop/dist/teamaligned-0.1.0-arm64.dmg`

## 3. 安装体验验收（手动）

- [ ] 安装包可正常安装
- [ ] 首次启动无白屏
- [ ] 设置页可保存 provider 并测试连接
- [ ] 单聊可发送文本和图片附件
- [ ] 群聊可 `@` 指定成员并连续接棒
- [ ] 群聊执行过程有“思考中/过程更新”反馈
- [ ] 右侧会话信息面板可查看 token 与 workspace
- [ ] 会话导出按钮可产出 JSON 文件
- [ ] 通知前后台行为符合设置开关

## 4. 已知限制（Known Issues）

1. MCP 外部服务稳定性依赖第三方服务可用性，超时会按统一错误文案提示。
2. 会话导出当前是最小可用 JSON（索引导出），不包含附件二进制打包。
3. 群聊复杂长链路仍需持续观察（尤其多 Agent 并行 + 依赖等待场景）。
4. Node/Electron 运行时可能出现实验性告警（例如 SQLite ExperimentalWarning），不影响核心功能。

## 5. 发布记录模板

建议每次 beta 包发布后补一条记录：

- 版本号：
- 发布时间：
- 提交范围：
- 验收人：
- 结果：
- 阻断问题：
