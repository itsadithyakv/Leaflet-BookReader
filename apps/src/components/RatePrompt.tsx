import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { STORE_WEB_URL } from "../constants/links";
import { accountService } from "../services/accountService";
import { getDateKey, useHabitStore } from "../store/habitStore";
import { PipSprite } from "./PipSprite";

/**
 * Asking for a Store rating, politely.
 *
 * Pip asks once, at a good moment: right after a session wrap-up in which the
 * day's goal was met, and only once Leaflet has been used on a few different
 * days (a rating from someone who opened it yesterday says little). "Maybe
 * later" waits two weeks; "Don't ask again" means it. Never mid-book, never
 * on launch. The same link lives in Settings and Pip's menu for anyone who
 * wants to rate without being asked.
 */

const STATE_KEY = "leaflet.rate";
const MIN_DAYS_USED = 3;
const SNOOZE_MS = 14 * 24 * 60 * 60_000;

type RateState = {
  /** Distinct local days Leaflet was opened on (most recent few). */
  days: string[];
  snoozedUntil?: number;
  done?: boolean;
};

const readState = (): RateState => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null") as RateState | null;
    return parsed && Array.isArray(parsed.days) ? parsed : { days: [] };
  } catch {
    return { days: [] };
  }
};

const writeState = (state: RateState) => {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // A preference; losing it only means Pip may ask again.
  }
};

/** Counts today as a day Leaflet was used. */
const noteDayUsed = () => {
  const state = readState();
  const today = getDateKey();
  if (!state.days.includes(today)) {
    writeState({ ...state, days: [...state.days, today].slice(-10) });
  }
};

const mayAsk = () => {
  const state = readState();
  return !state.done && state.days.length >= MIN_DAYS_USED && Date.now() >= (state.snoozedUntil ?? 0);
};

/**
 * Opens Leaflet's Store page on its reviews. The Store app's own review
 * dialog when it can; the web listing (which hands over to the Store app)
 * otherwise.
 */
export const openStoreReview = async () => {
  writeState({ ...readState(), done: true });
  if (isTauri()) {
    try {
      await invoke("open_store_review");
      return;
    } catch {
      // Older builds, or no Store app: fall through to the web listing.
    }
  }
  await accountService.openLink(STORE_WEB_URL);
};

/** Mounted once in the app. Shows itself when a good moment comes. */
export const RatePrompt = () => {
  const [open, setOpen] = useState(false);
  const wrapUp = useHabitStore((state) => state.wrapUp);
  const lastWrapUp = useRef(wrapUp);

  useEffect(noteDayUsed, []);

  // The moment: a wrap-up that met the day's goal has just been closed.
  useEffect(() => {
    const previous = lastWrapUp.current;
    lastWrapUp.current = wrapUp;
    if (previous && !wrapUp && previous.todayMet && mayAsk()) {
      const timer = window.setTimeout(() => setOpen(true), 700);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [wrapUp]);

  if (!open) {
    return null;
  }

  const later = () => {
    writeState({ ...readState(), snoozedUntil: Date.now() + SNOOZE_MS });
    setOpen(false);
  };
  const never = () => {
    writeState({ ...readState(), done: true });
    setOpen(false);
  };
  const rate = () => {
    setOpen(false);
    void openStoreReview();
  };

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/40 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          later();
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="rate-title" className="modal-surface confirm-pop w-full max-w-sm rounded-2xl p-6 text-center">
        <div className="mb-2 flex justify-center">
          <PipSprite move="smitten" size={80} />
        </div>
        <h2 id="rate-title" className="page-title text-xl text-on-surface">
          Enjoying Leaflet?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
          A quick rating on the Microsoft Store helps other readers find it, and it makes Pip's whole week.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            autoFocus
            className="tactile-button tactile-button-primary px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.16em]"
            onClick={rate}
          >
            Rate Leaflet ★
          </button>
          <button type="button" className="tactile-button px-5 py-2 text-xs font-semibold uppercase tracking-[0.16em]" onClick={later}>
            Maybe later
          </button>
          <button type="button" className="mt-1 text-[11px] text-on-surface-variant underline-offset-2 hover:underline" onClick={never}>
            Don't ask again
          </button>
        </div>
      </div>
    </div>
  );
};
