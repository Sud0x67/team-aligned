import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useAppStore } from "../store/use-app-store";
import { createTranslator } from "../i18n";
import { AvatarPicker } from "./avatar-picker";

export function ProfileModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const profile = useAppStore((state) => state.profile);
  const settings = useAppStore((state) => state.settings);
  const updateProfile = useAppStore((state) => state.updateProfile);
  const t = createTranslator(settings.language);
  const [draft, setDraft] = useState(profile);

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-[28px] border border-[var(--border)] bg-[var(--card)] shadow-soft">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">{t.profile("title")}</h2>
            <p className="text-sm text-[var(--muted-text)]">{t.profile("description")}</p>
          </div>
          <button
            className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--panel)] text-[var(--muted-text)] transition-colors hover:bg-[var(--panel-muted)] hover:text-[var(--text)]"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-4 px-6 py-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <AvatarPicker
              label={t.profile("avatar")}
              value={draft.avatarPath}
              fallback={draft.name.slice(0, 1).toUpperCase() || "A"}
              color="var(--primary)"
              uploadLabel={draft.avatarPath ? t.common("changeAvatar") : t.common("uploadAvatar")}
              removeLabel={t.common("removeAvatar")}
              scope="profile"
              fileNameHint={draft.name || "profile"}
              onChange={(avatarPath) => setDraft((current) => ({ ...current, avatarPath }))}
            />
          </div>
          <label className="space-y-2 md:col-span-1">
            <span className="text-sm text-[var(--muted-text)]">{t.profile("name")}</span>
            <input
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              className="input"
            />
          </label>
          <label className="space-y-2 md:col-span-1">
            <span className="text-sm text-[var(--muted-text)]">{t.profile("role")}</span>
            <input
              value={draft.role}
              onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))}
              className="input"
            />
          </label>
          <label className="space-y-2 md:col-span-1">
            <span className="text-sm text-[var(--muted-text)]">{t.profile("team")}</span>
            <input
              value={draft.team}
              onChange={(event) => setDraft((current) => ({ ...current, team: event.target.value }))}
              className="input"
            />
          </label>
          <label className="space-y-2 md:col-span-1">
            <span className="text-sm text-[var(--muted-text)]">{t.profile("email")}</span>
            <input
              value={draft.email}
              onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
              className="input"
            />
          </label>
          <label className="space-y-2 md:col-span-2">
            <span className="text-sm text-[var(--muted-text)]">{t.profile("bio")}</span>
            <textarea
              value={draft.bio}
              onChange={(event) => setDraft((current) => ({ ...current, bio: event.target.value }))}
              className="input min-h-[120px] resize-none"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] px-6 py-4">
          <button className="button-secondary" onClick={onClose}>
            {t.profile("cancel")}
          </button>
          <button
            className="button-primary"
            onClick={() => {
              void updateProfile(draft);
              onClose();
            }}
          >
            {t.profile("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
