import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { PipSprite } from "../PipSprite";
import { PipSay } from "../PipSay";
import { avatarLook } from "../community/PipAvatar";
import { streakText } from "../community/copy";
import { at, minutesText, nameOf, prefersReducedMotion } from "../community/format";
import { playSound } from "../../pip/sound";
import {
  knockLine,
  noteLine,
  visitPose,
  visitTimeline,
  type Door,
  type VisitPhase,
  type VisitRecord,
  type VisitorCandidate
} from "../../pip/visitors";
import "./visitor.css";

/**
 * What a visitor needs of the room: its scale and floor, as `HouseScene`'s
 * `RoomFrame` gives them (which this is a part of, so a frame can be passed
 * straight in).
 */
export type VisitorFrame = {
  /** CSS pixels per floor pixel. */
  scale: number;
  /** The floor's width, in floor pixels. */
  w: number;
  /** Where feet stand. */
  walkY: number;
};

/** What the house may want to answer: a knock, the visitor reaching its place, the visitor gone. */
export type VisitorEvent = { type: "knocked" | "arrived" | "left"; visitor: VisitorCandidate };

type CardProps = {
  visitor: VisitorCandidate;
  /** A line under the handle: why they are here, or that they came by. */
  why: string;
  frame: VisitorFrame;
  /** The floor x the card sits over. */
  x: number;
  onClose: () => void;
  onOpenProfile?: (handle: string) => void;
};

const CARD_W = 190;

/**
 * Who the visitor is: only what their public profile already shows (name,
 * handle, streak, this week's minutes), and a way to their card on the Social
 * page. Over the visitor where there is room above it, and always inside the
 * room (which clips); Escape or the cross closes it.
 */
const VisitorCard = ({ visitor, why, frame, x, onClose, onOpenProfile }: CardProps) => {
  const card = useRef<HTMLDivElement | null>(null);
  const close = useRef<HTMLButtonElement | null>(null);
  // Its height is its text's, so its place is found once it is laid out.
  const [top, setTop] = useState<number | null>(null);
  const above = (frame.walkY - 30) * frame.scale - 8;
  useLayoutEffect(() => {
    setTop(Math.max(6, above - (card.current?.offsetHeight ?? 0)));
  }, [above, visitor.handle]);
  // Focus moves in once the card is placed (while it is being measured it is not shown, and cannot take it).
  const placed = top !== null;
  useEffect(() => {
    if (placed) close.current?.focus();
  }, [placed]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };
  const left = Math.max(6, Math.min(frame.w * frame.scale - CARD_W - 6, x * frame.scale - CARD_W / 2));
  return (
    <div
      ref={card}
      className="pip-visitor-card"
      role="dialog"
      aria-label={`${at(visitor.handle)}, visiting`}
      style={{ left, top: top ?? 6, visibility: top === null ? "hidden" : undefined }}
      onKeyDown={onKeyDown}
    >
      <button ref={close} type="button" className="pip-visitor-card-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <p className="pip-visitor-card-name">{nameOf(visitor)}</p>
      {visitor.displayName && <p className="pip-visitor-card-handle">{at(visitor.handle)}</p>}
      <p className="pip-visitor-card-why">{why}</p>
      <ul className="pip-visitor-card-figures">
        <li>
          <b>{streakText(visitor.streak)}</b>streak
        </li>
        <li>
          <b>{minutesText(visitor.weekMinutes)}</b>this week
        </li>
      </ul>
      {onOpenProfile && (
        <button type="button" className="pip-visitor-card-open" onClick={() => onOpenProfile(visitor.handle)}>
          Open profile
        </button>
      )}
    </div>
  );
};

export type VisitorPipProps = {
  /** Who is visiting. */
  visitor: VisitorCandidate;
  /** From when until when (epoch ms): the visit is played by the clock. */
  record: VisitRecord;
  frame: VisitorFrame;
  /** Where the visitor stands (its feet), in floor pixels. */
  spot: number;
  /** Where it comes in from and leaves by: just beyond a side wall. */
  door: Door;
  /** Where Pip is, for the visitor to face while it sits. */
  hostX?: () => number | undefined;
  /** Each change of phase (and null when the visitor is taken away mid-visit), with the place it stands. */
  onPhase?: (phase: VisitPhase | null, x?: number) => void;
  onEvent?: (event: VisitorEvent) => void;
  /** Shows the reader's card on the Social page. Left out, the card has no such button. */
  onOpenProfile?: (handle: string) => void;
  /** The clock, for the preview's tests. */
  now?: () => number;
};

type View = { phase: VisitPhase; move: string; facing: 1 | -1; shown: boolean };

/**
 * A friend's Pip, visiting: it knocks (a sound, when sounds are on, and a
 * word from the door), walks in from the door to its place, waves, sits and
 * reads, waves goodbye and walks out. Drawn with the friend's own look, the
 * way the board draws them, with their @handle on a tag underneath.
 *
 * Where it is comes from the clock (`visitPose`), written straight to the
 * transform as Pip's own is; React hears only of a change of phase. Under
 * reduced motion nothing travels: after the knock it is in its place, still,
 * and then it is gone.
 *
 * Mounted inside the room box (`position: relative`), beside Pip.
 */
export const VisitorPip = ({ visitor, record, frame, spot, door, hostX, onPhase, onEvent, onOpenProfile, now = Date.now }: VisitorPipProps) => {
  const node = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const [view, setView] = useState<View>({ phase: "knock", move: "idle", facing: 1, shown: false });
  const [open, setOpen] = useState(false);
  const live = useRef({ hostX, onPhase, onEvent, now, visitor });
  live.current = { hostX, onPhase, onEvent, now, visitor };
  const reduced = prefersReducedMotion();
  const { scale, walkY } = frame;

  useEffect(() => {
    const timeline = visitTimeline(record.until - record.from, door.x - spot, reduced);
    let frameId = 0;
    let timer = 0;
    let stopped = false;
    let last: View | null = null;

    const step = () => {
      if (stopped) return;
      const { hostX: host, onPhase: phased, onEvent: raise, now: clock, visitor: who } = live.current;
      const pose = visitPose(clock() - record.from, timeline, door.x, spot, host?.() ?? undefined);
      if (node.current) {
        // A 32-pixel sprite standing at x: its box starts 16 to the left and 30 above the feet.
        node.current.style.transform = `translate(${((pose.x - 16) * scale).toFixed(2)}px, ${((walkY - 30) * scale).toFixed(2)}px)`;
      }
      if (!last || last.phase !== pose.phase || last.facing !== pose.facing) {
        const before = last?.phase ?? null;
        last = { phase: pose.phase, move: pose.move, facing: pose.facing, shown: pose.shown };
        setView(last);
        if (before !== pose.phase) {
          phased?.(pose.phase, spot);
          if (pose.phase === "knock") {
            // Two sets of raps, a moment apart. Nothing is heard with sounds off.
            playSound("knock");
            playSound("knock", { delay: 1200, pitch: 1.06 });
            raise?.({ type: "knocked", visitor: who });
          } else if ((pose.phase === "hello" || pose.phase === "read") && (before === "knock" || before === "walkIn")) {
            raise?.({ type: "arrived", visitor: who });
          } else if (pose.phase === "gone") {
            raise?.({ type: "left", visitor: who });
          }
        }
      }
      if (pose.phase === "gone") {
        return;
      }
      // Walking is drawn every frame; anything else only needs to notice its own end (and which way Pip is).
      if (pose.move === "walk") {
        frameId = requestAnimationFrame(step);
      } else {
        timer = window.setTimeout(step, Math.max(16, Math.min(pose.left, 500)));
      }
    };
    step();
    return () => {
      stopped = true;
      cancelAnimationFrame(frameId);
      window.clearTimeout(timer);
      live.current.onPhase?.(null);
    };
  }, [record.from, record.until, door.x, spot, scale, walkY, reduced]);

  // Gone: whatever was open about them closes with them.
  useEffect(() => {
    if (!view.shown) setOpen(false);
  }, [view.shown]);

  const look = avatarLook(visitor.pipSeed, visitor.avatar);
  const size = 32 * scale;
  const reading = view.phase === "read";
  const closeCard = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <>
      {view.phase === "knock" && (
        <div className="pip-visitor-knock" data-side={door.side} style={{ top: Math.max(4, (walkY - 52) * scale) }}>
          <PipSay text={knockLine(visitor.handle)} tail={door.side} tailAt={70} />
        </div>
      )}
      <div ref={node} className="pip-visitor" data-phase={view.phase} hidden={!view.shown} style={{ width: size, height: size }}>
        <button
          ref={button}
          type="button"
          className="pip-visitor-button"
          style={{ width: size, height: size }}
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`${at(visitor.handle)}'s Pip, visiting${reading ? " and reading beside Pip" : ""}. Select to see who it is.`}
          title={`${at(visitor.handle)} is visiting`}
        >
          <span className="pip-visitor-flip" data-facing={view.facing < 0 ? "left" : "right"}>
            <PipSprite move={view.move} size={size} skin={look.skin} outfit={look.outfit} still={reduced} />
          </span>
        </button>
        <span className="pip-visitor-tag" aria-hidden="true">
          {at(visitor.handle)}
        </span>
      </div>
      {open && view.shown && (
        <VisitorCard visitor={visitor} why="Read today, like you." frame={frame} x={spot} onClose={closeCard} onOpenProfile={onOpenProfile} />
      )}
    </>
  );
};

export type VisitorNoteProps = {
  /** Who came by while nobody was home. */
  visitor: VisitorCandidate;
  frame: VisitorFrame;
  door: Door;
  /** The note has been read (its card was closed): it comes off the door. */
  onRead: () => void;
  onOpenProfile?: (handle: string) => void;
};

/**
 * The note a friend leaves when Pip was asleep or out: a scrap of paper
 * pinned by the door. Selecting it says who came by; closing that takes the
 * note down.
 */
export const VisitorNote = ({ visitor, frame, door, onRead, onOpenProfile }: VisitorNoteProps) => {
  const [open, setOpen] = useState(false);
  const { scale, walkY, w } = frame;
  // By the wall the door is in, at about Pip's eye level.
  const x = door.side === "right" ? w - 16 : 7;
  return (
    <>
      <button
        type="button"
        className="pip-visitor-note"
        style={{ left: x * scale, top: (walkY - 46) * scale, width: 9 * scale, height: 10 * scale }}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`A note on the door: ${noteLine(visitor.handle)}. Select to read it.`}
        title={noteLine(visitor.handle)}
      />
      {open && (
        <VisitorCard
          visitor={visitor}
          why="Came by while Pip was away."
          frame={frame}
          x={x}
          onClose={() => {
            setOpen(false);
            onRead();
          }}
          onOpenProfile={onOpenProfile}
        />
      )}
    </>
  );
};
