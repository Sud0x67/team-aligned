import { createDeepAgent, FilesystemBackend } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import type {
  AgentRecord,
  McpCatalogRecord,
  McpConnectionRecord,
  MessageRecord,
  ProviderConfig,
  UserProfile,
} from "@teamaligned/shared";
import { buildMcpLangChainTools } from "./mcp-tools.ts";

type DeepAgentSession = {
  signature: string;
  agent: ReturnType<typeof createDeepAgent>;
  initialized: boolean;
};

function isPlaceholderApiKey(value: string) {
  const normalized = value.trim();
  return (
    normalized.length === 0 ||
    normalized === "sk-qwen-demo-key" ||
    normalized === "sk-openai-demo-key"
  );
}

export function normalizeMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          if ("text" in item && typeof item.text === "string") {
            return item.text;
          }
          if ("content" in item && typeof item.content === "string") {
            return item.content;
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (content && typeof content === "object") {
    if ("text" in content && typeof content.text === "string") {
      return content.text.trim();
    }
    if ("content" in content && typeof content.content === "string") {
      return content.content.trim();
    }
  }

  return "";
}

export function extractAgentText(result: unknown): string {
  if (typeof result === "string") {
    return result.trim();
  }

  if (!result || typeof result !== "object") {
    return "";
  }

  if ("messages" in result && Array.isArray(result.messages)) {
    for (let index = result.messages.length - 1; index >= 0; index -= 1) {
      const message = result.messages[index];
      if (!message || typeof message !== "object") continue;
      if ("content" in message) {
        const text = normalizeMessageContent(message.content);
        if (text) {
          return text;
        }
      }
    }
  }

  if ("content" in result) {
    return normalizeMessageContent(result.content);
  }

  return "";
}

function toAgentMessages(history: MessageRecord[]) {
  return history
    .filter(
      (message) =>
        message.visibility === "public" &&
        (message.senderKind === "user" || message.senderKind === "agent"),
    )
    .slice(-12)
    .map((message) => ({
      role: message.senderKind === "user" ? "user" : "assistant",
      content: message.content,
    }));
}

function buildSystemPrompt(input: {
  agent: AgentRecord;
  provider: ProviderConfig;
  profile: UserProfile;
  activeSkill: string | null;
  activeSkillDefinition: string | null;
  activeMcpServers: McpCatalogRecord[];
  workspacePath: string;
}) {
  const { agent, provider, profile, activeSkill, activeSkillDefinition, activeMcpServers, workspacePath } =
    input;
  const capabilities = agent.capabilities.join("、") || "未设置";
  const mcpServerNames = activeMcpServers.map((server) => server.name).join("、");

  return [
    `你是 ${agent.name}，角色是 ${agent.role}。`,
    `你运行在 teamaligned 的本地桌面应用里，当前首要目标是稳定支持单聊场景。`,
    `当前模型供应商：${provider.label}，模型：${provider.defaultModel}。`,
    `当前 workspace：${workspacePath}。`,
    `你的能力标签：${capabilities}。`,
    activeSkill ? `当前会话激活技能：${activeSkill}。` : "当前会话未指定额外技能。",
    activeSkillDefinition
      ? `请严格参考下面这份 SKILL 定义执行：\n\n${activeSkillDefinition}`
      : "",
    activeMcpServers.length > 0
      ? `当前可用 MCP 服务：${mcpServerNames}。如需外部能力，请优先通过已注入的 MCP tools 调用。`
      : "当前没有可用 MCP 服务。",
    `当前用户资料：姓名 ${profile.name}，角色 ${profile.role || "未设置"}，团队 ${profile.team || "未设置"}。`,
    "请优先使用与用户相同的语言回复。",
    "默认先直接给出清晰、可执行的答复；只有在确有必要时才使用文件系统或执行工具。",
    "如果本地配置或请求本身存在阻塞，请明确说明缺少什么信息或配置。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function createProviderModel(provider: ProviderConfig) {
  return new ChatOpenAI({
    model: provider.defaultModel,
    apiKey: provider.apiKey,
    temperature: 0.2,
    timeout: 120_000,
    maxRetries: 2,
    configuration: {
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl,
    },
  });
}

function createSignature(input: {
  provider: ProviderConfig;
  agent: AgentRecord;
  profile: UserProfile;
  activeSkill: string | null;
  activeSkillDefinition: string | null;
  mcpToolSignature: string;
  workspacePath: string;
}) {
  const { provider, agent, profile, activeSkill, activeSkillDefinition, mcpToolSignature, workspacePath } =
    input;
  return JSON.stringify({
    provider: {
      id: provider.id,
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel,
      apiKey: provider.apiKey,
      supportsToolCalling: provider.supportsToolCalling,
      supportsStreaming: provider.supportsStreaming,
    },
    agent: {
      id: agent.id,
      role: agent.role,
      capabilities: agent.capabilities,
    },
    profile: {
      name: profile.name,
      role: profile.role,
      team: profile.team,
      bio: profile.bio,
    },
    activeSkill,
    activeSkillDefinition,
    mcpToolSignature,
    workspacePath,
  });
}

export function validateProviderForSingleChat(provider: ProviderConfig | null) {
  if (!provider) {
    return "当前没有可用的模型供应商，请先在设置页完成配置。";
  }

  if (isPlaceholderApiKey(provider.apiKey)) {
    return provider.id === "qwen"
      ? "当前百炼 API Key 仍是示例值，请先在设置页填写真实 API Key。"
      : "当前 OpenAI API Key 仍是示例值，请先在设置页填写真实 API Key。";
  }

  if (!provider.baseUrl.trim()) {
    return "当前 provider 缺少 Base URL，请先在设置页补全。";
  }

  if (!provider.supportsToolCalling) {
    return "当前 provider 未开启工具调用，DeepAgents 无法正常工作。";
  }

  return null;
}

export async function invokeSingleChatDeepAgent(input: {
  sessions: Map<string, DeepAgentSession>;
  conversationId: string;
  provider: ProviderConfig;
  agent: AgentRecord;
  profile: UserProfile;
  activeSkill: string | null;
  activeSkillDefinition: string | null;
  mcpServers: McpCatalogRecord[];
  mcpConnections: McpConnectionRecord[];
  workspacePath: string;
  history: MessageRecord[];
  latestInput: string;
}) {
  const {
    sessions,
    conversationId,
    provider,
    agent,
    profile,
    activeSkill,
    activeSkillDefinition,
    mcpServers,
    mcpConnections,
    workspacePath,
    history,
    latestInput,
  } = input;

  const mcpConnectionMap = new Map(mcpConnections.map((connection) => [connection.serverId, connection]));
  const mcpTools = buildMcpLangChainTools({
    servers: mcpServers,
    connectionsById: mcpConnectionMap,
    workspacePath,
  });
  const mcpToolSignature = JSON.stringify(
    mcpServers.map((server) => ({
      id: server.id,
      tools: (mcpConnectionMap.get(server.id)?.discoveredTools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    })),
  );

  const signature = createSignature({
    provider,
    agent,
    profile,
    activeSkill,
    activeSkillDefinition,
    mcpToolSignature,
    workspacePath,
  });
  const cached = sessions.get(conversationId);
  const shouldCreate = !cached || cached.signature !== signature;

  const session =
    shouldCreate || !cached
      ? {
          signature,
          initialized: false,
          agent: createDeepAgent({
            name: agent.name,
            model: createProviderModel(provider),
            systemPrompt: buildSystemPrompt({
              agent,
              provider,
              profile,
              activeSkill,
              activeSkillDefinition,
              activeMcpServers: mcpServers,
              workspacePath,
            }),
            tools: mcpTools,
            backend: new FilesystemBackend({
              rootDir: workspacePath,
              virtualMode: true,
            }),
            checkpointer: new MemorySaver(),
            memory: ["/memory/MEMORY.md"],
          }),
        }
      : cached;

  sessions.set(conversationId, session);

  const messages = session.initialized
    ? [{ role: "user" as const, content: latestInput }]
    : toAgentMessages(history);

  const result = await session.agent.invoke(
    { messages },
    { configurable: { thread_id: conversationId } },
  );

  session.initialized = true;

  const text = extractAgentText(result);
  return text || "模型已完成调用，但没有返回可显示的文本内容。";
}
