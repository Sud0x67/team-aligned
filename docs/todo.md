# 开发 TODO

## 文档目的

这份文档只记录“接下来要做的事”，不再混合已经完成的 UI 骨架内容。

当前基线已经具备：

- 可运行的桌面应用
- 五个主页面
- 单聊 / 群聊主流程
- 本地持久化与 workspace 落盘
- Figma 对齐后的首版 UI

接下来的工作重点，是把当前这套“可体验原型”升级成“真实可执行产品”。

## P0：把 mock 替换成真实能力

### 1. 模型供应商接线

- [x] 接入真实 OpenAI API 调用
- [x] 接入真实 Qwen / DashScope API 调用
- [x] 让设置页中的 provider 配置直接驱动运行时
- [ ] 增加 provider 连接校验与错误提示

### 2. Agent Runtime 接线

- [x] 引入 DeepAgents
- [x] 引入 LangGraph 作为 runtime
- [x] 让单聊消息进入真实 Agent 调度
- [ ] 让群聊进入 manager + specialist 的真实协作链
- [ ] 把 run 状态与真实执行过程同步

### 3. Slash Command 真实执行

- [ ] `/skills` 列出当前可用 skills，并支持切换
- [ ] `/command` 在当前 workspace 执行真实本地命令
- [ ] `/mcp` 列出当前可用 MCP，并支持真实调用
- [ ] `/pause`、`/resume`、`/cancel` 与真实 run 对应

## P1：完善本地能力与扩展

### 4. Skills

- [ ] 读取内置 `SKILL.md`
- [ ] 支持全局 skills 目录
- [ ] 支持 workspace 级 skills
- [ ] 在消息流中展示 skill 生效结果

### 5. MCP

- [ ] 建立本地 MCP 注册表
- [ ] 支持 stdio MCP
- [ ] 支持 HTTP MCP
- [ ] 扩展页展示来源、协议和启用状态
- [ ] 增加 MCP 健康检查与错误提示

### 6. 本地工具

- [ ] 文件读取 / 写入工具
- [ ] 终端执行工具
- [ ] ripgrep 搜索工具
- [ ] artifact 生成与引用

## P1：正式数据层与审计

### 7. SQLite + Drizzle

- [ ] 设计正式 schema
- [ ] 增加 migration
- [ ] 规范 agents / teams / conversations / messages / runs / artifacts 表
- [ ] 建立 transcript 与 artifact 的关联关系

### 8. 可审计能力

- [ ] 导出会话记录
- [ ] 导出运行日志
- [ ] 导出 artifacts
- [ ] 增加本地全文检索

## P2：产品体验补强

### 9. 对话页增强

- [ ] `/` 命令自动补全菜单
- [ ] `@` 成员选择器
- [ ] run 详情抽屉
- [ ] artifact 浏览入口
- [ ] 命令执行结果卡片化

### 10. 群组协作增强

- [ ] 群组上下文摘要面板
- [ ] manager 调度轨迹展示
- [ ] specialist 协作详情
- [ ] 从管理页直接进入指定群组会话

### 11. 管理与设置增强

- [ ] 编辑 Agent
- [ ] 编辑群组
- [ ] 删除 Agent / 群组
- [ ] 头像二次编辑
- [ ] 设置页表单校验

## P2：交付与测试

### 12. 测试

- [ ] 为共享类型和命令解析补单元测试
- [ ] 为 runtime 行为补单元测试
- [ ] 为主要 UI 页面补组件测试
- [ ] 增加 Electron 端到端测试

### 13. 打包与发布

- [ ] Electron 打包配置
- [ ] macOS 应用图标与应用名检查
- [ ] 开发 / 测试 / 发布环境区分
- [ ] 崩溃日志与错误上报策略

## 推荐执行顺序

建议下一轮开发按下面顺序推进：

1. 先接通真实 OpenAI / Qwen
2. 再接通 `/command` 和真实 run 状态
3. 然后接 Skills 与 MCP
4. 接着整理 Drizzle schema 和审计能力
5. 最后再补 run 详情、artifact 浏览和发布流程
