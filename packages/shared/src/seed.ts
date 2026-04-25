import type {
  AppLanguage,
  AppSettings,
  ConversationMeta,
  ExtensionRecord,
  McpCatalogRecord,
  ProviderConfig,
  SkillCatalogRecord,
  TeamContext,
  UserProfile,
} from "./types.ts";
import { createTeamAlignedAssistantSkillRecord } from "./builtin.ts";

export const defaultProfile: UserProfile = {
  name: "Alex Chen",
  bio: "",
  avatarPath: null,
};

export const defaultSettings: AppSettings = {
  theme: "light",
  language: "zh",
  notifyAgentComplete: true,
  notifyMention: true,
  notifyGroup: true,
  activeProviderId: "qwen",
  onboardingCompleted: false,
};

export const defaultProviders: ProviderConfig[] = [
  {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "",
    defaultModel: "qwen-max",
    supportsToolCalling: true,
    supportsStreaming: true,
    isActive: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    defaultModel: "gpt-5",
    supportsToolCalling: true,
    supportsStreaming: true,
    isActive: false,
  },
];

export const defaultConversationMeta: ConversationMeta = {
  activeSkill: null,
  pinnedMcp: null,
  showInternalMessages: false,
};

export const defaultSkillCatalog: SkillCatalogRecord[] = [
  createTeamAlignedAssistantSkillRecord(),
  {
    id: "skill-bug-investigator",
    slug: "bug-investigator",
    name: "Bug Investigator",
    displayName: "问题排查",
    description: "系统化排查白屏、报错、回归和构建失败，快速定位根因并收敛到最小修复。",
    version: "0.1.0",
    sourceRepo: "https://github.com/Sud0x67/team-aligned-skills",
    sourceBranch: "main",
    sourcePath: "skills/bug-investigator",
    entryFile: "SKILL.md",
    installed: false,
    installedVersion: null,
    installPath: null,
    author: "TeamAligned",
    recommendedTools: ["terminal", "logs", "filesystem", "tests"],
    metadata: {
      descriptionZh: "系统化排查白屏、报错、回归和构建失败，快速定位根因并收敛到最小修复。",
      descriptionEn:
        "Systematically debug white screens, errors, regressions, and build failures to find root causes and converge on minimal fixes quickly.",
      category: "debugging",
      tags: ["debugging", "incident", "regression", "verification"],
      sources: [
        "https://github.com/MiniMax-AI/skills/tree/main/skills",
        "https://github.com/vercel-labs/skills",
      ],
    },
  },
  {
    id: "skill-codebase-onboarding",
    slug: "codebase-onboarding",
    name: "Codebase Onboarding",
    displayName: "代码库上手",
    description: "快速理解一个代码库的结构、入口、关键模块和演进路径，帮助新人高效进入上下文。",
    version: "0.1.0",
    sourceRepo: "https://github.com/Sud0x67/team-aligned-skills",
    sourceBranch: "main",
    sourcePath: "skills/codebase-onboarding",
    entryFile: "SKILL.md",
    installed: false,
    installedVersion: null,
    installPath: null,
    author: "TeamAligned",
    recommendedTools: ["filesystem", "ripgrep", "terminal"],
    metadata: {
      descriptionZh: "快速理解一个代码库的结构、入口、关键模块和演进路径，帮助新人高效进入上下文。",
      descriptionEn:
        "Quickly understand a codebase structure, entry points, key modules, and evolution path to ramp up efficiently.",
      category: "engineering",
      tags: ["codebase", "architecture", "onboarding", "engineering"],
      sources: [
        "https://github.com/MiniMax-AI/skills/tree/main/skills",
        "https://github.com/vercel-labs/skills",
      ],
    },
  },
  {
    id: "skill-research-brief",
    slug: "research-brief",
    name: "Research Brief",
    displayName: "研究简报",
    description: "围绕一个主题快速收集信息，区分事实与判断，并输出可用于决策的简报。",
    version: "0.1.0",
    sourceRepo: "https://github.com/Sud0x67/team-aligned-skills",
    sourceBranch: "main",
    sourcePath: "skills/research-brief",
    entryFile: "SKILL.md",
    installed: false,
    installedVersion: null,
    installPath: null,
    author: "TeamAligned",
    recommendedTools: ["web-search", "filesystem", "notes"],
    metadata: {
      descriptionZh: "围绕一个主题快速收集信息，区分事实与判断，并输出可用于决策的简报。",
      descriptionEn:
        "Rapidly collect information around one topic, separate facts from judgment, and produce a decision-ready brief.",
      category: "research",
      tags: ["research", "brief", "summary", "competitive-analysis"],
      sources: [
        "https://github.com/MiniMax-AI/skills/tree/main/skills",
        "https://github.com/vercel-labs/skills",
      ],
    },
  },
  {
    id: "skill-task-planner",
    slug: "task-planner",
    name: "Task Planner",
    displayName: "任务规划",
    description: "把模糊需求拆成可执行计划，明确目标、约束、阶段、风险和下一步动作。",
    version: "0.1.0",
    sourceRepo: "https://github.com/Sud0x67/team-aligned-skills",
    sourceBranch: "main",
    sourcePath: "skills/task-planner",
    entryFile: "SKILL.md",
    installed: false,
    installedVersion: null,
    installPath: null,
    author: "TeamAligned",
    recommendedTools: ["filesystem", "terminal", "todo"],
    metadata: {
      descriptionZh: "把模糊需求拆成可执行计划，明确目标、约束、阶段、风险和下一步动作。",
      descriptionEn:
        "Break ambiguous requirements into executable plans with clear goals, constraints, phases, risks, and next actions.",
      category: "planning",
      tags: ["planning", "execution", "roadmap", "breakdown"],
      sources: [
        "https://github.com/MiniMax-AI/skills/tree/main/skills",
        "https://github.com/vercel-labs/skills",
      ],
    },
  },
  {
    id: "skill-ui-refiner",
    slug: "ui-refiner",
    name: "UI Refiner",
    displayName: "界面打磨",
    description: "围绕可读性、一致性、间距、层级和状态反馈，提出高质量 UI 打磨建议并推动落地。",
    version: "0.1.0",
    sourceRepo: "https://github.com/Sud0x67/team-aligned-skills",
    sourceBranch: "main",
    sourcePath: "skills/ui-refiner",
    entryFile: "SKILL.md",
    installed: false,
    installedVersion: null,
    installPath: null,
    author: "TeamAligned",
    recommendedTools: ["figma", "screenshot", "filesystem"],
    metadata: {
      descriptionZh: "围绕可读性、一致性、间距、层级和状态反馈，提出高质量 UI 打磨建议并推动落地。",
      descriptionEn:
        "Improve UI readability, consistency, spacing, hierarchy, and state feedback with practical refinement guidance.",
      category: "design",
      tags: ["ui", "ux", "design", "polish", "figma"],
      sources: [
        "https://github.com/MiniMax-AI/skills/tree/main/skills",
        "https://github.com/vercel-labs/skills",
      ],
    },
  },
  {
    id: "skill-ui-ux-pro-max",
    slug: "ui-ux-pro-max",
    name: "UI UX Pro Max",
    displayName: "UI/UX 专业设计助手",
    description: "带可搜索设计知识库的高级 UI/UX Skill，覆盖风格、配色、字体、UX 规则、图表类型和多技术栈实现建议。",
    version: "0.1.0",
    sourceRepo: "https://github.com/Sud0x67/team-aligned-skills",
    sourceBranch: "main",
    sourcePath: "skills/ui-ux-pro-max",
    entryFile: "SKILL.md",
    installed: false,
    installedVersion: null,
    installPath: null,
    author: "Sud0x67",
    recommendedTools: ["python3", "filesystem", "figma", "screenshot"],
    metadata: {
      descriptionZh: "带可搜索设计知识库的高级 UI/UX Skill，覆盖风格、配色、字体、UX 规则、图表类型和多技术栈实现建议。",
      descriptionEn:
        "Advanced UI/UX skill with a searchable design knowledge base covering style, color, typography, UX rules, chart choices, and implementation guidance across stacks.",
      category: "design",
      tags: ["ui", "ux", "design-system", "figma", "frontend", "tailwind", "research"],
      sources: ["https://github.com/Sud0x67/team-aligned-skills"],
    },
  },
];

export const defaultExtensions: ExtensionRecord[] = [
];

export const defaultMcpCatalog: McpCatalogRecord[] = [
  {
    id: "mcp-context7",
    slug: "context7",
    name: "Context7",
    description: "通过 MCP 检索最新官方文档和库参考资料，适合研发和研究场景。",
    version: "0.1.0",
    author: "Upstash",
    transport: "stdio",
    sourceRepo: "https://github.com/Sud0x67/team-aligned-mcps",
    sourceBranch: "main",
    sourcePath: "servers/context7",
    launcherCommand: "npx",
    launcherArgs: ["-y", "@upstash/context7-mcp"],
    remoteUrl: null,
    authType: "env",
    authFields: [
      {
        key: "CONTEXT7_API_KEY",
        label: "Context7 API Key",
        required: true,
        secret: true,
        placeholder: "ctx7_...",
      },
    ],
    capabilities: ["docs", "search", "reference"],
    declaredTools: ["resolve-library-id", "get-library-docs"],
    recommendedFor: ["Researcher", "Coder", "Designer"],
    riskLevel: "low",
    docsUrl: "https://github.com/upstash/context7",
    homepage: "https://context7.com",
    metadata: {
      descriptionZh: "通过 MCP 检索最新官方文档和库参考资料，适合研发和研究场景。",
      descriptionEn:
        "Use MCP to retrieve up-to-date official docs and library references for engineering and research workflows.",
      tags: ["documentation", "research", "search"],
      sources: ["https://github.com/upstash/context7"],
    },
  },
  {
    id: "mcp-filesystem",
    slug: "filesystem",
    name: "Filesystem",
    description: "通过 MCP 暴露本地文件系统读写能力，适合代码、文档和工作区浏览。",
    version: "0.1.0",
    author: "Anthropic / MCP",
    transport: "stdio",
    sourceRepo: "https://github.com/Sud0x67/team-aligned-mcps",
    sourceBranch: "main",
    sourcePath: "servers/filesystem",
    launcherCommand: "npx",
    launcherArgs: ["-y", "@modelcontextprotocol/server-filesystem", "${workspacePath}"],
    remoteUrl: null,
    authType: "none",
    authFields: [],
    capabilities: ["filesystem", "workspace", "artifacts"],
    declaredTools: ["read_file", "write_file", "create_directory", "list_directory", "move_file"],
    recommendedFor: ["Coder", "Designer", "Planner"],
    riskLevel: "high",
    docsUrl: "https://github.com/modelcontextprotocol/servers",
    homepage: "https://modelcontextprotocol.io",
    metadata: {
      descriptionZh: "通过 MCP 暴露本地文件系统读写能力，适合代码、文档和工作区浏览。",
      descriptionEn:
        "Expose local filesystem read/write capabilities through MCP for code, documentation, and workspace navigation.",
      tags: ["filesystem", "workspace", "local"],
      sources: ["https://github.com/modelcontextprotocol/servers"],
    },
  },
  {
    id: "mcp-github",
    slug: "github",
    name: "GitHub",
    description: "访问仓库、Issue 和 Pull Request，适合代码协作和版本管理任务。",
    version: "0.1.0",
    author: "GitHub",
    transport: "http",
    sourceRepo: "https://github.com/Sud0x67/team-aligned-mcps",
    sourceBranch: "main",
    sourcePath: "servers/github",
    launcherCommand: null,
    launcherArgs: [],
    remoteUrl: "https://api.githubcopilot.com/mcp/",
    authType: "header",
    authFields: [
      {
        key: "Authorization",
        label: "GitHub Token",
        required: true,
        secret: true,
        placeholder: "Bearer ghp_...",
      },
    ],
    capabilities: ["code", "issues", "pull-requests"],
    declaredTools: ["search_repositories", "search_code", "list_issues", "list_pull_requests"],
    recommendedFor: ["Coder", "Planner", "Researcher"],
    riskLevel: "medium",
    docsUrl:
      "https://docs.github.com/en/copilot/how-tos/context/model-context-protocol/using-the-github-mcp-server",
    homepage: "https://github.com",
    metadata: {
      descriptionZh: "访问仓库、Issue 和 Pull Request，适合代码协作和版本管理任务。",
      descriptionEn:
        "Access repositories, issues, and pull requests for code collaboration and version control workflows.",
      tags: ["github", "git", "code", "collaboration"],
      sources: [
        "https://docs.github.com/en/copilot/how-tos/context/model-context-protocol/using-the-github-mcp-server",
      ],
    },
  },
  {
    id: "mcp-notion",
    slug: "notion",
    name: "Notion",
    description: "访问 Notion 页面和数据库，适合知识库同步、内容整理和任务协作。",
    version: "0.1.0",
    author: "Notion",
    transport: "stdio",
    sourceRepo: "https://github.com/Sud0x67/team-aligned-mcps",
    sourceBranch: "main",
    sourcePath: "servers/notion",
    launcherCommand: "npx",
    launcherArgs: ["-y", "@notionhq/notion-mcp-server"],
    remoteUrl: null,
    authType: "env",
    authFields: [
      {
        key: "OPENAPI_MCP_HEADERS",
        label: "Notion Authorization Headers",
        required: true,
        secret: true,
        placeholder: "{\"Authorization\":\"Bearer ntn_...\",\"Notion-Version\":\"2022-06-28\"}",
      },
    ],
    capabilities: ["knowledge-base", "documents", "databases"],
    declaredTools: ["search", "fetch", "create-pages", "update-page"],
    recommendedFor: ["Planner", "Researcher", "Manager"],
    riskLevel: "medium",
    docsUrl: "https://github.com/makenotion/notion-mcp-server",
    homepage: "https://www.notion.so",
    metadata: {
      descriptionZh: "访问 Notion 页面和数据库，适合知识库同步、内容整理和任务协作。",
      descriptionEn:
        "Access Notion pages and databases for knowledge sync, content organization, and task collaboration.",
      tags: ["notion", "knowledge-base", "documents"],
      sources: ["https://github.com/makenotion/notion-mcp-server"],
    },
  },
  {
    id: "mcp-playwright",
    slug: "playwright",
    name: "Playwright",
    description: "通过 MCP 控制浏览器完成访问、点击、输入和截图，适合 UI 验证和网页任务。",
    version: "0.1.0",
    author: "Microsoft",
    transport: "stdio",
    sourceRepo: "https://github.com/Sud0x67/team-aligned-mcps",
    sourceBranch: "main",
    sourcePath: "servers/playwright",
    launcherCommand: "npx",
    launcherArgs: ["-y", "@playwright/mcp@latest"],
    remoteUrl: null,
    authType: "none",
    authFields: [],
    capabilities: ["browser", "screenshot", "automation"],
    declaredTools: [
      "browser_navigate",
      "browser_click",
      "browser_type",
      "browser_snapshot",
      "browser_evaluate",
    ],
    recommendedFor: ["Designer", "Coder", "QA"],
    riskLevel: "medium",
    docsUrl: "https://github.com/microsoft/playwright-mcp",
    homepage: "https://playwright.dev",
    metadata: {
      descriptionZh: "通过 MCP 控制浏览器完成访问、点击、输入和截图，适合 UI 验证和网页任务。",
      descriptionEn:
        "Control the browser through MCP for navigation, clicks, typing, and screenshots in UI verification and web tasks.",
      tags: ["browser", "playwright", "automation", "testing"],
      sources: ["https://github.com/microsoft/playwright-mcp"],
    },
  },
];

export const defaultConnectedMcpIds = ["mcp-filesystem", "mcp-playwright"];

export const defaultTeamContext = (language: AppLanguage = "zh"): TeamContext => ({
  phase: language === "en" ? "executing" : "执行中",
  constraints:
    language === "en"
      ? ["Keep chat-first experience, avoid heavyweight control surfaces", "Prioritize a usable MVP"]
      : ["保持聊天优先，不做成复杂后台", "优先实现可体验的 MVP 版本"],
  activeTasks:
    language === "en"
      ? [
          "Align interaction details with the Figma prototype",
          "Deliver command-style direct-chat interaction",
          "Stabilize multi-Agent collaboration in team chat",
        ]
      : ["对齐 Figma 原型交互", "实现单聊命令式交互", "跑通群聊中的 Agent 协作"],
  recentDecisions:
    language === "en"
      ? [
          "Set chat as the default home page",
          "Use DashScope OpenAI-compatible endpoint for Qwen",
        ]
      : ["默认首页为对话页", "Qwen 通过 DashScope OpenAI-compatible 接口接入"],
  pinnedArtifacts: ["docs/mvp-plan.md", "docs/roadmap.md"],
  workspaceSummary:
    language === "en"
      ? "Current workspace is team-aligned, focused on the Electron desktop prototype."
      : "当前工作目录为 team-aligned，聚焦 Electron 桌面原型。",
  handoff: {
    activeAgentId: null,
    lastSpeakerId: null,
    nextAgentIds: [],
    reason: language === "en" ? "Initial state" : "初始状态",
    revision: 0,
    updatedAt: Date.now(),
  },
});
