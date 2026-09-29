import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  createReadingProfile,
  mergeProfiles,
  migrateLegacyProfile,
  sanitizeProfile,
  type ReadingProfile
} from "../readers/paceModel";
import { readLegacySmartRead } from "./smartReadService";

/** The browser preview has no database, so its profile lives here. */
const BROWSER_KEY = "leaflet.smart-read.v2.profile";

const readBrowser = () => {
  try {
    const raw = localStorage.getItem(BROWSER_KEY);
    return raw ? sanitizeProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

/**
 * The reader's pace (readers/paceModel.ts). In the app it is kept in the
 * library database and travels with sync, so every device reads at the
 * reader's pace. A save is merged into what is stored and the merged profile
 * comes back: whatever a sync brought in meanwhile is kept, never overwritten.
 */
export const readingProfileService = {
  async load(accountEmail: string | null): Promise<ReadingProfile> {
    const stored = isTauri()
      ? sanitizeProfile(await invoke<unknown>("reading_profile_get"))
      : readBrowser();
    if (stored) {
      return stored;
    }
    // Nothing yet: bring over what the old, device-only Smart Read learned.
    const legacy = readLegacySmartRead(accountEmail);
    const migrated = migrateLegacyProfile(legacy.profile, legacy.limits, new Date().toISOString());
    if (!migrated) {
      return createReadingProfile();
    }
    return this.save(migrated).catch(() => migrated);
  },

  async save(profile: ReadingProfile): Promise<ReadingProfile> {
    if (isTauri()) {
      return sanitizeProfile(await invoke<unknown>("reading_profile_set", { profile })) ?? profile;
    }
    const stored = readBrowser();
    const merged = stored ? mergeProfiles(stored, profile) : profile;
    try {
      localStorage.setItem(BROWSER_KEY, JSON.stringify(merged));
    } catch {
      // The preview keeps reading without it.
    }
    return merged;
  }
};
