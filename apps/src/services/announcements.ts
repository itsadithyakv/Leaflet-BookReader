import type { Announcement, AnnouncementAction, Audience } from "./adminService";
import { isNewer } from "./updateService";

/**
 * The owner's one-time messages, on the reader's side: which of them this
 * device should show (`forThisDevice`), and which it has already put away.
 * They come with the update notice (`updateService.notice`), so asking for
 * them costs nothing more.
 *
 * Who an announcement is for is decided here, since only the device knows:
 * its platform, its version, and whether Google Drive has been used on it
 * (`noteDriveUsed`, remembered once seen, so a reader whose Drive has since
 * been disconnected by Google's change is still told).
 */

export const SEEN_KEY = "leaflet.announcements.seen";
export const DRIVE_USED_KEY = "leaflet.driveUsed";
/** How many put-away ids are remembered: far more than are ever up at once. */
const SEEN_MAX = 60;

/** What a button may do in this app, by key. A key not here (a newer server's) means no button. */
export const ACTIONS: readonly AnnouncementAction[] = ["reconnect_drive", "open_library_settings", "report_problem"];

export type Device = { platform: "windows" | "android" | "macos" | "linux"; version: string | null; driveUsed: boolean };

export type Button = { label: string; url: string } | { label: string; action: AnnouncementAction };

const readList = (key: string): string[] => {
  try {
    const kept = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(kept) ? kept.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};

/** The ids put away on this device. */
export const seenIds = () => new Set(readList(SEEN_KEY));

/** Puts one away for good on this device. */
export function markSeen(id: string) {
  const kept = readList(SEEN_KEY).filter((seen) => seen !== id);
  kept.push(id);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(kept.slice(-SEEN_MAX)));
  } catch {
    // Put away for this visit only.
  }
}

/** Whether Google Drive has ever been connected here. */
export function driveUsed(): boolean {
  try {
    return localStorage.getItem(DRIVE_USED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remembers that Drive was connected here, for announcements to Drive's readers. */
export function noteDriveUsed() {
  try {
    localStorage.setItem(DRIVE_USED_KEY, "1");
  } catch {
    // Known for this visit only.
  }
}

/** Whether an announcement's audience takes in this device. An audience this app does not know takes in nobody. */
export function forDevice(audience: Audience | null | undefined, device: Device): boolean {
  const kind = audience?.kind ?? "everyone";
  switch (kind) {
    case "everyone":
      return true;
    case "android":
      return device.platform === "android";
    case "windows":
      return device.platform === "windows";
    case "below":
      return Boolean(device.version) && isNewer((audience as { version?: string }).version, device.version);
    case "drive":
      return device.driveUsed;
    default:
      return false;
  }
}

/** The ones this device should still show, oldest first: for it, not put away, not run out. */
export function forThisDevice(list: Announcement[] | undefined, device: Device, seen = seenIds(), now = Date.now()): Announcement[] {
  return (list ?? []).filter(
    (item) =>
      typeof item?.id === "string" &&
      !seen.has(item.id) &&
      !(item.expiresAt && Date.parse(item.expiresAt) <= now) &&
      forDevice(item.audience, device)
  );
}

/** The button under one, if this app can offer it: an https link, or an action it knows. */
export function buttonOf(link: Announcement["link"]): Button | null {
  if (!link?.label) return null;
  if (link.action !== undefined) {
    return (ACTIONS as readonly string[]).includes(link.action) ? { label: link.label, action: link.action as AnnouncementAction } : null;
  }
  try {
    return link.url && new URL(link.url).protocol === "https:" ? { label: link.label, url: link.url } : null;
  } catch {
    return null;
  }
}
