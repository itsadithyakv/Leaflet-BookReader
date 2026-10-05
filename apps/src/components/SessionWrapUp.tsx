import { Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { useHabitStore, wholeTodayMinutes, type SessionWrapUp as WrapUp } from "../store/habitStore";
import { usePipStore } from "../store/pipStore";
import { PipSprite } from "./PipSprite";
import { goalBeat, pickBeat, type PipBeat } from "../pip/moments";
import { getDateKey } from "../services/habitService";
import { useEquippedPip } from "../store/pipWardrobeStore";
import { CountUp } from "./community/CountUp";
import { UiIcon } from "./UiIcon";
import { FocusFlower, wiltReason } from "./FocusFlower";
import { FOCUS_FLOWERS } from "../pip/focusFlower.js";
import { buildAlbum, type Found } from "../pip/expedition";
import { NOTHING_FOUND, broughtBackText } from "./pip/album/words";
import { coldAfterSession } from "../pip/cold";
import "./pip/album/album.css";

// The find's picture is drawn with the house's art, which loads with the Pip
// tab and not with the app: it is fetched when a wrap-up has one to show.
const FindSprite = lazy(() => import("./pip/album/FindSprite"));

/** Set once Pip has explained the garden (water, ripe plants, seeds), so it says it once. */
const SEEDS_EXPLAINED_KEY = "leaflet.pip.seedsExplained";

const seedsExplained = () => {
  try {
    return localStorage.getItem(SEEDS_EXPLAINED_KEY) === "1";
  } catch {
    return true;
  }
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Where each petal of a bloom's burst flies to, from the flower's middle. */
const PETALS: Array<[number, number]> = [
  [-40, -30],
  [-14, -48],
  [16, -46],
  [42, -26],
  [-46, 4],
  [46, 8],
  [-26, 30],
  [28, 32]
];

/** A session's focus flower: bloomed, with a burst of its petals, or wilted, and why. */
const FlowerResult = ({ flower, blooms }: { flower: NonNullable<WrapUp["flower"]>; blooms: number }) => {
  const petal = FOCUS_FLOWERS[flower.kind]?.petal ?? "#E8484F";
  return (
    <div
      className={`mt-4 flex items-center gap-4 rounded-xl px-4 py-3 text-left ${
        flower.bloomed ? "bg-primary/10" : "bg-surface-container-high/70"
      }`}
    >
      <div className="relative shrink-0">
        <FocusFlower
          kind={flower.kind}
          progress={flower.bloomed ? 1 : (flower.at ?? 0)}
          state={flower.bloomed ? "bloomed" : "wilted"}
          box={72}
        />
        {flower.bloomed && (
          <span className="flower-burst" aria-hidden="true">
            {PETALS.map(([dx, dy], index) => (
              <span
                key={index}
                style={
                  {
                    "--dx": `${dx}px`,
                    "--dy": `${dy}px`,
                    "--petal": petal,
                    animationDelay: `${160 + index * 30}ms`
                  } as CSSProperties
                }
              />
            ))}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="font-headline text-base font-bold text-on-surface">
          {flower.bloomed ? `Your ${flower.kind} bloomed` : `Your ${flower.kind} wilted`}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-on-surface-variant">
          {flower.bloomed
            ? blooms > 1
              ? `${plural(blooms, "focus flower")} grown so far.`
              : "Your first focus flower. Stay in full screen to grow more."
            : `It wilted because ${flower.wilted ? wiltReason(flower.wilted) : "the session ended early"}. The minutes you read still count.`}
        </p>
      </div>
    </div>
  );
};

/**
 * What Pip brought back from the session (pip/expedition.ts): the thing, her
 * line about it, how rare it is, how far she got, and whether it is new to
 * her album. A session too short to find anything says so, kindly.
 */
const FindResult = ({ found, count, showPip }: { found: Found | null; count: number; showPip: boolean }) => {
  if (!found) {
    return <p className="wrapup-find-none">{NOTHING_FOUND}</p>;
  }
  const words = broughtBackText(found, count);
  return (
    <div className="wrapup-find" data-rarity={found.find.rarity}>
      {/* The box has its size before the picture arrives, so nothing moves when it does. */}
      <div className="wrapup-find-art">
        <Suspense fallback={null}>
          <FindSprite id={found.find.id} box={36} />
        </Suspense>
      </div>
      <div className="min-w-0">
        <p className="font-headline text-base font-bold text-on-surface">{words.headline}</p>
        {showPip && <p className="pip-line text-sm">{found.find.line}</p>}
        <p className="text-xs text-on-surface-variant">{words.detail}</p>
      </div>
    </div>
  );
};

/**
 * Pip's reaction to a session, strongest news first. Goal beats are seeded by
 * the day, so the move matches the one the rest of the app would pick.
 */
const pickWrapUpMove = (wrapUp: WrapUp): PipBeat => {
  const minutes = Math.round(wrapUp.minutes);
  if (wrapUp.goalJustMet) {
    return goalBeat(wrapUp.streak, getDateKey(), wrapUp.newRecord);
  }
  if (wrapUp.flower) {
    return pickBeat(wrapUp.flower.bloomed ? "flowerBloomed" : "flowerWilted", wrapUp.sessionId, {
      name: wrapUp.flower.kind
    });
  }
  if (minutes >= 25) {
    return pickBeat("deepRead", wrapUp.sessionId, { minutes });
  }
  if (minutes < 5) {
    return pickBeat("sessionShort", wrapUp.sessionId);
  }
  if (!wrapUp.todayMet) {
    const left = Math.max(1, Math.ceil(wrapUp.goalMinutes - wrapUp.todayMinutes));
    return pickBeat("sessionProgress", wrapUp.sessionId, { left });
  }
  return pickBeat("bonus", wrapUp.sessionId);
};

/**
 * The one place Pip is big. Shown over the library or the reader whenever a
 * focus session ends, and it carries the session note that used to be its own
 * modal in two places.
 */
export const SessionWrapUp = () => {
  const { wrapUp, dismissWrapUp, addSessionNote, notesEnabled } = useHabitStore(
    useShallow((state) => ({
      wrapUp: state.wrapUp,
      dismissWrapUp: state.dismissWrapUp,
      addSessionNote: state.addSessionNote,
      notesEnabled: state.focusSettings.sessionNotes
    }))
  );
  const pipMode = usePipStore((state) => state.mode);
  // Only claim a shelf number once the session is actually in the snapshot.
  const shelfCount = useHabitStore((state) =>
    wrapUp && state.snapshot.sessions.some((session) => session.id === wrapUp.sessionId)
      ? state.snapshot.shelfCount
      : null
  );
  // What she brought back, once the session is on the shelf: worked out from
  // the shelf as the album works it out, so the card says what the album shows.
  const sessions = useHabitStore((state) => state.snapshot.sessions);
  const sessionId = wrapUp?.sessionId;
  const brought = useMemo(() => {
    if (!sessionId || !sessions.some((session) => session.id === sessionId)) {
      return null;
    }
    const album = buildAlbum(sessions);
    const found = album.finds.find((entry) => entry.sessionId === sessionId) ?? null;
    return { found, count: album.entries.find((entry) => entry.find.id === found?.find.id)?.count ?? 0 };
  }, [sessionId, sessions]);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [note, setNote] = useState("");
  const [settled, setSettled] = useState(false);
  const equipped = useEquippedPip();
  // Water and seeds count up from zero a beat after the card appears.
  const [waterShown, setWaterShown] = useState(0);
  const [seedsShown, setSeedsShown] = useState(0);
  // Decided when the card opens, so the explanation does not vanish mid-read
  // once it has been marked as seen.
  const [explainSeeds, setExplainSeeds] = useState(false);

  useEffect(() => {
    setNote("");
    setSettled(false);
    setWaterShown(0);
    setSeedsShown(0);
    const water = wrapUp?.water ?? 0;
    const seeds = wrapUp?.seeds ?? 0;
    if (water <= 0 && seeds <= 0) {
      setExplainSeeds(false);
      return;
    }
    const first = !seedsExplained();
    setExplainSeeds(first);
    if (first) {
      try {
        localStorage.setItem(SEEDS_EXPLAINED_KEY, "1");
      } catch {
        // Explained again next time; harmless.
      }
    }
    const timer = window.setTimeout(() => {
      setWaterShown(water);
      setSeedsShown(seeds);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [wrapUp?.sessionId, wrapUp?.water, wrapUp?.seeds]);

  const close = (save: boolean) => {
    if (!wrapUp) {
      return;
    }
    if (save && note.trim()) {
      void addSessionNote(wrapUp.sessionId, note.trim());
    }
    dismissWrapUp();
  };

  // A card with everything on it (a flower, a find, the garden, a note) can be
  // taller than a small window: its body scrolls then, over a foot that keeps
  // Done in view, and opens at the top.
  useEffect(() => {
    if (cardRef.current) {
      cardRef.current.scrollTop = 0;
    }
  }, [sessionId, brought]);

  // The reader and the library both listen for Space, arrows and Escape on the
  // window. Capturing here keeps those keys from paging the book or closing the
  // reader underneath; Escape closes this instead.
  useEffect(() => {
    if (!wrapUp) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        return;
      }
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        dismissWrapUp();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [wrapUp, dismissWrapUp]);

  if (!wrapUp) {
    return null;
  }

  const { move, line } = pickWrapUpMove(wrapUp);
  const showPip = pipMode !== "off";
  const minutes = Math.max(1, Math.round(wrapUp.minutes));
  const todayMinutes = wholeTodayMinutes(wrapUp.todayMinutes, wrapUp.todayMet);
  const goalProgress = wrapUp.goalMinutes > 0 ? Math.min(1, wrapUp.todayMinutes / wrapUp.goalMinutes) : 0;
  const coldLine = coldAfterSession(wrapUp.cold, wrapUp.coldCured);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wrapup-title"
    >
      <div className="modal-surface flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl">
        {/* The body scrolls when the card is taller than the window; the foot below it stays put. */}
        <div ref={cardRef} className="wrapup-body min-h-0 flex-1 overflow-y-auto px-6 pb-1 pt-6">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:text-left">
            {showPip && (
              <div className="pip-stage shrink-0">
                <PipSprite
                  move={settled ? "idle" : move}
                  size={128}
                  skin={equipped.skin}
                  outfit={equipped.outfit}
                  loops={settled ? undefined : 2}
                  onDone={() => setSettled(true)}
                  label={`Pip: ${line}`}
                />
              </div>
            )}
            {/* max-w-full: stacked (a narrow window), a centred item is as wide as
                its longest line, and the book's title is one unbroken line. */}
            <div className="min-w-0 max-w-full">
              <p className="text-xs uppercase tracking-widest text-on-surface-variant">
                {wrapUp.reason === "completed" ? "Session complete" : "Session ended"}
              </p>
              <h2 id="wrapup-title" className="page-title mt-1 text-2xl text-on-surface">
                {plural(minutes, "minute")}
              </h2>
              {wrapUp.title && (
                <p className="mt-0.5 truncate text-sm text-on-surface-variant" title={wrapUp.title}>
                  {wrapUp.title}
                </p>
              )}
              {showPip && <p className="pip-line mt-2">{line}</p>}
            </div>
          </div>

          {wrapUp.flower && <FlowerResult flower={wrapUp.flower} blooms={wrapUp.blooms} />}
          {brought && <FindResult found={brought.found} count={brought.count} showPip={showPip} />}

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="inset-field p-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Today</p>
              <p className="mt-1 font-headline text-lg font-bold tabular-nums text-on-surface">
                {todayMinutes}
                <span className="text-sm font-normal text-on-surface-variant"> / {wrapUp.goalMinutes} min</span>
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-outline-variant/30">
                <div className="h-full rounded-full bg-primary" style={{ width: `${goalProgress * 100}%` }} />
              </div>
            </div>
            <div className="inset-field p-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Streak</p>
              <p className="mt-1 font-headline text-lg font-bold tabular-nums text-on-surface">
                {plural(wrapUp.streak, "day")}
              </p>
              <p className="mt-1 text-[11px] text-on-surface-variant">
                {wrapUp.newRecord ? "Your longest yet" : `${plural(wrapUp.freezes, "freeze")} banked`}
              </p>
            </div>
          </div>
          {/* Her cold, if a streak ended lately: cured by this session's reading, or how much more today would. */}
          {coldLine && (
            <p
              className={`wrapup-cold mt-3 text-center ${wrapUp.coldCured ? "text-sm font-semibold text-on-surface" : "text-xs text-on-surface-variant"}`}
            >
              {coldLine}
            </p>
          )}
          {(wrapUp.water > 0 || wrapUp.seeds > 0) && (
            <div className="mt-3 flex flex-col items-center gap-1.5 text-center">
              <p className="flex flex-wrap items-center justify-center gap-2">
                {wrapUp.water > 0 && (
                  <span className="seed-chip seed-chip-earned water-chip" aria-label={`${wrapUp.water} water for Pip's garden`}>
                    <UiIcon name="water" size={15} />
                    <span className="tabular-nums" aria-hidden="true">
                      +<CountUp value={waterShown} />
                    </span>
                    <span aria-hidden="true">water</span>
                  </span>
                )}
                {wrapUp.seeds > 0 && (
                  <span className="seed-chip seed-chip-earned" aria-label={`${wrapUp.seeds} bonus seeds`}>
                    <UiIcon name="seed" size={15} />
                    <span className="tabular-nums" aria-hidden="true">
                      +<CountUp value={seedsShown} />
                    </span>
                    <span aria-hidden="true">{wrapUp.seeds === 1 ? "seed" : "seeds"}</span>
                  </span>
                )}
              </p>
              {wrapUp.ripe > 0 && (
                <p className="text-sm font-semibold text-on-surface">
                  {wrapUp.newlyRipe > 0
                    ? `${plural(wrapUp.newlyRipe, "plant")} just ripened!`
                    : `${plural(wrapUp.ripe, "plant")} ripe in the garden.`}{" "}
                  <span className="font-normal text-on-surface-variant">Pick {wrapUp.ripe === 1 ? "it" : "them"} on the Pip tab.</span>
                </p>
              )}
              {explainSeeds && (
                <p className={showPip ? "pip-line text-sm" : "text-xs text-on-surface-variant"}>
                  {showPip
                    ? "psst: reading waters my garden. when a plant ripens, pick it for seeds, then spend them on me."
                    : "Reading in focus waters Pip's garden. Ripe plants are picked for seeds, to spend on Pip."}
                </p>
              )}
            </div>
          )}
          {shelfCount !== null && shelfCount > 0 && (
            <p className="mt-3 text-center text-xs text-on-surface-variant">Shelved as book #{shelfCount}</p>
          )}

          {notesEnabled && (
            <>
              <label htmlFor="wrapup-note" className="mt-5 block text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">
                Session note
              </label>
              <textarea
                id="wrapup-note"
                className="mt-1 h-24 w-full resize-none rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface"
                placeholder="What did you read or learn?"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </>
          )}
        </div>

        <div className="wrapup-foot flex shrink-0 items-center justify-end gap-3 px-6 pb-6 pt-4">
          {notesEnabled && note.trim().length > 0 && (
            <button type="button" className="tactile-button px-4 py-2 text-xs uppercase tracking-widest" onClick={() => close(false)}>
              Skip Note
            </button>
          )}
          <button
            type="button"
            className="tactile-button tactile-button-primary px-5 py-2 text-xs font-semibold"
            onClick={() => close(true)}
            autoFocus
          >
            {notesEnabled && note.trim().length > 0 ? "Save Note" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
};
