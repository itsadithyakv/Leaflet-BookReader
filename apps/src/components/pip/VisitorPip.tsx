import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Footprints } from "lucide-react";
import { UiIcon } from "../UiIcon";
import { PipSprite } from "../PipSprite";
import { PipSay } from "../PipSay";
import { avatarLook } from "../community/PipAvatar";
import { streakText } from "../community/copy";
import { at, minutesText, nameOf, prefersReducedMotion } from "../community/format";
import { playSound } from "../../pip/sound";
import {
  knockLine,
  noteLine,
  togetherBeats,
  togetherPose,
  visitPose,
  visitTimeline,
  type Door,
  type TogetherKind,
  type VisitPhase,
  type VisitRecord,
  type VisitorAct,
  type VisitorCandidate
} from "../../pip/visitors";
import { cardBounds, placeCard } from "./cardPlace";
import type { Rect } from "./layout";
import "./visitor.css";
import { useBackLayer } from "../../platform/back";

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
  /** Its height, when the room says (a tag under a visitor's feet has to fit above the room's foot). */
  h?: number;
  /** Where feet stand. */
  walkY: number;
  /**
   * The floor that shows, when the room says (where it fills a phone's screen it runs on past the room's walls):
   * its ends, and (`edge`) where the picture ends, which a visitor comes in from past.
   */
  span?: { left: number; right: number; edge: number };
};

/**
 * What the house may want to answer: a knock, the visitor reaching its place, the visitor gone; and, by the
 * visit's own plan (`togetherBeats`), a time to do something together.
 */
export type VisitorEvent = { type: "knocked" | "arrived" | "left"; visitor: VisitorCandidate } | { type: "together"; kind: TogetherKind; visitor: VisitorCandidate };

/** What the reader can ask the two to do together, from the visitor's card: the Play keys' words. */
const TOGETHER_KEYS: ReadonlyArray<{ kind: TogetherKind; label: string; title: string }> = [
  { kind: "highfive", label: "High 5", title: "A high five, Pip and your friend's Pip" },
  { kind: "ball", label: "Ball", title: "Pass the ball between them" },
  { kind: "dance", label: "Dance", title: "A dance together" },
  { kind: "chase", label: "Chase", title: "A chase across the floor" }
];

const TogetherIcon = ({ kind }: { kind: TogetherKind }) =>
  kind === "chase" ? <Footprints size={18} aria-hidden /> : <UiIcon name={kind === "highfive" ? "hand" : kind === "ball" ? "goal" : "move"} size={18} />;

type CardProps = {
  visitor: VisitorCandidate;
  /** A line under the handle: why they are here, or that they came by. */
  why: string;
  /** What it is about (the visitor, the note on the door), on screen now; null once that is gone. */
  anchor: () => Rect | null;
  onClose: () => void;
  onOpenProfile?: (handle: string) => void;
  /** Something for the two Pips to do together (the visitor is sitting with Pip): the keys for it, under who it is. */
  onTogether?: (kind: TogetherKind) => void;
};

/**
 * Who the visitor is: only what their public profile already shows (name,
 * handle, streak, this week's minutes), and a way to their card on the Social
 * page. By the visitor, placed as the room's own cards are (cardPlace.ts) and
 * laid over the whole window like them: inside the room, which clips, its
 * last button was cut off wherever the room is under 150 px tall. Escape or
 * the cross closes it.
 */
const VisitorCard = ({ visitor, why, anchor, onClose, onOpenProfile, onTogether }: CardProps) => {
  // Android's Back closes it, as Escape does.
  useBackLayer(true, onClose);
  const card = useRef<HTMLDivElement | null>(null);
  const close = useRef<HTMLButtonElement | null>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  // Its height is its text's, so its place is found once it is laid out.
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const box = anchorRef.current();
      const root = card.current;
      if (!box || !root) return;
      const viewport = cardBounds();
      const { left, top } = placeCard(box, { width: root.offsetWidth, height: root.offsetHeight }, viewport);
      setPlace((was) => (was && was.left === left && was.top === top ? was : { left, top }));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [visitor.handle]);
  // Focus moves in once the card is placed (while it is being measured it is not shown, and cannot take it).
  const placed = place !== null;
  useEffect(() => {
    if (placed) close.current?.focus();
  }, [placed]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };
  return createPortal(
    <div
      ref={card}
      className="pip-visitor-card"
      role="dialog"
      aria-label={`${at(visitor.handle)}, visiting`}
      style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place === null ? "hidden" : undefined }}
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
      {onTogether && (
        <div className="pip-visitor-card-together" role="group" aria-label="Play together">
          {TOGETHER_KEYS.map((key) => (
            <button key={key.kind} type="button" className="pip-visitor-card-key" title={key.title} onClick={() => onTogether(key.kind)}>
              <TogetherIcon kind={key.kind} />
              <span>{key.label}</span>
            </button>
          ))}
        </div>
      )}
      {onOpenProfile && (
        <button type="button" className="pip-visitor-card-open" onClick={() => onOpenProfile(visitor.handle)}>
          Open profile
        </button>
      )}
    </div>,
    document.body
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
  /** What the visitor is doing with Pip just now (the house sets it as she joins in): it plays its part. */
  act?: VisitorAct | null;
  /** The reader asks the two to do something together (from the card): the house has Pip do it, if she can. */
  onTogether?: (kind: TogetherKind) => void;
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
export const VisitorPip = ({ visitor, record, frame, spot, door, hostX, onPhase, onEvent, onOpenProfile, act = null, onTogether, now = Date.now }: VisitorPipProps) => {
  const node = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const [view, setView] = useState<View>({ phase: "knock", move: "idle", facing: 1, shown: false });
  const [open, setOpen] = useState(false);
  const live = useRef({ hostX, onPhase, onEvent, now, visitor, act });
  live.current = { hostX, onPhase, onEvent, now, visitor, act };
  // Looks again at once (a new part to play): set by the running visit below.
  const kick = useRef<() => void>(() => undefined);
  const reduced = prefersReducedMotion();
  const { scale, walkY } = frame;

  useEffect(() => {
    const timeline = visitTimeline(record.until - record.from, door.x - spot, reduced);
    // When, over this visit, the two do something together: only those still to come (a visit come back to after
    // a while does not catch up on what it missed). Without motion, none: nothing travels or dances then.
    const beats = reduced ? [] : togetherBeats(record, timeline);
    let nextBeat = beats.findIndex((beat) => beat.at > now() - record.from);
    if (nextBeat < 0) nextBeat = beats.length;
    let frameId = 0;
    let timer = 0;
    let stopped = false;
    let last: View | null = null;
    // Whole device pixels, so a sprite walking or standing never shimmers between two.
    const ratio = window.devicePixelRatio || 1;
    const snap = (css: number) => Math.round(css * ratio) / ratio;

    const step = () => {
      if (stopped) return;
      cancelAnimationFrame(frameId);
      window.clearTimeout(timer);
      const { hostX: host, onPhase: phased, onEvent: raise, now: clock, visitor: who, act: part } = live.current;
      const time = clock();
      const towards = host?.() ?? undefined;
      const visit = visitPose(time - record.from, timeline, door.x, spot, towards);
      // Sitting with Pip, its part in what the two are doing together, if anything (`togetherPose`).
      const playing = visit.phase === "hello" || visit.phase === "read" ? togetherPose(part, time, spot, towards) : null;
      const pose = playing ? { ...visit, ...playing } : visit;
      if (node.current) {
        // A 32-pixel sprite standing at x: its box starts 16 to the left and 30 above the feet.
        node.current.style.transform = `translate(${snap(Math.round(pose.x - 16) * scale)}px, ${snap((walkY - 30) * scale)}px)`;
      }
      if (!last || last.phase !== pose.phase || last.facing !== pose.facing || last.move !== pose.move) {
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
      // A time in the visit's plan to do something together: the house hears of it (once), and has Pip join in if she can.
      while (nextBeat < beats.length && time - record.from >= beats[nextBeat].at) {
        const beat = beats[nextBeat];
        nextBeat += 1;
        if (visit.phase === "read" && !playing) raise?.({ type: "together", kind: beat.kind, visitor: who });
      }
      if (pose.phase === "gone") {
        return;
      }
      // Walking and running are drawn every frame; anything else only needs to notice its own end (and which way Pip is).
      const moving = pose.move === "walk" || pose.move === "scamper";
      if (moving) {
        frameId = requestAnimationFrame(step);
      } else {
        const beatIn = nextBeat < beats.length ? beats[nextBeat].at - (time - record.from) : Infinity;
        const partIn = part ? (time < part.from ? part.from - time : time < part.until ? part.until - time : Infinity) : Infinity;
        timer = window.setTimeout(step, Math.max(16, Math.min(pose.left, 500, beatIn, partIn)));
      }
    };
    kick.current = step;
    step();
    return () => {
      stopped = true;
      kick.current = () => undefined;
      cancelAnimationFrame(frameId);
      window.clearTimeout(timer);
      live.current.onPhase?.(null);
    };
  }, [record.from, record.until, door.x, spot, scale, walkY, reduced]);

  // A new part to play (or the end of one): looked at at once, not at the next look.
  useEffect(() => {
    kick.current();
  }, [act]);

  // Gone: whatever was open about them closes with them.
  useEffect(() => {
    if (!view.shown) setOpen(false);
  }, [view.shown]);

  const look = avatarLook(visitor.pipSeed, visitor.avatar);
  const size = 32 * scale;
  const reading = view.phase === "read" && view.move === "read";
  // The tag is the room's to clip. Under the visitor's feet it needs 20 px of floor below them, which a room
  // drawn under two pixels a pixel does not have (at one, half of it was cut off): it goes over their head there.
  // And it is no wider than the room either side of where they stand.
  const tagAbove = frame.h !== undefined && (frame.h - walkY - 2) * scale < 20;
  const tagWidth = Math.min(160, Math.max(48, 2 * Math.min(spot, frame.w - spot) * scale - 6));
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
        <span className="pip-visitor-tag" data-above={tagAbove || undefined} style={{ maxWidth: tagWidth }} aria-hidden="true">
          {at(visitor.handle)}
        </span>
      </div>
      {open && view.shown && (
        <VisitorCard
          visitor={visitor}
          why="Read today, like you."
          anchor={() => button.current?.getBoundingClientRect() ?? null}
          onClose={closeCard}
          onOpenProfile={onOpenProfile}
          onTogether={
            onTogether && (view.phase === "read" || view.phase === "hello")
              ? (kind) => {
                  setOpen(false);
                  onTogether(kind);
                }
              : undefined
          }
        />
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
  const note = useRef<HTMLButtonElement | null>(null);
  const { scale, walkY, w } = frame;
  // By the wall the door is in, at about Pip's eye level.
  const x = door.side === "right" ? w - 16 : 7;
  return (
    <>
      <button
        ref={note}
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
          anchor={() => note.current?.getBoundingClientRect() ?? null}
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
