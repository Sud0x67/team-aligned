# Skill Registry 设计

## 当前实现

- Skill 元数据来自独立 registry 仓库的 `catalog/skills.json`
- TeamAligned 启动时会尝试同步 Skill catalog
- 扩展页的 Skills tab 展示 catalog 中的 skill
- 点击安装后，会把对应 skill 目录完整复制到本地全局目录
- 全局安装路径为 `~/.teamaligned/skills/<skill-id>/<version>/`
- Agent 使用 `skillWhitelist` 控制允许加载哪些 skill
- 当前新安装 skill 会默认加入所有 Agent 的白名单，后续再收紧为显式配置

## 当前仓库内结构

- `packages/agent-runtime/src/skill-registry.ts`
  - 负责读取 registry catalog
  - 负责安装 skill 到本地目录
  - 负责读取已安装 skill 的 `SKILL.md`

- `packages/agent-runtime/src/storage.ts`
  - 持久化 `skillCatalog`
  - 持久化 `agent.skillWhitelist`
  - 管理全局 skill 安装目录

- `packages/agent-runtime/src/runtime.ts`
  - 启动时同步 Skill catalog
  - 提供安装 Skill 的 runtime API
  - `/skills` 只展示当前会话可用且已安装的 skill

- `packages/agent-runtime/src/deep-agent.ts`
  - 将已安装 skill 的 `SKILL.md` 内容注入单聊 system prompt

## Registry 仓库约定

当前独立 Skill 仓库为：

- `https://github.com/Sud0x67/team-aligned-skills`

仓库结构：

```text
catalog/
  skills.json
skills/
  <slug>/
    skill.json
    SKILL.md
    ...
```

`catalog/skills.json` 是 TeamAligned 页面展示和安装的唯一聚合入口。

## 后续待补

1. Skill 升级与版本固定
2. Team 级 skillWhitelist
3. 从 `SKILL.md` frontmatter 自动生成 catalog
