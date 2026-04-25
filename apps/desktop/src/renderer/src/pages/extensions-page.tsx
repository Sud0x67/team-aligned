import { useMemo, useState } from "react";
import {
  Blocks,
  CheckCircle2,
  DownloadCloud,
  FolderOpen,
  Globe,
  Link2,
  Loader2,
  MessageSquareText,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import {
  isSystemBuiltinSkill,
  type ConnectMcpInput,
  type McpCatalogRecord,
  type PromptAliasRecord,
  type SavePromptAliasInput,
} from "@shared";
import { useAppStore } from "../store/use-app-store";
import { createTranslator } from "../i18n";

type TabKey = "skills" | "mcp" | "prompts";
type SyncableCatalogTab = Extract<TabKey, "skills" | "mcp">;

function serializeHeaders(headers: Record<string, string> | undefined) {
  if (!headers || Object.keys(headers).length === 0) {
    return "";
  }

  return JSON.stringify(headers, null, 2);
}

function parseHeaders(text: string, invalidObjectMessage: string) {
  if (!text.trim()) {
    return {};
  }

  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(invalidObjectMessage);
  }

  return Object.fromEntries(
    Object.entries(parsed)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );
}

function getExtensionIcon(name: string, installed: boolean) {
  if (/web search/i.test(name)) {
    return installed ? Search : Globe;
  }

  if (/github/i.test(name)) {
    return installed ? CheckCircle2 : DownloadCloud;
  }

  return installed ? CheckCircle2 : Plus;
}

function getMcpIcon(status: "disconnected" | "configured" | "connected" | "error") {
  if (status === "connected") return CheckCircle2;
  if (status === "error") return ShieldAlert;
  if (status === "configured") return Link2;
  return Blocks;
}

function matchesSearch(query: string, values: Array<string | null | undefined>) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
}

function resolveLocalizedDescription(
  input: { description: string; metadata: Record<string, unknown> | null },
  language: "zh" | "en",
) {
  const metadata = input.metadata;
  if (metadata && typeof metadata === "object") {
    const zh = typeof metadata.descriptionZh === "string" ? metadata.descriptionZh : null;
    const en = typeof metadata.descriptionEn === "string" ? metadata.descriptionEn : null;
    if (language === "en" && en) return en;
    if (language === "zh" && zh) return zh;
  }
  return input.description;
}

export function ExtensionsPage() {
  const {
    skillCatalog,
    promptAliases,
    mcpCatalog,
    mcpConnections,
    refreshSkillCatalog,
    installSkill,
    removeSkill,
    savePromptAlias,
    removePromptAlias,
    refreshMcpCatalog,
    connectMcp,
    checkMcpHealth,
    disconnectMcp,
    settings,
  } = useAppStore();
  const t = createTranslator(settings.language);
  const [tab, setTab] = useState<TabKey>("skills");
  const [catalogSync, setCatalogSync] = useState<{
    tab: SyncableCatalogTab;
    status: "syncing" | "success";
  } | null>(null);
  const [searchQueries, setSearchQueries] = useState<Record<TabKey, string>>({
    skills: "",
    mcp: "",
    prompts: "",
  });
  const [editingMcp, setEditingMcp] = useState<McpCatalogRecord | null>(null);
  const [mcpForm, setMcpForm] = useState<ConnectMcpInput | null>(null);
  const [customHeadersText, setCustomHeadersText] = useState("");
  const [mcpFormError, setMcpFormError] = useState<string | null>(null);
  const [skillAction, setSkillAction] = useState<{
    skillId: string;
    type: "install" | "remove";
  } | null>(null);
  const [skillActionError, setSkillActionError] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<PromptAliasRecord | null>(null);
  const [promptForm, setPromptForm] = useState<SavePromptAliasInput | null>(null);
  const [promptFormError, setPromptFormError] = useState<string | null>(null);

  const connectionMap = useMemo(
    () => new Map(mcpConnections.map((connection) => [connection.serverId, connection])),
    [mcpConnections],
  );

  const activeSearch = searchQueries[tab];
  const visibleSkills = useMemo(
    () =>
      skillCatalog.filter((skill) =>
        matchesSearch(searchQueries.skills, [
          skill.id,
          skill.name,
          skill.displayName,
          skill.description,
          String(skill.metadata?.descriptionZh ?? ""),
          String(skill.metadata?.descriptionEn ?? ""),
          String(skill.metadata?.category ?? ""),
          skill.version,
        ]),
      ),
    [searchQueries.skills, skillCatalog],
  );
  const visibleMcps = useMemo(
    () =>
      mcpCatalog.filter((server) =>
        matchesSearch(searchQueries.mcp, [
          server.id,
          server.name,
          server.description,
          String(server.metadata?.descriptionZh ?? ""),
          String(server.metadata?.descriptionEn ?? ""),
          server.transport,
          server.authType,
          server.riskLevel,
          ...server.capabilities,
          ...server.declaredTools,
        ]),
      ),
    [mcpCatalog, searchQueries.mcp],
  );
  const visiblePrompts = useMemo(
    () =>
      promptAliases.filter((prompt) =>
        matchesSearch(searchQueries.prompts, [
          prompt.name,
          prompt.alias,
          prompt.description,
          prompt.prompt,
        ]),
      ),
    [promptAliases, searchQueries.prompts],
  );
  const currentCatalogSync = catalogSync?.tab === tab ? catalogSync.status : null;
  const listSeparator = settings.language === "zh" ? "、" : ", ";
  const emptyListLabel = t.extensions("emptyList");
  const searchPlaceholder =
    tab === "skills"
      ? t.extensions("searchSkillsPlaceholder")
      : tab === "mcp"
        ? t.extensions("searchMcpPlaceholder")
        : t.extensions("searchPromptsPlaceholder");

  const syncCurrentCatalog = async () => {
    if (tab !== "skills" && tab !== "mcp") return;
    if (catalogSync?.status === "syncing") return;

    const syncingTab = tab;
    setCatalogSync({ tab: syncingTab, status: "syncing" });

    try {
      if (syncingTab === "skills") {
        await refreshSkillCatalog();
      } else {
        await refreshMcpCatalog();
      }
      setCatalogSync({ tab: syncingTab, status: "success" });
      window.setTimeout(() => {
        setCatalogSync((current) =>
          current?.tab === syncingTab && current.status === "success" ? null : current,
        );
      }, 1400);
    } catch (error) {
      console.error("Failed to sync extension catalog", error);
      setCatalogSync(null);
    }
  };

  const runSkillAction = async (skillId: string, type: "install" | "remove") => {
    const targetSkill = skillCatalog.find((item) => item.id === skillId);
    if (targetSkill && isSystemBuiltinSkill(targetSkill)) {
      return;
    }

    if (skillAction) return;
    if (type === "remove" && !window.confirm(t.extensions("removeSkillConfirm"))) {
      return;
    }

    setSkillAction({ skillId, type });
    setSkillActionError(null);
    try {
      if (type === "install") {
        await installSkill(skillId);
      } else {
        await removeSkill(skillId);
      }
    } catch (error) {
      setSkillActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSkillAction(null);
    }
  };

  const openMcpEditor = (server: McpCatalogRecord) => {
    const existing = connectionMap.get(server.id);
    setMcpFormError(null);
    setCustomHeadersText(serializeHeaders(existing?.headers));
    setEditingMcp(server);
    setMcpForm({
      serverId: server.id,
      command: existing?.command ?? server.launcherCommand,
      args: existing?.args ?? server.launcherArgs,
      url: existing?.url ?? server.remoteUrl,
      envEntries:
        existing?.envEntries ??
        Object.fromEntries(
          server.authType === "env" ? server.authFields.map((field) => [field.key, ""]) : [],
        ),
      headers:
        existing?.headers ??
        Object.fromEntries(
          server.authType === "header" ? server.authFields.map((field) => [field.key, ""]) : [],
        ),
      cwd: existing?.cwd ?? null,
      enabled: existing?.enabled ?? false,
    });
  };

  const closeMcpEditor = () => {
    setEditingMcp(null);
    setMcpForm(null);
    setCustomHeadersText("");
    setMcpFormError(null);
  };

  const openPromptEditor = (prompt: PromptAliasRecord | null = null) => {
    setEditingPrompt(prompt);
    setPromptForm({
      id: prompt?.id,
      name: prompt?.name ?? "",
      alias: prompt?.alias ?? "",
      description: prompt?.description ?? "",
      prompt: prompt?.prompt ?? t.extensions("defaultPromptTemplate"),
      enabled: prompt?.enabled ?? true,
    });
    setPromptFormError(null);
  };

  const closePromptEditor = () => {
    setEditingPrompt(null);
    setPromptForm(null);
    setPromptFormError(null);
  };

  const savePromptForm = async () => {
    if (!promptForm) return;
    try {
      setPromptFormError(null);
      await savePromptAlias(promptForm);
      closePromptEditor();
    } catch (error) {
      setPromptFormError(error instanceof Error ? error.message : String(error));
    }
  };

  const deletePromptAlias = async (prompt: PromptAliasRecord) => {
    if (!window.confirm(t.extensions("deletePromptConfirm").replace("{{alias}}", prompt.alias))) {
      return;
    }
    await removePromptAlias(prompt.id);
  };

  const selectMcpWorkingDirectory = async () => {
    const directory = await window.teamaligned.selectDirectory({
      title: t.extensions("mcpDirectoryPickerTitle"),
    });
    if (!directory) return;
    setMcpForm((current) => ({ ...(current as ConnectMcpInput), cwd: directory }));
  };

  const saveMcpConfig = async () => {
    if (!editingMcp || !mcpForm) return;

    try {
      const payload: ConnectMcpInput = {
        ...mcpForm,
        headers:
          editingMcp.transport === "http" && editingMcp.authFields.length === 0
            ? parseHeaders(customHeadersText, t.extensions("invalidHeadersObject"))
            : mcpForm.headers,
      };
      setMcpFormError(null);
      await connectMcp(payload);
      closeMcpEditor();
    } catch (error) {
      setMcpFormError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--background)] px-6 py-6 text-[var(--foreground)]">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-[20px] font-medium text-[var(--foreground)]">{t.extensions("title")}</h1>
          <p className="mt-1 text-[14px] text-[var(--muted-foreground)]">
            {t.extensions("description")}
          </p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 border-b border-[var(--border)]">
            <button
              onClick={() => setTab("skills")}
              className={`flex items-center gap-2 border-b-2 pb-3 text-[14px] font-medium transition-colors ${
                tab === "skills"
                  ? "border-[var(--primary)] text-[var(--primary)]"
                  : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              <Puzzle className="h-4 w-4" />
              {t.extensions("skills")}
            </button>
            <button
              onClick={() => setTab("mcp")}
              className={`flex items-center gap-2 border-b-2 pb-3 text-[14px] font-medium transition-colors ${
                tab === "mcp"
                  ? "border-[var(--primary)] text-[var(--primary)]"
                  : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              <Blocks className="h-4 w-4" />
              {t.extensions("mcp")}
            </button>
            <button
              onClick={() => setTab("prompts")}
              className={`flex items-center gap-2 border-b-2 pb-3 text-[14px] font-medium transition-colors ${
                tab === "prompts"
                  ? "border-[var(--primary)] text-[var(--primary)]"
                  : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              <MessageSquareText className="h-4 w-4" />
              {t.extensions("prompts")}
            </button>
          </div>

          {tab === "prompts" ? (
            <button
              onClick={() => openPromptEditor()}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-[13px] font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
            >
              <Plus className="h-3.5 w-3.5" />
              {t.extensions("newPrompt")}
            </button>
          ) : (
            <button
              onClick={() => void syncCurrentCatalog()}
              disabled={currentCatalogSync === "syncing"}
              className={`group inline-flex min-w-[148px] items-center justify-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97] disabled:cursor-wait disabled:hover:translate-y-0 ${
                currentCatalogSync === "success"
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 ring-2 ring-emerald-500/10"
                  : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--muted)]"
              }`}
              aria-live="polite"
            >
              {currentCatalogSync === "syncing" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : currentCatalogSync === "success" ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 transition-transform duration-300 group-hover:rotate-180" />
              )}
              {currentCatalogSync === "syncing"
                ? t.extensions("syncingCatalog")
                : currentCatalogSync === "success"
                  ? t.extensions("syncCatalogDone")
                  : tab === "skills"
                    ? t.extensions("syncCatalog")
                    : t.extensions("syncMcpCatalog")}
            </button>
          )}
        </div>

        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={activeSearch}
            onChange={(event) =>
              setSearchQueries((current) => ({
                ...current,
                [tab]: event.target.value,
              }))
            }
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] py-2.5 pl-10 pr-4 text-[14px] text-[var(--foreground)] outline-none transition focus:border-[color-mix(in_srgb,var(--primary)_35%,transparent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_16%,transparent)]"
          />
        </div>

        {tab === "skills" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {skillActionError ? (
              <div className="md:col-span-2 rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-[13px] text-red-500">
                {skillActionError}
              </div>
            ) : null}
            {visibleSkills.map((item) => {
              const title = settings.language === "zh" ? item.displayName || item.name : item.name;
              const subtitle =
                settings.language === "zh" && item.name !== item.displayName ? item.name : null;
              const localizedDescription = resolveLocalizedDescription(item, settings.language);
              const installed = item.installed;
              const isBuiltin = isSystemBuiltinSkill(item);
              const Icon = getExtensionIcon(item.name, installed);
              const activeAction = skillAction?.skillId === item.id ? skillAction.type : null;
              return (
                <div
                  key={item.id}
                  className="relative flex items-start gap-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 transition-all hover:shadow-sm"
                >
                  {activeAction ? (
                    <div className="absolute inset-x-0 bottom-0 h-1 bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]">
                      <div className="h-full w-1/3 rounded-full bg-[var(--primary)] opacity-80 skill-progress-bar" />
                    </div>
                  ) : null}
                  <div
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                      installed
                        ? "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)]"
                        : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>

                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-[15px] font-medium text-[var(--foreground)]">{title}</h3>
                        {subtitle ? (
                          <p className="mt-0.5 text-[12px] text-[var(--muted-foreground)]">{subtitle}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {installed && !activeAction ? (
                          <span className="flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--primary)]">
                            <CheckCircle2 className="h-3 w-3" />
                            {t.extensions("installed")}
                          </span>
                        ) : null}
                        {isBuiltin ? (
                          <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--primary)]">
                            {t.manage("systemBuiltin")}
                          </span>
                        ) : null}
                        {activeAction ? (
                          <button
                            disabled
                            className="flex cursor-wait items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-3 py-1 text-[12px] font-medium text-[var(--primary)]"
                          >
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {activeAction === "install"
                              ? t.extensions("installingSkill")
                              : t.extensions("removingSkill")}
                          </button>
                        ) : installed ? (
                          <button
                            onClick={() => void runSkillAction(item.id, "remove")}
                            disabled={!!skillAction || isBuiltin}
                            className="flex items-center gap-1 rounded-full bg-[var(--muted)] px-3 py-1 text-[12px] font-medium text-[var(--foreground)] transition hover:bg-red-500/10 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {isBuiltin ? t.extensions("builtInSkillLocked") : t.extensions("removeSkill")}
                          </button>
                        ) : (
                          <button
                            onClick={() => void runSkillAction(item.id, "install")}
                            disabled={!!skillAction || isBuiltin}
                            className="flex items-center gap-1 rounded-full bg-[var(--muted)] px-3 py-1 text-[12px] font-medium text-[var(--foreground)] transition hover:bg-[var(--panel-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <DownloadCloud className="h-3.5 w-3.5" />
                            {t.extensions("installAndEnable")}
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="pr-8 text-[13px] leading-relaxed text-[var(--muted-foreground)]">
                      {localizedDescription}
                    </p>
                    <p className="text-[12px] text-[var(--muted-foreground)]">
                      {item.metadata?.category ? `${String(item.metadata.category)} · ` : ""}v{item.version}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : tab === "mcp" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {visibleMcps.map((item) => {
              const connection = connectionMap.get(item.id);
              const status = connection?.status ?? "disconnected";
              const Icon = getMcpIcon(status);
              const riskTone =
                item.riskLevel === "high"
                  ? "bg-red-500/10 text-red-500"
                  : item.riskLevel === "medium"
                    ? "bg-amber-500/10 text-amber-500"
                    : "bg-emerald-500/10 text-emerald-500";
              const discoveredToolNames =
                connection?.discoveredTools.map((toolItem) => toolItem.name) ?? item.declaredTools;
              const localizedDescription = resolveLocalizedDescription(item, settings.language);

              return (
                <div
                  key={item.id}
                  className="flex items-start gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 transition-all hover:shadow-sm"
                >
                  <div
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                      status === "connected"
                        ? "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)]"
                        : status === "error"
                          ? "bg-red-500/10 text-red-500"
                          : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>

                  <div className="flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <h3 className="text-[15px] font-medium text-[var(--foreground)]">{item.name}</h3>
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[var(--muted-foreground)]">
                            {item.transport}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 ${riskTone}`}>{item.riskLevel}</span>
                          {connection ? (
                            <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2 py-0.5 text-[var(--primary)]">
                              {status === "connected"
                                ? t.extensions("mcpStatusConnected")
                                : status === "configured"
                                  ? t.extensions("mcpStatusConfigured")
                                  : status === "error"
                                    ? t.extensions("mcpStatusError")
                                    : t.extensions("mcpStatusDisconnected")}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          onClick={() => openMcpEditor(item)}
                          className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-3 py-1 text-[12px] font-medium text-[var(--foreground)] transition hover:bg-[var(--panel-muted)]"
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                          {connection ? t.extensions("configureConnection") : t.extensions("connectAndConfigure")}
                        </button>
                        {connection ? (
                          <>
                            <button
                              onClick={() => checkMcpHealth(item.id)}
                              className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-3 py-1 text-[12px] font-medium text-[var(--foreground)] transition hover:bg-[var(--panel-muted)]"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              {t.extensions("healthCheck")}
                            </button>
                            <button
                              onClick={() => disconnectMcp(item.id)}
                              className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-3 py-1 text-[12px] font-medium text-[var(--foreground)] transition hover:bg-[var(--panel-muted)]"
                            >
                              <Unplug className="h-3.5 w-3.5" />
                              {t.extensions("disconnect")}
                            </button>
                          </>
                        ) : item.authFields.length === 0 ? (
                          <button
                            onClick={() => connectMcp({ serverId: item.id })}
                            className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-3 py-1 text-[12px] font-medium text-[var(--foreground)] transition hover:bg-[var(--panel-muted)]"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                            {t.extensions("connectAndEnable")}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <p className="pr-8 text-[13px] leading-relaxed text-[var(--muted-foreground)]">
                      {localizedDescription}
                    </p>

                    <div className="space-y-1 text-[12px] text-[var(--muted-foreground)]">
                      <p>
                        {t.extensions("mcpCapabilities")}:{" "}
                        {item.capabilities.join(listSeparator) || emptyListLabel}
                      </p>
                      <p>
                        {t.extensions("mcpTools")}:{" "}
                        {discoveredToolNames.join(listSeparator) || emptyListLabel}
                      </p>
                      {connection?.lastError ? <p className="text-red-500">{connection.lastError}</p> : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {visiblePrompts.length === 0 ? (
              <div className="md:col-span-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] px-5 py-8 text-center">
                <MessageSquareText className="mx-auto h-8 w-8 text-[var(--muted-foreground)]" />
                <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
                  {t.extensions("noPrompts")}
                </p>
                <p className="mt-1 text-xs leading-6 text-[var(--muted-foreground)]">
                  {t.extensions("promptAliasHint")}
                </p>
              </div>
            ) : null}
            {visiblePrompts.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 transition-all hover:shadow-sm"
              >
                <div
                  className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                    item.enabled
                      ? "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)]"
                      : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                  }`}
                >
                  <MessageSquareText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-[15px] font-medium text-[var(--foreground)]">{item.name}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 font-mono text-[11px] text-[var(--foreground)]">
                          /{item.alias}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                          item.enabled
                            ? "bg-emerald-500/10 text-emerald-600"
                            : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                        }`}>
                          {item.enabled ? t.extensions("enabled") : t.extensions("disabled")}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        onClick={() =>
                          void savePromptAlias({
                            id: item.id,
                            name: item.name,
                            alias: item.alias,
                            description: item.description,
                            prompt: item.prompt,
                            enabled: !item.enabled,
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-3 py-1 text-[12px] font-medium text-[var(--foreground)] transition hover:bg-[var(--panel-muted)]"
                      >
                        {item.enabled ? t.extensions("disablePrompt") : t.extensions("enablePrompt")}
                      </button>
                      <button
                        onClick={() => openPromptEditor(item)}
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-3 py-1 text-[12px] font-medium text-[var(--foreground)] transition hover:bg-[var(--panel-muted)]"
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                        {t.extensions("editPrompt")}
                      </button>
                      <button
                        onClick={() => void deletePromptAlias(item)}
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-3 py-1 text-[12px] font-medium text-[var(--foreground)] transition hover:bg-red-500/10 hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t.extensions("deletePrompt")}
                      </button>
                    </div>
                  </div>
                  <p className="text-[13px] leading-relaxed text-[var(--muted-foreground)]">
                    {item.description || t.extensions("promptAliasHint")}
                  </p>
                  <p className="line-clamp-3 rounded-lg bg-[var(--muted)] px-3 py-2 font-mono text-[12px] leading-6 text-[var(--muted-foreground)]">
                    {item.prompt}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {editingMcp && mcpForm ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="mx-4 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-[18px] font-semibold text-[var(--foreground)]">{editingMcp.name}</h2>
                  <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">
                    {t.extensions("configureConnection")}
                  </p>
                </div>
                <button
                  onClick={closeMcpEditor}
                  className="rounded-lg p-1.5 hover:bg-[var(--muted)]"
                >
                  <X className="h-5 w-5 text-[var(--muted-foreground)]" />
                </button>
              </div>

              <div className="space-y-4">
                {editingMcp.transport === "stdio" ? (
                  <>
                    <div>
                      <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">
                        {t.extensions("command")}
                      </label>
                      <input
                        value={mcpForm.command ?? ""}
                        onChange={(event) =>
                          setMcpForm((current) => ({ ...(current as ConnectMcpInput), command: event.target.value }))
                        }
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">
                        {t.extensions("commandArgs")}
                      </label>
                      <textarea
                        value={(mcpForm.args ?? []).join("\n")}
                        onChange={(event) =>
                          setMcpForm((current) => ({
                            ...(current as ConnectMcpInput),
                            args: event.target.value
                              .split("\n")
                              .map((item) => item.trim())
                              .filter(Boolean),
                          }))
                        }
                        rows={4}
                        className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[13px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">
                        {t.extensions("workingDirectory")}
                      </label>
                      <div className="flex gap-2">
                        <input
                          value={mcpForm.cwd ?? ""}
                          onChange={(event) =>
                            setMcpForm((current) => ({ ...(current as ConnectMcpInput), cwd: event.target.value }))
                          }
                          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                        />
                        <button
                          type="button"
                          onClick={() => void selectMcpWorkingDirectory()}
                          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-[14px] font-medium text-white shadow-sm transition hover:opacity-90"
                        >
                          <FolderOpen className="h-4 w-4" />
                          {t.extensions("browseDirectory")}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">
                      {t.extensions("remoteUrl")}
                    </label>
                    <input
                      value={mcpForm.url ?? ""}
                      onChange={(event) =>
                        setMcpForm((current) => ({ ...(current as ConnectMcpInput), url: event.target.value }))
                      }
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                    />
                  </div>
                )}

                {editingMcp.transport === "http" && editingMcp.authFields.length === 0 ? (
                  <div className="space-y-3">
                    <div>
                      <p className="text-[13px] font-medium text-[var(--foreground)]">
                        {t.extensions("requestHeaders")}
                      </p>
                      <p className="mt-1 text-[12px] leading-5 text-[var(--muted-foreground)]">
                        {t.extensions("httpHeadersJsonHint")}
                      </p>
                    </div>
                    <textarea
                      value={customHeadersText}
                      onChange={(event) => setCustomHeadersText(event.target.value)}
                      rows={5}
                      placeholder={'{\n  "Authorization": "Bearer ..."\n}'}
                      className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 font-mono text-[13px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                    />
                  </div>
                ) : null}

                {editingMcp.authType === "env" && editingMcp.authFields.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-[13px] font-medium text-[var(--foreground)]">{t.extensions("envVars")}</p>
                    {editingMcp.authFields.map((field) => (
                      <div key={field.key}>
                        <label className="mb-1.5 block text-[12px] text-[var(--muted-foreground)]">
                          {field.label}
                        </label>
                        <input
                          type={field.secret ? "password" : "text"}
                          value={mcpForm.envEntries?.[field.key] ?? ""}
                          placeholder={field.placeholder}
                          onChange={(event) =>
                            setMcpForm((current) => ({
                              ...(current as ConnectMcpInput),
                              envEntries: {
                                ...((current as ConnectMcpInput).envEntries ?? {}),
                                [field.key]: event.target.value,
                              },
                            }))
                          }
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                        />
                      </div>
                    ))}
                  </div>
                ) : null}

                {editingMcp.authType === "header" && editingMcp.authFields.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-[13px] font-medium text-[var(--foreground)]">{t.extensions("requestHeaders")}</p>
                    {editingMcp.authFields.map((field) => (
                      <div key={field.key}>
                        <label className="mb-1.5 block text-[12px] text-[var(--muted-foreground)]">
                          {field.label}
                        </label>
                        <input
                          type={field.secret ? "password" : "text"}
                          value={mcpForm.headers?.[field.key] ?? ""}
                          placeholder={field.placeholder}
                          onChange={(event) =>
                            setMcpForm((current) => ({
                              ...(current as ConnectMcpInput),
                              headers: {
                                ...((current as ConnectMcpInput).headers ?? {}),
                                [field.key]: event.target.value,
                              },
                            }))
                          }
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                        />
                      </div>
                    ))}
                  </div>
                ) : null}

                {editingMcp.transport === "http" ? (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-[12px] leading-5 text-[var(--muted-foreground)]">
                    {t.extensions("remoteMcpReadyHint")}
                  </div>
                ) : null}

                {connectionMap.get(editingMcp.id)?.discoveredTools.length ? (
                  <div className="space-y-2">
                    <p className="text-[13px] font-medium text-[var(--foreground)]">
                      {t.extensions("connectedTools")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {connectionMap.get(editingMcp.id)?.discoveredTools.map((toolItem) => (
                        <span
                          key={toolItem.name}
                          className="rounded-md bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2 py-0.5 text-[11px] text-[var(--primary)]"
                        >
                          {toolItem.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {mcpFormError ? (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-[13px] text-red-500">
                    {mcpFormError}
                  </div>
                ) : null}
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={closeMcpEditor}
                  className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-[14px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
                >
                  {t.extensions("close")}
                </button>
                <button
                  onClick={() => checkMcpHealth(editingMcp.id)}
                  className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-[14px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
                >
                  {t.extensions("healthCheck")}
                </button>
                <button
                  onClick={() => void saveMcpConfig()}
                  className="rounded-lg bg-[var(--primary)] px-4 py-2.5 text-[14px] text-white transition hover:opacity-90"
                >
                  {t.extensions("saveAndCheck")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {promptForm ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="mx-4 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-[18px] font-semibold text-[var(--foreground)]">
                    {editingPrompt ? t.extensions("editPrompt") : t.extensions("newPrompt")}
                  </h2>
                  <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">
                    {t.extensions("promptAliasHint")}
                  </p>
                </div>
                <button
                  onClick={closePromptEditor}
                  className="rounded-lg p-1.5 hover:bg-[var(--muted)]"
                >
                  <X className="h-5 w-5 text-[var(--muted-foreground)]" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">
                      {t.extensions("promptName")}
                    </label>
                    <input
                      value={promptForm.name}
                      onChange={(event) =>
                        setPromptForm((current) => ({ ...(current as SavePromptAliasInput), name: event.target.value }))
                      }
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">
                      {t.extensions("promptAlias")}
                    </label>
                    <div className="flex rounded-lg border border-[var(--border)] bg-[var(--background)] focus-within:ring-2 focus-within:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]">
                      <span className="grid w-10 place-items-center border-r border-[var(--border)] text-[var(--muted-foreground)]">
                        /
                      </span>
                      <input
                        value={promptForm.alias}
                        onChange={(event) =>
                          setPromptForm((current) => ({ ...(current as SavePromptAliasInput), alias: event.target.value }))
                        }
                        placeholder="prd"
                        className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">
                    {t.extensions("promptDescription")}
                  </label>
                  <input
                    value={promptForm.description}
                    onChange={(event) =>
                      setPromptForm((current) => ({ ...(current as SavePromptAliasInput), description: event.target.value }))
                    }
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <label className="block text-[13px] text-[var(--muted-foreground)]">
                      {t.extensions("promptTemplate")}
                    </label>
                    <span className="text-[11px] text-[var(--muted-foreground)]">
                      {t.extensions("promptVariables")}
                    </span>
                  </div>
                  <textarea
                    value={promptForm.prompt}
                    onChange={(event) =>
                      setPromptForm((current) => ({ ...(current as SavePromptAliasInput), prompt: event.target.value }))
                    }
                    rows={9}
                    className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 font-mono text-[13px] leading-6 text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                  />
                </div>

                <label className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3">
                  <span className="text-[14px] font-medium text-[var(--foreground)]">
                    {t.extensions("enablePrompt")}
                  </span>
                  <input
                    type="checkbox"
                    checked={promptForm.enabled}
                    onChange={(event) =>
                      setPromptForm((current) => ({ ...(current as SavePromptAliasInput), enabled: event.target.checked }))
                    }
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                </label>

                {promptFormError ? (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-[13px] text-red-500">
                    {promptFormError}
                  </div>
                ) : null}
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={closePromptEditor}
                  className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-[14px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
                >
                  {t.extensions("cancel")}
                </button>
                <button
                  onClick={() => void savePromptForm()}
                  className="rounded-lg bg-[var(--primary)] px-4 py-2.5 text-[14px] text-white transition hover:opacity-90"
                >
                  {t.extensions("savePrompt")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
