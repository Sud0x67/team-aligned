import { useMemo, useState } from "react";
import {
  Blocks,
  CheckCircle2,
  DownloadCloud,
  Globe,
  Link2,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Unplug,
  X,
} from "lucide-react";
import type { ConnectMcpInput, McpCatalogRecord } from "@shared";
import { useAppStore } from "../store/use-app-store";
import { createTranslator } from "../i18n";

type TabKey = "skills" | "mcp";

function serializeHeaders(headers: Record<string, string> | undefined) {
  if (!headers || Object.keys(headers).length === 0) {
    return "";
  }

  return JSON.stringify(headers, null, 2);
}

function parseHeaders(text: string) {
  if (!text.trim()) {
    return {};
  }

  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("请求头必须是 JSON 对象。");
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

export function ExtensionsPage() {
  const {
    skillCatalog,
    mcpCatalog,
    mcpConnections,
    refreshSkillCatalog,
    installSkill,
    refreshMcpCatalog,
    connectMcp,
    checkMcpHealth,
    disconnectMcp,
    settings,
  } = useAppStore();
  const t = createTranslator(settings.language);
  const [tab, setTab] = useState<TabKey>("skills");
  const [editingMcp, setEditingMcp] = useState<McpCatalogRecord | null>(null);
  const [mcpForm, setMcpForm] = useState<ConnectMcpInput | null>(null);
  const [customHeadersText, setCustomHeadersText] = useState("");
  const [mcpFormError, setMcpFormError] = useState<string | null>(null);

  const connectionMap = useMemo(
    () => new Map(mcpConnections.map((connection) => [connection.serverId, connection])),
    [mcpConnections],
  );

  const visibleSkills = useMemo(() => skillCatalog, [skillCatalog]);
  const visibleMcps = useMemo(() => mcpCatalog, [mcpCatalog]);

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

  const saveMcpConfig = async () => {
    if (!editingMcp || !mcpForm) return;

    try {
      const payload: ConnectMcpInput = {
        ...mcpForm,
        headers:
          editingMcp.transport === "http" && editingMcp.authFields.length === 0
            ? parseHeaders(customHeadersText)
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
          </div>

          <button
            onClick={() => (tab === "skills" ? refreshSkillCatalog() : refreshMcpCatalog())}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-[13px] font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {tab === "skills" ? t.extensions("syncCatalog") : t.extensions("syncMcpCatalog")}
          </button>
        </div>

        {tab === "skills" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {visibleSkills.map((item) => {
              const title = settings.language === "zh" ? item.displayName || item.name : item.name;
              const subtitle =
                settings.language === "zh" && item.name !== item.displayName ? item.name : null;
              const installed = item.installed;
              const Icon = getExtensionIcon(item.name, installed);
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 transition-all hover:shadow-sm"
                >
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
                      {installed ? (
                        <span className="flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--primary)]">
                          <CheckCircle2 className="h-3 w-3" />
                          {t.extensions("installed")}
                        </span>
                      ) : (
                        <button
                          onClick={() => installSkill(item.id)}
                          className="flex items-center gap-1 rounded-full bg-[var(--muted)] px-3 py-1 text-[12px] font-medium text-[var(--foreground)] transition hover:bg-[var(--panel-muted)]"
                        >
                          <DownloadCloud className="h-3.5 w-3.5" />
                          {t.extensions("installAndEnable")}
                        </button>
                      )}
                    </div>

                    <p className="pr-8 text-[13px] leading-relaxed text-[var(--muted-foreground)]">
                      {item.description}
                    </p>
                    <p className="text-[12px] text-[var(--muted-foreground)]">
                      {item.metadata?.category ? `${String(item.metadata.category)} · ` : ""}v{item.version}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
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
                      {item.description}
                    </p>

                    <div className="space-y-1 text-[12px] text-[var(--muted-foreground)]">
                      <p>{t.extensions("mcpCapabilities")}: {item.capabilities.join("、") || "暂无"}</p>
                      <p>{t.extensions("mcpTools")}: {discoveredToolNames.join("、") || "暂无"}</p>
                      {connection?.lastError ? <p className="text-red-500">{connection.lastError}</p> : null}
                    </div>
                  </div>
                </div>
              );
            })}
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
                      <input
                        value={mcpForm.cwd ?? ""}
                        onChange={(event) =>
                          setMcpForm((current) => ({ ...(current as ConnectMcpInput), cwd: event.target.value }))
                        }
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                      />
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
                        {settings.language === "zh"
                          ? "如果远端 MCP 需要 Bearer Token 或自定义请求头，可以在这里直接填写 JSON 对象。"
                          : "If the remote MCP needs a bearer token or custom request headers, provide them here as a JSON object."}
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
                    {settings.language === "zh"
                      ? "远端 MCP 已支持真实 URL 握手和工具发现。部分托管服务可能还会限制允许接入的客户端，若检测失败，请检查服务本身的鉴权或接入限制。"
                      : "Remote MCP now supports real URL handshakes and tool discovery. Some hosted services may still restrict which clients are allowed to connect, so check the service's auth and client restrictions if health checks fail."}
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
                  {settings.language === "zh" ? "关闭" : "Close"}
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
      </div>
    </div>
  );
}
