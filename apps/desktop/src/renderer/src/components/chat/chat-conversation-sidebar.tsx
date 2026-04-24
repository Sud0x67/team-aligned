import {
  Check,
  BarChart3,
  Box,
  ChevronRight,
  FolderOpen,
  Hammer,
  Info,
  LoaderCircle,
} from "lucide-react";
import type {
  ConversationKind,
  RunRecord,
  RunStatus,
  ToolInvocationRecord,
} from "@shared";
import { createTranslator } from "../../i18n";
import { useAppStore } from "../../store/use-app-store";

function getRunStatusLabel(t: ReturnType<typeof createTranslator>, status: RunStatus | null) {
  if (!status) return t.chat("runStatusIdle");
  switch (status) {
    case "queued":
      return t.chat("runStatusQueued");
    case "running":
      return t.chat("runStatusRunning");
    case "pausing":
      return t.chat("runStatusPausing");
    case "paused":
      return t.chat("runStatusPaused");
    case "resuming":
      return t.chat("runStatusResuming");
    case "completed":
      return t.chat("runStatusCompleted");
    case "failed":
      return t.chat("runStatusFailed");
    case "cancelled":
      return t.chat("runStatusCancelled");
  }
}

function getRunStatusTone(status: RunStatus | null) {
  switch (status) {
    case "running":
    case "resuming":
      return "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)]";
    case "completed":
      return "bg-emerald-500/10 text-emerald-600";
    case "failed":
      return "bg-rose-500/10 text-rose-600";
    case "cancelled":
      return "bg-slate-500/10 text-slate-600";
    default:
      return "bg-[var(--muted)] text-[var(--muted-foreground)]";
  }
}

function trimMiddle(value: string, max = 42) {
  if (value.length <= max) return value;
  const head = value.slice(0, Math.floor(max / 2) - 1);
  const tail = value.slice(value.length - Math.floor(max / 2));
  return `${head}...${tail}`;
}

export function ChatConversationSidebar({
  expanded,
  onExpandedChange,
  conversationKind,
  tokenUsage,
  workspacePath,
  activeSkillLabel,
  pinnedMcpLabel,
  run,
  toolInvocations,
  onOpenWorkspace,
  onExportConversation,
  exportState,
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  conversationKind: ConversationKind;
  tokenUsage: { total: number; tracked: boolean };
  workspacePath: string | null;
  activeSkillLabel: string | null;
  pinnedMcpLabel: string | null;
  run: RunRecord | null;
  toolInvocations: ToolInvocationRecord[];
  onOpenWorkspace: (workspacePath: string) => void;
  onExportConversation: () => Promise<void>;
  exportState: {
    status: "idle" | "exporting" | "success" | "error";
    message: string | null;
  };
}) {
  const language = useAppStore((state) => state.settings.language);
  const t = createTranslator(language);
  const recentToolInvocations = [...toolInvocations]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3);

  if (!expanded) {
    return (
      <aside className="hidden w-12 shrink-0 border-l border-[var(--border)] bg-[var(--card)] lg:flex lg:flex-col lg:items-center lg:py-3">
        <button
          type="button"
          onClick={() => onExpandedChange(true)}
          className="grid h-9 w-9 place-items-center rounded-xl text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          aria-label={t.chat("expandConversationInfo")}
          title={t.chat("expandConversationInfo")}
        >
          <Info className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="hidden w-[304px] shrink-0 border-l border-[var(--border)] bg-[var(--card)] lg:flex lg:min-h-0 lg:flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] px-4">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--muted)] text-[var(--primary)]">
            <Info className="h-4 w-4" />
          </div>
          <p className="text-sm font-semibold text-[var(--foreground)]">
            {t.chat("conversationInfo")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onExpandedChange(false)}
          className="grid h-8 w-8 place-items-center rounded-xl text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          aria-label={t.chat("collapseConversationInfo")}
          title={t.chat("collapseConversationInfo")}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[var(--primary)]" />
            <p className="text-sm font-semibold text-[var(--foreground)]">{t.chat("tokenSummary")}</p>
          </div>
          <p className="text-2xl font-semibold text-[var(--foreground)]">
            {tokenUsage.total.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {tokenUsage.tracked ? t.chat("tokenUsageTracked") : t.chat("tokenUsageEstimated")}
          </p>
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <FolderOpen className="h-4 w-4 shrink-0 text-[var(--primary)]" />
              <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                {t.chat("workspace")}
              </p>
            </div>
            {workspacePath ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenWorkspace(workspacePath)}
                  className="shrink-0 rounded-full bg-[var(--muted)] px-2.5 py-1 text-[11px] font-medium text-[var(--foreground)] transition hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] hover:text-[var(--primary)]"
                >
                  {t.chat("openInFinder")}
                </button>
                <button
                  type="button"
                  onClick={() => void onExportConversation()}
                  disabled={exportState.status === "exporting"}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--panel-muted)] px-2.5 py-1 text-[11px] font-medium text-[var(--foreground)] transition hover:border-[color-mix(in_srgb,var(--primary)_22%,transparent)] hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {exportState.status === "exporting" ? (
                    <>
                      <LoaderCircle className="h-3 w-3 animate-spin" />
                      {t.chat("exportingConversation")}
                    </>
                  ) : (
                    t.chat("exportConversation")
                  )}
                </button>
              </div>
            ) : null}
          </div>
          <p className="break-all text-xs leading-5 text-[var(--muted-foreground)]">
            {workspacePath ? trimMiddle(workspacePath, 58) : t.chat("noWorkspace")}
          </p>
          {exportState.message ? (
            <p
              className={`mt-2 flex items-start gap-1 text-xs leading-5 ${
                exportState.status === "error"
                  ? "text-rose-600"
                  : "text-[var(--muted-foreground)]"
              }`}
            >
              {exportState.status === "success" ? (
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
              ) : null}
              <span className="break-all">
                {trimMiddle(exportState.message, 96)}
              </span>
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Box className="h-4 w-4 text-[var(--primary)]" />
            <p className="text-sm font-semibold text-[var(--foreground)]">{t.chat("context")}</p>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">{t.chat("conversationKind")}</span>
              <span className="font-medium text-[var(--foreground)]">
                {conversationKind === "agent" ? t.chat("directChat") : t.chat("teamChat")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">{t.chat("activeSkill")}</span>
              <span className="truncate font-medium text-[var(--foreground)]">
                {activeSkillLabel ?? t.chat("none")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">{t.chat("pinnedMcp")}</span>
              <span className="truncate font-medium text-[var(--foreground)]">
                {pinnedMcpLabel ?? t.chat("none")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">{t.chat("runState")}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${getRunStatusTone(run?.status ?? null)}`}>
                {getRunStatusLabel(t, run?.status ?? null)}
              </span>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Hammer className="h-4 w-4 text-[var(--primary)]" />
            <p className="text-sm font-semibold text-[var(--foreground)]">{t.chat("recentToolCalls")}</p>
          </div>
          {recentToolInvocations.length > 0 ? (
            <div className="space-y-2">
              {recentToolInvocations.map((invocation) => (
                <div key={invocation.id} className="rounded-xl border border-[var(--border)] px-3 py-2">
                  <p className="truncate text-xs font-medium text-[var(--foreground)]">
                    {invocation.serverName}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-[var(--muted-foreground)]">
                    {invocation.toolName}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--muted-foreground)]">{t.chat("noToolCalls")}</p>
          )}
        </section>
      </div>
    </aside>
  );
}
