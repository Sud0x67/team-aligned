# MCP Registry 设计

## 当前目标

`TeamAligned` 的 MCP 先走一条 `local-first` 的落地路径：

1. 远端 Git 仓库负责维护 MCP 元数据
2. 本地应用同步 catalog 并展示给用户
3. 用户把某个 MCP 加入本地连接列表
4. 本地运行时再根据连接状态决定是否对会话暴露能力

当前远端仓库：

- `https://github.com/Sud0x67/team-aligned-mcps`

本地开发副本默认位置：

- `/Users/bobo/code/team-aligned-mcps`

## 为什么这样设计

MCP 和 Skill 不完全一样。

Skill 更像可安装的知识模板，而 MCP 更像需要真实连接、鉴权和运行时适配的外部能力。

因此这里拆成两层：

- `registry`：负责发现、展示、更新
- `local connection`：负责真实配置、启用状态、工具发现结果

## 仓库结构

```text
team-aligned-mcps/
├─ catalog/
│  └─ servers.json
├─ docs/
│  └─ repository-design.md
├─ scripts/
│  └─ build-catalog.mjs
└─ servers/
   └─ <slug>/
      └─ server.json
```

## TeamAligned 中的本地模型

### MCP Catalog

保存静态元数据：

- 基础名称和说明
- transport 类型
- 启动命令或远端 URL
- 鉴权字段定义
- 预声明工具
- 风险等级
- 推荐角色

### MCP Connection

保存本地真实状态：

- 是否启用
- 本地 command / args
- 远端 url
- env / headers
- 当前发现的工具
- 连接状态
- 最近错误

## 当前已实现

当前版本已经完成：

- MCP registry 仓库结构
- 从 GitHub repo 同步 `catalog/servers.json`
- `TeamAligned` 启动时自动同步 MCP catalog
- 扩展页展示真实 MCP 卡片
- 本地连接配置表单
- `stdio npx` MCP 的真实健康检查和 tools/list
- `HTTP + headers` MCP 的真实 URL 握手、超时控制和 tools/list
- `HTTP + OAuth` MCP 的基础授权闭环：扩展页授权按钮、浏览器打开授权页、本地回调接收 code、token 状态保存、授权后重新发现工具
- “连接并启用 / 添加并配置 / 移除连接” 的本地状态流
- Agent 级 MCP 白名单
- `/mcp`
- `/mcp use <slug>`
- `/mcp tools <slug>`
- 单聊与群聊 runtime 已能注入 discovered MCP tools
- MCP 未授权/权限错误会在聊天过程消息中提示用户授权后重试
- runtime 已提供通用工具执行前 policy hook，可用于后续确认 UI

## 当前边界

这一版还没有做：

- OAuth token 过期后的重授权体验打磨
- 更完整的 tool call 可视化和 run 详情
- tool 级白名单
- MCP 调用审计与历史记录
- 群聊里对 MCP 使用过程的更丰富可视化
- 通用工具确认 UI 队列

也就是说，当前已经完成了第一版 MCP 主链路：

- 支持 `stdio npx`
- 支持 `HTTP + headers`
- 支持 `HTTP + OAuth` 基础授权
- 支持本地配置
- 支持健康检查
- 支持 Agent / Team 白名单
- 支持 discovered tools 注入 runtime

## 推荐开发顺序

1. 增加 MCP tool call 审计与运行记录
2. 增加 tool 级白名单
3. 增加更细粒度的错误提示与配置模板
4. 在消息流中展示 MCP 调用过程与结果
5. 补通用工具确认 UI 和 OAuth 重授权体验
