import { FolderOpen, X } from "lucide-react";
import type { AgentRecord } from "@shared";
import { AvatarBadge } from "../avatar-badge";
import { AvatarPicker } from "../avatar-picker";

const teamMemberLimit = 5;

export type AgentFormState = {
  name: string;
  role: string;
  description: string;
  capabilities: string;
  workspacePath: string;
  avatarPath: string | null;
};

export type TeamFormState = {
  name: string;
  description: string;
  memberIds: string[];
  workspacePath: string;
  avatarPath: string | null;
};

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-[18px] font-semibold text-[var(--foreground)]">{title}</h2>
            {subtitle ? (
              <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">{subtitle}</p>
            ) : null}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-[var(--muted)]">
            <X className="h-5 w-5 text-[var(--muted-foreground)]" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

async function pickWorkspaceDirectory(onSelect: (directory: string) => void) {
  if (typeof window.teamaligned.selectDirectory !== "function") {
    return;
  }

  const directory = await window.teamaligned.selectDirectory();
  if (directory) {
    onSelect(directory);
  }
}

export function AgentFormModal({
  open,
  form,
  title,
  submitLabel,
  labels,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  form: AgentFormState;
  title: string;
  submitLabel: string;
  labels: Record<string, string>;
  onChange: (next: AgentFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="space-y-4">
        <AvatarPicker
          label={labels.avatar}
          value={form.avatarPath}
          fallback={form.name.slice(0, 1).toUpperCase() || "A"}
          color="var(--primary)"
          uploadLabel={form.avatarPath ? labels.changeAvatar : labels.uploadAvatar}
          removeLabel={labels.removeAvatar}
          scope="agents"
          fileNameHint={form.name || "agent"}
          onChange={(avatarPath) => onChange({ ...form, avatarPath })}
        />
        <div>
          <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{labels.name}</label>
          <input
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{labels.role}</label>
          <input
            value={form.role}
            onChange={(event) => onChange({ ...form, role: event.target.value })}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{labels.descriptionField}</label>
          <textarea
            value={form.description}
            onChange={(event) => onChange({ ...form, description: event.target.value })}
            rows={3}
            className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{labels.capabilities}</label>
          <input
            value={form.capabilities}
            onChange={(event) => onChange({ ...form, capabilities: event.target.value })}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{labels.workspacePath}</label>
          <div className="flex gap-2">
            <input
              value={form.workspacePath}
              onChange={(event) => onChange({ ...form, workspacePath: event.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
            />
            <button
              type="button"
              onClick={() =>
                void pickWorkspaceDirectory((workspacePath) => onChange({ ...form, workspacePath }))
              }
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-[14px] font-medium text-white shadow-sm transition hover:opacity-90"
            >
              <FolderOpen className="h-4 w-4" />
              {labels.browseDirectory}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={onClose}
          className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-[14px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
        >
          {labels.cancel}
        </button>
        <button
          onClick={onSubmit}
          className="rounded-lg bg-[var(--primary)] px-4 py-2.5 text-[14px] text-white transition hover:opacity-90"
        >
          {submitLabel}
        </button>
      </div>
    </ModalShell>
  );
}

export function TeamFormModal({
  open,
  form,
  agents,
  title,
  submitLabel,
  labels,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  form: TeamFormState;
  agents: AgentRecord[];
  title: string;
  submitLabel: string;
  labels: Record<string, string>;
  onChange: (next: TeamFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="space-y-4">
        <AvatarPicker
          label={labels.avatar}
          value={form.avatarPath}
          fallback={form.name.slice(0, 1).toUpperCase() || "G"}
          color="var(--primary)"
          uploadLabel={form.avatarPath ? labels.changeAvatar : labels.uploadAvatar}
          removeLabel={labels.removeAvatar}
          scope="teams"
          fileNameHint={form.name || "team"}
          onChange={(avatarPath) => onChange({ ...form, avatarPath })}
        />
        <div>
          <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{labels.teamName}</label>
          <input
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{labels.descriptionField}</label>
          <input
            value={form.description}
            onChange={(event) => onChange({ ...form, description: event.target.value })}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <label className="block text-[13px] text-[var(--muted-foreground)]">{labels.chooseMembers}</label>
            <span className="text-[12px] text-[var(--muted-foreground)]">
              {form.memberIds.length} / {teamMemberLimit}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {agents.map((agent) => {
              const selected = form.memberIds.includes(agent.id);
              const disabled = !selected && form.memberIds.length >= teamMemberLimit;
              return (
                <button
                  key={agent.id}
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...form,
                      memberIds: selected
                        ? form.memberIds.filter((id) => id !== agent.id)
                        : [...form.memberIds, agent.id],
                    })
                  }
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors ${
                    selected
                      ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)]"
                      : disabled
                        ? "cursor-not-allowed border-[var(--border)] text-[var(--muted-foreground)] opacity-45"
                        : "border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)]"
                  }`}
                >
                  <AvatarBadge
                    src={agent.avatarPath}
                    fallback={agent.avatar}
                    alt={agent.name}
                    className="h-7 w-7 shrink-0 rounded-md"
                    style={{ backgroundColor: agent.avatarColor }}
                    textClassName="text-[11px] font-semibold text-white"
                  />
                  <span className="truncate">{agent.name}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{labels.workspacePath}</label>
          <div className="flex gap-2">
            <input
              value={form.workspacePath}
              onChange={(event) => onChange({ ...form, workspacePath: event.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
            />
            <button
              type="button"
              onClick={() =>
                void pickWorkspaceDirectory((workspacePath) => onChange({ ...form, workspacePath }))
              }
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-[14px] font-medium text-white shadow-sm transition hover:opacity-90"
            >
              <FolderOpen className="h-4 w-4" />
              {labels.browseDirectory}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={onClose}
          className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-[14px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
        >
          {labels.cancel}
        </button>
        <button
          onClick={onSubmit}
          className="rounded-lg bg-[var(--primary)] px-4 py-2.5 text-[14px] text-white transition hover:opacity-90"
        >
          {submitLabel}
        </button>
      </div>
    </ModalShell>
  );
}

export function SelectionModal({
  open,
  title,
  subtitle,
  items,
  selectedIds,
  emptyLabel,
  cancelLabel,
  confirmLabel,
  onToggle,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  subtitle: string;
  items: Array<{ id: string; name: string; description: string }>;
  selectedIds: string[];
  emptyLabel: string;
  cancelLabel: string;
  confirmLabel: string;
  onToggle: (id: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <ModalShell title={title} subtitle={subtitle} onClose={onClose}>
      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item) => {
            const selected = selectedIds.includes(item.id);
            return (
              <button
                key={item.id}
                onClick={() => onToggle(item.id)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                  selected
                    ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
                    : "border-[var(--border)] bg-[var(--background)] hover:bg-[var(--muted)]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-[var(--foreground)]">{item.name}</p>
                    <p className="mt-1 text-[12px] leading-5 text-[var(--muted-foreground)]">
                      {item.description}
                    </p>
                  </div>
                  <div
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      selected
                        ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]"
                        : "border-[var(--border)] bg-transparent"
                    }`}
                  >
                    <span
                      className={`h-2.5 w-2.5 rounded-full transition-colors ${
                        selected ? "bg-[var(--primary)]" : "bg-transparent"
                      }`}
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--background)] p-4 text-[13px] text-[var(--muted-foreground)]">
          {emptyLabel}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={onClose}
          className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-[14px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
        >
          {cancelLabel}
        </button>
        <button
          onClick={onSubmit}
          className="rounded-lg bg-[var(--primary)] px-4 py-2.5 text-[14px] text-white transition hover:opacity-90"
        >
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}
