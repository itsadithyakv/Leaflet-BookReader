import { useEffect, useMemo, useRef, useState } from "react";
import { usePipWardrobeStore } from "../../store/pipWardrobeStore";
import { earnedRewards, goalProgress, goalRows, newRewards, rewardSeeds, type RewardMoment } from "../../pip/goals";
import { cuePip } from "../../pip/life";
import { playSound } from "../../pip/sound";
import { banner, bump, centerOf, collect, floatText, seedPixel, type Box } from "./fx";
import { UiIcon } from "../UiIcon";

/** The rewards this device has celebrated (its own record, never a claim). */
const SEEN_KEY = "leaflet.pip.rewardsSeen";
/** Whether the checklist is open or folded to its next step. */
const OPEN_KEY = "leaflet.pip.goalsOpen";

const readSeen = (): string[] | null => {
  try {
    const value = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "null") as unknown;
    return Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : null;
  } catch {
    return null;
  }
};
const writeSeen = (keys: string[]) => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(keys));
  } catch {
    // Celebrated again next time, at worst.
  }
};
const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
};

const defaultCounter = () => document.querySelector(".pip-hud-seeds");
const defaultStage = () => document.querySelector(".pip-house-room");

/** A little pixel chest, for the starter chest's line. */
const ChestIcon = ({ open }: { open: boolean }) => (
  <svg width="14" height="12" viewBox="0 0 7 6" shapeRendering="crispEdges" aria-hidden="true">
    <path fill="#5a3a1a" d="M0 1h7v5H0z" />
    <path fill={open ? "#ffd23f" : "#b07a4a"} d="M1 2h5v3H1z" />
    <path fill="#8a5a34" d={open ? "M1 0h5v1H1z" : "M1 1h5v1H1z"} />
    <path fill="#ffd23f" d="M3 3h1v1H3z" />
  </svg>
);

export type PipGoalsProps = {
  /** The seed counter reward seeds fly to. Defaults to the Pip tab's seed chip (`.pip-hud-seeds`). */
  counter?: () => Element | null;
  /** Where the chest or a finished set shows its title card. Defaults to the house scene's room. */
  stage?: () => Element | null;
  /**
   * Told as a reward's seeds take off and as the last one lands, so the page
   * can hold its counter at the old number meanwhile (as it does for a harvest).
   */
  onFlight?: (phase: "start" | "end", seeds: number) => void;
  className?: string;
};

/**
 * A new reader's first steps, as a small checklist: the starter chest, then
 * plant, water, read, pick, a treat, a hat and a lamp, each with the seeds it
 * pays, done ones ticked and the next one picked out with a hint. It folds
 * to its next step, and goes once every step is done and celebrated.
 *
 * It also celebrates every reward as it comes in (a step, the chest, a set
 * finished): "+N" where it was earned and seeds flying to the counter, a title
 * card for the chest and a set. Rust decides what is earned (the overview);
 * this device only remembers what it has already celebrated.
 *
 * Reads the overview from the wardrobe store; needs nothing else.
 */
export const PipGoals = ({ counter = defaultCounter, stage = defaultStage, onFlight, className }: PipGoalsProps) => {
  const overview = usePipWardrobeStore((state) => state.overview);
  const rows = useMemo(() => goalRows(overview), [overview]);
  const progress = goalProgress(rows);
  const next = rows.find((row) => row.next) ?? null;
  const [open, setOpen] = useState(readOpen);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  // Rewards arriving: the checklist stays up to show them, even the last step
  // ticked, and goes a moment after.
  const [holding, setHolding] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const timers = useRef(new Set<number>());
  const live = useRef({ counter, stage, onFlight });
  live.current = { counter, stage, onFlight };

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);
  const later = (ms: number, run: () => void) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, ms);
    timers.current.add(timer);
  };

  const toggle = () => {
    setOpen((current) => {
      try {
        localStorage.setItem(OPEN_KEY, current ? "0" : "1");
      } catch {
        // Remembered for this visit only.
      }
      return !current;
    });
  };

  /** Where a reward was earned, on screen: its line, or the checklist, or the room. */
  const originOf = (reward: RewardMoment): Box | null => {
    const row = rowRefs.current.get(reward.kind === "goal" ? reward.id : reward.kind === "chest" ? "chest" : "");
    const box = (row?.isConnected ? row : rootRef.current?.isConnected ? rootRef.current : live.current.stage())?.getBoundingClientRect();
    return box && box.width > 0 ? box : null;
  };

  /** One reward: "+N" where it was earned, a chime, seeds to the counter; a title card for the chest or a set. */
  const celebrate = (reward: RewardMoment, label?: string) => {
    const from = originOf(reward);
    const target = live.current.counter();
    const to = target?.querySelector("svg")?.getBoundingClientRect() ?? target?.getBoundingClientRect();
    playSound("chime");
    setFresh((current) => new Set(current).add(reward.kind === "goal" ? reward.id : reward.kind));
    later(1400, () => setFresh((current) => {
      const nextSet = new Set(current);
      nextSet.delete(reward.kind === "goal" ? reward.id : reward.kind);
      return nextSet;
    }));
    if (reward.kind !== "goal") {
      const room = live.current.stage()?.getBoundingClientRect();
      if (room && room.width > 0) banner(room, label ?? reward.label, `+${reward.seeds} seeds`);
    }
    if (!from) return;
    floatText({ x: from.left + Math.min(from.width - 24, from.width / 2 + 60), y: from.top + 4 }, `+${reward.seeds}`, "gain");
    if (!to) return;
    const count = Math.max(3, Math.min(10, Math.round(reward.seeds / 3)));
    live.current.onFlight?.("start", reward.seeds);
    void collect(centerOf(from), centerOf(to), {
      sprite: "seed",
      count,
      px: seedPixel(4),
      onLand: (index) => {
        bump(target, index === count - 1 ? 1.2 : 0.5);
        if (index === count - 1) live.current.onFlight?.("end", reward.seeds);
      }
    });
  };

  // Rewards that have come in since this device last celebrated: one after
  // another, a beat after whatever earned them has had its own moment. On a
  // device's first look everything earned is new, and comes as one.
  const earnedKey = earnedRewards(overview).map((reward) => reward.key).join(",");
  useEffect(() => {
    if (!overview) return;
    const seen = readSeen();
    const arrived = newRewards(seen, overview);
    if (arrived.length === 0) {
      if (seen === null) writeSeen([]);
      return;
    }
    // A set finished after the checklist is done celebrates without it.
    if (arrived.some((reward) => reward.kind !== "set")) setHolding(true);
    const timer = window.setTimeout(() => {
      const latest = usePipWardrobeStore.getState().overview;
      writeSeen(earnedRewards(latest).map((reward) => reward.key));
      const done = goalProgress(goalRows(latest));
      const combined = seen === null && arrived.length > 1;
      if (combined) {
        // One title card for all of it, and no single line lit up.
        const total = rewardSeeds(arrived);
        celebrate({ key: "all", kind: "set", id: "all", label: "Rewards", seeds: total }, "Rewards");
        cuePip({ move: "cheer", line: `you've been busy. +${total} seeds.` });
      } else {
        arrived.forEach((reward, index) => later(index * 900, () => celebrate(reward)));
      }
      if (done.of > 0 && done.done === done.of && arrived.some((reward) => reward.kind !== "set") && !combined) {
        cuePip({ move: "fireworks", line: "first steps, all done. you're a natural." });
      }
      later((combined ? 1 : arrived.length) * 900 + 2600, () => setHolding(false));
    }, seen === null ? 1400 : 900);
    return () => window.clearTimeout(timer);
    // earnedKey stands in for the overview: only what has been earned matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earnedKey, overview === null]);

  if (!overview || rows.length === 0 || (progress.done === progress.of && !holding)) return null;

  return (
    <section ref={rootRef} className={`pip-goals ${className ?? ""}`} aria-label="First steps" data-open={open || undefined}>
      <button type="button" className="pip-goals-head" aria-expanded={open} onClick={toggle}>
        <UiIcon name="sparkle" size={14} />
        <span className="pip-goals-title">First steps</span>
        <span className="pip-goals-count">
          {progress.done}/{progress.of}
        </span>
        <UiIcon name={open ? "minus" : "plus"} size={12} />
      </button>
      {open ? (
        <ol className="pip-goals-list">
          {rows.map((row) => (
            <li
              key={row.id}
              ref={(node) => {
                if (node) rowRefs.current.set(row.id, node);
                else rowRefs.current.delete(row.id);
              }}
              className="pip-goals-row"
              data-done={row.done || undefined}
              data-next={row.next || undefined}
              data-fresh={fresh.has(row.id) || undefined}
            >
              <span className="pip-goals-tick" aria-hidden="true">
                {row.done ? <UiIcon name="check" size={11} strokeWidth={3} /> : row.id === "chest" ? <ChestIcon open={false} /> : null}
              </span>
              <span className="pip-goals-text">
                <span className="pip-goals-name">
                  {row.name}
                  <span className="sr-only">{row.done ? ". Done." : row.next ? ". Next." : "."}</span>
                </span>
                {row.next && row.hint && <span className="pip-goals-hint">{row.hint}</span>}
              </span>
              <span className="pip-goals-seeds" aria-label={`${row.seeds} seeds`}>
                <UiIcon name="seed" size={11} />
                {row.seeds}
              </span>
            </li>
          ))}
        </ol>
      ) : next ? (
        <p className="pip-goals-next">
          <span className="pip-goals-name">{next.name}</span>
          <span className="pip-goals-seeds" aria-label={`${next.seeds} seeds`}>
            <UiIcon name="seed" size={11} />
            {next.seeds}
          </span>
        </p>
      ) : null}
    </section>
  );
};
