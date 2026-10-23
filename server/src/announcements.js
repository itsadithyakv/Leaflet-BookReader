import { randomBytes } from "node:crypto";
import { HttpError, plainLines, plainText } from "./http.js";
import { VERSION } from "./metrics.js";

/**
 * One-time messages from the owner to readers: something has gone wrong
 * and is being put right, an apology, a thing to do. Each app shows each
 * one once, as a card, after it has settled and never over an open book,
 * and remembers on the device that it was put away.
 *
 * They travel with the update notice (`GET /v1/notice`), which every app
 * already asks for now and then and the server answers from memory: so an
 * announcement costs no read per reader and no request of its own. They are
 * kept in the one `settings` document (`_id: "announcements"`), as a list of
 * at most `LIVE_MAX` that have not run out.
 *
 * Who should see one is said here but decided on the device (`audience`):
 * the server cannot tell who on Android is on an old version without asking
 * for a version with every notice, and does not know at all who backs up to
 * Google Drive. A button under one opens an https link, or does one of a
 * few things in the app named by a key (`ACTIONS`): never code, never a
 * link the app would hand to the system. An app that does not know a key
 * (a newer server) shows the announcement without the button.
 */

export const LIVE_MAX = 3;
export const TITLE_MAX = 80;
export const BODY_MAX = 600;
export const LABEL_MAX = 30;
export const URL_MAX = 300;
/** The furthest ahead an announcement may be set to run out. */
const EXPIRY_MAX_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

export const AUDIENCES = ["everyone", "android", "windows", "below", "drive"];
/** What a button can do in the app, by key. */
export const ACTIONS = ["reconnect_drive", "open_library_settings", "report_problem"];

const words = (value, max, name, lines) => {
  if (typeof value !== "string" || [...value.trim()].length > max) {
    throw new HttpError(400, `${name} should be text, up to ${max} characters.`);
  }
  const text = lines ? plainLines(value, max) : plainText(value, max);
  if (!text) {
    throw new HttpError(400, `${name} should be text, up to ${max} characters.`);
  }
  return text;
};

function linkOf(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object") {
    throw new HttpError(400, "A button is a label and a link or an action.");
  }
  const label = words(value.label, LABEL_MAX, "The button's label", false);
  if (value.action !== undefined && value.action !== null) {
    if (!ACTIONS.includes(value.action)) {
      throw new HttpError(400, `An action is one of ${ACTIONS.join(", ")}.`);
    }
    return { label, action: value.action };
  }
  let url;
  try {
    url = new URL(String(value.url ?? ""));
  } catch {
    throw new HttpError(400, "A link is an https address.");
  }
  if (url.protocol !== "https:" || url.username || url.password || String(value.url).length > URL_MAX) {
    throw new HttpError(400, "A link is an https address.");
  }
  return { label, url: url.toString() };
}

function audienceOf(value) {
  if (value === undefined || value === null) {
    return { kind: "everyone" };
  }
  if (typeof value !== "object" || !AUDIENCES.includes(value.kind)) {
    throw new HttpError(400, `An audience is one of ${AUDIENCES.join(", ")}.`);
  }
  if (value.kind === "below") {
    if (typeof value.version !== "string" || !VERSION.test(value.version)) {
      throw new HttpError(400, "Say the version as numbers with dots, like 1.5.12.");
    }
    return { kind: "below", version: value.version };
  }
  return { kind: value.kind };
}

function expiryOf(value, now) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const at = new Date(String(value));
  if (Number.isNaN(at.getTime()) || at <= now || at.getTime() - now.getTime() > EXPIRY_MAX_DAYS * DAY_MS) {
    throw new HttpError(400, "It should run out on a day in the coming year.");
  }
  return at;
}

/** A new announcement as kept, from what the owner wrote; refused (400) in a sentence when it will not do. */
export function cleanAnnouncement(body, now = new Date()) {
  const given = body ?? {};
  return {
    id: randomBytes(6).toString("hex"),
    title: words(given.title, TITLE_MAX, "The title", false),
    body: words(given.body, BODY_MAX, "The message", true),
    link: linkOf(given.link),
    audience: audienceOf(given.audience),
    at: now,
    expiresAt: expiryOf(given.expiresAt, now)
  };
}

/** Whether it is still to be shown: no end, or an end still to come. */
export const isLive = (item, now = new Date()) => !(item.expiresAt instanceof Date) || item.expiresAt > now;

/** As apps and the owner see one. */
export const announcementView = (item) => ({
  id: item.id,
  title: item.title,
  body: item.body,
  link: item.link ?? null,
  audience: item.audience ?? { kind: "everyone" },
  at: item.at instanceof Date ? item.at.toISOString() : null,
  expiresAt: item.expiresAt instanceof Date ? item.expiresAt.toISOString() : null
});
