import { createDeepAgent, FilesystemBackend } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { readFileSync } from "node:fs";
import type {
  AgentRecord,
  AttachmentAssetRecord,
  McpCatalogRecord,
  McpConnectionRecord,
  MessageRecord,
  ProviderConnectionTestInput,
  ProviderConnectionTestResult,
  ProviderConfig,
  UserProfile,
} from "@teamaligned/shared";
import { buildMcpLangChainTools, type McpInvocationEvent } from "./mcp-tools.ts";
import { byLanguage, type RuntimeLanguage } from "./runtime-language.ts";

type TokenUsageSummary = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

type DeepAgentSession = {
  signature: string;
  agent: ReturnType<typeof createDeepAgent>;
  initialized: boolean;
};

type ChatInputMessage = {
  role: "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

function isPlaceholderApiKey(value: string) {
  const normalized = value.trim();
  return (
    normalized.length === 0 ||
    normalized === "sk-qwen-demo-key" ||
    normalized === "sk-openai-demo-key"
  );
}

function isLikelyHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function collectErrorTexts(error: unknown, depth = 0, bucket: string[] = []) {
  if (depth > 4 || error == null) return bucket;

  if (typeof error === "string") {
    if (error.trim()) bucket.push(error.trim());
    return bucket;
  }

  if (error instanceof Error) {
    if (error.message?.trim()) {
      bucket.push(error.message.trim());
    }
    const asRecord = error as unknown as Record<string, unknown>;
    if (typeof asRecord.code === "string" && asRecord.code.trim()) {
      bucket.push(asRecord.code.trim());
    }
    if (typeof asRecord.type === "string" && asRecord.type.trim()) {
      bucket.push(asRecord.type.trim());
    }
    collectErrorTexts(asRecord.error, depth + 1, bucket);
    collectErrorTexts(asRecord.cause, depth + 1, bucket);
    return bucket;
  }

  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) {
      bucket.push(record.message.trim());
    }
    if (typeof record.code === "string" && record.code.trim()) {
      bucket.push(record.code.trim());
    }
    if (typeof record.type === "string" && record.type.trim()) {
      bucket.push(record.type.trim());
    }
    collectErrorTexts(record.error, depth + 1, bucket);
    collectErrorTexts(record.cause, depth + 1, bucket);
    return bucket;
  }

  const stringified = String(error).trim();
  if (stringified) bucket.push(stringified);
  return bucket;
}

function toErrorText(error: unknown) {
  const texts = collectErrorTexts(error);
  if (texts.length === 0) return "";
  return Array.from(new Set(texts)).join(" | ");
}

function extractTroubleshootingUrl(rawMessage: string) {
  const matchedUrl =
    rawMessage.match(/Troubleshooting URL:\s*(https?:\/\/\S+)/i)?.[1] ??
    rawMessage.match(/For details,\s*see:\s*(https?:\/\/\S+)/i)?.[1] ??
    rawMessage.match(/https?:\/\/\S+/i)?.[0] ??
    null;
  return matchedUrl ? matchedUrl.replace(/[)\],.]+$/, "") : null;
}

export function normalizeProviderErrorMessage(
  error: unknown,
  provider?: Pick<ProviderConfig, "id" | "label" | "baseUrl" | "defaultModel">,
  language: RuntimeLanguage = "zh",
) {
  const raw = toErrorText(error).trim();
  const normalized = raw.toLowerCase();
  const normalizedCompat = normalized.replace(/[_-]+/g, " ");
  const providerLabel = provider?.label ?? provider?.id ?? byLanguage(language, { zh: "模型服务", en: "model provider" });
  const baseUrlHint = provider?.baseUrl ? `（${provider.baseUrl}）` : "";
  const troubleshootingUrl = extractTroubleshootingUrl(raw);
  const troubleshootingHint = troubleshootingUrl
    ? byLanguage(language, { zh: `\n排查参考：${troubleshootingUrl}`, en: `\nTroubleshooting: ${troubleshootingUrl}` })
    : "";

  if (
    /(^|[\s:])401([\s:]|$)|unauthorized|invalid api key|incorrect api key|authentication|auth|api key|apikey error/i.test(
      normalizedCompat,
    ) ||
    normalizedCompat.includes("incorrect api key")
  ) {
    return byLanguage(language, {
      zh: `${providerLabel} 鉴权失败。请检查 API Key 是否正确、是否过期，并确认当前账号有该模型的调用权限。${troubleshootingHint}`,
      en: `${providerLabel} authentication failed. Check whether the API key is correct, valid, and authorized for this model.${troubleshootingHint}`,
    });
  }

  if (/(^|[\s:])403([\s:]|$)|forbidden|permission denied/i.test(normalized)) {
    return byLanguage(language, {
      zh: `${providerLabel} 拒绝访问。请检查账号权限、组织策略或服务端白名单配置。`,
      en: `${providerLabel} rejected the request. Check account permissions, org policy, or service allowlist settings.`,
    });
  }

  if (
    /(^|[\s:])429([\s:]|$)|rate limit|too many requests|insufficient_quota|quota|billing/i.test(
      normalized,
    )
  ) {
    return byLanguage(language, {
      zh: `${providerLabel} 调用受限（限流或额度不足）。请稍后重试，或检查配额与计费状态。`,
      en: `${providerLabel} is rate-limited or out of quota. Retry later, or check quota and billing status.`,
    });
  }

  if (
    /(^|[\s:])404([\s:]|$)|model.*not found|no such model|invalid model|does not exist/i.test(
      normalized,
    )
  ) {
    return byLanguage(language, {
      zh: `${providerLabel} 模型不可用。请检查模型名称是否正确，并确认该模型在当前接口可访问。`,
      en: `${providerLabel} model is unavailable. Verify model name and make sure this endpoint can access it.`,
    });
  }

  if (/timeout|timed out|etimedout|aborted|abort/i.test(normalized)) {
    return byLanguage(language, {
      zh: `连接 ${providerLabel} 超时。请检查网络和 Base URL${baseUrlHint}，然后重试。`,
      en: `Connection to ${providerLabel} timed out. Check network and Base URL${baseUrlHint}, then retry.`,
    });
  }

  if (
    /enotfound|econnrefused|econnreset|network|fetch failed|socket hang up|getaddrinfo|certificate|self signed|ssl|tls/i.test(
      normalized,
    )
  ) {
    return byLanguage(language, {
      zh: `无法连接到 ${providerLabel}。请检查 Base URL${baseUrlHint}、网络连通性和证书配置。${troubleshootingHint}`,
      en: `Cannot connect to ${providerLabel}. Check Base URL${baseUrlHint}, network connectivity, and certificate settings.${troubleshootingHint}`,
    });
  }

  if (
    /(^|[\s:])5\d{2}([\s:]|$)|internal server error|bad gateway|service unavailable|gateway timeout/i.test(
      normalized,
    )
  ) {
    return byLanguage(language, {
      zh: `${providerLabel} 服务暂时不可用。请稍后重试。`,
      en: `${providerLabel} service is temporarily unavailable. Please retry later.`,
    });
  }

  return raw || byLanguage(language, { zh: "模型调用失败，请稍后重试。", en: "Model call failed. Please retry later." });
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

function toNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildTokenUsageSummary(inputTokens: unknown, outputTokens: unknown, totalTokens: unknown) {
  const normalizedInput = toNullableNumber(inputTokens);
  const normalizedOutput = toNullableNumber(outputTokens);
  const normalizedTotal =
    toNullableNumber(totalTokens) ??
    (normalizedInput !== null || normalizedOutput !== null
      ? (normalizedInput ?? 0) + (normalizedOutput ?? 0)
      : null);

  if (normalizedInput === null && normalizedOutput === null && normalizedTotal === null) {
    return null;
  }

  return {
    inputTokens: normalizedInput,
    outputTokens: normalizedOutput,
    totalTokens: normalizedTotal,
  } satisfies TokenUsageSummary;
}

function extractTokenUsage(result: unknown): TokenUsageSummary | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const usageMetadata =
    "usage_metadata" in result && result.usage_metadata && typeof result.usage_metadata === "object"
      ? result.usage_metadata
      : null;
  if (usageMetadata) {
    return buildTokenUsageSummary(
      "input_tokens" in usageMetadata ? usageMetadata.input_tokens : null,
      "output_tokens" in usageMetadata ? usageMetadata.output_tokens : null,
      "total_tokens" in usageMetadata ? usageMetadata.total_tokens : null,
    );
  }

  const responseMetadata =
    "response_metadata" in result &&
    result.response_metadata &&
    typeof result.response_metadata === "object"
      ? result.response_metadata
      : null;
  if (responseMetadata) {
    const tokenUsage =
      "tokenUsage" in responseMetadata &&
      responseMetadata.tokenUsage &&
      typeof responseMetadata.tokenUsage === "object"
        ? responseMetadata.tokenUsage
        : null;
    if (tokenUsage) {
      return buildTokenUsageSummary(
        "promptTokens" in tokenUsage ? tokenUsage.promptTokens : null,
        "completionTokens" in tokenUsage ? tokenUsage.completionTokens : null,
        "totalTokens" in tokenUsage ? tokenUsage.totalTokens : null,
      );
    }
  }

  const usage =
    "usage" in result && result.usage && typeof result.usage === "object" ? result.usage : null;
  if (usage) {
    return buildTokenUsageSummary(
      "prompt_tokens" in usage ? usage.prompt_tokens : null,
      "completion_tokens" in usage ? usage.completion_tokens : null,
      "total_tokens" in usage ? usage.total_tokens : null,
    );
  }

  if ("messages" in result && Array.isArray(result.messages)) {
    for (let index = result.messages.length - 1; index >= 0; index -= 1) {
      const nestedUsage = extractTokenUsage(result.messages[index]);
      if (nestedUsage) {
        return nestedUsage;
      }
    }
  }

  return null;
}

function toAgentMessages(history: MessageRecord[]): ChatInputMessage[] {
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

function buildImageDataUrl(attachment: AttachmentAssetRecord) {
  const data = readFileSync(attachment.path).toString("base64");
  return `data:${attachment.mimeType};base64,${data}`;
}

function buildLatestUserMessage(
  input: string,
  attachments: AttachmentAssetRecord[],
  responseLanguage: RuntimeLanguage,
): ChatInputMessage {
  const imageAttachments = attachments.filter((attachment) => attachment.mimeType.startsWith("image/"));
  if (imageAttachments.length === 0) {
    return { role: "user", content: input };
  }

  const content: ChatInputMessage["content"] = [
    {
      type: "text",
      text: [
        input,
        "",
        byLanguage(responseLanguage, {
          zh: "请理解并结合下面上传的图片内容进行回答。若图片无法读取，请明确说明。",
          en: "Please answer based on the uploaded image content. If any image cannot be read, state that clearly.",
        }),
      ].join("\n"),
    },
  ];

  for (const attachment of imageAttachments) {
    try {
      content.push({
        type: "image_url",
        image_url: { url: buildImageDataUrl(attachment) },
      });
    } catch {
      content.push({
        type: "text",
        text: byLanguage(responseLanguage, {
          zh: `图片 ${attachment.name} 读取失败，路径：${attachment.path}`,
          en: `Failed to read image ${attachment.name}. Path: ${attachment.path}`,
        }),
      });
    }
  }

  return { role: "user", content };
}

function buildSystemPrompt(input: {
  agent: AgentRecord;
  provider: ProviderConfig;
  profile: UserProfile;
  activeSkill: string | null;
  activeSkillDefinition: string | null;
  activeMcpServers: McpCatalogRecord[];
  runtimeToolSummary: string;
  workspacePath: string;
  responseLanguage: RuntimeLanguage;
}) {
  const {
    agent,
    provider,
    profile,
    activeSkill,
    activeSkillDefinition,
    activeMcpServers,
    runtimeToolSummary,
    workspacePath,
    responseLanguage,
  } =
    input;
  const capabilities =
    responseLanguage === "en"
      ? agent.capabilities.join(", ") || "not set"
      : agent.capabilities.join("、") || "未设置";
  const mcpServerNames =
    responseLanguage === "en"
      ? activeMcpServers.map((server) => server.name).join(", ")
      : activeMcpServers.map((server) => server.name).join("、");

  return byLanguage(responseLanguage, {
    zh: [
      `你是 ${agent.name}，角色是 ${agent.role}。`,
      "你运行在 teamaligned 的本地桌面应用里，当前首要目标是稳定支持单聊场景。",
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
      `当前用户资料：姓名 ${profile.name}，简介 ${profile.bio || "未设置"}。`,
      "请优先使用与用户相同的语言回复。",
      "默认先直接给出清晰、可执行的答复；只有在确有必要时才使用文件系统或执行工具。",
      runtimeToolSummary,
      "如果本地配置或请求本身存在阻塞，请明确说明缺少什么信息或配置。",
    ],
    en: [
      `You are ${agent.name}, and your role is ${agent.role}.`,
      "You run inside the local TeamAligned desktop app. Your primary goal is to provide stable one-on-one chat support.",
      `Current model provider: ${provider.label}, model: ${provider.defaultModel}.`,
      `Current workspace: ${workspacePath}.`,
      `Your capability tags: ${capabilities}.`,
      activeSkill ? `Active skill for this conversation: ${activeSkill}.` : "No extra skill is active for this conversation.",
      activeSkillDefinition
        ? `Strictly follow this SKILL definition:\n\n${activeSkillDefinition}`
        : "",
      activeMcpServers.length > 0
        ? `Available MCP servers: ${mcpServerNames}. When external capabilities are needed, prefer injected MCP tools.`
        : "No MCP server is currently available.",
      `Current user profile: name ${profile.name}, bio ${profile.bio || "not set"}.`,
      "Reply in the same language the user is currently using.",
      "Default to clear, actionable answers first; only use filesystem or execution tools when needed.",
      runtimeToolSummary,
      "If local config or request constraints block progress, clearly explain what information or configuration is missing.",
    ],
  })
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
    streaming: provider.supportsStreaming,
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
  responseLanguage: RuntimeLanguage;
}) {
  const {
    provider,
    agent,
    profile,
    activeSkill,
    activeSkillDefinition,
    mcpToolSignature,
    workspacePath,
    responseLanguage,
  } =
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
      bio: profile.bio,
    },
    activeSkill,
    activeSkillDefinition,
    mcpToolSignature,
    workspacePath,
    responseLanguage,
  });
}

export function validateProviderForSingleChat(
  provider: ProviderConfig | null,
  language: RuntimeLanguage = "zh",
) {
  if (!provider) {
    return byLanguage(language, {
      zh: "当前没有可用的模型供应商，请先在设置页完成配置。",
      en: "No model provider is available. Please finish provider configuration in Settings.",
    });
  }

  if (isPlaceholderApiKey(provider.apiKey)) {
    if (provider.id === "qwen") {
      return byLanguage(language, {
        zh: "当前百炼 API Key 仍是示例值，请先在设置页填写真实 API Key。",
        en: "The DashScope API key is still a placeholder. Please set a real API key in Settings.",
      });
    }
    return byLanguage(language, {
      zh: "当前 OpenAI API Key 仍是示例值，请先在设置页填写真实 API Key。",
      en: "The OpenAI API key is still a placeholder. Please set a real API key in Settings.",
    });
  }

  if (!provider.baseUrl.trim()) {
    return byLanguage(language, {
      zh: "当前 provider 缺少 Base URL，请先在设置页补全。",
      en: "The current provider is missing Base URL. Please complete it in Settings.",
    });
  }

  if (!provider.supportsToolCalling) {
    return byLanguage(language, {
      zh: "当前 provider 未开启工具调用，DeepAgents 无法正常工作。",
      en: "Tool calling is disabled for the current provider, so DeepAgents cannot work properly.",
    });
  }

  return null;
}

export function validateProviderConfig(
  provider: Pick<
    ProviderConnectionTestInput,
    "id" | "baseUrl" | "apiKey" | "defaultModel" | "supportsToolCalling"
  > | null,
  language: RuntimeLanguage = "zh",
) {
  if (!provider) {
    return [byLanguage(language, { zh: "当前没有可用的模型供应商配置。", en: "No model provider configuration is available." })];
  }

  const issues: string[] = [];
  if (!provider.baseUrl.trim()) {
    issues.push(byLanguage(language, { zh: "请填写 Base URL。", en: "Please provide Base URL." }));
  } else if (!isLikelyHttpUrl(provider.baseUrl.trim())) {
    issues.push(byLanguage(language, {
      zh: "Base URL 格式无效，请填写完整的 http(s) 地址。",
      en: "Invalid Base URL format. Please provide a complete http(s) URL.",
    }));
  }

  if (!provider.defaultModel.trim()) {
    issues.push(byLanguage(language, { zh: "请填写模型名称。", en: "Please provide a model name." }));
  }

  if (isPlaceholderApiKey(provider.apiKey)) {
    issues.push(
      provider.id === "qwen"
        ? byLanguage(language, { zh: "请填写真实的百炼 API Key。", en: "Please provide a real DashScope API key." })
        : byLanguage(language, { zh: "请填写真实的 OpenAI API Key。", en: "Please provide a real OpenAI API key." }),
    );
  }

  if (!provider.supportsToolCalling) {
    issues.push(byLanguage(language, {
      zh: "当前 provider 未开启工具调用，DeepAgents 无法正常工作。",
      en: "Tool calling is disabled for the current provider, so DeepAgents cannot work properly.",
    }));
  }

  return issues;
}

export async function testProviderConnection(
  input: ProviderConnectionTestInput,
  language: RuntimeLanguage = "zh",
): Promise<ProviderConnectionTestResult> {
  const issues = validateProviderConfig(input, language);
  if (issues.length > 0) {
    return {
      ok: false,
      message: issues.join("\n"),
      latencyMs: null,
    };
  }

  const startedAt = Date.now();
  try {
    const model = createProviderModel({
      ...input,
      label: input.label ?? input.id,
      isActive: true,
    });
    const response = await model.invoke("Reply with OK only.");
    const text = normalizeMessageContent("content" in response ? response.content : response);
    return {
      ok: true,
      message: text || byLanguage(language, { zh: "连接成功，模型已返回响应。", en: "Connection succeeded. The model returned a response." }),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      message: normalizeProviderErrorMessage(error, {
        id: input.id,
        label: input.label ?? input.id,
        baseUrl: input.baseUrl,
        defaultModel: input.defaultModel,
      }, language),
      latencyMs: Date.now() - startedAt,
    };
  }
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
  attachments?: AttachmentAssetRecord[];
  onMcpInvocation?: (event: McpInvocationEvent) => void | Promise<void>;
  additionalTools?: StructuredToolInterface[];
  runtimeToolSummary?: string;
  onTextStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  responseLanguage?: RuntimeLanguage;
}): Promise<{ text: string; usage: TokenUsageSummary | null }> {
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
    attachments = [],
    additionalTools,
    runtimeToolSummary,
    onTextStream,
    responseLanguage = "zh",
  } = input;

  const mcpConnectionMap = new Map(mcpConnections.map((connection) => [connection.serverId, connection]));
  const mcpTools = buildMcpLangChainTools({
    servers: mcpServers,
    connectionsById: mcpConnectionMap,
    workspacePath,
    onInvocation: input.onMcpInvocation,
  });
  const tools = [...(additionalTools ?? []), ...mcpTools];
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
    responseLanguage,
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
              runtimeToolSummary: runtimeToolSummary ?? "",
              workspacePath,
              responseLanguage,
            }),
            tools,
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

  const latestUserMessage = buildLatestUserMessage(latestInput, attachments, responseLanguage);
  const historyMessages = toAgentMessages(history);
  const previousMessages =
    historyMessages.at(-1)?.role === "user" ? historyMessages.slice(0, -1) : historyMessages;
  const messages = session.initialized ? [latestUserMessage] : [...previousMessages, latestUserMessage];

  if (provider.supportsStreaming && onTextStream && typeof (session.agent as { streamEvents?: unknown }).streamEvents === "function") {
    try {
      let streamedText = "";
      let finalOutput: unknown = null;
      const stream = await (session.agent as {
        streamEvents: (
          input: unknown,
          options?: Record<string, unknown>,
        ) => Promise<AsyncIterable<Record<string, unknown>>> | AsyncIterable<Record<string, unknown>>;
      }).streamEvents(
        { messages },
        { configurable: { thread_id: conversationId }, version: "v2" },
      );

      for await (const event of stream) {
        if (!event || typeof event !== "object") continue;
        if (event.event === "on_chat_model_stream") {
          const chunk =
            "data" in event && event.data && typeof event.data === "object" && "chunk" in event.data
              ? event.data.chunk
              : null;
          const delta = extractStreamText(chunk);
          if (!delta) continue;
          streamedText += delta;
          await onTextStream(streamedText, delta);
          continue;
        }

        if (event.event === "on_chain_end" || event.event === "on_graph_end") {
          finalOutput =
            "data" in event && event.data && typeof event.data === "object" && "output" in event.data
              ? event.data.output
              : finalOutput;
        }
      }

      session.initialized = true;
      const finalText = extractAgentText(finalOutput) || streamedText.trim();
      if (finalText) {
        return {
          text: finalText,
          usage: extractTokenUsage(finalOutput),
        };
      }
    } catch {
      // Fallback to non-streaming invoke below.
    }
  }

  const result = await session.agent.invoke(
    { messages },
    { configurable: { thread_id: conversationId } },
  );

  session.initialized = true;

  const text = extractAgentText(result);
  return {
    text:
      text ||
      byLanguage(responseLanguage, {
        zh: "模型已完成调用，但没有返回可显示的文本内容。",
        en: "The model finished the call, but returned no displayable text.",
      }),
    usage: extractTokenUsage(result),
  };
}

function extractStreamText(chunk: unknown) {
  if (!chunk || typeof chunk !== "object") {
    return "";
  }

  if ("content" in chunk) {
    return normalizeMessageContent(chunk.content);
  }

  if ("text" in chunk && typeof chunk.text === "string") {
    return chunk.text;
  }

  return "";
}
