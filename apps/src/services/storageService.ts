import { invoke, isTauri } from "@tauri-apps/api/core";

/** Bytes Leaflet takes on this device, and the parts the (i) names. */
export type StorageUsage = {
  total: number;
  /** Every library's books here, converted copies included. */
  books: number;
  covers: number;
  /** The web view's cache: what "Free up space" empties. */
  cache: number;
};

export type FreedSpace = { freed: number; usage: StorageUsage };

/** "182 MB", "0.4 MB", "1.3 GB". */
export const formatBytes = (bytes: number): string => {
  const mb = Math.max(0, bytes) / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  if (mb > 0 && mb < 1) {
    return `${Math.max(0.1, Math.round(mb * 10) / 10).toFixed(1)} MB`;
  }
  return `${Math.round(mb)} MB`;
};

/** Settings → Library → Storage (`commands/space.rs`). */
export const storageService = {
  available: () => isTauri(),

  usage: () => invoke<StorageUsage>("storage_usage"),

  /** Clears what no book uses and the web view's cache. */
  freeUp: () => invoke<FreedSpace>("storage_free_up")
};
