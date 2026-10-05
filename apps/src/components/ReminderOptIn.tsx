import { useEffect, useRef, useState } from "react";
import { useHabitStore } from "../store/habitStore";
import { usePipStore } from "../store/pipStore";
import {
  minutesToTime,
  reminderService,
  timeToMinutes,
  type ReminderStatus
} from "../services/reminderService";
import { PipSprite } from "./PipSprite";

/** How long to keep waiting for another dialog (the rating prompt) to close. */
const WAIT_TRIES = 20;
const WAIT_MS = 1500;

/**
 * Asks once whether the reader would like reminders.
 *
 * Not on first launch, when nobody knows yet whether Leaflet is worth being
 * nudged about: right after the first focus session that ran to the end,
 * once its wrap-up is closed. Either answer is final; Settings has the rest.
 */
export const ReminderOptIn = () => {
  const [status, setStatus] = useState<ReminderStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(minutesToTime(19 * 60));
  const wrapUp = useHabitStore((state) => state.wrapUp);
  const lastWrapUp = useRef(wrapUp);
  const pipOff = usePipStore((state) => state.mode === "off");

  useEffect(() => {
    const previous = lastWrapUp.current;
    lastWrapUp.current = wrapUp;
    if (!previous || wrapUp || previous.reason !== "completed") {
      return undefined;
    }
    let tries = 0;
    let timer = 0;
    const attempt = () => {
      // The rating prompt may have chosen the same moment; one dialog at a
      // time, so wait for it.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        tries += 1;
        if (tries < WAIT_TRIES) {
          timer = window.setTimeout(attempt, WAIT_MS);
        }
        return;
      }
      reminderService
        .status()
        .then((next) => {
          if (next.supported && !next.settings.asked) {
            setStatus(next);
            setTime(minutesToTime(next.settings.dailyAt));
            setOpen(true);
          }
        })
        .catch(() => undefined);
    };
    timer = window.setTimeout(attempt, 900);
    return () => window.clearTimeout(timer);
  }, [wrapUp]);

  if (!open || !status) {
    return null;
  }

  const answer = (yes: boolean) => {
    setOpen(false);
    const dailyAt = timeToMinutes(time) ?? status.settings.dailyAt;
    void reminderService
      .save({
        ...status.settings,
        daily: yes,
        dailyAt,
        streakRisk: yes,
        asked: true
      })
      .catch(() => undefined);
  };

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/40 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          answer(false);
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reminder-optin-title"
        className="modal-surface confirm-pop dialog-fit w-full max-w-sm rounded-2xl p-6 text-center"
      >
        {!pipOff && (
          <div className="mb-2 flex justify-center">
            <PipSprite move="welcome" size={80} />
          </div>
        )}
        <h2 id="reminder-optin-title" className="page-title text-xl text-on-surface">
          Want a nudge tomorrow?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
          {pipOff ? "Leaflet" : "Pip"} can remind you when today's reading is still to do, and before a streak
          slips at 10 pm. Only on days you haven't read yet, never at night.
        </p>
        <label className="mt-4 flex items-center justify-center gap-3 text-xs text-on-surface-variant">
          <span>Remind me at</span>
          <input
            type="time"
            min="07:00"
            max="22:59"
            step={300}
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className="inset-field px-2 py-1 text-xs text-on-surface"
          />
        </label>
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            autoFocus
            className="tactile-button tactile-button-primary px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.16em]"
            onClick={() => answer(true)}
          >
            Yes, Remind Me
          </button>
          <button
            type="button"
            className="tactile-button px-5 py-2 text-xs font-semibold uppercase tracking-[0.16em]"
            onClick={() => answer(false)}
          >
            No Thanks
          </button>
        </div>
        <p className="mt-3 text-[11px] text-on-surface-variant">You can change this any time in Settings.</p>
      </div>
    </div>
  );
};
