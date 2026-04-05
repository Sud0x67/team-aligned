# packages/agent-runtime

这个目录已经包含当前 MVP 使用的本地 Agent runtime。

当前已实现：

- 会话 snapshot 组装
- `/skills`、`/command`、`/mcp` 与 run 控制
- 单 Agent run 与 Team 群组 run 编排
- 群聊上下文同步与内部消息
- 本地文件持久化
- 通知、workspace、种子数据初始化

后续会逐步替换为更真实的运行时能力：

- DeepAgents 集成
- LangChain 模型适配
- LangGraph 执行流
- 真实工具调用
- 更完整的 Team 编排与调度
