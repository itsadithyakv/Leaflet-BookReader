import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { usePipStore } from "../store/pipStore";
import { deviceNoun, isAndroid } from "../platform/device";
import {
  DEFAULT_REMINDERS,
  minutesToTime,
  reminderService,
  timeToMinutes,
  type ReminderSettings,
  type ReminderStatus
} from "../services/reminderService";

const Toggle = ({ on }: { on: boolean }) => (
  <span
    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition ${
      on ? "bg-primary/30 border-primary/40" : "bg-surface-container-high border-outline-variant/30"
    }`}
  >
    <span
      className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
        on ? "translate-x-6" : "translate-x-1"
      }`}
    />
  </span>
);

/**
 * Settings → Reminders. Windows and Android: elsewhere there is nothing to
 * deliver them with, so the card is not shown at all.
 */
export const RemindersCard = ({ showToast }: { showToast: (message: string) => void }) => {
  const [status, setStatus] = useState<ReminderStatus | null>(null);
  const pipOff = usePipStore((state) => state.mode === "off");

  useEffect(() => {
    const refresh = () =>
      reminderService
        .status()
        .then(setStatus)
        .catch(() => setStatus(null));
    void refresh();
    if (!isTauri()) {
      return undefined;
    }
    // On a phone the reader may have just come back from its notification
    // settings: the reminders are handed over again then, and this follows.
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("reminders-changed", () => void refresh())
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (!status?.supported) {
    return null;
  }

  const settings = status.settings;
  const update = (next: Partial<ReminderSettings>) => {
    // Choosing anything here is an answer to the opt-in question too.
    const merged = { ...settings, ...next, asked: true };
    setStatus({ ...status, settings: merged });
    reminderService
      .save(merged)
      .then(setStatus)
      .catch(() => {
        showToast("Could not save reminders.");
        // The switch moved before the save was tried. It did not happen, so
        // show what is stored (or, failing that, what was shown before).
        reminderService
          .status()
          .then(setStatus)
          .catch(() => setStatus(status));
      });
  };

  const phone = isAndroid();
  const preview = () => {
    reminderService
      .preview(settings.streakRisk && !settings.daily ? "streakRisk" : "daily")
      .then(() => showToast("Sent a sample reminder."))
      .catch(() =>
        showToast(
          phone
            ? "Your phone did not show the reminder. Check Leaflet's notifications in its settings."
            : "Windows did not show the reminder. Check its notification settings."
        )
      );
  };
  const openSettings = () => {
    reminderService.openSettings().catch(() => showToast(`Could not open the ${deviceNoun()}'s settings.`));
  };

  const anyOn = settings.daily || settings.streakRisk || settings.closeNudge;
  const row =
    "inset-field flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-xs text-on-surface-variant transition hover:text-primary";

  return (
    <div className="paper-surface rounded-xl p-5">
      <p
        className="text-xs uppercase tracking-widest text-on-surface-variant"
        title={`${pipOff ? "A gentle nudge" : "A gentle nudge from Pip"} when today's reading is still to do. Never at night, never while you're reading, at most once a day each, and never once the goal is met.`}
      >
        Reminders
      </p>
      <div className="mt-3 space-y-2">
        <div className="inset-field w-full px-4 py-3 text-xs text-on-surface-variant">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 text-left transition hover:text-primary"
            onClick={() => update({ daily: !settings.daily })}
            title={`"Time to read?" if today's goal isn't met yet.`}
          >
            <span>Daily reminder</span>
            <Toggle on={settings.daily} />
          </button>
          {settings.daily && (
            <label className="mt-3 flex items-center justify-between gap-4">
              <span>At</span>
              <input
                type="time"
                min="07:00"
                max="22:59"
                step={300}
                value={minutesToTime(settings.dailyAt ?? DEFAULT_REMINDERS.dailyAt)}
                onChange={(event) => {
                  const minutes = timeToMinutes(event.target.value);
                  if (minutes !== null) {
                    update({ dailyAt: minutes });
                  }
                }}
                className="inset-field px-2 py-1 text-xs text-on-surface"
              />
            </label>
          )}
        </div>
        <button
          type="button"
          className={row}
          onClick={() => update({ streakRisk: !settings.streakRisk })}
          title="At 10 pm, only when a streak is running and today isn't done."
        >
          <span>Streak at risk</span>
          <Toggle on={settings.streakRisk} />
        </button>
        <button
          type="button"
          className={row}
          onClick={() => update({ closeNudge: !settings.closeNudge })}
          title="A little after a session that left you five minutes or less short."
        >
          <span>"You're close"</span>
          <Toggle on={settings.closeNudge} />
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-on-surface-variant">
          {status.blocked &&
            (phone ? (
              <>
                Notifications for Leaflet are off.{" "}
                <button type="button" className="underline transition hover:text-primary" onClick={openSettings}>
                  Turn On
                </button>
              </>
            ) : (
              "Windows has notifications for Leaflet turned off. Turn them on in Windows Settings › System › Notifications."
            ))}
        </span>
        <button
          type="button"
          className="tactile-button px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-45"
          onClick={preview}
          disabled={!anyOn}
          title={
            status.whileClosed
              ? `Reminders arrive even when Leaflet is closed. ${phone ? "Tap" : "Select"} one to pick up where you left off.`
              : "This copy of Leaflet can only remind you while it's open, even minimised."
          }
        >
          Send a Test
        </button>
      </div>
    </div>
  );
};
