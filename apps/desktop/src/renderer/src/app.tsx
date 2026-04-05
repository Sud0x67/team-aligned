import { useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/app-shell";
import { AppErrorBoundary } from "./components/app-error-boundary";
import { DashboardPage } from "./pages/dashboard-page";
import { ExtensionsPage } from "./pages/extensions-page";
import { ManagePage } from "./pages/manage-page";
import { ChatPage } from "./pages/chat-page";
import { SettingsPage } from "./pages/settings-page";
import { createTranslator, resolvePreferredLanguage } from "./i18n";
import { useAppStore } from "./store/use-app-store";

function RouteTitleSync() {
  const location = useLocation();
  const settings = useAppStore((state) => state.settings);

  useEffect(() => {
    document.documentElement.lang = settings.language === "zh" ? "zh-CN" : "en";
    document.documentElement.dataset.theme = settings.theme;
    document.body.classList.toggle("dark", settings.theme === "dark");
    window.localStorage.setItem("teamaligned_ui_language", settings.language);
  }, [settings.language, settings.theme, location.pathname]);

  return null;
}

function AppRoutes() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/manage" element={<ManagePage />} />
        <Route path="/extensions" element={<ExtensionsPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  const bootstrap = useAppStore((state) => state.bootstrap);
  const applySnapshot = useAppStore((state) => state.applySnapshot);
  const bootstrapped = useAppStore((state) => state.bootstrapped);
  const language = useAppStore((state) => state.settings.language);
  const [startupError, setStartupError] = useState<string | null>(null);
  const startupLanguage = bootstrapped ? language : resolvePreferredLanguage();
  const startupT = createTranslator(startupLanguage);

  useEffect(() => {
    if (!window.teamaligned) {
      setStartupError(createTranslator(startupLanguage).startup("preloadMissing"));
      return;
    }

    let mounted = true;

    void bootstrap().catch((error) => {
      if (!mounted) return;
      setStartupError(error instanceof Error ? error.message : String(error));
    });

    const unsubscribe = window.teamaligned.subscribe((snapshot) => {
      applySnapshot(snapshot);
      if (mounted) {
        setStartupError(null);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [applySnapshot, bootstrap, startupLanguage]);

  if (startupError) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--background)] px-6 text-[var(--foreground)]">
        <div className="w-full max-w-[560px] rounded-[28px] border border-[var(--border)] bg-[var(--card)] p-8 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
            teamaligned
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{startupT.startup("startupFailed")}</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--muted-foreground)]">
            {startupT.startup("startupFailedDesc")}
          </p>
          <pre className="mt-5 overflow-x-auto rounded-2xl bg-[var(--muted)] px-4 py-3 text-xs leading-6 text-[var(--foreground)]">
            {startupError}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex items-center rounded-full bg-[var(--primary)] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          >
            {startupT.common("reload")}
          </button>
        </div>
      </div>
    );
  }

  if (!bootstrapped) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
        <div className="rounded-[28px] border border-[var(--border)] bg-[var(--card)] px-8 py-7 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--muted-foreground)]">
            teamaligned
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{startupT.startup("bootingTitle")}</h1>
          <p className="mt-2 text-sm leading-7 text-[var(--muted-foreground)]">
            {startupT.startup("bootingDesc")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <AppErrorBoundary language={language}>
      <HashRouter>
        <RouteTitleSync />
        <AppRoutes />
      </HashRouter>
    </AppErrorBoundary>
  );
}
