import { useEffect, useState } from "react";
import { formatBytes, storageService, type StorageUsage } from "../services/storageService";
import { InfoTip } from "./ui/InfoTip";

/** What the (i) says: the parts, and what the button takes. */
export const storageBreakdown = (usage: StorageUsage) =>
  `Books ${formatBytes(usage.books)} · Covers ${formatBytes(usage.covers)} · Cache ${formatBytes(usage.cache)}. ` +
  "Free Up Space empties the cache and removes files no book uses. Your books, highlights and notes stay.";

/**
 * Settings → Library → Storage: how much room Leaflet takes on this device,
 * and a button that gives back what it can (`commands/space.rs`). Leaflet
 * tidies by itself about once a day; the button is that, now, plus the cache.
 */
export const StorageCard = ({ showToast }: { showToast: (message: string) => void }) => {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!storageService.available()) {
      return;
    }
    let cancelled = false;
    storageService
      .usage()
      .then((measured) => !cancelled && setUsage(measured))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!storageService.available()) {
    return null;
  }

  const freeUp = () => {
    if (busy) {
      return;
    }
    setBusy(true);
    storageService
      .freeUp()
      .then(({ freed, usage: after }) => {
        setUsage(after);
        showToast(freed >= 1024 * 1024 ? `Freed ${formatBytes(freed)}.` : "Nothing more to free up.");
      })
      .catch(() => showToast("Couldn't free up space. Please try again."))
      .finally(() => setBusy(false));
  };

  return (
    <section className="paper-surface rounded-xl p-5">
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-on-surface-variant">
        Storage
        {usage && <InfoTip className="normal-case tracking-normal" text={storageBreakdown(usage)} />}
      </p>
      <p className="mt-2 text-sm text-on-surface">
        {usage ? `Leaflet uses ${formatBytes(usage.total)} on this device` : "Measuring…"}
      </p>
      <button
        type="button"
        className="tactile-button mt-3 px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
        onClick={freeUp}
        disabled={busy}
      >
        {busy ? "Freeing Up…" : "Free Up Space"}
      </button>
    </section>
  );
};
