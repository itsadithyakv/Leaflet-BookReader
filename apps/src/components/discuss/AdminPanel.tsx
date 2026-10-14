import { useCallback, useEffect, useState } from "react";
import { discussService, type ReportGroup } from "../../services/discussService";
import { updateService, type UpdateNotice } from "../../services/updateService";
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
    <>
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
      <UpdateNoticeCard showToast={showToast} />
    </>
  );
};

/**
 * Telling every reader a newer Leaflet is out: the version (this app's own to
 * begin with, since it is the one just released) and a line about it. Each
 * app a version behind shows it in a corner with Update, which opens the
 * Store's page; Take down stops it. Only apps from 1.4.2 on ask, so readers
 * on older ones are not reached by it.
 */
const UpdateNoticeCard = ({ showToast }: { showToast: (message: string) => void }) => {
  const [current, setCurrent] = useState<UpdateNotice | null>(null);
  const [version, setVersion] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([updateService.notice(), updateService.mine()]).then(([notice, mine]) => {
      if (!live) return;
      setCurrent(notice);
      setVersion(notice?.version ?? mine ?? "");
      setNote(notice?.note ?? "");
    });
    return () => {
      live = false;
    };
  }, []);

  const save = (next: string | null) => {
    setBusy(true);
    updateService
      .setNotice(next, next ? note.trim() || null : null)
      .then((saved) => {
        setCurrent(saved);
        showToast(saved.version ? `Readers on older versions are told ${saved.version} is out.` : "The update notice is down.");
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="paper-surface mt-6 rounded-xl p-4 sm:p-6" aria-labelledby="notice-title">
      <SectionHeader eyebrow="Only you see this" title="Update notice" id="notice-title" />
      <p className="mt-2 text-xs text-on-surface-variant">
        {current?.version ? `Up now: ${current.version}${current.at ? `, since ${relativeTime(current.at)}` : ""}.` : "Nothing is up."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className="inset-field w-28 px-3 py-2 text-sm tabular-nums text-on-surface"
          aria-label="The newest version"
          placeholder="1.4.2"
          value={version}
          onChange={(event) => setVersion(event.target.value)}
        />
        <input
          className="inset-field min-w-0 flex-1 px-3 py-2 text-sm text-on-surface"
          aria-label="A line about it (optional)"
          placeholder="What's new, in a line (optional)"
          maxLength={160}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="tactile-button tactile-button-primary px-3 py-1.5 text-xs disabled:opacity-60"
          disabled={busy || !/^\d{1,4}(\.\d{1,4}){1,3}$/.test(version.trim())}
          title="Every app older than this version shows it in a corner, with a button to the Store"
          onClick={() => save(version.trim())}
        >
          Tell everyone
        </button>
        {current?.version && (
          <button type="button" className="tactile-button px-3 py-1.5 text-xs disabled:opacity-60" disabled={busy} onClick={() => save(null)}>
            Take it down
          </button>
        )}
      </div>
    </section>
  );
};
