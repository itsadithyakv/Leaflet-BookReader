import { useEffect, type CSSProperties } from "react";
import { UiIcon } from "../UiIcon";
import { Burst, Shield, TickCount } from "./StreakArt";
import { FlameSprite, IceCube } from "./sprites";
import { keyDate, type StreakMoment } from "./streakModel";
import { useStreakMoments, useStreakUi } from "./useStreakMoments";
import "./streak.css";

/** How long a happy moment stays before it goes by itself. A lost streak waits to be answered. */
const STAYS: Record<StreakMoment["kind"], number | null> = { goal: 4200, saved: 5200, milestone: 6500, lost: null };

const weekday = (key: string) => keyDate(key).toLocaleDateString(undefined, { weekday: "long" });

const GoalMoment = ({ moment }: { moment: Extract<StreakMoment, { kind: "goal" }> }) => (
  <>
    <span className="streak-moment-art streak-anim">
      <FlameSprite state="lit" scale={4} className="streak-ignite" />
      <Burst count={8} reach={30} />
    </span>
    <div className="min-w-0">
      <p className="streak-moment-title">
        <TickCount from={Math.max(0, moment.streak - 1)} to={moment.streak} />-day streak
      </p>
      <p className="streak-moment-sub">Today's goal met</p>
    </div>
  </>
);

const SavedMoment = ({ moment }: { moment: Extract<StreakMoment, { kind: "saved" }> }) => (
  <>
    <span className="streak-moment-art streak-anim">
      <span className="streak-bubble streak-saving" data-kind="frozen">
        <IceCube scale={3} />
        <svg className="streak-crack" viewBox="0 0 52 52" aria-hidden="true">
          <path d="M14 10 L22 20 L18 26 L28 34 L26 42" />
          <path d="M22 20 L32 16 L38 22" />
        </svg>
        <Shield />
      </span>
    </span>
    <div className="min-w-0">
      <p className="streak-moment-title">Streak saved</p>
      <p className="streak-moment-sub" title={moment.by === "freeze" ? "A freeze covered the missed day" : "One missed day a streak is forgiven"}>
        {moment.days.length === 1 ? weekday(moment.days[0]) : `${moment.days.length} days`} · {moment.by === "freeze" ? "freeze" : "grace day"}
      </p>
    </div>
  </>
);

const MilestoneMoment = ({ moment }: { moment: Extract<StreakMoment, { kind: "milestone" }> }) => (
  <>
    <span className="streak-moment-art streak-anim">
      <FlameSprite state="lit" scale={5} className="streak-ignite" />
      <Burst count={16} reach={44} big />
    </span>
    <div className="min-w-0">
      <p className="streak-moment-title text-lg">{moment.milestone} days!</p>
      <p className="streak-moment-sub">A {moment.milestone}-day streak</p>
    </div>
  </>
);

const EMBERS = [
  { "--x": "-8px", "--d": "500ms" },
  { "--x": "2px", "--d": "750ms" },
  { "--x": "9px", "--d": "1000ms" }
] as unknown as CSSProperties[];

const LostMoment = ({ moment, onRead, onClose }: { moment: Extract<StreakMoment, { kind: "lost" }>; onRead: () => void; onClose: () => void }) => (
  <>
    <span className="streak-moment-art streak-anim">
      <FlameSprite state="out" scale={4} />
      <span className="streak-fading">
        <FlameSprite state="lit" scale={4} />
      </span>
      <span className="streak-rising" aria-hidden="true">
        {EMBERS.map((style, at) => (
          <i key={at} style={style} />
        ))}
      </span>
    </span>
    <div className="min-w-0 flex-1">
      <p className="streak-moment-title" title={`Your streak ran ${moment.from} days`}>
        The flame went out
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="pip-key pip-key-primary pip-key-small"
          onClick={() => {
            onClose();
            onRead();
          }}
        >
          Start again
        </button>
        <button type="button" className="pip-key pip-key-quiet pip-key-small" onClick={onClose}>
          Later
        </button>
      </div>
    </div>
  </>
);

type Props = {
  /** Held back: a book open, the session wrap-up up. */
  paused: boolean;
  onRead: () => void;
};

/**
 * The streak's moments, each shown once (useStreakMoments): a goal met, a
 * day saved by a freeze or grace, a milestone, and a streak lost. A card
 * under the header; a tap on it opens the streak's panel.
 */
export const StreakMoments = ({ paused, onRead }: Props) => {
  const open = useStreakUi((state) => state.open);
  const moment = useStreakUi((state) => state.moment);
  const dismiss = useStreakUi((state) => state.dismissMoment);
  const setOpen = useStreakUi((state) => state.setOpen);
  useStreakMoments(paused || open);

  useEffect(() => {
    const stays = moment ? STAYS[moment.kind] : null;
    if (!moment || paused || stays === null) return undefined;
    const timer = window.setTimeout(dismiss, stays);
    return () => window.clearTimeout(timer);
  }, [moment, paused, dismiss]);

  if (!moment || paused) return null;

  const openPanel = () => {
    dismiss();
    setOpen(true);
  };

  return (
    <div
      key={moment.keys[0]}
      className="streak-moment"
      role="status"
      data-kind={moment.kind}
      onClick={(event) => {
        if (moment.kind !== "lost" && !(event.target as HTMLElement).closest("button")) openPanel();
      }}
    >
      {moment.kind === "goal" && <GoalMoment moment={moment} />}
      {moment.kind === "saved" && <SavedMoment moment={moment} />}
      {moment.kind === "milestone" && <MilestoneMoment moment={moment} />}
      {moment.kind === "lost" && <LostMoment moment={moment} onRead={onRead} onClose={dismiss} />}
      {moment.kind !== "lost" && (
        <button type="button" className="ml-auto self-start text-[var(--hud-ink-soft)] hover:text-[var(--hud-ink)]" aria-label="Close" onClick={dismiss}>
          <UiIcon name="close" size={16} />
        </button>
      )}
    </div>
  );
};
