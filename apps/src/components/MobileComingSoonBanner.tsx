import { useState } from "react";
import { UiIcon } from "./UiIcon";
import { FEATURES } from "../constants/features";

const DISMISS_KEY = "leaflet.mobileBannerDismissed";

const readDismissed = () => {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * Announces the mobile app on the desktop launch.
 *
 * Dismissal is remembered, so it is a one-time announcement rather than a
 * permanent strip across the library. It disappears on its own once the build
 * turns multi-device sync on, which is when the mobile app actually exists.
 */
export const MobileComingSoonBanner = () => {
  const [dismissed, setDismissed] = useState(readDismissed);

  if (FEATURES.multiDeviceSync || dismissed) {
    return null;
  }

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Private storage is fine: it simply shows again next launch.
    }
  };

  return (
    <div
      className="paper-surface flex min-w-0 items-center gap-3 rounded-xl px-4 py-3"
      role="status"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <UiIcon name="book-open" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-on-surface">Leaflet for your phone is coming soon</p>
        <p className="text-xs leading-relaxed text-on-surface-variant">
          Back up to Google Drive now, and your library, progress and streak will be waiting on the
          mobile app the day it lands.
        </p>
      </div>
      <button
        type="button"
        className="tactile-button shrink-0 px-3 py-1.5 text-[11px] uppercase tracking-[0.16em]"
        onClick={dismiss}
        aria-label="Dismiss mobile app announcement"
      >
        Got it
      </button>
    </div>
  );
};
