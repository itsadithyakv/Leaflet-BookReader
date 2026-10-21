import { invoke, isTauri } from "@tauri-apps/api/core";
import { SUPPORT_EMAIL } from "../constants/links";

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

/** What "Report a problem" sends. */
export type ProblemReport = {
  message: string;
  diagnostics: string | null;
  contact: string | null;
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

  /**
   * "Report a problem": the report onto the clipboard, then a letter to
   * support opened in the mail app (`report_problem`) to paste it into. Never
   * in the letter itself: a mail link holds only so much, and the report is
   * the reader's to look over first. `text` goes on the clipboard in place of
   * the report (the sheet's words and its diagnostics, when sending them to
   * the server failed). Resolves whether the mail app opened; rejects only
   * when nothing could be copied.
   */
  async reportProblem(text?: string): Promise<boolean> {
    await navigator.clipboard.writeText(text ?? (await diagnosticsService.report()));
    try {
      if (isTauri()) {
        await invoke("report_problem");
      } else {
        window.open(`mailto:${SUPPORT_EMAIL}`, "_blank", "noopener,noreferrer");
      }
      return true;
    } catch {
      return false;
    }
  },

  /**
   * The diagnostics exactly as a problem report sends them
   * (`problem_diagnostics`): the report, cut to what the server takes.
   */
  async problemReport(): Promise<string> {
    if (!isTauri()) {
      return diagnosticsService.report();
    }
    return invoke<string>("problem_diagnostics");
  },

  /**
   * Sends a problem report to the Leaflet server (`send_problem`), signed in
   * or not. `diagnostics` is what the sheet showed, or null when left out;
   * `contact` an address for a reply, counted only when signed out. Rejects
   * with a sentence when it could not be sent (no server, offline, a server
   * too old for it, a limit), and the sheet then offers email instead.
   */
  async sendProblem(problem: ProblemReport): Promise<void> {
    if (!isTauri()) {
      throw new Error("Sending a report needs the app.");
    }
    try {
      await invoke("send_problem", { ...problem });
    } catch (cause) {
      throw cause instanceof Error ? cause : new Error(String(cause));
    }
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
