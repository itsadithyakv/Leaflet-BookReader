import { useCallback, useEffect, useState, type ReactNode } from "react";
import { adminService, type Named, type Overview, type RouteRow } from "../../services/adminService";
import { ErrorLine } from "../community/ErrorLine";
import { errorText, relativeTime } from "../community/format";
import { InfoTip } from "../ui/InfoTip";
import { EYEBROW } from "../ui/SectionHeader";
import { UiIcon } from "../UiIcon";
import type { AdminSection } from "./AdminPage";

/** Past this, the last backup is late: it runs nightly. */
export const BACKUP_LATE_HOURS = 36;
const HOUR_MS = 60 * 60 * 1000;

export const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
const whole = (value: number) => value.toLocaleString();
const ms = (value: number | null) => (value === null ? "–" : value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} s` : `${value} ms`);

/** How long the server has been up, shortly: "3 d 4 h", "5 h 12 min", "40 min". */
export const uptime = (seconds: number) => {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${Math.max(minutes, 0)} min`;
};

/** Whether the last backup is missing or older than a night and a half. */
export const backupLate = (backup: Overview["backup"], now = Date.now()) =>
  !backup || now - Date.parse(backup.at) > BACKUP_LATE_HOURS * HOUR_MS;

const Tile = ({ label, value, sub, tip, warn = false, onClick }: { label: string; value: ReactNode; sub?: ReactNode; tip?: string; warn?: boolean; onClick?: () => void }) => {
  const body = (
    <>
      <span className={`${EYEBROW} flex items-center gap-1.5`}>
        {label}
        {tip && <InfoTip className="normal-case tracking-normal" text={tip} />}
      </span>
      <span className={`admin-tile-value mt-2 block text-2xl font-semibold tabular-nums ${warn ? "text-error" : "text-on-surface"}`}>{value}</span>
      {sub && <span className="mt-1 block truncate text-[11px] text-on-surface-variant">{sub}</span>}
    </>
  );
  const className = `admin-tile paper-surface rounded-xl p-4 text-left ${warn ? "is-warning" : ""}`;
  return onClick ? (
    <button type="button" className={`${className} admin-tile-link`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
};

/** A list of names with a bar each, the longest bar the most. */
const Bars = ({ rows, unit, format = whole }: { rows: Named[]; unit: string; format?: (value: number) => string }) => {
  const most = Math.max(1, ...rows.map((row) => row.readers));
  if (rows.length === 0) return <p className="mt-3 text-xs text-on-surface-variant">None yet.</p>;
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.name} className="grid grid-cols-[minmax(4.5rem,auto)_1fr_auto] items-center gap-3 text-xs">
          <span className="truncate font-semibold capitalize text-on-surface">{row.name}</span>
          <span className="admin-bar" aria-hidden>
            <span style={{ width: `${(row.readers / most) * 100}%` }} />
          </span>
          <span className="tabular-nums text-on-surface-variant" title={`${row.readers} ${unit}`}>
            {format(row.readers)}
          </span>
        </li>
      ))}
    </ul>
  );
};

/** Columns, oldest on the left: the last 24 hours' requests (with failures marked), or a week of errors. */
const Columns = ({ values, marks, labels, label }: { values: number[]; marks?: number[]; labels: string[]; label: string }) => {
  const most = Math.max(1, ...values);
  return (
    <div className="admin-columns mt-3" role="img" aria-label={label}>
      {values.map((value, index) => (
        <span key={labels[index]} className="admin-column" title={`${labels[index]}: ${whole(value)}${marks?.[index] ? `, ${marks[index]} failed` : ""}`}>
          <span style={{ height: `${Math.max(value > 0 ? 4 : 0, (value / most) * 100)}%` }} className={marks?.[index] ? "has-failures" : ""} />
        </span>
      ))}
    </div>
  );
};

const Routes = ({ title, rows, tip }: { title: string; rows: RouteRow[]; tip: string }) => (
  <div className="min-w-0">
    <p className={`${EYEBROW} flex items-center gap-1.5`}>
      {title} <InfoTip className="normal-case tracking-normal" text={tip} />
    </p>
    {rows.length === 0 ? (
      <p className="mt-3 text-xs text-on-surface-variant">Nothing yet.</p>
    ) : (
      <ul className="mt-3 flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.route} className="flex items-baseline justify-between gap-3 text-xs">
            <code className="min-w-0 truncate text-on-surface" title={row.route}>
              {row.route}
            </code>
            <span className="shrink-0 tabular-nums text-on-surface-variant" title={`${row.requests} requests, mean ${row.meanMs} ms, p95 ${ms(row.p95)}, ${row.failed} failed`}>
              {whole(row.requests)} · {ms(row.p95)}
              {row.failed > 0 && <span className="text-error"> · {row.failed}✕</span>}
            </span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

const Card = ({ title, tip, children, className = "" }: { title: string; tip?: string; children: ReactNode; className?: string }) => (
  <section className={`paper-surface min-w-0 rounded-xl p-4 sm:p-5 ${className}`}>
    <p className={`${EYEBROW} flex items-center gap-1.5`}>
      {title}
      {tip && <InfoTip className="normal-case tracking-normal" text={tip} />}
    </p>
    {children}
  </section>
);

const hourLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric" });
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });

/** The week's error counts, a day a column, with the days that had none. */
const weekOfErrors = (days: { day: string; count: number }[], now = new Date()) => {
  const counts = new Map(days.map((row) => [row.day, row.count]));
  return Array.from({ length: 7 }, (_, back) => {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (6 - back))).toISOString().slice(0, 10);
    return { day, count: counts.get(day) ?? 0 };
  });
};

/**
 * Leaflet at a glance: a few tiles, then where each number comes from in a
 * little more detail. The server keeps what it reads a minute, and its own
 * counts of requests start again whenever it restarts (the uptime says when).
 */
export const OverviewPanel = ({ onOpen }: { onOpen: (section: AdminSection) => void }) => {
  const [overview, setOverview] = useState<Overview | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    adminService
      .overview()
      .then((found) => (setOverview(found), setError(null)))
      .catch((cause) => setError(errorText(cause)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorLine message={error} onRetry={load} className="mt-2" />;
  if (overview === undefined) return <p className="text-xs text-on-surface-variant">Loading…</p>;
  // A server deployed before the overview.
  if (overview === null) return <p className="text-sm text-on-surface-variant">Server not updated yet</p>;

  const { readers, queues, storage, collections, backup, server } = overview;
  const used = storage ? storage.usedBytes / storage.quotaBytes : null;
  const late = backupLate(backup);
  const errorWeek = weekOfErrors(queues.errorDays);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-on-surface-variant" title={new Date(overview.at).toLocaleString()}>
          As of {relativeTime(overview.at)}
        </p>
        <button type="button" className="key-button" aria-label="Refresh" title="Refresh (the server keeps its figures a minute)" disabled={loading} onClick={load}>
          <UiIcon name="sync" size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="admin-tiles grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Tile label="Readers" value={whole(readers.accounts)} sub={`+${whole(readers.newThisWeek)} this week`} tip="Leaflet accounts. Readers without one are not counted anywhere." />
        <Tile
          label="Active today"
          value={whole(readers.activeToday)}
          sub={`${whole(readers.active7)} in 7 d · ${whole(readers.active30)} in 30 d`}
          tip="Accounts used since midnight UTC, and in the last 7 and 30 days. Noted once a day per account."
        />
        <Tile label="Problems" value={whole(queues.openProblems)} sub="open reports" onClick={() => onOpen("problems")} />
        <Tile label="Reported" value={whole(queues.openReports)} sub="things waiting" onClick={() => onOpen("moderation")} />
        <Tile label="Errors" value={whole(queues.errorKinds7)} sub="kinds in 7 days" onClick={() => onOpen("errors")} />
        <Tile
          label="Storage"
          value={used === null ? "–" : `${Math.round(used * 100)}%`}
          sub={storage ? `${megabytes(storage.usedBytes)} of ${megabytes(storage.quotaBytes)}` : "The cluster did not say"}
          warn={used !== null && used > 0.8}
          tip="Data and indexes, as Atlas counts them against the free cluster's 512 MB."
        />
        <Tile
          label="Last backup"
          value={backup ? relativeTime(backup.at) : "Never"}
          sub={backup ? `${backup.sizeMB} MB · ${backup.collections} collections` : "No backup has been noted"}
          warn={late}
          tip={`Nightly (leaflet-backup.timer). Marked late after ${BACKUP_LATE_HOURS} hours.`}
        />
        <Tile
          label="Uptime"
          value={server ? uptime(server.uptimeSeconds) : "–"}
          sub={server ? `since ${new Date(server.startedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : undefined}
          tip="The server's request counts start again whenever it restarts."
        />
        <Tile label="Requests" value={server ? whole(server.day.requests) : "–"} sub={server ? `${whole(server.day.failed)} failed · last 24 h` : undefined} warn={Boolean(server && server.day.failed > 0)} />
        <Tile label="Response" value={server ? ms(server.day.p50) : "–"} sub={server ? `p95 ${ms(server.day.p95)}` : undefined} tip="Half of the last day's requests were answered within the first figure, 95 in 100 within the second." />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Versions in use" tip="Accounts used in the last 30 days, by the app they were last used from. Unknown: before 1.5.12.">
          <Bars rows={readers.versions} unit="readers" />
        </Card>
        <Card title="Platforms" tip="The same accounts, by device.">
          <Bars rows={readers.platforms} unit="readers" />
        </Card>
      </div>

      {server && (
        <Card title="Server, last 24 hours" tip="Requests each hour, oldest on the left; an hour with failures is marked.">
          <Columns
            values={server.hours.map((hour) => hour.requests)}
            marks={server.hours.map((hour) => hour.failed)}
            labels={server.hours.map((hour) => hourLabel(hour.at))}
            label={`Requests each hour: ${whole(server.day.requests)} in the last 24 hours`}
          />
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <Routes title="Busiest" rows={server.busiest} tip="Since the server started: requests, and the time 95 in 100 were answered within." />
            <Routes title="Slowest" rows={server.slowest} tip="By that time, among routes asked at least five times." />
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Errors this week" tip="Times the apps reported an error, each day (UTC).">
          <Columns
            values={errorWeek.map((row) => row.count)}
            labels={errorWeek.map((row) => dayLabel(row.day))}
            label={`Errors reported each day this week: ${whole(errorWeek.reduce((sum, row) => sum + row.count, 0))}`}
          />
        </Card>
        <Card title="Largest collections" tip="Data and indexes. Read every quarter of an hour at most.">
          {collections && collections.length > 0 ? (
            <Bars rows={collections.slice(0, 8).map((row) => ({ name: row.name, readers: row.bytes }))} unit="bytes" format={megabytes} />
          ) : (
            <p className="mt-3 text-xs text-on-surface-variant">The cluster did not say.</p>
          )}
        </Card>
      </div>
    </div>
  );
};
