import { SKINS } from "../../pip/core";
import type { CommunityPerson } from "../../services/socialService";

/**
 * Small, pure helpers the community components share.
 */

/** Stable small hash (FNV-1a with an avalanche), so a seed always maps alike. */
export const hashSeed = (value: string) => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
};

/**
 * Skins a stranger's Pip may wear. The earned-only ones (Champ, Golden,
 * Prism) are left out, so an avatar never looks like an achievement.
 */
const AVATAR_SKINS = SKINS.map((skin) => skin.id).filter(
  (id) => !["champ", "golden", "rainbow"].includes(id)
);

/** Each reader's Pip skin, picked from their seed. The same on every screen. */
export const skinFor = (seed: string | null | undefined) =>
  AVATAR_SKINS.length === 0 ? "sprout" : AVATAR_SKINS[hashSeed(seed || "pip") % AVATAR_SKINS.length];

export const nameOf = (person: Pick<CommunityPerson, "handle" | "displayName"> | null | undefined) =>
  person?.displayName || (person?.handle ? `@${person.handle}` : "A reader");

export const at = (handle: string | null | undefined) => (handle ? `@${handle}` : "a reader");

/**
 * What the profile's Name field starts with. The name given at sign-up fills
 * it for a reader setting their profile up (no handle yet), so there is one
 * name to type, not two. Once the profile has a handle its name is its own,
 * and an empty one stays empty: a reader who removed their name had the
 * sign-up one put back in the field, and published by the next press of
 * "Share my profile".
 */
export const nameToEdit = (
  profile: { handle: string | null; displayName: string | null } | null,
  accountName: string | null | undefined
) => profile?.displayName ?? (profile?.handle ? "" : accountName ?? "");

export const minutesText = (minutes: number) => {
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 60) {
    return `${whole}m`;
  }
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};

/** The start of next Monday, local time: when this week's board resets. */
export const localWeekEnd = (now = new Date()) => {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysFromMonday = (end.getDay() + 6) % 7;
  end.setDate(end.getDate() + (7 - daysFromMonday));
  return end;
};

/** "2d 4h", "3h 12m", "12m". */
export const timeLeftText = (until: Date, now = new Date()) => {
  const minutes = Math.max(0, Math.round((until.getTime() - now.getTime()) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
};

export const relativeTime = (iso: string, now = Date.now()) => {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) {
    return "";
  }
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
};

export const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

export const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A convenience only; the board still works without it.
  }
};

export const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
