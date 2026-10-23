import { useCallback, useEffect, useState } from "react";
import { adminService, type ErrorRow, type ErrorStatus } from "../../services/adminService";
import { updateService } from "../../services/updateService";
import { ErrorLine } from "../community/ErrorLine";
import { errorText, relativeTime } from "../community/format";
import { SectionHeader } from "../ui/SectionHeader";
import { SegmentedTabs, type SegmentedTab } from "../ui/SegmentedTabs";

const STATUSES: SegmentedTab<ErrorStatus>[] = [
  { id: "open", label: "Open" },
  { id: "fixed", label: "Fixed" },
  { id: "all", label: "All" }
];
const PLATFORM: Record<string, string> = { windows: "Windows", android: "Android", macos: "macOS", linux: "Linux" };
const VERSION = /^\d{1,4}(\.\d{1,4}){1,3}$/;

/**
 * The kinds of error the apps reported by themselves, one row a kind: what
 * it says (scrubbed of anything a reader's), where in the code, how often,
 * in which versions and on which platforms, first and last seen. A kind can
 * be marked fixed in a version; seen again in that version or a later one,
 * it is open again, and says so.
 */
export const ErrorsPanel = ({ showToast }: { showToast: (message: string) => void }) => {
  const [status, setStatus] = useState<ErrorStatus>("open");
  const [rows, setRows] = useState<ErrorRow[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    adminService
      .errors(status)
      .then((found) => (setRows(found), setError(null)))
      .catch((cause) => setError(errorText(cause)));
  }, [status]);
  useEffect(load, [load]);
  useEffect(() => {
    void updateService.mine().then((version) => setMine(version ?? ""));
  }, []);

  const mark = (row: ErrorRow, fixedIn: string | null) => {
    setBusy(row.sig);
    adminService
      .markError(row.sig, fixedIn)
      .then(() => {
        showToast(fixedIn ? `Marked fixed in ${fixedIn}.` : "Open again.");
        load();
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(null));
  };

  return (
    <section className="paper-surface rounded-xl p-4 sm:p-6" aria-labelledby="errors-title">
      <SectionHeader
        eyebrow="Sent by the apps"
        title={`Errors${rows ? ` ${rows.length}` : ""}`}
        id="errors-title"
        eyebrowOnPhone={false}
        actions={<SegmentedTabs label="Which errors" idPrefix="errors" tabs={STATUSES} value={status} onChange={setStatus} />}
      />
      {error ? (
        <ErrorLine message={error} onRetry={load} />
      ) : rows === undefined ? (
        <p className="mt-4 text-xs text-on-surface-variant">Loading…</p>
      ) : rows === null ? (
        <p className="mt-4 text-sm text-on-surface-variant">Server not updated yet</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-on-surface-variant">{status === "fixed" ? "Nothing marked fixed." : "No errors."}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {rows.map((row) => (
            <ErrorItem key={row.sig} row={row} suggested={mine} busy={busy === row.sig} onMark={(version) => mark(row, version)} />
          ))}
        </ul>
      )}
    </section>
  );
};

const ErrorItem = ({ row, suggested, busy, onMark }: { row: ErrorRow; suggested: string; busy: boolean; onMark: (version: string | null) => void }) => {
  const [version, setVersion] = useState(row.fixedIn ?? suggested);
  useEffect(() => setVersion(row.fixedIn ?? suggested), [row.fixedIn, suggested]);
  return (
    <li className="rounded-xl border border-outline-variant/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-sm text-on-surface [overflow-wrap:anywhere]">
          <span className="font-semibold">{row.name}</span> {row.message}
        </p>
        <span className="shrink-0 text-xs tabular-nums text-on-surface-variant" title={`${row.recent} in the last day`}>
          {row.count.toLocaleString()}×
        </span>
      </div>
      {row.frames.length > 0 && (
        <p className="selectable mt-1 font-mono text-[11px] text-on-surface-variant [overflow-wrap:anywhere]">{row.frames.join(" ‹ ")}</p>
      )}
      <p className="mt-2 text-[11px] text-on-surface-variant">
        {row.versions.join(", ")} · {row.platforms.map((platform) => PLATFORM[platform] ?? platform).join(", ")}
        {row.lastAt && <> · last {relativeTime(row.lastAt)}</>}
        {row.firstAt && <> · first {relativeTime(row.firstAt)}</>}
        {row.reopened && <span className="text-error"> · back after the fix in {row.fixedIn}</span>}
        {row.status === "fixed" && <> · fixed in {row.fixedIn}</>}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {row.status === "open" ? (
          <>
            <input
              className="inset-field w-24 px-2 py-1 text-xs tabular-nums text-on-surface"
              aria-label="Fixed in version"
              placeholder="1.5.12"
              inputMode="decimal"
              value={version}
              onChange={(event) => setVersion(event.target.value)}
            />
            <button
              type="button"
              className="tactile-button px-3 py-1 text-xs disabled:opacity-60"
              disabled={busy || !VERSION.test(version.trim())}
              title="Seen again in this version or a later one, it opens again"
              onClick={() => onMark(version.trim())}
            >
              Mark fixed
            </button>
          </>
        ) : (
          <button type="button" className="tactile-button px-3 py-1 text-xs disabled:opacity-60" disabled={busy} onClick={() => onMark(null)}>
            Reopen
          </button>
        )}
      </div>
    </li>
  );
};
