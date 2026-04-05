import type {
  AppSettings,
  ConversationMeta,
  ExtensionRecord,
  ProviderConfig,
  TeamContext,
  UserProfile,
} from "./types.ts";

export const defaultProfile: UserProfile = {
  name: "Alex Chen",
  role: "产品经理",
  team: "AI 平台组",
  email: "alex.chen@teamaligned.local",
  bio: "专注于把 Agent 协作产品做成真正能用的本地桌面工具。",
  avatarPath: null,
};

export const defaultSettings: AppSettings = {
  theme: "light",
  language: "zh",
  notifyAgentComplete: true,
  notifyMention: true,
  notifyGroup: true,
  activeProviderId: "qwen",
};

export const defaultProviders: ProviderConfig[] = [
  {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "sk-qwen-demo-key",
    defaultModel: "qwen-max",
    supportsToolCalling: true,
    supportsStreaming: true,
    isActive: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-openai-demo-key",
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

export const defaultExtensions: ExtensionRecord[] = [
  {
    id: "skill-planner",
    type: "skill",
    name: "Planner",
    description: "帮助 Agent 拆解任务、整理优先级并规划执行步骤。",
    installed: true,
    enabled: true,
    source: "builtin",
    metadata: { category: "planning" },
  },
  {
    id: "skill-summarize",
    type: "skill",
    name: "Summarize",
    description: "将长内容压缩为重点摘要或阶段总结。",
    installed: true,
    enabled: true,
    source: "builtin",
    metadata: { category: "writing" },
  },
  {
    id: "skill-web-search",
    type: "skill",
    name: "Web Search",
    description: "允许 Agent 调用搜索工具获取互联网上的最新信息。",
    installed: true,
    enabled: true,
    source: "builtin",
    metadata: { category: "research" },
  },
  {
    id: "mcp-github",
    type: "mcp",
    name: "GitHub MCP",
    description: "访问仓库内容，浏览 Issues 和 Pull Requests。",
    installed: true,
    enabled: true,
    source: "stdio",
    metadata: { tools: ["list_issues", "search_code", "list_prs"] },
  },
  {
    id: "mcp-notion",
    type: "mcp",
    name: "Notion MCP",
    description: "访问 Notion 页面和数据库，用于同步知识库。",
    installed: false,
    enabled: false,
    source: "http",
    metadata: { tools: ["search_pages", "update_page"] },
  },
];

export const defaultTeamContext = (objective: string): TeamContext => ({
  objective,
  phase: "执行中",
  constraints: [
    "保持聊天优先，不做成复杂后台",
    "优先实现可体验的 MVP 版本",
  ],
  activeTasks: [
    "对齐 Figma 原型交互",
    "实现单聊命令式交互",
    "跑通群聊中的 Agent 协作",
  ],
  recentDecisions: [
    "默认首页为对话页",
    "Qwen 通过 DashScope OpenAI-compatible 接口接入",
  ],
  pinnedArtifacts: ["docs/mvp-plan.md", "docs/roadmap.md"],
  workspaceSummary: "当前工作目录为 team-aligned，聚焦 Electron 桌面原型。",
});
