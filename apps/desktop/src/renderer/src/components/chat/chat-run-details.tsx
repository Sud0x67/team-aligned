import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  FileStack,
  Paperclip,
  Pause,
  Play,
  Wrench,
  X,
} from "lucide-react";
import type {
  ArtifactRecord,
  RunRecord,
  RunStatus,
  RunStepRecord,
  StoredAttachmentRecord,
  ToolInvocationRecord,
} from "@shared";
import { createTranslator } from "../../i18n";
import { resolveAssetSrc } from "../../lib/asset-src";
import { useAppStore } from "../../store/use-app-store";

function formatTime(timestamp: number | null) {
  if (!timestamp) return "--";
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function trimText(value: string | null | undefined, max = 160) {
  const text = (value ?? "").trim();
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function formatJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function isActiveRun(status: RunStatus) {
  return !["completed", "failed", "cancelled"].includes(status);
}

function getRunStatusTone(status: RunStatus) {
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

function getStepTone(step: RunStepRecord) {
  switch (step.status) {
    case "running":
      return "border-[color-mix(in_srgb,var(--primary)_20%,transparent)] bg-[color-mix(in_srgb,var(--primary)_6%,transparent)]";
    case "completed":
      return "border-emerald-500/20 bg-emerald-500/5";
    case "failed":
      return "border-rose-500/20 bg-rose-500/5";
    case "cancelled":
      return "border-slate-500/20 bg-slate-500/5";
    default:
      return "border-[var(--border)] bg-[var(--card)]";
  }
}

function getStatusLabel(t: ReturnType<typeof createTranslator>, status: RunStatus) {
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

function getStepStatusLabel(t: ReturnType<typeof createTranslator>, status: RunStepRecord["status"]) {
  switch (status) {
    case "pending":
      return t.chat("stepStatusPending");
    case "running":
      return t.chat("stepStatusRunning");
    case "completed":
      return t.chat("stepStatusCompleted");
    case "failed":
      return t.chat("stepStatusFailed");
    case "cancelled":
      return t.chat("stepStatusCancelled");
  }
}

function getToolStatusLabel(
  t: ReturnType<typeof createTranslator>,
  status: ToolInvocationRecord["status"],
) {
  switch (status) {
    case "running":
      return t.chat("toolStatusRunning");
    case "completed":
      return t.chat("toolStatusCompleted");
    case "failed":
      return t.chat("toolStatusFailed");
  }
}

function Section({
  icon,
  title,
  empty,
  children,
}: {
  icon: ReactNode;
  title: string;
  empty: string;
  children: ReactNode;
}) {
  const isEmpty = Array.isArray(children) ? children.length === 0 : !children;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--muted)] text-[var(--primary)]">
          {icon}
        </div>
        <h4 className="text-sm font-semibold text-[var(--foreground)]">{title}</h4>
      </div>
      {isEmpty ? <p className="text-sm text-[var(--muted-foreground)]">{empty}</p> : children}
    </section>
  );
}

export function ChatRunDetails({
  run,
  runSteps,
  artifacts,
  attachments,
  toolInvocations,
  tokenUsage,
  latestSystemMessage,
  onPause,
  onResume,
  onCancel,
}: {
  run: RunRecord | null;
  runSteps: RunStepRecord[];
  artifacts: ArtifactRecord[];
  attachments: StoredAttachmentRecord[];
  toolInvocations: ToolInvocationRecord[];
  tokenUsage: { total: number; tracked: boolean };
  latestSystemMessage: string | null;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const language = useAppStore((state) => state.settings.language);
  const t = createTranslator(language);
  const [expanded, setExpanded] = useState(false);

  const sortedSteps = useMemo(
    () => [...runSteps].sort((a, b) => a.stepIndex - b.stepIndex),
    [runSteps],
  );
  const recentArtifacts = useMemo(
    () => [...artifacts].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6),
    [artifacts],
  );
  const recentAttachments = useMemo(
    () => [...attachments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6),
    [attachments],
  );
  const recentToolInvocations = useMemo(
    () => [...toolInvocations].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6),
    [toolInvocations],
  );

  if (
    !run &&
    recentArtifacts.length === 0 &&
    recentAttachments.length === 0 &&
    recentToolInvocations.length === 0 &&
    tokenUsage.total === 0
  ) {
    return null;
  }

  const summaryText = latestSystemMessage
    ? trimText(latestSystemMessage.replace(/\n+/g, " "), 88)
    : run
      ? `${run.title} · ${t.chat("currentStep")} ${run.stepIndex} / ${run.totalSteps}`
      : t.chat("runHistoryReady");

  if (!expanded) {
    return (
      <div className="mb-3 rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="min-w-0 flex-1 text-left"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--foreground)]">{t.chat("runDetails")}</span>
              {run ? (
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${getRunStatusTone(run.status)}`}>
                  {getStatusLabel(t, run.status)}
                </span>
              ) : null}
              <span className="rounded-full bg-[var(--muted)] px-2.5 py-1 text-[11px] text-[var(--muted-foreground)]">
                {tokenUsage.tracked ? t.chat("tokenUsage") : t.chat("tokenEstimate")}
                {tokenUsage.total.toLocaleString()}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-[var(--muted-foreground)]">{summaryText}</p>
          </button>

          {run && isActiveRun(run.status) ? (
            <button
              type="button"
              onClick={onCancel}
              className="shrink-0 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
            >
              {t.chat("cancel")}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="shrink-0 rounded-xl p-2 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            aria-label={t.chat("expandRunDetails")}
          >
            <ChevronUp className="h-4 w-4 rotate-180" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3 flex max-h-[42vh] min-h-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
      <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--foreground)]">{t.chat("runDetails")}</p>
            {run ? (
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getRunStatusTone(run.status)}`}>
                {getStatusLabel(t, run.status)}
              </span>
            ) : null}
            <span className="rounded-full bg-[var(--muted)] px-2.5 py-1 text-[11px] text-[var(--muted-foreground)]">
              {tokenUsage.tracked ? t.chat("tokenUsage") : t.chat("tokenEstimate")}
              {tokenUsage.total.toLocaleString()}
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {summaryText}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {run?.status === "running" || run?.status === "pausing" ? (
            <button
              type="button"
              onClick={onPause}
              className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
            >
              <span className="inline-flex items-center gap-1.5">
                <Pause className="h-3.5 w-3.5" />
                {t.chat("pause")}
              </span>
            </button>
          ) : null}
          {run?.status === "paused" || run?.status === "resuming" ? (
            <button
              type="button"
              onClick={onResume}
              className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
            >
              <span className="inline-flex items-center gap-1.5">
                <Play className="h-3.5 w-3.5" />
                {t.chat("resume")}
              </span>
            </button>
          ) : null}
          {run && isActiveRun(run.status) ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
            >
              <span className="inline-flex items-center gap-1.5">
                <X className="h-3.5 w-3.5" />
                {t.chat("cancel")}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="rounded-xl p-2 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            aria-label={t.chat("collapseRunDetails")}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto pr-1">
        <div className="grid gap-3 xl:grid-cols-2">
        <Section icon={<Activity className="h-4 w-4" />} title={t.chat("stepTimeline")} empty={t.chat("noSteps")}>
          <div className="space-y-2">
            {sortedSteps.map((step) => (
              <div key={step.id} className={`rounded-xl border px-3 py-2 ${getStepTone(step)}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-[var(--foreground)]">{step.label}</p>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {getStepStatusLabel(t, step.status)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {formatTime(step.startedAt)} - {formatTime(step.completedAt)}
                </p>
                {step.errorText ? (
                  <p className="mt-2 text-xs leading-6 text-rose-600">{trimText(step.errorText, 220)}</p>
                ) : null}
              </div>
            ))}
          </div>
        </Section>

        <Section icon={<FileStack className="h-4 w-4" />} title={t.chat("recentArtifacts")} empty={t.chat("noArtifacts")}>
          <div className="space-y-2">
            {recentArtifacts.map((artifact) => (
              <a
                key={artifact.id}
                href={resolveAssetSrc(artifact.path) ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl border border-[var(--border)] px-3 py-2 transition hover:border-[var(--primary)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">{artifact.title}</p>
                  <span className="text-xs text-[var(--muted-foreground)]">{formatTime(artifact.createdAt)}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {artifact.artifactKind} · {artifact.path}
                </p>
              </a>
            ))}
          </div>
        </Section>

        <Section icon={<Paperclip className="h-4 w-4" />} title={t.chat("recentAttachments")} empty={t.chat("noAttachments")}>
          <div className="space-y-2">
            {recentAttachments.map((attachment) => (
              <a
                key={attachment.id}
                href={resolveAssetSrc(attachment.path) ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl border border-[var(--border)] px-3 py-2 transition hover:border-[var(--primary)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">{attachment.name}</p>
                  <span className="text-xs text-[var(--muted-foreground)]">{formatTime(attachment.createdAt)}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB · {attachment.mimeType}
                </p>
              </a>
            ))}
          </div>
        </Section>

        <Section icon={<Wrench className="h-4 w-4" />} title={t.chat("recentToolCalls")} empty={t.chat("noToolCalls")}>
          <div className="space-y-2">
            {recentToolInvocations.map((invocation) => (
              <div key={invocation.id} className="rounded-xl border border-[var(--border)] px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">
                    {invocation.serverName} · {invocation.toolName}
                  </p>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {getToolStatusLabel(t, invocation.status)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">{formatTime(invocation.createdAt)}</p>
                <div className="mt-2 rounded-lg bg-[var(--muted)] px-3 py-2">
                  <p className="mb-1 text-[11px] font-medium text-[var(--muted-foreground)]">
                    {t.chat("toolInput")}
                  </p>
                  <pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-[var(--foreground)]">
                    {trimText(formatJson(invocation.inputJson), 320)}
                  </pre>
                </div>
                {invocation.outputText ? (
                  <div className="mt-2 rounded-lg bg-[var(--muted)] px-3 py-2">
                    <p className="mb-1 text-[11px] font-medium text-[var(--muted-foreground)]">
                      {t.chat("toolOutput")}
                    </p>
                    <pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-[var(--foreground)]">
                      {trimText(invocation.outputText, 320)}
                    </pre>
                  </div>
                ) : null}
                {invocation.errorText ? (
                  <p className="mt-2 text-xs leading-6 text-rose-600">{trimText(invocation.errorText, 240)}</p>
                ) : null}
              </div>
            ))}
          </div>
        </Section>
        </div>
      </div>
    </div>
  );
}
