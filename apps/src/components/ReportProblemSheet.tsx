import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SUPPORT_EMAIL } from "../constants/links";
import { useBackClose } from "../hooks/useBackClose";
import { diagnosticsService } from "../services/diagnosticsService";
import { useAccountStore } from "../store/accountStore";
import { useLibraryStore } from "../store/libraryStore";
import { backdropClose } from "./ui/backdrop";
import { EYEBROW } from "./ui/SectionHeader";
import { SheetHandle } from "./ui/SheetHandle";
import { UiIcon } from "./UiIcon";

/** The longest message the server takes (`server/src/routes/problems.js`). */
const MESSAGE_MAX = 2000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The sheet's longer classes, kept here so its markup reads.
const BACKDROP =
  "sheet-backdrop fixed inset-0 z-[90] flex items-center justify-center bg-black/55 px-4 py-6";
const PANEL =
  "modal-surface sheet-panel flex max-h-full w-full max-w-lg flex-col overflow-y-auto p-6";
const SWITCH =
  "inset-field flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2.5 text-xs " +
  "text-on-surface";
const INFO =
  "touch-hit inline-flex shrink-0 items-center rounded-full p-1.5 text-on-surface-variant " +
  "hover:text-primary";
const REPORT =
  "selectable mt-2 max-h-56 overflow-auto whitespace-pre rounded-lg bg-surface-container-high/50 " +
  "p-3 font-mono text-[11px] leading-relaxed text-on-surface-variant";
const FAILED =
  "mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg " +
  "bg-surface-container-high/50 px-3 py-2 text-xs text-on-surface";
const SEND =
  "tactile-button tactile-button-primary px-4 py-2 text-xs font-semibold disabled:opacity-60";

type ReportProblemSheetProps = {
  open: boolean;
  onClose: () => void;
  showToast: (message: string) => void;
};

/**
 * Settings → "Report a problem": what happened, in the reader's words, sent
 * to the Leaflet server for the owner to read in the app's Admin section.
 * The diagnostics go with it unless switched off, and the (i) beside the
 * switch shows them exactly as they go. Signed out, an address for a reply
 * may be given; signed in, the account is who to answer.
 *
 * When it cannot be sent (no server in this build, offline, a server from
 * before reports, a limit reached) the sheet says why and offers the old way:
 * the words and the diagnostics on the clipboard, and a letter to support
 * opened in the mail app to paste them into.
 */
export const ReportProblemSheet = ({ open, onClose, showToast }: ReportProblemSheetProps) => {
  const signedIn = useAccountStore((state) => state.status.signedIn);
  const server = useLibraryStore((state) => Boolean(state.sync.apiBase));
  const [message, setMessage] = useState("");
  const [include, setInclude] = useState(true);
  const [contact, setContact] = useState("");
  const [report, setReport] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [badContact, setBadContact] = useState(false);

  useBackClose(open, onClose);
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    setMessage("");
    setInclude(true);
    setContact("");
    setShowReport(false);
    setFailed(null);
    setBadContact(false);
    setReport(null);
    let live = true;
    diagnosticsService
      .problemReport()
      .then((text) => live && setReport(text))
      .catch(() => live && setReport(""));
    // Capture phase, so nothing underneath sees the Escape.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const words = message.trim();
  const diagnostics = include && report ? report : null;
  // Only from a reader signed out, and only where it could be sent.
  const asksContact = server && !signedIn;

  const emailInstead = () => {
    const text = [`What happened:\n${words}`, diagnostics].filter(Boolean).join("\n\n");
    diagnosticsService
      .reportProblem(text)
      .then((opened) => {
        onClose();
        showToast(
          opened
            ? "Copied. Paste it into the email."
            : `Copied. Paste it into an email to ${SUPPORT_EMAIL}.`
        );
      })
      .catch(() => showToast("Couldn't copy the report."));
  };

  const send = () => {
    if (!server) {
      emailInstead();
      return;
    }
    const reply = asksContact ? contact.trim() : "";
    if (reply && !EMAIL.test(reply)) {
      setBadContact(true);
      return;
    }
    setBusy(true);
    setFailed(null);
    diagnosticsService
      .sendProblem({ message: words, diagnostics, contact: reply || null })
      .then(() => {
        onClose();
        showToast("Sent. Thank you.");
      })
      .catch((cause: unknown) => setFailed(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  return createPortal(
    <div className={BACKDROP} {...backdropClose(onClose)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="problem-title"
        className={PANEL}
      >
        <SheetHandle onClose={onClose} />
        <h2 id="problem-title" className="page-title text-2xl">
          Report a problem
        </h2>
        <label className="mt-4 block">
          <span className={EYEBROW}>What happened?</span>
          <textarea
            className="inset-field mt-1.5 w-full resize-none px-3 py-2 text-sm text-on-surface"
            rows={5}
            maxLength={MESSAGE_MAX}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={include}
            className={SWITCH}
            onClick={() => setInclude((on) => !on)}
          >
            <span className="font-semibold">Include diagnostics</span>
            <span
              aria-hidden
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                include ? "bg-primary" : "bg-surface-container-highest"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow ${
                  include ? "left-[18px]" : "left-0.5"
                } transition-[left]`}
              />
            </span>
          </button>
          <button
            type="button"
            className={INFO}
            aria-label="What the diagnostics say"
            aria-expanded={showReport}
            title="What the diagnostics say"
            onClick={() => setShowReport((shown) => !shown)}
          >
            <UiIcon name="info" size={14} />
          </button>
        </div>
        {showReport && (
          <pre
            aria-label="The diagnostics, as they are sent"
            className={REPORT}
          >
            {report ?? "…"}
          </pre>
        )}
        {asksContact && (
          <label className="mt-3 block">
            <span className={EYEBROW}>Email for a reply</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              className="inset-field mt-1.5 w-full px-3 py-2 text-sm text-on-surface"
              placeholder="Optional"
              maxLength={254}
              value={contact}
              onChange={(event) => {
                setContact(event.target.value);
                setBadContact(false);
              }}
            />
            {badContact && (
              <span role="alert" className="mt-1 block text-xs text-error">
                That email address doesn't look right.
              </span>
            )}
          </label>
        )}
        {failed && (
          <div
            role="alert"
            className={FAILED}
          >
            <span className="min-w-0 [overflow-wrap:anywhere]">{failed}</span>
            <button
              type="button"
              className="tactile-button px-3 py-1 text-xs"
              onClick={emailInstead}
            >
              Email it instead
            </button>
          </div>
        )}
        <div className="sheet-actions mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="tactile-button px-4 py-2 text-xs"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={SEND}
            onClick={send}
            disabled={busy || !words}
          >
            {busy ? "Sending…" : server ? "Send" : "Email it"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
