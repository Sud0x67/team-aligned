import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Circle, CircleDot, Languages, MoonStar, SunMedium } from "lucide-react";
import { useAppStore } from "../store/use-app-store";
import { createTranslator } from "../i18n";
import { PageShell } from "../components/pages/page-shell";
import { SectionCard } from "../components/pages/section-card";

const providerDisplayLabels = {
  qwen: "百炼 (DashScope)",
  openai: "OpenAI",
} as const;

const providerModelOptions = {
  qwen: ["qwen-max", "qwen-plus", "qwen-turbo"],
  openai: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
} as const;

function ChoiceCard({
  selected,
  icon,
  title,
  description,
  onClick,
}: {
  selected: boolean;
  icon: ReactNode;
  title: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-[24px] border px-5 py-5 text-left transition ${
        selected
          ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_8%,white)] text-slate-950 shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_12%,transparent)]"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
      }`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`mt-0.5 shrink-0 ${
            selected ? "text-[var(--primary)]" : "text-slate-500"
          }`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {selected ? (
              <CircleDot className="h-5 w-5 text-[var(--primary)]" />
            ) : (
              <Circle className="h-5 w-5 text-slate-500" />
            )}
            <p className="text-[15px] font-semibold">{title}</p>
          </div>
          {description ? (
            <p className="mt-2 pl-8 text-sm leading-6 text-slate-500">{description}</p>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input
        type="checkbox"
        checked={checked}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className="h-7 w-12 rounded-full border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-slate-200 transition peer-checked:bg-[var(--primary)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-[color-mix(in_srgb,var(--primary)_35%,transparent)]" />
      <span className="pointer-events-none absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition peer-checked:translate-x-5" />
    </label>
  );
}

export function SettingsPage() {
  const { settings, providers, updateSettings, updateProvider } = useAppStore();
  const t = createTranslator(settings.language);

  const [providerForms, setProviderForms] = useState(providers);
  const [selectedProviderId, setSelectedProviderId] = useState<string>(
    providers.find((provider) => provider.isActive)?.id ?? providers[0]?.id ?? "openai",
  );

  useEffect(() => {
    setProviderForms(providers);
    setSelectedProviderId((current) => {
      if (providers.some((provider) => provider.id === current)) {
        return current;
      }

      return providers.find((provider) => provider.isActive)?.id ?? providers[0]?.id ?? "openai";
    });
  }, [providers]);

  const notificationItems = [
    {
      key: "notifyAgentComplete" as const,
      title: t.settings("agentComplete"),
    },
    {
      key: "notifyMention" as const,
      title: t.settings("mentionNotify"),
    },
    {
      key: "notifyGroup" as const,
      title: t.settings("groupNotify"),
    },
  ];

  const selectedProvider =
    providerForms.find((provider) => provider.id === selectedProviderId) ?? providerForms[0] ?? null;

  return (
    <PageShell title={t.settings("title")}>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <SectionCard title={t.settings("appearance")}>
            <div className="grid gap-3 md:grid-cols-2">
              <ChoiceCard
                selected={settings.theme === "light"}
                icon={<SunMedium className="h-6 w-6" />}
                title={t.settings("lightMode")}
                onClick={() => updateSettings({ theme: "light" })}
              />
              <ChoiceCard
                selected={settings.theme === "dark"}
                icon={<MoonStar className="h-6 w-6" />}
                title={t.settings("darkMode")}
                onClick={() => updateSettings({ theme: "dark" })}
              />
            </div>
          </SectionCard>

          <SectionCard title={t.settings("language")}>
            <div className="grid gap-3 md:grid-cols-2">
              <ChoiceCard
                selected={settings.language === "zh"}
                icon={<Languages className="h-6 w-6" />}
                title={t.settings("languageZh")}
                onClick={() => updateSettings({ language: "zh" })}
              />
              <ChoiceCard
                selected={settings.language === "en"}
                icon={<Languages className="h-6 w-6" />}
                title={t.settings("languageEn")}
                onClick={() => updateSettings({ language: "en" })}
              />
            </div>
          </SectionCard>

          <SectionCard title={t.settings("notifications")}>
            <div className="space-y-3">
              {notificationItems.map((item) => (
                <label
                  key={item.key}
                  className="flex items-center justify-between gap-4 rounded-[24px] border border-slate-200 bg-white px-4 py-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{item.title}</p>
                  </div>
                  <ToggleSwitch
                    checked={settings[item.key]}
                    ariaLabel={item.title}
                    onChange={(checked) =>
                      updateSettings({ [item.key]: checked } as Partial<typeof settings>)
                    }
                  />
                </label>
              ))}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title={t.settings("modelConfig")}>
            {selectedProvider ? (
              <div className="space-y-4">
                <div className="rounded-[28px] border border-slate-200 bg-white p-5">
                  <div className="grid gap-5">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-slate-700">{t.settings("providerPicker")}</p>
                      <select
                        value={selectedProviderId}
                        onChange={(event) => setSelectedProviderId(event.target.value)}
                        className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-4 text-[15px] text-slate-950 outline-none transition focus:border-slate-400"
                      >
                        {providerForms.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {providerDisplayLabels[provider.id]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-slate-700">{t.settings("baseUrlField")}</p>
                      <input
                        value={selectedProvider.baseUrl}
                        onChange={(event) =>
                          setProviderForms((current) =>
                            current.map((item) =>
                              item.id === selectedProvider.id
                                ? { ...item, baseUrl: event.target.value }
                                : item,
                            ),
                          )
                        }
                        className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-4 text-[15px] text-slate-950 outline-none transition focus:border-slate-400"
                      />
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-slate-700">{t.settings("apiKeyField")}</p>
                      <input
                        type="password"
                        value={selectedProvider.apiKey}
                        onChange={(event) =>
                          setProviderForms((current) =>
                            current.map((item) =>
                              item.id === selectedProvider.id
                                ? { ...item, apiKey: event.target.value }
                                : item,
                            ),
                          )
                        }
                        className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-4 text-[15px] text-slate-950 outline-none transition focus:border-slate-400"
                      />
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-slate-700">{t.settings("modelField")}</p>
                      <select
                        value={selectedProvider.defaultModel}
                        onChange={(event) =>
                          setProviderForms((current) =>
                            current.map((item) =>
                              item.id === selectedProvider.id
                                ? { ...item, defaultModel: event.target.value }
                                : item,
                            ),
                          )
                        }
                        className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-4 text-[15px] text-slate-950 outline-none transition focus:border-slate-400"
                      >
                        {providerModelOptions[selectedProvider.id].map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="flex items-center justify-between rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                        <span>{t.settings("toolCalling")}</span>
                        <ToggleSwitch
                          checked={selectedProvider.supportsToolCalling}
                          ariaLabel={t.settings("toolCalling")}
                          onChange={(checked) =>
                            setProviderForms((current) =>
                              current.map((item) =>
                                item.id === selectedProvider.id
                                  ? { ...item, supportsToolCalling: checked }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="flex items-center justify-between rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                        <span>{t.settings("streaming")}</span>
                        <ToggleSwitch
                          checked={selectedProvider.supportsStreaming}
                          ariaLabel={t.settings("streaming")}
                          onChange={(checked) =>
                            setProviderForms((current) =>
                              current.map((item) =>
                                item.id === selectedProvider.id
                                  ? { ...item, supportsStreaming: checked }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={() =>
                          updateProvider({
                            id: selectedProvider.id,
                            label: selectedProvider.label,
                            baseUrl: selectedProvider.baseUrl,
                            apiKey: selectedProvider.apiKey,
                            defaultModel: selectedProvider.defaultModel,
                            supportsToolCalling: selectedProvider.supportsToolCalling,
                            supportsStreaming: selectedProvider.supportsStreaming,
                            isActive: true,
                          })
                        }
                        className="rounded-full bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
                      >
                        {t.settings("saveAndUseProvider")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </SectionCard>
        </div>
      </div>
    </PageShell>
  );
}
