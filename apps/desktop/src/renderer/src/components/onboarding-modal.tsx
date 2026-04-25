import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Eye, EyeOff, Loader2, Sparkles } from "lucide-react";
import type { ProviderConfig, UserProfile } from "@shared";
import { createTranslator } from "../i18n";
import { useAppStore } from "../store/use-app-store";
import { AvatarPicker } from "./avatar-picker";

const demoApiKeys = new Set(["sk-qwen-demo-key", "sk-openai-demo-key"]);
const providerDisplayLabels: Record<ProviderConfig["id"], string> = {
  qwen: "百炼 (DashScope)",
  openai: "OpenAI",
};

function needsProfileSetup(profile: UserProfile) {
  return !profile.name.trim() || profile.name.trim() === "Alex Chen";
}

function needsProviderSetup(provider: ProviderConfig | null) {
  if (!provider) return true;
  return (
    !provider.baseUrl.trim() ||
    !/^https?:\/\//i.test(provider.baseUrl.trim()) ||
    !provider.defaultModel.trim() ||
    !provider.apiKey.trim() ||
    demoApiKeys.has(provider.apiKey.trim()) ||
    !provider.supportsToolCalling
  );
}

export function OnboardingModal() {
  const {
    profile,
    settings,
    providers,
    updateProfile,
    updateProvider,
    updateSettings,
    testProviderConnection,
  } = useAppStore();
  const t = createTranslator(settings.language);
  const [draftProfile, setDraftProfile] = useState(profile);
  const [providerForms, setProviderForms] = useState(providers);
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderConfig["id"]>(
    providers.find((provider) => provider.isActive)?.id ?? providers[0]?.id ?? "qwen",
  );
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    setDraftProfile(profile);
  }, [profile]);

  useEffect(() => {
    if (saving) return;
    setProviderForms(providers);
    setSelectedProviderId((current) => {
      if (providers.some((provider) => provider.id === current)) return current;
      return providers.find((provider) => provider.isActive)?.id ?? providers[0]?.id ?? "qwen";
    });
  }, [providers, saving]);

  const activeProvider = useMemo(
    () =>
      providers.find((provider) => provider.id === settings.activeProviderId) ??
      providers.find((provider) => provider.isActive) ??
      providers[0] ??
      null,
    [providers, settings.activeProviderId],
  );
  const selectedProvider =
    providerForms.find((provider) => provider.id === selectedProviderId) ?? providerForms[0] ?? null;
  const open =
    !settings.onboardingCompleted &&
    (needsProfileSetup(profile) || needsProviderSetup(activeProvider));

  const updateSelectedProvider = (patch: Partial<ProviderConfig>) => {
    if (!selectedProvider) return;
    setProviderForms((current) =>
      current.map((provider) =>
        provider.id === selectedProvider.id ? { ...provider, ...patch } : provider,
      ),
    );
  };

  const validate = () => {
    const issues: string[] = [];
    if (!draftProfile.name.trim()) {
      issues.push(t.onboarding("nameRequired"));
    }
    if (!selectedProvider) {
      issues.push(t.onboarding("providerRequired"));
      return issues;
    }
    if (!selectedProvider.baseUrl.trim()) {
      issues.push(t.onboarding("baseUrlRequired"));
    } else if (!/^https?:\/\//i.test(selectedProvider.baseUrl.trim())) {
      issues.push(t.onboarding("baseUrlInvalid"));
    }
    if (!selectedProvider.apiKey.trim() || demoApiKeys.has(selectedProvider.apiKey.trim())) {
      issues.push(
        selectedProvider.id === "qwen"
          ? t.onboarding("apiKeyRequiredQwen")
          : t.onboarding("apiKeyRequiredOpenAI"),
      );
    }
    if (!selectedProvider.defaultModel.trim()) {
      issues.push(t.onboarding("modelRequired"));
    }
    if (!selectedProvider.supportsToolCalling) {
      issues.push(t.onboarding("toolCallingRequired"));
    }
    return issues;
  };

  const showValidationIssues = (issues: string[]) => {
    setMessage({
      type: "error",
      text: `${t.onboarding("issueTitle")}\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
    });
  };

  const handleTestConnection = async () => {
    if (!selectedProvider || testing) return;
    const issues = validate();
    if (issues.length > 0) {
      showValidationIssues(issues);
      return;
    }

    setTesting(true);
    setMessage(null);
    try {
      const result = await testProviderConnection({
        id: selectedProvider.id,
        label: selectedProvider.label,
        baseUrl: selectedProvider.baseUrl.trim(),
        apiKey: selectedProvider.apiKey.trim(),
        defaultModel: selectedProvider.defaultModel.trim(),
        supportsToolCalling: selectedProvider.supportsToolCalling,
        supportsStreaming: selectedProvider.supportsStreaming,
      });
      setMessage({
        type: result.ok ? "success" : "error",
        text: `${result.ok ? t.onboarding("connectionOk") : t.onboarding("connectionFailed")}${
          result.latencyMs ? ` · ${t.onboarding("latency")} ${result.latencyMs}ms` : ""
        }\n${result.message}`,
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: `${t.onboarding("connectionFailed")}\n${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleFinish = async () => {
    if (!selectedProvider || saving) return;
    const issues = validate();
    if (issues.length > 0) {
      showValidationIssues(issues);
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await updateProfile({
        avatarPath: draftProfile.avatarPath,
        name: draftProfile.name.trim(),
        bio: draftProfile.bio.trim(),
      });
      await updateProvider({
        id: selectedProvider.id,
        label: selectedProvider.label,
        baseUrl: selectedProvider.baseUrl.trim(),
        apiKey: selectedProvider.apiKey.trim(),
        defaultModel: selectedProvider.defaultModel.trim(),
        supportsToolCalling: selectedProvider.supportsToolCalling,
        supportsStreaming: selectedProvider.supportsStreaming,
        isActive: true,
      });
      await updateSettings({
        activeProviderId: selectedProvider.id,
        onboardingCompleted: true,
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: `${t.onboarding("connectionFailed")}\n${error instanceof Error ? error.message : String(error)}`,
      });
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-sm">
      <div className="max-h-full w-full max-w-4xl overflow-y-auto rounded-[32px] border border-[var(--border)] bg-[var(--card)] shadow-2xl">
        <div className="border-b border-[var(--border)] px-7 py-6">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-[var(--primary)]">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
                teamaligned
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
                {t.onboarding("title")}
              </h2>
              <p className="mt-2 text-sm leading-7 text-[var(--muted-foreground)]">
                {t.onboarding("subtitle")}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 px-7 py-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-[28px] border border-[var(--border)] bg-[var(--panel)] p-5">
            <h3 className="text-base font-semibold text-[var(--foreground)]">
              {t.onboarding("profileTitle")}
            </h3>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              {t.onboarding("profileDesc")}
            </p>

            <div className="mt-5 space-y-4">
              <AvatarPicker
                label={t.profile("avatar")}
                value={draftProfile.avatarPath}
                fallback={draftProfile.name.slice(0, 1).toUpperCase() || "A"}
                color="var(--primary)"
                uploadLabel={draftProfile.avatarPath ? t.common("changeAvatar") : t.common("uploadAvatar")}
                removeLabel={t.common("removeAvatar")}
                scope="profile"
                fileNameHint={draftProfile.name || "profile"}
                onChange={(avatarPath) =>
                  setDraftProfile((current) => ({ ...current, avatarPath }))
                }
              />

              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--muted-foreground)]">
                  {t.onboarding("name")}
                </span>
                <input
                  value={draftProfile.name}
                  onChange={(event) =>
                    setDraftProfile((current) => ({ ...current, name: event.target.value }))
                  }
                  className="input"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--muted-foreground)]">
                  {t.onboarding("bio")}
                </span>
                <textarea
                  value={draftProfile.bio}
                  onChange={(event) =>
                    setDraftProfile((current) => ({ ...current, bio: event.target.value }))
                  }
                  className="input min-h-[120px] resize-none"
                />
              </label>
            </div>
          </section>

          <section className="rounded-[28px] border border-[var(--border)] bg-[var(--panel)] p-5">
            <h3 className="text-base font-semibold text-[var(--foreground)]">
              {t.onboarding("providerTitle")}
            </h3>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              {t.onboarding("providerDesc")}
            </p>

            {selectedProvider ? (
              <div className="mt-5 grid gap-4">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-[var(--muted-foreground)]">
                    {t.onboarding("provider")}
                  </span>
                  <select
                    value={selectedProvider.id}
                    onChange={(event) => setSelectedProviderId(event.target.value as ProviderConfig["id"])}
                    className="input"
                  >
                    {providerForms.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {providerDisplayLabels[provider.id]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-[var(--muted-foreground)]">
                    {t.onboarding("baseUrl")}
                  </span>
                  <input
                    value={selectedProvider.baseUrl}
                    onChange={(event) => updateSelectedProvider({ baseUrl: event.target.value })}
                    className="input"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-[var(--muted-foreground)]">
                    {t.onboarding("apiKey")}
                  </span>
                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={selectedProvider.apiKey}
                      onChange={(event) => updateSelectedProvider({ apiKey: event.target.value })}
                      className="input pr-14"
                    />
                    <button
                      type="button"
                      aria-label={showApiKey ? t.onboarding("hideApiKey") : t.onboarding("showApiKey")}
                      onClick={() => setShowApiKey((current) => !current)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-[var(--muted-foreground)]">
                    {t.onboarding("model")}
                  </span>
                  <input
                    value={selectedProvider.defaultModel}
                    onChange={(event) => updateSelectedProvider({ defaultModel: event.target.value })}
                    className="input"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--panel-muted)] px-4 py-3 text-sm text-[var(--foreground)]">
                    <span>{t.onboarding("toolCalling")}</span>
                    <input
                      type="checkbox"
                      checked={selectedProvider.supportsToolCalling}
                      onChange={(event) =>
                        updateSelectedProvider({ supportsToolCalling: event.target.checked })
                      }
                      className="h-4 w-4 accent-[var(--primary)]"
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--panel-muted)] px-4 py-3 text-sm text-[var(--foreground)]">
                    <span>{t.onboarding("streaming")}</span>
                    <input
                      type="checkbox"
                      checked={selectedProvider.supportsStreaming}
                      onChange={(event) =>
                        updateSelectedProvider({ supportsStreaming: event.target.checked })
                      }
                      className="h-4 w-4 accent-[var(--primary)]"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleTestConnection()}
                    disabled={testing || saving}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel-muted)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[color-mix(in_srgb,var(--primary)_24%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {testing ? t.onboarding("testingConnection") : t.onboarding("testConnection")}
                  </button>
                  {message ? (
                    <div
                      className={`min-w-0 flex-1 rounded-2xl border px-4 py-3 text-sm leading-6 ${
                        message.type === "success"
                          ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700"
                          : "border-rose-500/20 bg-rose-500/5 text-rose-700"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {message.type === "success" ? (
                          <Check className="mt-0.5 h-4 w-4 shrink-0" />
                        ) : (
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        )}
                        <p className="whitespace-pre-wrap">{message.text}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <div className="flex items-center justify-end border-t border-[var(--border)] px-7 py-5">
          <button
            type="button"
            onClick={() => void handleFinish()}
            disabled={saving || testing}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--primary)] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? t.onboarding("finishing") : t.onboarding("finish")}
          </button>
        </div>
      </div>
    </div>
  );
}
