import type { ReactNode } from "react";
import { Activity, FileStack, Paperclip, Wrench } from "lucide-react";
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
}: {
  run: RunRecord | null;
  runSteps: RunStepRecord[];
  artifacts: ArtifactRecord[];
  attachments: StoredAttachmentRecord[];
  toolInvocations: ToolInvocationRecord[];
}) {
  const language = useAppStore((state) => state.settings.language);
  const t = createTranslator(language);

  const sortedSteps = [...runSteps].sort((a, b) => a.stepIndex - b.stepIndex);
  const recentArtifacts = [...artifacts].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const recentAttachments = [...attachments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const recentToolInvocations = [...toolInvocations].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);

  if (!run && recentArtifacts.length === 0 && recentAttachments.length === 0 && recentToolInvocations.length === 0) {
    return null;
  }

  return (
    <div className="mb-3 rounded-[22px] border border-[var(--border)] bg-[var(--background)] p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">{t.chat("runDetails")}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {run
              ? `${run.title} · ${t.chat("currentStep")} ${run.stepIndex} / ${run.totalSteps}`
              : t.chat("noRunDetails")}
          </p>
        </div>
        {run ? (
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getRunStatusTone(run.status)}`}>
            {getStatusLabel(t, run.status)}
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Section icon={<Activity className="h-4 w-4" />} title={t.chat("stepTimeline")} empty={t.chat("noSteps")}>
          <div className="space-y-2">
            {sortedSteps.map((step) => (
              <div
                key={step.id}
                className={`rounded-xl border px-3 py-2 ${getStepTone(step)}`}
              >
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
  );
}
