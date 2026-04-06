# packages/agent-runtime

这个目录已经包含当前 MVP 使用的本地 Agent runtime。

当前已实现：

- 会话 snapshot 组装
- `/skills`、`/command`、`/mcp` 与 run 控制
- 单 Agent run 与 Team 群组 run 编排
- 群聊上下文同步与内部消息
- DeepAgents / LangChain / LangGraph 单聊调用链
- Skills registry、安装、激活与脚本执行
- MCP registry、配置、健康检查与 tool discovery
- 本地文件、搜索、命令工具层
- 本地文件持久化与 SQLite / Drizzle
- 通知、workspace、种子数据初始化

当前仍待继续补强的方向：

- MCP tool 级白名单
- OAuth 型 MCP
- 更强的 failure recovery / checkpoint
- 导出、全文搜索与测试体系
