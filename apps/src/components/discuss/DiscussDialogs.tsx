import { useEffect, useState } from "react";
import { discussService, type ReportReason } from "../../services/discussService";
import { errorText } from "../community/format";
import { useDiscussStore } from "./discussStore";
import { CONSEQUENCES, GUIDELINES, REPORT_REASONS } from "./guidelines";

/** Escape closes the dialog on top and nothing under it. */
const useEscape = (open: boolean, close: () => void) => {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);
};

/**
 * The community guidelines, shown the first time a reader goes to post where
 * everyone can read, start or join a community: five rules, and what happens
 * to what breaks them. Accepting is remembered on the account.
 */
const RulesDialog = () => {
  const asked = useDiscussStore((state) => state.rulesAsked);
  const answer = useDiscussStore((state) => state.answerRules);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decline = () => void answer(false);
  useEscape(asked !== null, decline);
  if (!asked) {
    return null;
  }
  const accept = () => {
    setBusy(true);
    setError(null);
    answer(true)
      .catch((cause) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 px-4 py-6">
      <div className="modal-surface flex max-h-full w-full max-w-lg flex-col overflow-y-auto p-6" role="dialog" aria-modal="true" aria-labelledby="rules-title">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Before you post for everyone</p>
        <h2 id="rules-title" className="page-title mt-1 text-2xl">
          Community guidelines
        </h2>
        <ol className="mt-4 flex flex-col gap-3">
          {GUIDELINES.map((entry, index) => (
            <li key={entry.rule} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{index + 1}</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-on-surface">{entry.rule}</span>
                <span className="block text-xs leading-5 text-on-surface-variant">{entry.more}</span>
              </span>
            </li>
          ))}
        </ol>
        <ul className="mt-4 flex flex-col gap-1 border-t border-outline-variant/30 pt-3 text-xs leading-5 text-on-surface-variant">
          {CONSEQUENCES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {error && <p className="mt-3 rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-surface">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="tactile-button px-4 py-2 text-xs" onClick={decline} disabled={busy}>
            Not now
          </button>
          <button type="button" className="tactile-button tactile-button-primary px-4 py-2 text-xs font-semibold disabled:opacity-60" onClick={accept} disabled={busy}>
            {busy ? "…" : "I agree"}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Reporting a post, a thread, a reply, a community or a reader: why, and a line if there is more to say. */
const ReportDialog = ({ showToast }: { showToast: (message: string) => void }) => {
  const reporting = useDiscussStore((state) => state.reporting);
  const close = useDiscussStore((state) => state.closeReport);
  const [reason, setReason] = useState<ReportReason>("spam");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(reporting !== null, close);
  useEffect(() => {
    setReason("spam");
    setNote("");
    setError(null);
  }, [reporting]);
  if (!reporting) {
    return null;
  }
  const send = () => {
    setBusy(true);
    setError(null);
    discussService
      .report(reporting.target, reporting.id, reason, note.trim() || null)
      .then(() => {
        close();
        showToast("Reported. Thank you: it will be looked at.");
      })
      .catch((cause) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };
  // A spoiler is a thread's or a post's fault, never a reader's or a community's.
  const reasons = REPORT_REASONS.filter((entry) => entry.id !== "spoiler" || reporting.target === "thread" || reporting.target === "post" || reporting.target === "reply");
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 px-4 py-6" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="modal-surface w-full max-w-md p-6" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <h2 id="report-title" className="page-title text-2xl">
          Report {reporting.what}
        </h2>
        <div className="mt-4 flex flex-col gap-1.5" role="radiogroup" aria-label="What is wrong with it">
          {reasons.map((entry) => (
            <label key={entry.id} className="flex cursor-pointer items-center gap-2 text-sm text-on-surface">
              <input type="radio" name="report-reason" className="accent-[rgb(var(--color-primary))]" checked={reason === entry.id} onChange={() => setReason(entry.id)} />
              {entry.label}
            </label>
          ))}
        </div>
        <textarea
          className="inset-field mt-3 w-full resize-none px-3 py-2 text-sm text-on-surface"
          rows={2}
          maxLength={280}
          placeholder="Anything to add (optional)"
          aria-label="Anything to add"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {error && <p className="mt-2 rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-surface">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="tactile-button px-4 py-2 text-xs" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="tactile-button tactile-button-primary px-4 py-2 text-xs font-semibold disabled:opacity-60" onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Report"}
          </button>
        </div>
      </div>
    </div>
  );
};

/** The two dialogs of the public community, mounted once at the top of the app. */
export const DiscussDialogs = ({ showToast }: { showToast: (message: string) => void }) => (
  <>
    <RulesDialog />
    <ReportDialog showToast={showToast} />
  </>
);
