import { useMemo, useState } from "react";
import { CheckCircle2, Plus, Search } from "lucide-react";
import { useAppStore } from "../store/use-app-store";
import { createTranslator } from "../i18n";
import { Badge } from "../components/pages/badge";
import { EmptyState } from "../components/pages/empty-state";
import { PageShell } from "../components/pages/page-shell";
import { SectionCard } from "../components/pages/section-card";

type TabKey = "skills" | "mcp";
type CommandKey = "/skills" | "/command" | "/mcp" | "/pause" | "/resume" | "/cancel";

export function ExtensionsPage() {
  const { extensions, toggleExtension, commandSuggestions, settings } = useAppStore();
  const t = createTranslator(settings.language);
  const [tab, setTab] = useState<TabKey>("skills");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const type = tab === "skills" ? "skill" : "mcp";
    return extensions
      .filter((extension) => extension.type === type)
      .filter((extension) =>
        [extension.name, extension.description, extension.source].join(" ").toLowerCase().includes(query.trim().toLowerCase()),
      );
  }, [extensions, query, tab]);

  return (
    <PageShell title={t.extensions("title")} description={t.extensions("description")}>
      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <SectionCard
          title={t.extensions("centerTitle")}
          subtitle={t.extensions("centerDesc")}
          actions={
            <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
              <button
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  tab === "skills" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
                }`}
                onClick={() => setTab("skills")}
              >
                {t.extensions("skills")}
              </button>
              <button
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  tab === "mcp" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
                }`}
                onClick={() => setTab("mcp")}
              >
                {t.extensions("mcp")}
              </button>
            </div>
          }
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.extensions("searchPlaceholder")}
              className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm outline-none"
            />
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {visible.length > 0 ? (
              visible.map((extension) => (
                <article
                  key={extension.id}
                  className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-slate-950">{extension.name}</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{extension.description}</p>
                    </div>
                    <Badge tone={extension.installed ? "emerald" : "slate"}>
                      {extension.installed ? t.extensions("installed") : t.extensions("notInstalled")}
                    </Badge>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge tone="indigo">{extension.source}</Badge>
                    <Badge tone={extension.enabled ? "emerald" : "amber"}>
                      {extension.enabled ? t.extensions("enabled") : t.extensions("disabled")}
                    </Badge>
                    <Badge tone="cyan">{extension.type === "skill" ? t.extensions("skills") : t.extensions("mcp")}</Badge>
                  </div>
                  <button
                    onClick={() => toggleExtension(extension.id)}
                    className={`mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition ${
                      extension.installed
                        ? "border border-slate-200 bg-slate-50 text-slate-700"
                        : "bg-slate-950 text-white"
                    }`}
                  >
                    {extension.installed ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        {t.extensions("toggleEnabled")}
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4" />
                        {t.extensions("installAndEnable")}
                      </>
                    )}
                  </button>
                </article>
              ))
            ) : (
              <div className="md:col-span-2">
                <EmptyState title={t.extensions("noMatchTitle")} description={t.extensions("noMatchDesc")} />
              </div>
            )}
          </div>
        </SectionCard>

        <div className="space-y-4">
          <SectionCard title={t.extensions("commandSuggestions")} subtitle={t.extensions("commandSuggestionsDesc")}>
            <div className="space-y-3">
              {commandSuggestions.map((item) => (
                <div key={item.name} className="rounded-2xl bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-sm font-semibold text-slate-950">{item.name}</p>
                    <Badge tone="slate">{t.extensions("commandBadge")}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{t.command(item.name as CommandKey)}</p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title={t.extensions("extensionNotes")} subtitle={t.extensions("extensionNotesDesc")}>
            <div className="space-y-2 text-sm leading-7 text-slate-600">
              <p>{t.extensions("skillNote1")}</p>
              <p>{t.extensions("skillNote2")}</p>
              <p>{t.extensions("skillNote3")}</p>
            </div>
          </SectionCard>
        </div>
      </div>
    </PageShell>
  );
}
