/**
 * Release switches, read once at build time.
 *
 * The desktop launch ships Drive as a *backup*: one computer, its library and
 * reading history copied to the reader's own Drive, restorable on a new machine.
 * Keeping several devices in step is the mobile app's job, so the folder
 * transport and the "sync across devices" framing stay off until it ships.
 *
 * Both are off unless the build sets them, so a release cannot switch one on by
 * forgetting a flag. Turn them on in `apps/.env` to work on them locally.
 */
const flag = (value: string | undefined) => value === "true";

export const FEATURES = {
  /** Folder sync and multi-device wording. Returns with the mobile app. */
  multiDeviceSync: flag(import.meta.env.VITE_ENABLE_MULTI_DEVICE),
  /** Leaderboards and shared shelves. Needs a hosted Leaflet server. */
  community: flag(import.meta.env.VITE_ENABLE_COMMUNITY),
  /** Optional email + password accounts. Also needs a Leaflet API base. */
  accounts: flag(import.meta.env.VITE_ENABLE_ACCOUNTS),
  /**
   * Pip's whole house: every floor (kitchen, library, workshop, observatory),
   * the attic arcade, the full decor catalogue and the book-nod furniture.
   * Off, the Pip tab is the bedroom and the garden with a starter set of
   * decor: enough to make a home, small enough that reading stays the point.
   * Everything bought stays owned and placed either way.
   */
  fullPipHouse: flag(import.meta.env.VITE_ENABLE_FULL_PIP_HOUSE)
} as const;
