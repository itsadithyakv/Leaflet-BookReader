import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject
} from "react";
import { fridgeBox, houseItems, itemBox, renderItem, type Fixture, type HouseLevel, type LevelDecor } from "../../pip/home.js";
import {
  FRIDGE_HUM_S,
  FURNISH_STORE,
  KINDS,
  crookedReaction,
  curtainPull,
  curtainReaction,
  curtainSettle,
  curtainStep,
  curtainToggle,
  freeSpan,
  fridgeShutsAt,
  furnishKey,
  hangStep,
  hangingAngle,
  hangingFrom,
  hangsOff,
  hangsStill,
  kindOf,
  lampReaction,
  morning,
  nudge,
  parseRemembered,
  roomShade,
  slideTo,
  straighten,
  withRemembered,
  withinSpan,
  type FurnishKind,
  type FurnishState,
  type Hanging,
  type Reaction,
  type Remembered,
  type Span
} from "../../pip/furnish";
import type { Spot } from "../../pip/behaviour";
import { holdStart, type Sample } from "../../pip/play";
import { dimForNight, renderCurtains } from "../../pip/furnish-art.js";
import { subscribeTick } from "../../pip/ticker";
import { playSound } from "../../pip/sound";
import { floorPoint } from "./layout";
import "./furnishings.css";

/** How far the pointer moves before a press on a furnishing becomes a drag (the same as for Pip). */
const DRAG_SLOP = 4;
/** The curtains are drawn at this many steps of the way across, each once and kept. */
const CURTAIN_STEPS = 18;
/** The room's picture loops this many frames (HouseScene's ROOM_LOOP): a picture off the wall's own art keeps time with it. */
const ROOM_LOOP = 48;
/** An arrow key moves a picture this far along the wall, in floor pixels. */
const KEY_SLIDE = 4;
/** The "slot" a fixture is named by (it is in none): the floor's fridge. */
const FIXTURE_SLOT = "fixture";

type Box = { x: number; y: number; w: number; h: number };

/** One furnishing that is out on this floor: what it is, where, and what it is called. */
type Thing = { key: string; slot: string; kind: FurnishKind; itemId: string; name: string; box: Box; span: Span; /** On the wall, a shelf or the ceiling: Pip stands under it. */ up: boolean };

/** A furnishing as it is right now (the loop's, on a ref: nothing re-renders as it moves). */
type Live = {
  /** Curtains: how far drawn, where they are gliding to, and how they were before the hand took them. */
  closed: number;
  target: number | null;
  was: number;
  /** A picture: how it hangs, whether it is in the hand or still swinging, and how crooked it was when it last settled. */
  hang: Hanging;
  dragging: boolean;
  moving: boolean;
  wasTilt: number;
  /** A lamp: switched off. */
  off: boolean;
  /**
   * The fridge: its door open, since when (the scene's clock, in seconds), when
   * Pip got to it (null: she has not), whether she is holding it open herself,
   * and when it next hums.
   */
  open: boolean;
  openedAt: number;
  pipAt: number | null;
  held: boolean;
  humAt: number;
};

/** The fridge on this floor, for the scene: its name among the furnishings, where it stands, and how its door is. */
export type Fridge = { key: string; box: Box; open: boolean; held: boolean };

/** What the reader has just done to the room's light: Pip minds differently if it catches her at the fridge, or on her phone. */
export type RoomChange = "curtains-open" | "curtains-closed" | "light-on" | "light-off";

/** What the furnishings ask of Pip and the scene (the scene's own functions, the latest of them). */
export type FurnishPip = {
  /** She answers where she stands, turned towards `x` (floor pixels), if she is free to. `what`: the change it answers. */
  react: (reaction: Reaction, x: number, what?: RoomChange) => void;
  /** The bed was chosen: to bed with her, or up if she is in it. */
  bed: () => void;
  /** Whether she is in bed. */
  asleep: () => boolean;
  /** Up, if she is asleep (the curtains opened on a morning). Says whether she was. */
  wake: () => boolean;
  /** She comes over to this thing and does that with it (reads one of these books, looks out of that window), if she is free to. */
  go: (what: "read" | "window", spot: Spot) => void;
  /** The fridge's door was opened by the reader, or has shut (by the hand, or by itself): what she makes of it. */
  fridge: (what: "opened" | "shut", fridge: Fridge) => void;
  /** The scene's clock, in milliseconds. */
  clock: () => number;
  /** The room's picture drawn again: a piece has come off it, or gone back on. */
  redraw: () => void;
};

type FurnishingsOptions = {
  level: HouseLevel;
  decor: LevelDecor;
  /** CSS pixels a floor pixel. */
  scale: number;
  night: boolean;
  /** Decorating: the furnishings show as they are, and none can be used. */
  decorating: boolean;
  roomRef: RefObject<HTMLDivElement>;
  pip: MutableRefObject<FurnishPip>;
};

const readRemembered = (): Remembered => {
  try {
    return parseRemembered(localStorage.getItem(FURNISH_STORE));
  } catch {
    return {};
  }
};
const writeRemembered = (all: Remembered) => {
  try {
    if (Object.keys(all).length > 0) localStorage.setItem(FURNISH_STORE, JSON.stringify(all));
    else localStorage.removeItem(FURNISH_STORE);
  } catch {
    // Remembered for this visit only.
  }
};

// Art drawn once and kept: the curtains at each step across, a picture at each frame of the room's loop.
const art = new Map<string, ImageData>();
const kept = (key: string, night: boolean, draw: () => ImageData) => {
  const id = `${key}|${night}`;
  let image = art.get(id);
  if (!image) {
    if (art.size > 400) art.clear();
    const drawn = draw();
    image = night ? dimForNight(drawn) : drawn;
    art.set(id, image);
  }
  return image;
};
const curtainImage = (closed: number, w: number, h: number, night: boolean) => {
  const step = Math.round(Math.max(0, Math.min(1, closed)) * CURTAIN_STEPS);
  return kept(`curtains|${w}x${h}|${step}`, night, () => renderCurtains(step / CURTAIN_STEPS, w, h));
};
const pictureImage = (itemId: string, frame: number, night: boolean) => kept(`item|${itemId}|${frame}`, night, () => renderItem(itemId, frame));

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/**
 * A press on a furnishing, followed wherever the pointer goes until it ends:
 * the button up, the pointer cancelled or lost, or the window losing focus.
 * `onEnd` always comes, once, saying whether the press ended properly.
 */
const followPress = (
  event: ReactPointerEvent<HTMLElement>,
  handlers: { onMove: (e: PointerEvent) => void; onEnd: (how: "up" | "cancel", moved: boolean) => void }
) => {
  const target = event.currentTarget;
  const id = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;
  try {
    target.setPointerCapture(id);
  } catch {
    // No such pointer (a press made in a test): the window's listeners still hear it.
  }
  const move = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_SLOP) return;
    moved = true;
    handlers.onMove(e);
  };
  const end = (how: "up" | "cancel") => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    window.removeEventListener("blur", lost);
    target.removeEventListener("lostpointercapture", lost);
    try {
      target.releasePointerCapture(id);
    } catch {
      // Already let go of.
    }
    handlers.onEnd(how, moved);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId === id) end(e.type === "pointerup" ? "up" : "cancel");
  };
  const lost = () => end("cancel");
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  window.addEventListener("blur", lost);
  target.addEventListener("lostpointercapture", lost);
};

/**
 * The furnishings of one floor that can be used (pip/furnish.ts says which,
 * and how): a button over each, the art of whatever is not as the room drew
 * it (drawn curtains, a picture knocked crooked or hung somewhere else), and
 * the shade drawn curtains cast. Returns the layer to put in the room;
 * `step`, which the scene's one frame loop calls to move what is moving;
 * `lifted`, the slots whose piece this layer is drawing, for the room's
 * picture to leave out, and `fixtures`, how it is to draw the floor's fridge
 * (shut or open); and what Pip can do about it all (`spots`, `pipUse`).
 */
export const useFurnishings = ({ level, decor, scale, night, decorating, roomRef, pip }: FurnishingsOptions) => {
  const decorKey = JSON.stringify(decor.placed);
  const things = useMemo(() => {
    const names = new Map(houseItems().map((item) => [item.id, item.name]));
    const boxes = decor.placed.flatMap(({ slot: slotId, itemId }) => {
      const slot = level.slots.find((entry) => entry.id === slotId);
      const box = slot ? itemBox(itemId, slot) : null;
      return slot && box ? [{ slot: slotId, itemId, box, up: slot.fits !== "stand" && slot.fits !== "rug" }] : [];
    });
    // What a picture may not slide over: the other pieces, and the shelves (the room above each "top" slot).
    const shelves = level.slots.filter((slot) => slot.fits === "top").map((slot) => ({ x: slot.x, y: slot.y, w: slot.w, h: slot.h }));
    const out: Thing[] = [];
    for (const { slot, itemId, box, up } of boxes) {
      const kind = kindOf(itemId);
      if (!kind) continue;
      const others = [...boxes.filter((entry) => entry.slot !== slot).map((entry) => entry.box), ...shelves];
      out.push({ key: furnishKey(level.id, slot, itemId), slot, kind, itemId, name: names.get(itemId) ?? itemId, box, span: kind === "picture" ? freeSpan(box, others, level.w) : { min: 0, max: 0 }, up });
    }
    // The floor's fridge: a fixture, in no slot, standing where the decor leaves room (pip/home.js).
    const fridge = fridgeBox(level, decor);
    if (fridge) out.push({ key: furnishKey(level.id, FIXTURE_SLOT, "minifridge"), slot: FIXTURE_SLOT, kind: "fridge", itemId: "minifridge", name: "Mini fridge", box: fridge, span: { min: 0, max: 0 }, up: false });
    return out;
    // decorKey stands in for decor.placed, a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, decorKey]);

  const remembered = useRef<Remembered | null>(null);
  if (remembered.current === null) remembered.current = readRemembered();
  const live = useRef(new Map<string, Live>());
  const liveOf = (thing: Thing) => {
    let state = live.current.get(thing.key);
    if (!state) {
      const saved: FurnishState = remembered.current?.[thing.key] ?? {};
      const hang = hangingFrom(saved);
      // The room may have changed since it was hung there: still within what is free now.
      hang.dx = withinSpan(hang.dx, thing.span);
      state = { closed: saved.closed ?? 0, target: null, was: saved.closed ?? 0, hang, dragging: false, moving: false, wasTilt: hang.tilt, off: saved.off === true, open: false, openedAt: 0, pipAt: null, held: false, humAt: 0 };
      live.current.set(thing.key, state);
    }
    return state;
  };
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const shadeRef = useRef<HTMLDivElement | null>(null);
  // Counted up when something settles, so labels and pressed states follow.
  const [, setSettled] = useState(0);
  const latest = useRef({ things, night, scale });
  latest.current = { things, night, scale };
  const frame = useRef(0);

  /** Whether this layer, not the room's picture, is drawing a thing just now. */
  const off = (thing: Thing, state: Live) => thing.kind === "picture" && (state.dragging || state.moving || hangsOff(state.hang));
  // The slots this layer is drawing, worked out as it renders so the room's picture can leave them out from its first frame.
  const lifted = useRef(new Set<string>());
  lifted.current = new Set(things.filter((thing) => off(thing, liveOf(thing))).map((thing) => thing.slot));
  // The slots whose light is switched off, for the room's picture to draw unlit.
  const unlit = useRef(new Set<string>());
  unlit.current = new Set(things.filter((thing) => thing.kind === "lamp" && liveOf(thing).off).map((thing) => thing.slot));
  // The floor's fixtures as the room's picture is to draw them: the fridge, shut or open.
  const fixturesNow = (all: readonly Thing[]): Fixture[] =>
    all.filter((thing) => thing.kind === "fridge").map((thing) => ({ itemId: liveOf(thing).open ? "minifridge-open" : "minifridge", x: thing.box.x, y: thing.box.y }));
  const fixtures = useRef<Fixture[]>([]);
  fixtures.current = fixturesNow(things);
  /** After a change: if a piece has come off the room's picture, or gone back on, the room is drawn again. */
  const relift = () => {
    const next = new Set(latest.current.things.filter((thing) => off(thing, liveOf(thing))).map((thing) => thing.slot));
    const same = next.size === lifted.current.size && [...next].every((slot) => lifted.current.has(slot));
    lifted.current = next;
    if (!same) pip.current.redraw();
  };

  /** A furnishing's art, as it is now; nothing where the room's own picture already shows it. */
  const draw = (thing: Thing) => {
    const canvas = canvases.current.get(thing.key);
    const state = liveOf(thing);
    const k = latest.current.scale;
    if (thing.kind === "picture") {
      const slide = `translateX(${(state.hang.dx * k).toFixed(2)}px)`;
      const button = buttons.current.get(thing.key);
      if (button) button.style.transform = slide;
      if (!canvas) return;
      const show = off(thing, state);
      canvas.style.visibility = show ? "visible" : "hidden";
      if (!show) return;
      canvas.style.transform = `${slide} rotate(${hangingAngle(state.hang).toFixed(4)}rad)`;
      canvas.getContext("2d")?.putImageData(pictureImage(thing.itemId, frame.current, latest.current.night), 0, 0);
      return;
    }
    if (!canvas || thing.kind !== "curtains") return;
    const show = state.closed > 0.001;
    canvas.style.visibility = show ? "visible" : "hidden";
    if (show) canvas.getContext("2d")?.putImageData(curtainImage(state.closed, thing.box.w, thing.box.h, latest.current.night), 0, 0);
  };
  const shade = () => {
    const node = shadeRef.current;
    if (!node) return;
    const drawn = latest.current.things.filter((thing) => thing.kind === "curtains").map((thing) => liveOf(thing).closed);
    node.style.opacity = String(roomShade(drawn, latest.current.night));
  };

  // A new floor, new decor, a new scale, night falling: everything drawn as it is.
  useLayoutEffect(() => {
    things.forEach(draw);
    shade();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [things, night, scale]);

  // A picture this layer is drawing keeps time with the room it hangs in (one that glints, glints on).
  useEffect(() => {
    if (prefersReducedMotion()) return;
    return subscribeTick((tick) => {
      if (lifted.current.size === 0) return;
      frame.current = tick % ROOM_LOOP;
      for (const thing of latest.current.things) if (thing.kind === "picture" && lifted.current.has(thing.slot)) draw(thing);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = (thing: Thing, state: FurnishState) => {
    remembered.current = withRemembered(remembered.current ?? {}, thing.key, thing.kind, state);
    writeRemembered(remembered.current);
  };
  const middle = (thing: Thing, state: Live) => thing.box.x + thing.box.w / 2 + (thing.kind === "picture" ? state.hang.dx : 0);

  /** Curtains settled: remembered on this device, and Pip is told if it changed. */
  const settleCurtains = (thing: Thing, state: Live) => {
    state.target = null;
    save(thing, { closed: state.closed });
    const closed = state.closed >= 0.5;
    if (closed !== state.was >= 0.5) {
      const hour = new Date().getHours();
      // Opened on a sleeper in the morning: up she gets. Otherwise she says what she thinks.
      if (closed || !morning(hour) || !pip.current.wake()) pip.current.react(curtainReaction(closed, hour), middle(thing, state), closed ? "curtains-closed" : "curtains-open");
    }
    state.was = state.closed;
    setSettled((count) => count + 1);
  };

  /** A picture has stopped swinging: remembered, back on the room's own picture if it hangs as drawn, and Pip notices a crooked one. */
  const settlePicture = (thing: Thing, state: Live) => {
    state.moving = false;
    state.hang = { ...state.hang, hold: holdStart() };
    save(thing, { dx: state.hang.dx, tilt: state.hang.tilt });
    if (state.hang.tilt !== 0 && state.wasTilt === 0) pip.current.react(crookedReaction(), middle(thing, state));
    state.wasTilt = state.hang.tilt;
    draw(thing);
    relift();
    setSettled((count) => count + 1);
  };

  /** Sends the curtains gliding to `target`; they settle in `step`. */
  const glide = (thing: Thing, target: number) => {
    const state = liveOf(thing);
    state.target = target;
    if (target !== state.closed) playSound("swish", { pitch: target > state.closed ? 0.9 : 1.15 });
    // Without motion nothing glides: there at once.
    if (prefersReducedMotion()) step(0, true);
  };

  /** Sets a picture swinging (it has been nudged, slid or straightened); it settles in `step`. */
  const swing = (thing: Thing, state: Live, hang: Hanging) => {
    state.hang = hang;
    state.moving = true;
    draw(thing);
    relift();
    if (prefersReducedMotion()) step(0, true);
  };

  /** The fridge as the scene sees it. */
  const fridgeOf = (thing: Thing, state: Live): Fridge => ({ key: thing.key, box: thing.box, open: state.open, held: state.held });

  /**
   * The fridge's door, opened or shut. `held`: Pip has it open herself, and it
   * stays open until she shuts it. The room's picture draws it (and, after
   * dark, the light it throws), so it is drawn again only when the door moves.
   * Says whether the door moved.
   */
  const setDoor = (thing: Thing, open: boolean, held = false) => {
    const state = liveOf(thing);
    if (state.open === open) {
      // Already open under the reader's hand: hers to hold now.
      if (open && held) state.held = true;
      return false;
    }
    state.open = open;
    state.held = open && held;
    state.openedAt = pip.current.clock() / 1000;
    state.pipAt = null;
    state.humAt = 0;
    fixtures.current = fixturesNow(latest.current.things);
    if (open) playSound("click", { pitch: 0.7, volume: 0.7 });
    else playSound("shut");
    pip.current.redraw();
    setSettled((count) => count + 1);
    return true;
  };

  /** What is moving, a frame later. Called by the scene's frame loop. */
  const step = (dt: number, still: boolean) => {
    for (const thing of latest.current.things) {
      const state = live.current.get(thing.key);
      if (!state) continue;
      if (thing.kind === "fridge") {
        if (!state.open) continue;
        const now = pip.current.clock() / 1000;
        if (now >= fridgeShutsAt(state.openedAt, state.pipAt, state.held)) {
          // Left open, it swings shut by itself; Pip, if she was hoping, is told.
          setDoor(thing, false);
          pip.current.fridge("shut", fridgeOf(thing, state));
        } else if (now >= state.humAt) {
          state.humAt = now + FRIDGE_HUM_S;
          playSound("hum");
        }
      } else if (thing.kind === "curtains" && state.target !== null) {
        state.closed = curtainStep(state.closed, state.target, dt, still);
        draw(thing);
        shade();
        if (state.closed === state.target) settleCurtains(thing, state);
      } else if (thing.kind === "picture" && (state.moving || state.dragging)) {
        state.hang = hangStep(state.hang, dt, still);
        draw(thing);
        if (!state.dragging && hangsStill(state.hang)) settlePicture(thing, state);
      }
    }
  };

  const pointerAt = (pointer: { clientX: number; clientY: number }) => {
    const room = roomRef.current?.getBoundingClientRect();
    return room ? floorPoint(pointer, room, level.w) : null;
  };

  const onCurtains = (thing: Thing, event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = liveOf(thing);
    const centre = thing.box.x + thing.box.w / 2;
    const half = thing.box.w / 2;
    const from = Math.abs((pointerAt(event)?.x ?? centre) - centre);
    const before = state.closed;
    state.target = null;
    followPress(event, {
      onMove: (e) => {
        // Pulled: towards the middle of the window draws them, away from it opens them.
        const hand = pointerAt(e);
        if (!hand) return;
        state.closed = curtainPull(before, from, Math.abs(hand.x - centre), half);
        draw(thing);
        shade();
      },
      // Let go part way, they settle the nearer way; a tap sends them the other way.
      onEnd: (how, moved) => glide(thing, moved ? curtainSettle(state.closed) : how === "up" ? curtainToggle(before) : curtainSettle(before))
    });
  };

  const onPicture = (thing: Thing, event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = liveOf(thing);
    const from = pointerAt(event);
    const before = state.hang.dx;
    let last: Sample | undefined;
    followPress(event, {
      onMove: (e) => {
        // Slid along the wall, as far as there is room; it swings behind the hand.
        const hand = pointerAt(e);
        if (!hand || !from) return;
        const dx = withinSpan(before + hand.x - from.x, thing.span);
        const sample = { x: dx, y: 0, at: pip.current.clock() };
        state.dragging = true;
        state.hang = slideTo(state.hang, dx, last, sample);
        last = sample;
        draw(thing);
        relift();
      },
      onEnd: (how, moved) => {
        state.dragging = false;
        if (moved) {
          swing(thing, state, state.hang);
          playSound("place", { pitch: 1.5, volume: 0.4 });
        } else if (how === "up") {
          // A tap is a nudge, on the side it was tapped.
          knock(thing, from && from.x < middle(thing, state) ? -1 : 1);
        }
      }
    });
  };

  const knock = (thing: Thing, side: 1 | -1) => {
    const state = liveOf(thing);
    swing(thing, state, nudge(state.hang, side));
    playSound("place", { pitch: 1.7, volume: 0.45 });
  };

  const onPictureKey = (thing: Thing, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const state = liveOf(thing);
    const way = event.key === "ArrowLeft" ? -1 : 1;
    const dx = withinSpan(state.hang.dx + way * KEY_SLIDE, thing.span);
    if (dx === state.hang.dx) return;
    // Moved a step along the wall: it swings a little behind the move.
    const { swing: now } = state.hang.hold;
    swing(thing, state, { ...state.hang, dx, hold: { ...state.hang.hold, swing: { angle: now.angle, spin: now.spin + way * 1.2 } } });
  };

  /** A press on a thing, by the pointer. */
  const onPointerDown = (thing: Thing) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    if (thing.kind === "curtains") onCurtains(thing, event);
    else if (thing.kind === "picture") onPicture(thing, event);
  };

  /** A light switched: drawn lit or unlit by the room's own picture, remembered, and Pip may have a word about it. */
  const switchLamp = (thing: Thing, state: Live) => {
    state.off = !state.off;
    if (state.off) unlit.current.add(thing.slot);
    else unlit.current.delete(thing.slot);
    save(thing, { off: state.off });
    playSound("click", { pitch: state.off ? 0.85 : 1.1 });
    pip.current.redraw();
    const reaction = lampReaction(state.off, new Date().getHours());
    if (reaction) pip.current.react(reaction, middle(thing, state), state.off ? "light-off" : "light-on");
    setSettled((count) => count + 1);
  };

  /** A thing chosen: by the keyboard, or (for a thing that is only ever tapped) by the pointer. */
  const choose = (thing: Thing, keyboard: boolean) => {
    const state = liveOf(thing);
    if (thing.kind === "bed") pip.current.bed();
    else if (thing.kind === "lamp") switchLamp(thing, state);
    else if (thing.kind === "fridge") {
      // Opened, or pushed shut again: either way Pip has something to say about it.
      setDoor(thing, !state.open);
      pip.current.fridge(state.open ? "opened" : "shut", fridgeOf(thing, state));
    }
    else if (thing.kind === "window" || thing.kind === "books")
      pip.current.go(thing.kind === "books" ? "read" : "window", { kind: thing.kind, x: middle(thing, state), w: thing.box.w, up: thing.up || thing.kind === "window", id: thing.itemId });
    else if (!keyboard) return;
    else if (thing.kind === "curtains") glide(thing, curtainToggle(state.closed));
    // Enter knocks a straight picture crooked, and a crooked one back.
    else if (thing.kind === "picture") knock(thing, state.hang.tilt > 0 ? -1 : 1);
  };

  // Leaving the floor mid-move: where it was going is where it is.
  useEffect(
    () => () => {
      for (const thing of things) {
        const state = live.current.get(thing.key);
        if (!state) continue;
        if (state.target !== null) {
          state.closed = state.target;
          state.target = null;
          state.was = state.closed;
          save(thing, { closed: state.closed });
        }
        if (state.moving || state.dragging) {
          state.moving = false;
          state.dragging = false;
          state.hang = { ...state.hang, hold: holdStart() };
          state.wasTilt = state.hang.tilt;
          save(thing, { dx: state.hang.dx, tilt: state.hang.tilt });
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [things]
  );

  // Leaving the floor: nobody leaves a fridge open behind them (it is shut when they come back).
  useEffect(
    () => () => {
      for (const state of live.current.values()) {
        state.open = false;
        state.held = false;
      }
    },
    [level.id]
  );

  // Decorating: the fridge is shut, like everything else left as it stands.
  useEffect(() => {
    if (!decorating) return;
    for (const thing of latest.current.things) if (thing.kind === "fridge") setDoor(thing, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decorating]);

  const label = (thing: Thing) => {
    const spec = KINDS[thing.kind];
    const state = liveOf(thing);
    const now =
      thing.kind === "curtains"
        ? `the curtains are ${state.closed >= 0.5 ? "drawn" : "open"}`
        : thing.kind === "picture"
          ? state.hang.tilt !== 0
            ? "hanging crooked"
            : "hanging straight"
          : thing.kind === "bed"
            ? pip.current.asleep()
              ? "Pip is asleep in it"
              : "Pip is up"
            : thing.kind === "lamp"
              ? state.off
                ? "switched off"
                : "on"
              : thing.kind === "fridge"
                ? state.open
                  ? "open"
                  : "shut"
                : null;
    return `${thing.name}${now ? `: ${now}` : ""}. ${spec.how} ${spec.keys}`;
  };
  const pressed = (thing: Thing) =>
    thing.kind === "curtains" ? liveOf(thing).closed >= 0.5 : thing.kind === "bed" ? pip.current.asleep() : thing.kind === "lamp" ? !liveOf(thing).off : thing.kind === "fridge" ? liveOf(thing).open : undefined;

  const layer: ReactNode = (
    <>
      {things
        .filter((thing) => thing.kind === "curtains" || thing.kind === "picture")
        .map((thing) => (
          <canvas
            key={`art-${thing.key}`}
            ref={(node) => {
              if (node) {
                canvases.current.set(thing.key, node);
                draw(thing);
              } else {
                canvases.current.delete(thing.key);
              }
            }}
            width={thing.box.w}
            height={thing.box.h}
            className="pip-sprite pip-furnish-art"
            data-furnish={thing.kind}
            style={{ left: thing.box.x * scale, top: thing.box.y * scale, width: thing.box.w * scale, height: thing.box.h * scale }}
            aria-hidden="true"
          />
        ))}
      {!decorating &&
        things.map((thing) => (
          <button
            key={thing.key}
            ref={(node) => {
              if (node) {
                buttons.current.set(thing.key, node);
                draw(thing);
              } else {
                buttons.current.delete(thing.key);
              }
            }}
            type="button"
            className="pip-house-hotspot pip-furnish"
            data-furnish={thing.kind}
            data-cursor={KINDS[thing.kind].cursor}
            aria-pressed={pressed(thing)}
            style={{ left: thing.box.x * scale, top: thing.box.y * scale, width: thing.box.w * scale, height: thing.box.h * scale }}
            onPointerDown={onPointerDown(thing)}
            // Pointer presses on a thing that can be dragged are handled on release; the click is then the keyboard's.
            onClick={(event) => choose(thing, event.detail === 0)}
            onKeyDown={thing.kind === "picture" ? (event) => onPictureKey(thing, event) : undefined}
            aria-label={label(thing)}
            title={KINDS[thing.kind].how}
          />
        ))}
      <div ref={shadeRef} className="pip-room-shade" aria-hidden="true" />
    </>
  );

  /** What on this floor Pip may go to of her own accord: a picture hanging crooked, to straighten; the fridge, to look in. */
  const spots = (): Spot[] =>
    latest.current.things.flatMap((thing): Spot[] => {
      const state = liveOf(thing);
      if (thing.kind === "fridge") return [{ kind: "fridge" as const, x: middle(thing, state), w: thing.box.w, id: thing.key }];
      return thing.kind === "picture" && state.hang.tilt !== 0 && !state.moving && !state.dragging ? [{ kind: "crooked" as const, x: middle(thing, state), w: thing.box.w, up: true, id: thing.key }] : [];
    });

  /**
   * Pip does something to a furnishing herself (a step of one of her
   * activities, or an errand): a picture set straight; the fridge opened (and
   * held open until she shuts it), shut, or simply reached (`linger`: a door
   * the reader opened waits for her to have her look).
   */
  const pipUse = (key: string, what: "straighten" | "open" | "shut" | "linger") => {
    const thing = latest.current.things.find((entry) => entry.key === key);
    if (!thing) return;
    const state = liveOf(thing);
    if (thing.kind === "fridge") {
      if (what === "open") setDoor(thing, true, true);
      else if (what === "shut") setDoor(thing, false);
      else if (what === "linger" && state.open) state.pipAt = pip.current.clock() / 1000;
      return;
    }
    if (thing.kind !== "picture" || what !== "straighten") return;
    swing(thing, state, straighten(state.hang));
    playSound("place", { pitch: 1.4, volume: 0.4 });
  };

  /** The fridge on this floor, and how its door is; null on a floor without one. */
  const fridge = (): Fridge | null => {
    const thing = latest.current.things.find((entry) => entry.kind === "fridge");
    return thing ? fridgeOf(thing, liveOf(thing)) : null;
  };

  /** The first furnishing of a kind on this floor, used as a tap would (for the Play keys). */
  const use = (kind: FurnishKind) => {
    const thing = latest.current.things.find((entry) => entry.kind === kind);
    if (thing) choose(thing, true);
    return Boolean(thing);
  };

  /** For the development hook: each furnishing, where it is and how it stands. */
  const state = () =>
    latest.current.things.map((thing) => {
      const now = liveOf(thing);
      const fixed = (value: number, places = 3) => Number(value.toFixed(places));
      return {
        key: thing.key,
        kind: thing.kind,
        box: thing.box,
        closed: fixed(now.closed),
        target: now.target,
        shade: Number(shadeRef.current?.style.opacity || 0),
        off: now.off,
        open: now.open,
        held: now.held,
        dx: fixed(now.hang.dx, 2),
        tilt: fixed(now.hang.tilt),
        angle: fixed(hangingAngle(now.hang)),
        spin: fixed(now.hang.hold.swing.spin, 2),
        moving: now.moving || now.dragging,
        span: thing.span,
        lifted: lifted.current.has(thing.slot)
      };
    });

  /** How far the piece in a slot has been slid from where the slot puts it (a picture hung along the wall), in floor pixels. */
  const offsetOf = (slot: string) => {
    const thing = latest.current.things.find((entry) => entry.slot === slot && entry.kind === "picture");
    return thing ? liveOf(thing).hang.dx : 0;
  };

  return { layer, step, state, lifted, unlit, fixtures, fridge, spots, pipUse, use, offsetOf };
};
