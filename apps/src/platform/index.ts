export type Platform = "mobile" | "desktop";

export const isMobilePlatform = () => {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
};

export const getPlatform = (): Platform => (isMobilePlatform() ? "mobile" : "desktop");

export async function pickBookFiles(): Promise<string[]> {
  if (getPlatform() === "mobile") {
    const module = await import("./mobile/file");
    return module.pickBookFiles();
  }
  const module = await import("./desktop/file");
  return module.pickBookFiles();
}

/**
 * Picks the directory that carries sync.
 *
 * Desktop only: a phone has no folder its cloud client keeps in step, so those
 * devices use the Drive transport instead.
 */
export async function pickSyncFolder(): Promise<string | null> {
  if (getPlatform() === "mobile") {
    return null;
  }
  const module = await import("./desktop/file");
  return module.pickSyncFolder();
}

/**
 * Picks the folder for "keep a copy of my books".
 *
 * Desktop only: a phone's files are not laid out as folders a reader browses.
 */
export async function pickLibraryCopyFolder(): Promise<string | null> {
  if (getPlatform() === "mobile") {
    return null;
  }
  const module = await import("./desktop/file");
  return module.pickLibraryCopyFolder();
}

export async function ensureBookPermissions(): Promise<boolean> {
  if (getPlatform() === "mobile") {
    const module = await import("./mobile/permissions");
    return module.ensureBookPermissions();
  }
  const module = await import("./desktop/permissions");
  return module.ensureBookPermissions();
}
