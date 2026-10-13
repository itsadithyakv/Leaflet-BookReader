import { useCallback, useEffect, useState } from "react";
import { discussService, type ReportGroup } from "../../services/discussService";
import { askConfirm } from "../ConfirmDialog";
import { SectionHeader } from "../ui/SectionHeader";
import { ErrorLine } from "../community/ErrorLine";
import { at, errorText, relativeTime } from "../community/format";
import { REPORT_REASONS } from "./guidelines";

const WHAT: Record<ReportGroup["target"], string> = { post: "A post", thread: "A thread", reply: "A reply", community: "A community", profile: "A reader" };
const reasonLabel = (id: string) => REPORT_REASONS.find((entry) => entry.id === id)?.label ?? id;

/**
 * The owner's review of what readers reported, for the account the server
 * knows as the admin (nobody else is sent this, and the server answers
 * "no such route" to anyone else who asks). Each report can be dismissed,
 * the thing restored if it was hidden, or removed; its writer can be
 * suspended from posting; and public posting can be paused altogether while
 * something is sorted out.
 */
export const AdminPanel = ({ showToast }: { showToast: (message: string) => void }) => {
  const [reports, setReports] = useState<ReportGroup[] | null>(null);
  const [posting, setPosting] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    discussService
      .openReports()
      .then((found) => (setReports(found), setError(null)))
      .catch((cause) => setError(errorText(cause)));
    discussService
      .settings()
      .then((settings) => setPosting(settings.publicPosting))
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const run = (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    work()
      .then(() => {
        showToast(done);
        load();
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const remove = async (group: ReportGroup) => {
    const ok = await askConfirm({
      title: `Remove ${WHAT[group.target].toLowerCase()}?`,
      body: group.target === "community" ? "The community goes, with every thread and reply in it. This cannot be undone." : "It is deleted for everyone. This cannot be undone.",
      confirmLabel: "Remove",
      danger: true
    });
    if (ok) {
      run(() => discussService.resolve(group.target, group.id, "remove"), "Removed.");
    }
  };

  const suspend = async (handle: string, days: number) => {
    const ok = await askConfirm({
      title: `Suspend ${at(handle)} for ${days} days?`,
      body: "They cannot post, reply, react or report until then, and what they posted for everyone is hidden meanwhile.",
      confirmLabel: "Suspend",
      danger: true
    });
    if (ok) {
      run(() => discussService.suspend(handle, days), `${at(handle)} is suspended for ${days} days.`);
    }
  };

  const pause = async () => {
    const next = !(posting ?? true);
    const ok = next
      ? true
      : await askConfirm({ title: "Pause public posting?", body: "Nobody can post for everyone, start or join a community, or write in one, until you turn it back on. Reading still works.", confirmLabel: "Pause", danger: true });
    if (ok) {
      run(() => discussService.setPublicPosting(next).then((settings) => setPosting(settings.publicPosting)), next ? "Public posting is on again." : "Public posting is paused.");
    }
  };

  return (
    <section className="paper-surface rounded-xl p-4 sm:p-6" aria-labelledby="admin-title">
      <SectionHeader
        eyebrow="Only you see this"
        title={`Reports${reports ? ` ${reports.length}` : ""}`}
        id="admin-title"
        actions={
          posting !== null ? (
            <button type="button" className={`tactile-button px-3 py-1.5 text-xs disabled:opacity-60 ${posting ? "" : "tactile-button-primary"}`} disabled={busy} onClick={() => void pause()}>
              {posting ? "Pause public posting" : "Public posting is paused: turn it on"}
            </button>
          ) : undefined
        }
      />
      {error ? (
        <ErrorLine message={error} onRetry={() => (setError(null), load())} />
      ) : reports === null ? (
        <p className="mt-4 text-sm text-on-surface-variant">Looking…</p>
      ) : reports.length === 0 ? (
        <p className="mt-4 text-sm text-on-surface-variant">Nothing waiting.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {reports.map((group) => (
            <li key={`${group.target}:${group.id}`} className="rounded-xl border border-outline-variant/30 p-3">
              <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-on-surface-variant">
                <span className="font-semibold text-on-surface">{WHAT[group.target]}</span>
                {group.content.person && <span>{group.target === "profile" ? at(group.content.person.handle) : `by ${at(group.content.person.handle)}`}</span>}
                <span>
                  · {group.count} {group.count === 1 ? "report" : "reports"}: {Object.keys(group.reasons).map(reasonLabel).join(", ")}
                </span>
                <span>· {relativeTime(group.latestAt)}</span>
                {group.content.hidden && <span className="font-semibold text-error">· hidden</span>}
                {group.content.unlisted && <span className="font-semibold text-error">· not listed</span>}
                {group.content.suspendedUntil && <span className="font-semibold text-error">· suspended</span>}
              </p>
              {group.content.title && <p className="mt-1 text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">{group.content.title}</p>}
              {[group.content.body, group.content.quote, group.content.line, group.content.note]
                .filter((words): words is string => Boolean(words))
                .map((words, index) => (
                  <p key={index} className="mt-1 max-h-40 overflow-y-auto whitespace-pre-line text-sm text-on-surface [overflow-wrap:anywhere]">
                    {words}
                  </p>
                ))}
              {(group.notes ?? []).length > 0 && (
                <ul className="mt-2 flex flex-col gap-0.5 text-xs italic text-on-surface-variant">
                  {(group.notes ?? []).map((note, index) => (
                    <li key={index}>“{note}”</li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="tactile-button px-3 py-1.5 text-xs disabled:opacity-60" disabled={busy} onClick={() => run(() => discussService.resolve(group.target, group.id, "dismiss"), "Dismissed.")}>
                  Dismiss
                </button>
                {(group.content.hidden || group.content.unlisted) && (
                  <button type="button" className="tactile-button px-3 py-1.5 text-xs disabled:opacity-60" disabled={busy} onClick={() => run(() => discussService.resolve(group.target, group.id, "restore"), "Restored.")}>
                    Restore
                  </button>
                )}
                {group.target !== "profile" && (
                  <button type="button" className="tactile-button px-3 py-1.5 text-xs text-error disabled:opacity-60" disabled={busy} onClick={() => void remove(group)}>
                    Remove
                  </button>
                )}
                {group.content.person && (
                  <>
                    <button type="button" className="tactile-button px-3 py-1.5 text-xs disabled:opacity-60" disabled={busy} onClick={() => void suspend(group.content.person!.handle, 7)}>
                      Suspend 7 days
                    </button>
                    <button type="button" className="tactile-button px-3 py-1.5 text-xs disabled:opacity-60" disabled={busy} onClick={() => void suspend(group.content.person!.handle, 30)}>
                      30 days
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
