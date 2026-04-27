import type { RendererErrorReport } from "@shared";

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  return {
    message: String(error),
    stack: null,
  };
}

export function reportRendererError(
  source: string,
  error: unknown,
  metadata: Record<string, unknown> | null = null,
) {
  const serialized = serializeError(error);
  const payload: RendererErrorReport = {
    source,
    message: serialized.message,
    stack: serialized.stack,
    url: window.location.href,
    userAgent: navigator.userAgent,
    metadata,
    createdAt: Date.now(),
  };

  try {
    void window.teamaligned?.reportRendererError?.(payload).catch(() => {
      // Keep the UI alive even if diagnostics IPC is unavailable.
    });
  } catch {
    // The reporter itself must never become the crash source.
  }
}

export function installRendererErrorReporting() {
  window.addEventListener("error", (event) => {
    reportRendererError("renderer:window-error", event.error ?? event.message, {
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportRendererError("renderer:unhandled-rejection", event.reason);
  });
}
