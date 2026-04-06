import { useId, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { AvatarBadge } from "./avatar-badge";

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

export function AvatarPicker({
  label,
  value,
  fallback,
  color,
  uploadLabel,
  removeLabel,
  scope,
  fileNameHint,
  onChange,
}: {
  label: string;
  value: string | null;
  fallback: string;
  color: string;
  uploadLabel: string;
  removeLabel: string;
  scope: "profile" | "agents" | "teams";
  fileNameHint?: string;
  onChange: (value: string | null) => void;
}) {
  const inputId = useId();
  const [loading, setLoading] = useState(false);

  return (
    <div className="space-y-2">
      <span className="block text-[13px] text-[var(--muted-foreground)]">{label}</span>
      <div className="flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3">
        <AvatarBadge
          src={value}
          fallback={fallback}
          alt={label}
          className="h-16 w-16 rounded-2xl"
          style={{ backgroundColor: color }}
          textClassName="text-lg font-semibold text-white"
        />
        <div className="flex flex-wrap gap-2">
          <label
            htmlFor={inputId}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[13px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
          >
            <ImagePlus className="h-4 w-4" />
            {loading ? "..." : uploadLabel}
          </label>
          {value ? (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[13px] text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <Trash2 className="h-4 w-4" />
              {removeLabel}
            </button>
          ) : null}
        </div>
        <input
          id={inputId}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setLoading(true);
            void fileToDataUrl(file)
              .then((dataUrl) =>
                window.teamaligned.saveAvatarAsset({
                  scope,
                  dataUrl,
                  fileNameHint: fileNameHint || file.name.replace(/\.[^.]+$/, ""),
                }),
              )
              .then((assetPath) => onChange(assetPath))
              .catch(() => undefined)
              .finally(() => {
                setLoading(false);
                event.target.value = "";
              });
          }}
        />
      </div>
    </div>
  );
}
