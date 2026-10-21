import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBackClose } from "../../hooks/useBackClose";
import {
  discussService,
  type Problem,
  type ProblemRow,
  type ProblemStatus
} from "../../services/discussService";
import { askConfirm } from "../ConfirmDialog";
import { ErrorLine } from "../community/ErrorLine";
import { at, errorText, relativeTime } from "../community/format";
import { backdropClose } from "../ui/backdrop";
import { SectionHeader } from "../ui/SectionHeader";
import { SegmentedTabs, type SegmentedTab } from "../ui/SegmentedTabs";
import { SheetHandle } from "../ui/SheetHandle";
import { UiIcon } from "../UiIcon";

const STATUSES: SegmentedTab<ProblemStatus>[] = [
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" }
];
const PLATFORM: Record<string, string> = {
  windows: "Windows",
  android: "Android",
  macos: "macOS",
  linux: "Linux"
};
const NOTE_MAX = 500;
/** What a list row learns from the report saved in its sheet. */
const pick = ({ status, note }: Problem) => ({ status, note });

/** Who sent it: their handle, the address they left, or neither. */
export const sender = (problem: Pick<ProblemRow, "handle" | "contact" | "signedIn">) => {
  if (problem.handle) return at(problem.handle);
  return problem.contact ?? (problem.signedIn ? "a reader" : "signed out");
};

const PREVIEW = "line-clamp-2 block text-sm text-on-surface [overflow-wrap:anywhere]";
const MESSAGE =
  "selectable mt-4 whitespace-pre-line text-sm text-on-surface [overflow-wrap:anywhere]";
const ROW =
  "w-full rounded-xl border border-outline-variant/30 p-3 text-left transition " +
  "hover:border-primary/40 focus-visible:border-primary/60";
const BACKDROP =
  "sheet-backdrop fixed inset-0 z-[85] flex items-center justify-center bg-black/55 px-4 py-6";
const PANEL =
  "modal-surface sheet-panel flex max-h-full w-full max-w-2xl flex-col overflow-y-auto p-6";
const DIAGNOSTICS =
  "selectable mt-2 max-h-72 overflow-auto whitespace-pre rounded-lg bg-surface-container-high/50 " +
  "p-3 font-mono text-[11px] leading-relaxed text-on-surface-variant";
const SHUT =
  "touch-hit absolute right-4 top-4 rounded-full px-2 py-1 text-on-surface-variant " +
  "hover:text-on-surface";
const PRIMARY =
  "tactile-button tactile-button-primary px-4 py-2 text-xs font-semibold disabled:opacity-60";

/**
 * What readers said went wrong with Leaflet (Settings → Report a problem),
 * for the owner: open or closed, the newest first, fifty at a time. Each
 * opens whole in a sheet, to be noted, closed, reopened or deleted.
 */
export const ProblemsPanel = ({ showToast }: { showToast: (message: string) => void }) => {
  const [status, setStatus] = useState<ProblemStatus>("open");
  const [rows, setRows] = useState<ProblemRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const asked = useRef(0);

  const load = useCallback(() => {
    const round = (asked.current += 1);
    setRows(null);
    setError(null);
    discussService
      .problems(status)
      .then((page) => {
        if (round !== asked.current) return;
        setRows(page.problems);
        setMore(page.more);
      })
      .catch((cause) => round === asked.current && setError(errorText(cause)));
  }, [status]);
  useEffect(load, [load]);

  const loadMore = () => {
    const last = rows?.[rows.length - 1];
    if (!last) return;
    const round = asked.current;
    setLoadingMore(true);
    discussService
      .problems(status, last.id)
      .then((page) => {
        if (round !== asked.current) return;
        setRows((shown) => [...(shown ?? []), ...page.problems]);
        setMore(page.more);
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setLoadingMore(false));
  };

  // A report closed or reopened leaves this list; one only noted stays in it.
  const changed = (problem: Problem) =>
    setRows((shown) =>
      (shown ?? [])
        .map((row) => (row.id === problem.id ? { ...row, ...pick(problem) } : row))
        .filter((row) => row.status === status)
    );
  const deleted = (id: string) => setRows((shown) => (shown ?? []).filter((row) => row.id !== id));

  return (
    <section className="paper-surface rounded-xl p-4 sm:p-6" aria-labelledby="problems-title">
      <SectionHeader
        eyebrow="Only you see this"
        title={`Problems${rows ? ` ${rows.length}${more ? "+" : ""}` : ""}`}
        id="problems-title"
        actions={
          <SegmentedTabs
            label="Which problems"
            idPrefix="problems"
            tabs={STATUSES}
            value={status}
            onChange={setStatus}
          />
        }
      />
      {error ? (
        <ErrorLine message={error} onRetry={load} />
      ) : rows === null ? (
        <p className="mt-4 text-sm text-on-surface-variant">Looking…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-on-surface-variant">
          {status === "open" ? "Nothing waiting." : "Nothing closed."}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" className={ROW} onClick={() => setOpened(row.id)}>
                <span className={PREVIEW}>
                  {row.preview}
                  {row.cut ? "…" : ""}
                </span>
                <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-on-surface-variant">
                  <span>
                    {row.version} · {PLATFORM[row.platform] ?? row.platform}
                  </span>
                  <span>· {sender(row)}</span>
                  <span>· {relativeTime(row.at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows && more && (
        <button
          type="button"
          className="tactile-button mt-3 px-3 py-1.5 text-xs disabled:opacity-60"
          disabled={loadingMore}
          onClick={loadMore}
        >
          {loadingMore ? "Looking…" : "More"}
        </button>
      )}
      {opened && (
        <ProblemSheet
          id={opened}
          onClose={() => setOpened(null)}
          onChanged={changed}
          onDeleted={deleted}
          showToast={showToast}
        />
      )}
    </section>
  );
};

type ProblemSheetProps = {
  id: string;
  onClose: () => void;
  onChanged: (problem: Problem) => void;
  onDeleted: (id: string) => void;
  showToast: (message: string) => void;
};

/** One problem report, whole: the words, the diagnostics to copy, a note, what to do with it. */
const ProblemSheet = ({ id, onClose, onChanged, onDeleted, showToast }: ProblemSheetProps) => {
  const [problem, setProblem] = useState<Problem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // While Delete asks to be sure, Escape is that question's, not the sheet's.
  const confirming = useRef(false);

  useBackClose(true, onClose);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirming.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const open = useCallback(() => {
    setError(null);
    discussService
      .problem(id)
      .then((found) => {
        setProblem(found);
        setNote(found.note ?? "");
      })
      .catch((cause) => setError(errorText(cause)));
  }, [id]);
  useEffect(open, [open]);

  const save = (status: ProblemStatus) => {
    setBusy(true);
    discussService
      .updateProblem(id, status, note.trim())
      .then((saved) => {
        setProblem(saved);
        setNote(saved.note ?? "");
        onChanged(saved);
        if (saved.status === problem?.status) showToast("Note saved.");
        else showToast(saved.status === "closed" ? "Closed." : "Reopened.");
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const remove = async () => {
    confirming.current = true;
    const ok = await askConfirm({
      title: "Delete this report?",
      body: "It is gone for good, diagnostics and all.",
      confirmLabel: "Delete",
      danger: true
    }).finally(() => {
      confirming.current = false;
    });
    if (!ok) return;
    setBusy(true);
    discussService
      .deleteProblem(id)
      .then(() => {
        onDeleted(id);
        onClose();
        showToast("Deleted.");
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const copy = (text: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => showToast("Diagnostics copied."))
      .catch(() => showToast("Couldn't copy the diagnostics."));

  const noted = note.trim() !== (problem?.note ?? "");

  return createPortal(
    <div className={BACKDROP} {...backdropClose(onClose)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="problem-detail-title"
        className={`relative ${PANEL}`}
      >
        <SheetHandle onClose={onClose} />
        <button
          type="button"
          className={SHUT}
          onClick={onClose}
          aria-label="Close"
        >
          <UiIcon name="close" size={16} />
        </button>
        <h2 id="problem-detail-title" className="page-title text-2xl">
          {problem?.status === "closed" ? "Closed problem" : "Problem"}
        </h2>
        {error ? (
          <ErrorLine message={error} onRetry={open} />
        ) : !problem ? (
          <p className="mt-4 text-sm text-on-surface-variant">Looking…</p>
        ) : (
          <>
            <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-on-surface-variant">
              <span>
                Leaflet {problem.version} · {PLATFORM[problem.platform] ?? problem.platform}
              </span>
              <span className="selectable">· {sender(problem)}</span>
              <span title={new Date(problem.at).toLocaleString()}>
                · {relativeTime(problem.at)}
              </span>
            </p>
            <p className={MESSAGE}>
              {problem.message}
            </p>
            {problem.diagnostics ? (
              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-on-surface-variant">
                    Diagnostics
                  </span>
                  <button
                    type="button"
                    className="tactile-button px-3 py-1 text-xs"
                    onClick={() => void copy(problem.diagnostics!)}
                  >
                    Copy
                  </button>
                </div>
                <pre aria-label="Diagnostics" className={DIAGNOSTICS}>
                  {problem.diagnostics}
                </pre>
              </div>
            ) : (
              <p className="mt-4 text-xs text-on-surface-variant">No diagnostics.</p>
            )}
            <textarea
              className="inset-field mt-4 w-full resize-none px-3 py-2 text-sm text-on-surface"
              rows={2}
              maxLength={NOTE_MAX}
              placeholder="A note for yourself (optional)"
              aria-label="Note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </>
        )}
        <div className="sheet-actions mt-5 flex flex-wrap justify-end gap-2">
          {problem && (
            <button
              type="button"
              className="tactile-button mr-auto px-4 py-2 text-xs text-error disabled:opacity-60"
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete
            </button>
          )}
          {problem && noted && (
            <button
              type="button"
              className="tactile-button px-4 py-2 text-xs disabled:opacity-60"
              disabled={busy}
              onClick={() => save(problem.status)}
            >
              Save note
            </button>
          )}
          {problem && (
            <button
              type="button"
              className={PRIMARY}
              disabled={busy}
              onClick={() => save(problem.status === "open" ? "closed" : "open")}
            >
              {problem.status === "open" ? "Close report" : "Reopen"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
