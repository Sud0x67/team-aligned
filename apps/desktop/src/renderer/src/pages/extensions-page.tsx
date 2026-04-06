import { useMemo, useState } from "react";
import {
  Blocks,
  CheckCircle2,
  DownloadCloud,
  Globe,
  Plus,
  Puzzle,
  Search,
} from "lucide-react";
import { useAppStore } from "../store/use-app-store";
import { createTranslator } from "../i18n";

type TabKey = "skills" | "mcp";

function getExtensionIcon(name: string, installed: boolean) {
  if (/web search/i.test(name)) {
    return installed ? Search : Globe;
  }

  if (/github/i.test(name)) {
    return installed ? CheckCircle2 : DownloadCloud;
  }

  return installed ? CheckCircle2 : Plus;
}

export function ExtensionsPage() {
  const { extensions, toggleExtension, settings } = useAppStore();
  const t = createTranslator(settings.language);
  const [tab, setTab] = useState<TabKey>("skills");

  const visible = useMemo(() => {
    const type = tab === "skills" ? "skill" : "mcp";
    return extensions.filter((extension) => extension.type === type);
  }, [extensions, tab]);

  return (
    <div className="h-full overflow-y-auto bg-[var(--background)] px-6 py-6 text-[var(--foreground)]">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-[20px] font-medium text-[var(--foreground)]">{t.extensions("title")}</h1>
          <p className="mt-1 text-[14px] text-[var(--muted-foreground)]">
            {t.extensions("description")}
          </p>
        </div>

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

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visible.map((extension) => {
            const Icon = getExtensionIcon(extension.name, extension.installed);
            return (
              <div
                key={extension.id}
                className="flex items-start gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 transition-all hover:shadow-sm"
              >
                <div
                  className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                    extension.installed
                      ? "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)]"
                      : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </div>

                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-[15px] font-medium text-[var(--foreground)]">{extension.name}</h3>
                    {extension.installed ? (
                      <button
                        onClick={() => toggleExtension(extension.id)}
                        className="flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--primary)] transition hover:opacity-80"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        {t.extensions("installed")}
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleExtension(extension.id)}
                        className="flex items-center gap-1 rounded-full bg-[var(--muted)] px-3 py-1 text-[12px] font-medium text-[var(--foreground)] transition hover:bg-[var(--panel-muted)]"
                      >
                        <DownloadCloud className="h-3.5 w-3.5" />
                        {t.extensions("installAndEnable")}
                      </button>
                    )}
                  </div>

                  <p className="pr-8 text-[13px] leading-relaxed text-[var(--muted-foreground)]">
                    {extension.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
