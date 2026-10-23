import { invoke } from "@tauri-apps/api/core";

/**
 * The owner's admin page and the server (`server/src/routes/admin.js`,
 * the announcements in `routes/moderation.js`). Every call is the admin's;
 * the server answers anyone else as if there were no such route.
 */

export type Named = { name: string; readers: number };
export type HourRow = { at: string; requests: number; failed: number; p50: number | null; p95: number | null };
export type RouteRow = { route: string; requests: number; failed: number; meanMs: number; p95: number | null };

export type Overview = {
  at: string;
  readers: {
    accounts: number;
    newThisWeek: number;
    activeToday: number;
    active7: number;
    active30: number;
    versions: Named[];
    platforms: Named[];
  };
  queues: { openProblems: number; openReports: number; errorKinds7: number; errorDays: { day: string; count: number }[] };
  storage: { usedBytes: number; dataBytes: number; indexBytes: number; onDiskBytes: number; documents: number; quotaBytes: number } | null;
  collections: { name: string; bytes: number; documents: number }[] | null;
  backup: { at: string; sizeMB: number; parts: number; collections: number; documents: number; where: string } | null;
  server: {
    startedAt: string;
    uptimeSeconds: number;
    day: { requests: number; failed: number; p50: number | null; p95: number | null };
    hours: HourRow[];
    busiest: RouteRow[];
    slowest: RouteRow[];
  } | null;
};

export type ErrorStatus = "open" | "fixed" | "all";
export type ErrorRow = {
  sig: string;
  name: string;
  message: string;
  frames: string[];
  count: number;
  recent: number;
  versions: string[];
  platforms: string[];
  firstAt: string | null;
  lastAt: string | null;
  fixedIn: string | null;
  status: "open" | "fixed";
  reopened: boolean;
};

export type AnnouncementAction = "reconnect_drive" | "open_library_settings" | "report_problem";
export type AnnouncementLink = { label: string; url?: string; action?: string };
export type Audience =
  | { kind: "everyone" }
  | { kind: "android" }
  | { kind: "windows" }
  | { kind: "below"; version: string }
  | { kind: "drive" };
export type Announcement = {
  id: string;
  title: string;
  body: string;
  link: AnnouncementLink | null;
  audience: Audience;
  at: string | null;
  expiresAt: string | null;
  live?: boolean;
};
export type AnnouncementDraft = {
  title: string;
  body: string;
  link: AnnouncementLink | null;
  audience: Audience;
  expiresAt: string | null;
};

const discuss = <T>(route: string, args: Record<string, unknown> = {}) => invoke<T>("discuss", { route, args });

export const adminService = {
  /** Null from a server deployed before the overview. */
  overview: () => invoke<Overview | null>("admin_overview"),
  /** Null from a server deployed before error reports. */
  async errors(status: ErrorStatus): Promise<ErrorRow[] | null> {
    const found = await invoke<{ errors: ErrorRow[] } | null>("admin_errors", { status });
    return found ? found.errors : null;
  },
  markError: (sig: string, fixedIn: string | null) => discuss<{ sig: string; fixedIn: string | null }>("admin_error_mark", { sig, fixedIn }),
  announcements: () => discuss<{ announcements: Announcement[]; liveMax: number }>("admin_announcements"),
  announce: (draft: AnnouncementDraft) => discuss<Announcement>("admin_announce", { draft }),
  withdraw: (id: string) => discuss<{ withdrawn: boolean }>("admin_withdraw", { id })
};
