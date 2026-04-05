# apps/desktop

这个目录已经承载当前可运行的 Electron 桌面端 MVP。

当前包含：

- Electron 主进程
- preload 桥接层
- React renderer
- Tailwind UI
- 聊天、管理、扩展、仪表盘、设置页面
- Electron 打包配置

当前目标是先跑通本地优先的聊天交互体验，后续再逐步接入真实 Agent runtime、MCP 和模型调用。
