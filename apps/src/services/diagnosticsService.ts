import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * The app's side of diagnostics: errors from the interface go to the same log
 * file as the Rust side (`diag.rs`), and Settings can copy a report of it.
 *
 * The release build has no devtools console, so without this an error in the
 * interface leaves no trace at all.
 */

const MAX_PER_SESSION = 50;
let sent = 0;
let lastMessage = "";

const describe = (value: unknown): string => {
  if (value instanceof Error) {
    const stack = value.stack?.split("\n").slice(0, 6).join(" | ") ?? "";
    return `${value.name}: ${value.message}${stack ? ` | ${stack}` : ""}`;
  }
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const diagnosticsService = {
  /** Writes an error to the log. Repeats and floods are dropped. */
  logError(context: string, error: unknown) {
    if (!isTauri() || sent >= MAX_PER_SESSION) {
      return;
    }
    const message = `${context}: ${describe(error)}`.slice(0, 3000);
    if (message === lastMessage) {
      return;
    }
    lastMessage = message;
    sent += 1;
    void invoke("log_client_error", { message }).catch(() => undefined);
  },

  /** A plain-text report: versions, what is switched on, and the recent log. */
  async report(): Promise<string> {
    if (!isTauri()) {
      return `Leaflet (browser preview)\n${navigator.userAgent}`;
    }
    return invoke<string>("diagnostics");
  },

  /** Unhandled errors and rejections anywhere in the interface go to the log. */
  install() {
    window.addEventListener("error", (event) => {
      diagnosticsService.logError("unhandled error", event.error ?? event.message);
    });
    window.addEventListener("unhandledrejection", (event) => {
      diagnosticsService.logError("unhandled rejection", event.reason);
    });
  }
};
