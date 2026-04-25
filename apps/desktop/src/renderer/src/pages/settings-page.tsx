import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Check,
  Circle,
  CircleDot,
  Eye,
  EyeOff,
  ExternalLink,
  Languages,
  AlertCircle,
  LoaderCircle,
  MoonStar,
  SunMedium,
} from "lucide-react";
import { useAppStore } from "../store/use-app-store";
import { createTranslator } from "../i18n";
import { PageShell } from "../components/pages/page-shell";
import { SectionCard } from "../components/pages/section-card";

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
          ? "border-[var(--primary)] bg-[var(--accent)] text-[var(--foreground)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_12%,transparent)]"
          : "border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)] hover:border-[color-mix(in_srgb,var(--primary)_18%,var(--border))] hover:bg-[var(--panel-muted)]"
      }`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`mt-0.5 shrink-0 ${
            selected ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"
          }`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {selected ? (
              <CircleDot className="h-5 w-5 text-[var(--primary)]" />
            ) : (
              <Circle className="h-5 w-5 text-[var(--muted-foreground)]" />
            )}
            <p className="text-[15px] font-semibold">{title}</p>
          </div>
          {description ? (
            <p className="mt-2 pl-8 text-sm leading-6 text-[var(--muted-foreground)]">{description}</p>
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
      <span className="h-7 w-12 rounded-full border border-[var(--border)] bg-[var(--muted)] transition peer-checked:border-[color-mix(in_srgb,var(--primary)_30%,transparent)] peer-checked:bg-[var(--primary)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-[color-mix(in_srgb,var(--primary)_35%,transparent)]" />
      <span className="pointer-events-none absolute left-1 top-1 h-5 w-5 rounded-full border border-[var(--border)] bg-[var(--card)] shadow-sm transition peer-checked:translate-x-5 peer-checked:border-transparent" />
    </label>
  );
}

export function SettingsPage() {
  const { settings, providers, updateSettings, updateProvider, testProviderConnection } = useAppStore();
  const t = createTranslator(settings.language);
  const getProviderDisplayLabel = (providerId: string) =>
    providerId === "qwen" ? t.settings("providerQwenDisplay") : "OpenAI";

  const [providerForms, setProviderForms] = useState(providers);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [testState, setTestState] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [providerMessage, setProviderMessage] = useState<string | null>(null);
  const [notificationHelpMessage, setNotificationHelpMessage] = useState<string | null>(null);
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

  useEffect(() => {
    setShowApiKey(false);
    setProviderMessage(null);
    setTestState("idle");
    setSaveState("idle");
  }, [selectedProviderId]);

  useEffect(() => {
    if (saveState !== "saved") return;

    const timeoutId = window.setTimeout(() => {
      setSaveState("idle");
    }, 1600);

    return () => window.clearTimeout(timeoutId);
  }, [saveState]);

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

  const providerValidationIssues = selectedProvider
    ? [
        !selectedProvider.baseUrl.trim() ? t.settings("validationBaseUrlRequired") : null,
        selectedProvider.baseUrl.trim() &&
        !/^https?:\/\//i.test(selectedProvider.baseUrl.trim())
          ? t.settings("validationBaseUrlInvalid")
          : null,
        !selectedProvider.defaultModel.trim() ? t.settings("validationModelRequired") : null,
        !selectedProvider.apiKey.trim() ||
        selectedProvider.apiKey === "sk-qwen-demo-key" ||
        selectedProvider.apiKey === "sk-openai-demo-key"
          ? selectedProvider?.id === "qwen"
            ? t.settings("validationApiKeyRequiredQwen")
            : t.settings("validationApiKeyRequiredOpenAI")
          : null,
        !selectedProvider.supportsToolCalling ? t.settings("validationToolCallingRequired") : null,
      ].filter(Boolean) as string[]
    : [];

  const runProviderTest = async () => {
    if (!selectedProvider) return false;
    if (providerValidationIssues.length > 0) {
      setProviderMessage(
        `${t.settings("providerValidationTitle")}\n${providerValidationIssues.map((issue) => `- ${issue}`).join("\n")}`,
      );
      setTestState("error");
      return false;
    }

    setTestState("testing");
    setProviderMessage(null);
    const result = await testProviderConnection({
      id: selectedProvider.id,
      label: selectedProvider.label,
      baseUrl: selectedProvider.baseUrl,
      apiKey: selectedProvider.apiKey,
      defaultModel: selectedProvider.defaultModel,
      supportsToolCalling: selectedProvider.supportsToolCalling,
      supportsStreaming: selectedProvider.supportsStreaming,
    });
    setTestState(result.ok ? "success" : "error");
    setProviderMessage(
      `${result.ok ? t.settings("providerConnectionOk") : t.settings("providerConnectionFailed")}${
        result.latencyMs ? ` · ${t.settings("providerLatency")} ${result.latencyMs}ms` : ""
      }\n${result.message}`,
    );
    return result.ok;
  };

  const handleSaveProvider = async () => {
    if (!selectedProvider || saveState === "saving") return;
    if (providerValidationIssues.length > 0) {
      setProviderMessage(
        `${t.settings("providerValidationTitle")}\n${providerValidationIssues.map((issue) => `- ${issue}`).join("\n")}`,
      );
      setTestState("error");
      return;
    }

    setSaveState("saving");
    setProviderMessage(null);
    try {
      await updateProvider({
        id: selectedProvider.id,
        label: selectedProvider.label,
        baseUrl: selectedProvider.baseUrl,
        apiKey: selectedProvider.apiKey,
        defaultModel: selectedProvider.defaultModel,
        supportsToolCalling: selectedProvider.supportsToolCalling,
        supportsStreaming: selectedProvider.supportsStreaming,
        isActive: true,
      });
      setSaveState("saved");
      setTestState("success");
      setProviderMessage(`${t.settings("providerConnectionOk")}\n${t.settings("providerSaved")}`);
    } catch (error) {
      setSaveState("idle");
      setTestState("error");
      setProviderMessage(
        `${t.settings("providerConnectionFailed")}\n${
          error instanceof Error ? error.message : t.settings("saveFailedFallback")
        }`,
      );
    }
  };

  const handleOpenNotificationSettings = async () => {
    const ok = await window.teamaligned.openNotificationSettings();
    setNotificationHelpMessage(
      ok ? t.settings("systemNotificationOpened") : t.settings("systemNotificationOpenFailed"),
    );
  };

  return (
    <PageShell title={t.settings("title")} showHeader={false}>
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
                  className="flex items-center justify-between gap-4 rounded-[24px] border border-[var(--border)] bg-[var(--panel)] px-4 py-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">{item.title}</p>
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

              <div className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] px-4 py-4">
                <p className="text-sm leading-7 text-[var(--muted-foreground)]">
                  {t.settings("systemNotificationHelp")}
                </p>
                <button
                  type="button"
                  onClick={handleOpenNotificationSettings}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  <ExternalLink className="h-4 w-4" />
                  {t.settings("openSystemNotificationSettings")}
                </button>
                {notificationHelpMessage ? (
                  <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                    {notificationHelpMessage}
                  </p>
                ) : null}
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title={t.settings("modelConfig")}>
            {selectedProvider ? (
              <div className="space-y-4">
                <div className="rounded-[28px] border border-[var(--border)] bg-[var(--panel)] p-4">
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-[var(--muted-foreground)]">{t.settings("providerPicker")}</p>
                      <select
                        value={selectedProviderId}
                        onChange={(event) => setSelectedProviderId(event.target.value)}
                        className="w-full rounded-[22px] border border-[var(--border)] bg-[var(--panel-muted)] px-5 py-3.5 text-[15px] text-[var(--foreground)] outline-none transition focus:border-[color-mix(in_srgb,var(--primary)_35%,transparent)]"
                      >
                        {providerForms.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {getProviderDisplayLabel(provider.id)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-[var(--muted-foreground)]">{t.settings("baseUrlField")}</p>
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
                        className="w-full rounded-[22px] border border-[var(--border)] bg-[var(--panel-muted)] px-5 py-3.5 text-[15px] text-[var(--foreground)] outline-none transition focus:border-[color-mix(in_srgb,var(--primary)_35%,transparent)]"
                      />
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-[var(--muted-foreground)]">{t.settings("apiKeyField")}</p>
                      <div className="relative">
                        <input
                          type={showApiKey ? "text" : "password"}
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
                          className="w-full rounded-[22px] border border-[var(--border)] bg-[var(--panel-muted)] px-5 py-3.5 pr-14 text-[15px] text-[var(--foreground)] outline-none transition focus:border-[color-mix(in_srgb,var(--primary)_35%,transparent)]"
                        />
                        <button
                          type="button"
                          aria-label={showApiKey ? t.settings("hideApiKey") : t.settings("showApiKey")}
                          onClick={() => setShowApiKey((current) => !current)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                        >
                          {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-[var(--muted-foreground)]">{t.settings("modelField")}</p>
                      <input
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
                        className="w-full rounded-[22px] border border-[var(--border)] bg-[var(--panel-muted)] px-5 py-3.5 text-[15px] text-[var(--foreground)] outline-none transition focus:border-[color-mix(in_srgb,var(--primary)_35%,transparent)]"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="flex items-center justify-between rounded-[22px] border border-[var(--border)] bg-[var(--panel-muted)] px-4 py-2.5 text-sm text-[var(--foreground)]">
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
                      <label className="flex items-center justify-between rounded-[22px] border border-[var(--border)] bg-[var(--panel-muted)] px-4 py-2.5 text-sm text-[var(--foreground)]">
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
                        onClick={() => void runProviderTest()}
                        disabled={testState === "testing" || saveState === "saving"}
                        className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel-muted)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[color-mix(in_srgb,var(--primary)_24%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {testState === "testing" ? (
                          <>
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                            {t.settings("testingProvider")}
                          </>
                        ) : (
                          t.settings("testProvider")
                        )}
                      </button>
                      <button
                        onClick={() => void handleSaveProvider()}
                        disabled={saveState === "saving"}
                        className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white transition-all duration-300 ${
                          saveState === "saved"
                            ? "scale-[1.02] bg-[var(--success)] shadow-[0_10px_24px_rgba(16,185,129,0.24)]"
                            : "bg-[var(--primary)] hover:opacity-90"
                        } disabled:cursor-not-allowed disabled:opacity-80`}
                      >
                        {saveState === "saving" ? (
                          <>
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                            {t.settings("savingProvider")}
                          </>
                        ) : saveState === "saved" ? (
                          <>
                            <Check className="h-4 w-4" />
                            {t.settings("providerSaved")}
                          </>
                        ) : (
                          t.settings("saveAndUseProvider")
                        )}
                      </button>
                    </div>

                    <div className="min-h-[112px]">
                      {providerMessage ? (
                        <div
                          className={`max-h-[148px] overflow-y-auto rounded-[20px] border px-4 py-3 text-sm leading-7 ${
                            testState === "success"
                              ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700"
                              : "border-rose-500/20 bg-rose-500/5 text-rose-700"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {testState === "success" ? (
                              <Check className="mt-0.5 h-4 w-4 shrink-0" />
                            ) : (
                              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            )}
                            <p className="whitespace-pre-wrap">{providerMessage}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="h-full rounded-[20px] border border-dashed border-transparent px-4 py-3" />
                      )}
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
