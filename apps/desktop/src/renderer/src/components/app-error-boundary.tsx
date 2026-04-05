import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Component } from "react";
import type { AppLanguage } from "@shared";
import { createTranslator } from "../i18n";

type Props = {
  children: ReactNode;
  language: AppLanguage;
};

type State = {
  hasError: boolean;
  errorMessage: string | null;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    errorMessage: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message,
    };
  }

  componentDidCatch(error: Error) {
    console.error("Renderer crashed:", error);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const t = createTranslator(this.props.language);

    return (
      <div className="flex h-screen items-center justify-center bg-[var(--background)] px-6 text-[var(--foreground)]">
        <div className="w-full max-w-[560px] rounded-[28px] border border-[var(--border)] bg-[var(--card)] p-8 shadow-soft">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent)] text-[var(--primary)]">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
            teamaligned
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t.startup("renderFailed")}</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--muted-foreground)]">
            {t.startup("renderFailedDesc")}
          </p>
          {this.state.errorMessage ? (
            <pre className="mt-5 overflow-x-auto rounded-2xl bg-[var(--muted)] px-4 py-3 text-xs leading-6 text-[var(--foreground)]">
              {this.state.errorMessage}
            </pre>
          ) : null}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--primary)] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" />
            {t.common("reload")}
          </button>
        </div>
      </div>
    );
  }
}
