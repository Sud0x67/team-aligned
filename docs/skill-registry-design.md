# Skill Registry 设计

## 当前实现

- Skill 元数据来自独立 registry 仓库的 `catalog/skills.json`
- TeamAligned 启动时会尝试同步 Skill catalog
- 扩展页的 Skills tab 展示 catalog 中的 skill
- 点击安装后，会把对应 skill 目录完整复制到本地全局目录
- 全局安装路径为 `~/.teamaligned/skills/<skill-id>/<version>/`
- Agent 使用 `skillWhitelist` 控制允许加载哪些 skill
- 当前新安装 skill 会默认加入所有 Agent 的白名单，后续再收紧为显式配置
- Runtime 采用标准 Skill progressive disclosure：
  - system prompt 只注入白名单 Skill 的轻量 catalog（id、slug、description）
  - 模型判断任务相关时调用 `skill_load` 读取完整 `SKILL.md`
  - 需要附属材料时调用 `skill_read_file` 读取 `references/`、`templates/`、`assets/`
  - 需要执行附带脚本时调用 `skill_run_script`，脚本仍走工具确认策略

### 内置 Skill（不走远端下载）

- `team-aligned-assistant` 是系统内置 Skill，随应用打包，运行时内置提供 `SKILL.md` 内容。
- 该 Skill 不依赖 GitHub 下载，不会被移除，也不会被 catalog 同步覆盖掉。
- 它只服务内置应用助手 Agent（`agent-teamaligned-assistant`），不对其他 Agent 自动分配。

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
  - 单聊和群聊按 Agent 白名单注入可用 Skill catalog

- `packages/agent-runtime/src/deep-agent.ts`
  - 提示模型按需加载白名单 Skill，而不是默认注入完整 `SKILL.md`

- `packages/agent-runtime/src/agent-tools.ts`
  - 提供通用 `skill_list`、`skill_load`、`skill_read_file`、`skill_run_script`
  - 不再为单个 active Skill 动态生成专属工具名

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
2. 从 `SKILL.md` frontmatter 自动生成 catalog
3. Skill 升级时的差异提示与回滚
