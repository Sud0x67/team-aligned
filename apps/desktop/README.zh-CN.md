# apps/desktop

[English README](./README.md)

这个目录已经承载当前可运行的 Electron 桌面端 MVP。

当前包含：

- Electron 主进程
- preload 桥接层
- React renderer
- Tailwind UI
- 聊天、管理、扩展、设置页面
- Electron 打包配置
- 单聊与群聊主界面
- run 详情、附件预览、命令结果卡片
- 扩展中心、管理页、设置页

当前桌面端已经接入真实本地运行时，UI 侧负责：

- 页面路由与状态同步
- IPC 驱动的本地数据读写
- 聊天输入、`@` 选择器、`/` 自动补全
- 模型配置、MCP 配置与健康检查
- run / artifact / attachment / tool invocation 展示
- 通知中心与系统通知入口
