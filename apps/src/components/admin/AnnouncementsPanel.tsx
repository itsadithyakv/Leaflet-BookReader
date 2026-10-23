import { useCallback, useEffect, useState } from "react";
import {
  adminService,
  type Announcement,
  type AnnouncementAction,
  type AnnouncementDraft,
  type Audience
} from "../../services/adminService";
import { updateService } from "../../services/updateService";
import { askConfirm } from "../ConfirmDialog";
import { AnnouncementCard } from "../announcements/AnnouncementCard";
import { ErrorLine } from "../community/ErrorLine";
import { errorText, relativeTime } from "../community/format";
import { InfoTip } from "../ui/InfoTip";
import { EYEBROW, SectionHeader } from "../ui/SectionHeader";

export const TITLE_MAX = 80;
export const BODY_MAX = 600;
const LABEL_MAX = 30;
const VERSION = /^\d{1,4}(\.\d{1,4}){1,3}$/;

type ButtonKind = "none" | "link" | AnnouncementAction;
type AudienceKind = Audience["kind"];

const BUTTONS: { id: ButtonKind; label: string; suggested: string }[] = [
  { id: "none", label: "No button", suggested: "" },
  { id: "link", label: "Open a link", suggested: "Read more" },
  { id: "reconnect_drive", label: "Reconnect Google Drive", suggested: "Reconnect Drive" },
  { id: "open_library_settings", label: "Open Settings → Library", suggested: "Open Settings" },
  { id: "report_problem", label: "Report a problem", suggested: "Report a problem" }
];
const AUDIENCES: { id: AudienceKind; label: string }[] = [
  { id: "everyone", label: "Everyone" },
  { id: "android", label: "Android only" },
  { id: "windows", label: "Windows only" },
  { id: "below", label: "Versions below…" },
  { id: "drive", label: "Readers who used Google Drive" }
];
const AUDIENCE_TIP = "Decided on each device: its platform, its version, and whether Google Drive was ever connected on it.";

const audienceText = (audience: Audience) =>
  audience.kind === "below" ? `Versions below ${audience.version}` : AUDIENCES.find((entry) => entry.id === audience.kind)?.label ?? audience.kind;

/** The end of a day in the reader's own time, from a date field ("2026-11-01"). */
const endOfDay = (day: string) => (day ? new Date(`${day}T23:59:59`).toISOString() : null);

/**
 * One-time messages to readers: a title, a few lines, and at most one button
 * (an https link, or one of a few things the app does: reconnect Drive, open
 * Settings on Library, report a problem). Each app shows each once, in the
 * Library, never over a book. Preview shows the card as readers will see it.
 */
export const AnnouncementsPanel = ({ showToast }: { showToast: (message: string) => void }) => {
  const [list, setList] = useState<Announcement[] | null>(null);
  const [liveMax, setLiveMax] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [buttonKind, setButtonKind] = useState<ButtonKind>("none");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [audienceKind, setAudienceKind] = useState<AudienceKind>("everyone");
  const [below, setBelow] = useState("");
  const [until, setUntil] = useState("");
  const [preview, setPreview] = useState(false);

  const load = useCallback(() => {
    adminService
      .announcements()
      .then((found) => {
        setList(found.announcements);
        setLiveMax(found.liveMax);
        setError(null);
      })
      .catch((cause) => setError(errorText(cause)));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    void updateService.mine().then((version) => setBelow((current) => current || version || ""));
  }, []);

  const draft = (): AnnouncementDraft => ({
    title: title.trim(),
    body: body.trim(),
    link:
      buttonKind === "none"
        ? null
        : buttonKind === "link"
          ? { label: label.trim(), url: url.trim() }
          : { label: label.trim(), action: buttonKind },
    audience: audienceKind === "below" ? { kind: "below", version: below.trim() } : ({ kind: audienceKind } as Audience),
    expiresAt: endOfDay(until)
  });

  const live = (list ?? []).filter((item) => item.live);
  const ready =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (buttonKind === "none" || label.trim().length > 0) &&
    (buttonKind !== "link" || /^https:\/\/\S+$/.test(url.trim())) &&
    (audienceKind !== "below" || VERSION.test(below.trim())) &&
    live.length < liveMax;

  const chooseButton = (next: ButtonKind) => {
    setButtonKind(next);
    const suggested = BUTTONS.find((entry) => entry.id === next)?.suggested ?? "";
    setLabel((current) => (current && BUTTONS.every((entry) => entry.suggested !== current) ? current : suggested));
  };

  const publish = async () => {
    const ok = await askConfirm({ title: "Publish this announcement?", body: `${audienceText(draft().audience)} will see it once, the next time Leaflet checks.`, confirmLabel: "Publish" });
    if (!ok) return;
    setBusy(true);
    adminService
      .announce(draft())
      .then(() => {
        showToast("Published.");
        setTitle("");
        setBody("");
        setPreview(false);
        load();
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const withdraw = async (item: Announcement) => {
    const ok = await askConfirm({ title: `Withdraw "${item.title}"?`, body: "Readers who have not seen it yet will not.", confirmLabel: "Withdraw", danger: true });
    if (!ok) return;
    setBusy(true);
    adminService
      .withdraw(item.id)
      .then(() => {
        showToast("Withdrawn.");
        load();
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const field = "inset-field w-full px-3 py-2 text-sm text-on-surface";
  const labelClass = `${EYEBROW} mb-1.5 flex items-center gap-1.5`;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <section className="paper-surface rounded-xl p-4 sm:p-6" aria-labelledby="announce-title">
        <SectionHeader eyebrow="Shown once on each device" title="New announcement" id="announce-title" eyebrowOnPhone={false} />
        <div className="mt-4 flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Title</span>
            <input className={field} maxLength={TITLE_MAX} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="block">
            <span className={labelClass}>
              Message <span className="ml-auto normal-case tracking-normal tabular-nums">{BODY_MAX - body.length}</span>
            </span>
            <textarea className={`${field} min-h-28 resize-y`} maxLength={BODY_MAX} value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Button</span>
              <select className={field} value={buttonKind} onChange={(event) => chooseButton(event.target.value as ButtonKind)}>
                {BUTTONS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            {buttonKind !== "none" && (
              <label className="block">
                <span className={labelClass}>Its label</span>
                <input className={field} maxLength={LABEL_MAX} value={label} onChange={(event) => setLabel(event.target.value)} />
              </label>
            )}
          </div>
          {buttonKind === "link" && (
            <label className="block">
              <span className={labelClass}>Link</span>
              <input className={field} inputMode="url" placeholder="https://" value={url} onChange={(event) => setUrl(event.target.value)} />
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>
                Who <InfoTip className="normal-case tracking-normal" text={AUDIENCE_TIP} />
              </span>
              <select className={field} value={audienceKind} onChange={(event) => setAudienceKind(event.target.value as AudienceKind)}>
                {AUDIENCES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            {audienceKind === "below" ? (
              <label className="block">
                <span className={labelClass}>Below version</span>
                <input className={`${field} tabular-nums`} inputMode="decimal" placeholder="1.5.12" value={below} onChange={(event) => setBelow(event.target.value)} />
              </label>
            ) : (
              <label className="block">
                <span className={labelClass}>Until (optional)</span>
                <input className={field} type="date" value={until} onChange={(event) => setUntil(event.target.value)} />
              </label>
            )}
          </div>
          {audienceKind === "below" && (
            <label className="block sm:w-1/2 sm:pr-1.5">
              <span className={labelClass}>Until (optional)</span>
              <input className={field} type="date" value={until} onChange={(event) => setUntil(event.target.value)} />
            </label>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              className="tactile-button tactile-button-primary px-4 py-2 text-xs disabled:opacity-60"
              disabled={busy || !ready}
              title={live.length >= liveMax ? `Up to ${liveMax} at once: withdraw one first` : undefined}
              onClick={() => void publish()}
            >
              Publish
            </button>
            <button type="button" className="tactile-button px-4 py-2 text-xs" aria-pressed={preview} onClick={() => setPreview((shown) => !shown)}>
              {preview ? "Hide preview" : "Preview"}
            </button>
          </div>
          {preview && (
            <div className="mt-2">
              <AnnouncementCard
                inline
                item={{ title: title.trim(), body: body.trim(), link: draft().link }}
                onDismiss={() => setPreview(false)}
                onButton={() => showToast("In the app this button works.")}
              />
            </div>
          )}
        </div>
      </section>

      <section className="paper-surface rounded-xl p-4 sm:p-6" aria-labelledby="announced-title">
        <SectionHeader eyebrow={`Up to ${liveMax} at once`} title={`Up now ${live.length}`} id="announced-title" eyebrowOnPhone={false} />
        {error ? (
          <ErrorLine message={error} onRetry={load} />
        ) : list === null ? (
          <p className="mt-4 text-xs text-on-surface-variant">Loading…</p>
        ) : list.length === 0 ? (
          <p className="mt-4 text-sm text-on-surface-variant">Nothing announced.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {list.map((item) => (
              <li key={item.id} className={`rounded-xl border border-outline-variant/30 p-3 ${item.live ? "" : "opacity-60"}`}>
                <p className="text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">{item.title}</p>
                <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-on-surface-variant [overflow-wrap:anywhere]">{item.body}</p>
                <p className="mt-2 text-[11px] text-on-surface-variant">
                  {audienceText(item.audience)}
                  {item.link && <> · “{item.link.label}”</>}
                  {item.at && <> · {relativeTime(item.at)}</>}
                  {item.expiresAt && <> · {item.live ? "until" : "ended"} {new Date(item.expiresAt).toLocaleDateString()}</>}
                </p>
                {item.live && (
                  <button type="button" className="tactile-button mt-2 px-3 py-1 text-xs disabled:opacity-60" disabled={busy} onClick={() => void withdraw(item)}>
                    Withdraw
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
