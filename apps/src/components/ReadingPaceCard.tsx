import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLibraryStore } from "../store/libraryStore";
import {
  createReadingProfile,
  describePace,
  forgetPace,
  paceLimits,
  setLimits,
  type DifficultyBand,
  type ReadingProfile
} from "../readers/paceModel";
import { readingProfileService } from "../services/readingProfileService";
import { readStartMode, saveStartMode, setReaderTourSeen, type StartMode } from "../readers/ReaderTour";
import { pausesWhenStill, setPausesWhenStill } from "../readers/pacing";

const BAND_LABELS: Record<DifficultyBand, string> = {
  easy: "Light reads",
  standard: "Most books",
  demanding: "Demanding"
};

const readingTime = (minutes: number) =>
  minutes < 90 ? `${minutes} minutes` : `${Math.round(minutes / 6) / 10} hours`;

type ReadingPaceCardProps = {
  showToast: (message: string) => void;
  renderToggle: (on: boolean) => ReactNode;
};

/**
 * What Leaflet has learned about how fast this reader reads, Dotty's range in
 * Smart Read, and how books open. The pace is learned while reading, in every
 * mode (readers/paceModel.ts), and travels with the backup.
 */
export const ReadingPaceCard = ({ showToast, renderToggle }: ReadingPaceCardProps) => {
  const accountEmail = useLibraryStore((state) => state.sync.accountEmail);
  const backedUp = useLibraryStore((state) => state.sync.driveConnected || Boolean(state.sync.folderPath));
  const requestBackup = useLibraryStore((state) => state.requestBackup);
  const [profile, setProfile] = useState<ReadingProfile | null>(null);
  const [startMode, setStartMode] = useState<StartMode>(readStartMode);
  const [pauseWhenStill, setPauseWhenStill] = useState(pausesWhenStill);
  const [confirmForget, setConfirmForget] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  // The range a slider was left at, while its save is still waiting.
  const unsavedRef = useRef<ReadingProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    readingProfileService
      .load(accountEmail)
      .then((loaded) => !cancelled && setProfile(loaded))
      .catch(() => !cancelled && setProfile(createReadingProfile()));
    return () => {
      cancelled = true;
    };
  }, [accountEmail]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      // Leaving Settings within half a second of moving a slider used to
      // drop the change: the card showed the new range and never saved it.
      const unsaved = unsavedRef.current;
      unsavedRef.current = null;
      if (unsaved) {
        void readingProfileService
          .save(unsaved)
          .then(() => useLibraryStore.getState().requestBackup())
          .catch(() => undefined);
      }
    },
    []
  );

  const save = (next: ReadingProfile, done?: string) =>
    readingProfileService
      .save(next)
      .then((stored) => {
        setProfile(stored);
        requestBackup();
        if (done) {
          showToast(done);
        }
      })
      .catch(() => showToast("Couldn't save that. Try again."));

  // A slider saves once it comes to rest, not on every step of a drag.
  const changeLimits = (change: Partial<{ minWpm: number; maxWpm: number }>) => {
    if (!profile) {
      return;
    }
    const next = setLimits(profile, { ...paceLimits(profile), ...change }, new Date().toISOString());
    setProfile(next);
    unsavedRef.current = next;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      unsavedRef.current = null;
      void save(next);
    }, 500);
  };

  const forget = () => {
    if (!profile) {
      return;
    }
    if (!confirmForget) {
      setConfirmForget(true);
      return;
    }
    setConfirmForget(false);
    void save(forgetPace(profile, new Date().toISOString()), "Forgotten. Leaflet will learn your pace afresh.");
  };

  const chooseStartMode = () => {
    const next: StartMode = startMode === "smart" ? "standard" : "smart";
    saveStartMode(next);
    setStartMode(next);
  };

  const summary = profile ? describePace(profile, Date.now()) : null;
  const limits = profile ? paceLimits(profile) : null;
  const bands = summary ? (Object.keys(BAND_LABELS) as DifficultyBand[]).filter((band) => summary.bands[band]) : [];

  return (
    <div className="paper-surface rounded-xl p-5">
      <p className="text-xs uppercase tracking-widest text-on-surface-variant">Reading Pace</p>
      <h3 className="page-title mt-2 text-2xl text-on-surface">
        {summary && summary.minutes >= 3 ? `About ${summary.wpm} words a minute` : "Still learning your pace"}
      </h3>
      <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
        {summary && summary.minutes >= 3
          ? `Learned from ${readingTime(summary.minutes)} of reading in ${summary.books} ${
              summary.books === 1 ? "book" : "books"
            }, in every mode. Each book keeps its own pace, and easy books read faster than demanding ones.`
          : "Read a few pages, in any mode, and Leaflet will know your pace. Each book keeps its own, and easy books read faster than demanding ones."}
      </p>
      {bands.length > 0 && summary && (
        <div className="mt-3 flex flex-wrap gap-2">
          {bands.map((band) => (
            <span key={band} className="inset-field px-3 py-1.5 text-[11px] text-on-surface-variant">
              {BAND_LABELS[band]} <strong className="text-on-surface tabular-nums">~{summary.bands[band]} wpm</strong>
            </span>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-on-surface-variant">
        {summary && summary.pausesSkipped > 0
          ? `Stops to think are left out (${summary.pausesSkipped} so far). `
          : "Stops to think are left out. "}
        {backedUp
          ? "It is kept with your backup, so every device reads at your pace."
          : "It is kept on this device; turn on backup to take it to your other devices."}
      </p>

      {limits && (
        // The two ends of the range sit side by side: one under the other they
        // made this the tallest card in Settings.
        <div className="section-rule mt-3 grid gap-x-6 gap-y-3 pt-3 sm:grid-cols-2">
          <p className="text-xs text-on-surface-variant sm:col-span-2">Dotty's range in Smart Read</p>
          <label className="block">
            <span className="flex items-center justify-between gap-3 text-xs text-on-surface-variant">
              <span>Slowest</span>
              <strong className="text-on-surface tabular-nums">{limits.minWpm} wpm</strong>
            </span>
            <input
              className="mt-2 w-full accent-primary"
              type="range"
              min={60}
              max={limits.maxWpm - 40}
              step={10}
              value={limits.minWpm}
              onChange={(event) => changeLimits({ minWpm: Number(event.target.value) })}
            />
          </label>
          <label className="block">
            <span className="flex items-center justify-between gap-3 text-xs text-on-surface-variant">
              <span>Fastest</span>
              <strong className="text-on-surface tabular-nums">{limits.maxWpm} wpm</strong>
            </span>
            <input
              className="mt-2 w-full accent-primary"
              type="range"
              min={limits.minWpm + 40}
              max={900}
              step={10}
              value={limits.maxWpm}
              onChange={(event) => changeLimits({ maxWpm: Number(event.target.value) })}
            />
          </label>
        </div>
      )}

      <div className="mt-3 space-y-3">
        <button
          type="button"
          className="inset-field flex w-full items-center justify-between px-4 py-3 text-xs text-on-surface-variant transition hover:text-primary"
          onClick={chooseStartMode}
        >
          <span className="text-left">
            <span className="block">Open books in Smart Read</span>
            <span className="mt-0.5 block text-[11px] opacity-75">Paused at your line; Space sets Dotty off.</span>
          </span>
          {renderToggle(startMode === "smart")}
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={pauseWhenStill}
          className="inset-field flex w-full items-center justify-between px-4 py-3 text-xs text-on-surface-variant transition hover:text-primary"
          title="Smart Read, SpeedRead and auto-scroll stop after five minutes without a key or the pointer, and wait for Space"
          onClick={() => {
            setPausesWhenStill(!pauseWhenStill);
            setPauseWhenStill(!pauseWhenStill);
          }}
        >
          <span className="text-left">Pause when I've been still for five minutes</span>
          {renderToggle(pauseWhenStill)}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          className="tactile-button px-4 py-2 text-xs"
          onClick={() => {
            setReaderTourSeen(false);
            showToast("The reader tour will show the next time you open a book.");
          }}
        >
          Show the Reader Tour Again
        </button>
        <button type="button" className="tactile-button px-4 py-2 text-xs" onClick={forget} disabled={!profile}>
          {confirmForget ? "Confirm: Forget My Pace" : "Forget My Pace"}
        </button>
        {confirmForget && (
          <button type="button" className="tactile-button px-4 py-2 text-xs" onClick={() => setConfirmForget(false)}>
            Keep It
          </button>
        )}
      </div>
    </div>
  );
};
