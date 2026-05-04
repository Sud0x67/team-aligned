import {
  Check,
  BarChart3,
  Box,
  ChevronRight,
  FolderOpen,
  Info,
  LoaderCircle,
} from "lucide-react";
import type { ConversationKind } from "@shared";
import { createTranslator } from "../../i18n";
import { useAppStore } from "../../store/use-app-store";

function trimMiddle(value: string, max = 42) {
  if (value.length <= max) return value;
  const head = value.slice(0, Math.floor(max / 2) - 1);
  const tail = value.slice(value.length - Math.floor(max / 2));
  return `${head}...${tail}`;
}

export function ChatConversationSidebar({
  expanded,
  expandedWidth,
  onExpandedChange,
  conversationKind,
  tokenUsage,
  workspacePath,
  activeSkillLabel,
  pinnedMcpLabel,
  activeRunElapsedLabel,
  activeRunProgressText,
  activeRunReasoningText,
  onOpenWorkspace,
  onExportConversation,
  exportState,
}: {
  expanded: boolean;
  expandedWidth?: number;
  onExpandedChange: (expanded: boolean) => void;
  conversationKind: ConversationKind;
  tokenUsage: { total: number; tracked: boolean };
  workspacePath: string | null;
  activeSkillLabel: string | null;
  pinnedMcpLabel: string | null;
  activeRunElapsedLabel: string | null;
  activeRunProgressText: string | null;
  activeRunReasoningText: string | null;
  onOpenWorkspace: (workspacePath: string) => void;
  onExportConversation: () => Promise<void>;
  exportState: {
    status: "idle" | "exporting" | "success" | "error";
    message: string | null;
  };
}) {
  const language = useAppStore((state) => state.settings.language);
  const t = createTranslator(language);

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
    <aside
      className="hidden shrink-0 border-l border-[var(--border)] bg-[var(--card)] lg:flex lg:min-h-0 lg:flex-col"
      style={expandedWidth ? { width: `${expandedWidth}px` } : undefined}
    >
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
        {activeRunElapsedLabel || activeRunProgressText || activeRunReasoningText ? (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
            <div className="mb-3 flex items-center gap-2">
              <LoaderCircle className="h-4 w-4 animate-spin text-[var(--primary)]" />
              <p className="text-sm font-semibold text-[var(--foreground)]">
                {language === "en" ? "Current run" : "当前任务"}
              </p>
            </div>
            {activeRunElapsedLabel ? (
              <p className="text-lg font-semibold text-[var(--foreground)]">{activeRunElapsedLabel}</p>
            ) : null}
            {activeRunProgressText ? (
              <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
                {activeRunProgressText}
              </p>
            ) : null}
            {activeRunReasoningText ? (
              <div className="mt-3 rounded-xl bg-[var(--muted)] p-3">
                <p className="mb-1 text-[11px] font-semibold text-[var(--primary)]">
                  {language === "en" ? "Model thinking" : "模型思考"}
                </p>
                <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-[var(--muted-foreground)]">
                  {activeRunReasoningText}
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

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
            <p className="text-sm font-semibold text-[var(--foreground)]">
              {t.chat("currentCapabilities")}
            </p>
          </div>
          <div className="space-y-2 text-xs leading-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">{t.chat("activeSkill")}</span>
              {activeSkillLabel ? (
                <span className="inline-flex max-w-[170px] items-center gap-1.5 truncate rounded-full bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-2.5 py-1 font-medium text-[var(--primary)]">
                  <Check className="h-3 w-3 shrink-0" />
                  <span className="truncate">{activeSkillLabel}</span>
                </span>
              ) : (
                <span className="max-w-[160px] truncate rounded-full bg-[var(--muted)] px-2.5 py-1 font-medium text-[var(--foreground)]">
                  {t.chat("none")}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">{t.chat("pinnedMcp")}</span>
              <span className="max-w-[160px] truncate rounded-full bg-[var(--muted)] px-2.5 py-1 font-medium text-[var(--foreground)]">
                {pinnedMcpLabel ?? t.chat("none")}
              </span>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-[var(--muted-foreground)]">
            {conversationKind === "agent"
              ? t.chat("directCapabilitiesHint")
              : t.chat("teamCapabilitiesHint")}
          </p>
        </section>

      </div>
    </aside>
  );
}
