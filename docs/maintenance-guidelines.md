# 维护指南

## 文档目标

这份文档不讨论产品能力，而是记录当前仓库在 beta 收口阶段的维护原则，避免继续累积中间产物、重复逻辑和过时说明。

## 当前维护原则

### 1. 不再新增 feature

当前阶段只做三类工作：

- 完善已有用户链路
- 修复体验问题和 bug
- 清理代码与文档

如果一项改动会引入新的产品能力，而不是让现有链路更稳定、更好用，就不属于当前阶段。

### 2. 优先做减法

在不影响现有功能的前提下，优先：

- 删除未使用组件
- 删除过期文档
- 删除重复状态更新逻辑
- 删除“为了过渡而保留”的 UI 和文案

不要为了“以后可能会用”保留已经脱离当前产品方向的代码。

### 3. 保持代码与文档同口径

如果实现发生变化，至少同步检查这些文件：

- [README.md](../README.md)
- [系统架构](./architecture.md)
- [开发 TODO](./todo.md)
- [Beta 计划](./beta-plan.md)

beta 阶段最忌讳的是：

- 代码已经变了，文档还在描述旧世界
- 文档写着“后续再做”，实际上代码已经做完

## 当前建议的清理重点

### Renderer

重点关注：

- 大页面组件是否过大
- 是否有未使用组件
- store 中是否存在重复样板
- 文案是否仍然残留旧链路描述

当前已知：

- 管理页和扩展页仍然偏大，后续适合继续拆分
- store 层应优先复用统一的 snapshot 更新 helper

### Runtime

重点关注：

- slash command 分支是否过长
- provider / skill / mcp / run 控制是否存在重复错误处理
- payload 兼容逻辑是否还能继续收口

当前不建议做的事情：

- 在 beta 阶段大规模重写 `storage.ts`
- 去掉所有兼容逻辑后破坏现有本地数据

### Persistence

当前持久层已确定：

- `~/.teamaligned/settings.json`
- `~/.teamaligned/app.db`
- `transcripts / workspaces / avatars / attachments / skills`

后续清理应坚持：

- SQLite 负责结构化查询
- 文件系统负责 transcript、artifact、memory、附件等内容实体
- 不重新引入新的持久化分叉

当前不再保留自动迁移路径：

- 运行时只使用 `~/.teamaligned`
- 启动不会自动导入 `~/teamaligned` / Electron `userData/teamaligned` / `app-state.json`
- 如需保留历史数据，需由用户手动备份后迁移

## 代码修改时的建议检查项

每次收口或修 bug 时，至少检查：

1. 是否删掉了已经不再使用的代码
2. 是否减少了重复状态更新
3. 是否引入了新的过渡逻辑
4. 是否需要同步文档
5. 是否至少通过：
   - `npm run typecheck`
   - `npm run lint`

## 当前阶段的目标

这份维护指南服务于当前 beta 收口目标：

- 代码简洁
- 结构稳定
- 文档可信
- 方便继续修链路和做发布准备
