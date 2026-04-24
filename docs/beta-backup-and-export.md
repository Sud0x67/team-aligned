# Beta 最小导出与备份说明

更新时间：2026-04-24

## 1. 会话最小导出

当前版本已支持从聊天页右侧「会话信息」面板导出当前会话数据。

### 使用方式

1. 打开任意会话（单聊或群聊）。
2. 展开右侧会话信息面板（`i` 图标）。
3. 在「工作空间」卡片点击「导出会话」。

### 导出文件位置

- 默认目录：`~/.teamaligned/exports/<conversationId>/`
- 文件名格式：`<conversationTitle>-<timestamp>.json`

### 导出内容（schemaVersion=1）

- 会话基础信息（conversation）
- 会话消息（messages）
- 运行记录（runs）
- 运行步骤（runSteps）
- 产物索引（artifacts）
- 附件索引（attachments）
- 工具调用索引（toolInvocations）
- transcript 路径信息（global/workspace）
- 导出统计计数（message/run/artifact 等）

说明：这是“可审计、可回放”的最小导出，不做压缩打包，不搬运二进制附件内容本体（保留本地绝对路径索引）。

## 2. `~/.teamaligned` 备份建议

备份前请先退出应用，避免写入中状态导致不一致。

### 整体备份（推荐）

```bash
mkdir -p ~/.teamaligned/backups
tar -czf ~/.teamaligned/backups/teamaligned-$(date +%Y%m%d-%H%M%S).tar.gz ~/.teamaligned
```

### 仅备份关键数据（可选）

- `~/.teamaligned/app.db`
- `~/.teamaligned/settings.json`
- `~/.teamaligned/transcripts/`
- `~/.teamaligned/workspaces/`
- `~/.teamaligned/avatars/`
- `~/.teamaligned/exports/`

## 3. 恢复流程

1. 退出应用。
2. 还原备份文件到 `~/.teamaligned`（覆盖前建议先重命名旧目录）。
3. 启动应用，检查：
   - 会话列表是否完整
   - 历史消息是否可查看
   - 右侧 workspace 路径是否可打开
   - 导出文件是否可读

## 4. 当前限制

- 导出文件使用绝对路径索引，跨机器恢复时路径可能失效。
- 不包含“自动重写路径”的导入向导（beta 后续项）。
- 导出是“会话级”，不是全量实例一键导出。
