import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowUp, Bell, Crosshair, Flag, Hourglass, Info, Megaphone, Play } from "lucide-react";
import { BATTLE_TICK, RAID_SECONDS, type Battle, type Result } from "../../../../pip/base/battle";
import { BELL_SECONDS } from "../../../../pip/base/feats";
import { HERO_MOVES, HEROES, heroMove } from "../../../../pip/base/heroes";
import type { OrderGiven } from "../../../../pip/base/orders";
import { playSound } from "../../../../pip/sound";
import type { GameArt } from "../gameArt";
import { RaidField } from "./RaidField";
import { StarPips } from "./RaidScout";
import { moving, newFx, stepFx, takeEvents, type FxState } from "./raidFx";
import { screenRatio } from "./fit";
import { NO_CLEAR, centreOn, edgeMarks, focusOf, follow, toPicture, toRoom, type Clear, type EdgeMark, type FieldView, type FramedView, type PictureBox, type ViewWindow } from "./raidLayout";
import type { PanAt } from "./RaidField";
import { APPROACH_COLOURS, newLooks, notice, remember, type RaidScene } from "./raidPaint";
import { KINDS, KIND_ART, approachShort, structureName } from "./raidWords";
import { Sprite } from "./Sprite";
import { useBackLayer } from "../../../../platform/back";

/**
 * The fight (the Magpie Lands, 2026-10-24; raids-plan.md, sections 2 and 5): the planned raid going on by itself on
 * the whole field, and the reader's few orders, each one tap, never a timing test:
 *
 * - **rally**: a group's chip, then the thing to send it at (a ring is about each thing it can be sent at);
 * - **release**: the group held back goes in;
 * - **the hero's move**, by its name (`HERO_MOVES`), and where the move is aimed, the thing to aim it at.
 *
 * Each is `battle.order(...)`: one the battle will not take (nothing left for it to do, no orders left) gives a small
 * nudge, not an error. Along the top, in the camp's chrome: the bell (the time left; it rings at 30 seconds, the
 * ford's feat), the three stars as they are won (and lost again, to a second flight), and the orders left.
 *
 * (2026-10-25) The bar is one board of the camp's pixel paper, at the dock's size; each group's chip is in its colour
 * with its kinds' own pictures (the planner's), and a chip picked for a rally sinks in and shows a sight, while what it
 * can be sent at is ringed in its colour on the field: a tap on the chip, then a tap on the target. The camera keeps
 * the fighting in view (`follow`), slowly, and stays put under reduced motion.
 *
 * (2026-10-26) Where the stronghold and a group cannot both be in view (an upright phone, the scouts still at the ford),
 * the group has a mark at the window's edge: an arrow its colour, toward them, with how many are out there
 * (`edgeMarks`). A tap on it sends the camera to them, and keeps it with them until the camera's own framing has them in
 * view again; under reduced motion the picture goes there at once, and stays.
 */

/** Longest real time folded into one frame, so a stall does not skip the fight. */
const MAX_FRAME = 1 / 10;

type Pick = { kind: "rally"; group: number } | { kind: "aim" } | null;

type Hud = {
  seconds: number;
  rung: boolean;
  stars: [boolean, boolean, boolean];
  orders: number;
  bands: Array<{ alive: number; held: boolean; out: boolean; via: number; kinds: string[] }>;
  heroOn: boolean;
  heroMoved: boolean;
  over: boolean;
};

const hudOf = (battle: Battle, fx: FxState): Hud => ({
  seconds: Math.max(0, Math.ceil((battle.setup.seconds ?? RAID_SECONDS) - battle.time)),
  rung: battle.time >= BELL_SECONDS,
  stars: [...fx.stars] as [boolean, boolean, boolean],
  orders: battle.ordersLeft,
  bands: battle.bands.map((band, index) => {
    const out = battle.units.filter((unit) => unit.band === index && unit.hp > 0);
    const kinds = new Set<string>([...out.map((unit) => unit.kind), ...band.queue]);
    return { alive: out.length + band.queue.length, held: band.held && !band.out, out: band.out, via: band.via, kinds: KINDS.filter((kind) => kinds.has(kind)) };
  }),
  heroOn: battle.units.some((unit) => unit.kind === "hero" && unit.hp > 0),
  heroMoved: battle.heroMoved,
  over: battle.over
});

type Props = {
  battle: Battle;
  art: GameArt;
  view: FieldView;
  /** The room the raid has, in CSS pixels (the ground covers it). */
  roomW: number;
  roomH: number;
  /** What the bars take of the room: the camera keeps the stronghold in the rest. */
  clear?: Clear;
  region: number;
  season: number;
  name: string;
  /** Nothing moves but the fight itself: falls and specks are shown at their end. */
  still: boolean;
  /** The raid is over: called once, with how it went. Not for a battle handed in already over (a raid sent without the reader, shown as it ended). */
  onDone: (result: Result) => void;
};

/** Where the scouts on the field are (only those numbered in `ids`, given), on the picture, a little room round each: what the camera follows. */
const fightingBox = (battle: Battle, view: FieldView, ids: ReadonlySet<number> | null = null): PictureBox | null => {
  let box: PictureBox | null = null;
  for (const unit of battle.units) {
    if (unit.hp <= 0 || (ids !== null && !ids.has(unit.id))) continue;
    const at = toPicture(view, unit.x, unit.y);
    box = box
      ? { x0: Math.min(box.x0, at.x - 8), y0: Math.min(box.y0, at.y - 18), x1: Math.max(box.x1, at.x + 8), y1: Math.max(box.y1, at.y + 4) }
      : { x0: at.x - 8, y0: at.y - 18, x1: at.x + 8, y1: at.y + 4 };
  }
  return box;
};

export const RaidBattle = ({ battle, art, view, roomW, roomH, clear = NO_CLEAR, region, season, name, still, onDone }: Props) => {
  const king = Boolean(battle.setup.king);
  // A battle already over when it is shown (played out without the reader) is shown as it ended: rubble, no falls.
  const settled = useMemo(() => battle.over, [battle]);
  const fx = useMemo(() => newFx(still || settled), [battle, still, settled]);
  const looks = useMemo(() => newLooks(battle), [battle]);
  const [pick, setPick] = useState<Pick>(null);
  const [nudged, setNudged] = useState<string | null>(null);
  const [hud, setHud] = useState<Hud>(() => hudOf(battle, fx));
  const clock = useRef({ last: -1, acc: 0, done: settled, hud: "", rung: settled });
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const sync = () => {
    const next = hudOf(battle, fx);
    const key = JSON.stringify(next);
    if (key !== clock.current.hud) {
      clock.current.hud = key;
      setHud(next);
    }
  };

  const tick = (now: number) => {
    const c = clock.current;
    lookOut();
    const dt = c.last < 0 ? 0 : Math.max(0, Math.min(MAX_FRAME, now - c.last));
    c.last = now;
    if (!battle.over) {
      c.acc += dt;
      while (c.acc >= BATTLE_TICK && !battle.over) {
        remember(looks, battle);
        battle.step(BATTLE_TICK);
        c.acc -= BATTLE_TICK;
      }
    }
    takeEvents(fx, battle.events, now, battle.structures, king);
    notice(looks, scene, now);
    stepFx(fx, dt, now);
    // What happened, heard once each (one of a kind a frame).
    if (fx.cues.length > 0) {
      for (const cue of new Set(fx.cues)) playSound(cue === "star" ? "star" : cue, { volume: cue === "crumble" ? 0.7 : 0.6 });
      fx.cues.length = 0;
    }
    if (!c.rung && battle.time >= BELL_SECONDS) {
      c.rung = true;
      playSound("chime", { volume: 0.5 });
    }
    sync();
    if (battle.over && !c.done) {
      c.done = true;
      doneRef.current(battle.result());
    }
    return { busy: !battle.over || moving(fx, now), blend: battle.over ? 1 : Math.min(1, c.acc / BATTLE_TICK) };
  };

  // Android's Back, and Escape: a pick is let go; otherwise the raid is ended as it stands.
  useBackLayer(!hud.over, () => {
    if (pick) setPick(null);
    else battle.over = true;
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pick) {
        setPick(null);
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [pick]);

  const nudge = (what: string) => {
    setNudged(what);
    playSound("click", { pitch: 0.6 });
    window.setTimeout(() => setNudged((was) => (was === what ? null : was)), 360);
  };
  /** An order, given now: the battle says whether it takes it. */
  const give = (order: OrderGiven, what: string) => {
    const ok = battle.order(order);
    setPick(null);
    if (ok) playSound(order.kind === "release" ? "horn" : order.kind === "hero" ? "whee" : "march", { volume: 0.7 });
    else nudge(what);
    sync();
    return ok;
  };

  const heroId = battle.setup.hero?.id ?? null;
  const move = heroId !== null ? heroMove(heroId) : null;
  const moveInfo = move ? HERO_MOVES[move] : null;
  const targets = useMemo(
    () => (pick ? battle.structures.filter((entry) => entry.hp > 0 && entry.kind !== "wall" && !entry.flat && entry.traps === undefined).map((entry) => entry.id) : []),
    // Worked out again as things fall (`hud` changes then).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pick, battle, hud]
  );
  const scene: RaidScene = { battle, art, fx, region, season, marks: { reach: false, chosen: null, targets } };
  const held = hud.bands.findIndex((band) => band.held);
  const [told, setTold] = useState(false);

  // The camera: the stronghold always in view between the bars, and as much of the fighting as fits with it. Never
  // under reduced motion (the picture stays as framed, and moves only under a finger).
  const framed = "pan" in view && "focus" in view ? (view as FramedView) : null;
  const keep = useMemo(() => focusOf(view.orient, battle.structures, []).keep, [battle, view.orient]);
  const sight: ViewWindow = { left: clear.left, top: clear.top, right: roomW - clear.right, bottom: roomH - clear.bottom };
  /** What can be seen of the field past the bars: beside an upright phone's orders too, which stand in the middle of the foot. */
  const seen: ViewWindow = { left: 0, top: clear.top, right: roomW - clear.right, bottom: view.orient === "tall" ? roomH - clear.bottom / 2 : roomH };
  /** Each group's scouts on the field, as field points with their numbers. */
  const groupPoints = (band: number) => battle.units.filter((unit) => unit.hp > 0 && unit.band === band).map((unit) => ({ id: unit.id, x: unit.x, y: unit.y }));
  /** The scouts a tap on a mark has sent the camera to: it stays with them until its own framing has them in view. */
  const focus = useRef<ReadonlySet<number> | null>(null);
  const aim = (): PanAt | null => {
    if (!framed || battle.over) return null;
    const home = follow(framed, sight, keep, fightingBox(battle, view), screenRatio());
    const ids = focus.current;
    if (ids === null) return home;
    const box = fightingBox(battle, view, ids);
    // Done once the camera's own framing would have no mark for them: they are (all but a straggler) in its view.
    if (!box || edgeMarks(view, home, sight, [{ group: 0, points: battle.units.filter((unit) => unit.hp > 0 && ids.has(unit.id)) }], seen).length === 0) {
      focus.current = null;
      return home;
    }
    return centreOn(framed, sight, box, screenRatio());
  };
  const camera = still || !framed ? undefined : aim;
  const panRef = useRef<PanAt>({ dx: 0, dy: 0 });
  const steer = useRef<((to: PanAt | null) => void) | null>(null);

  // ---- the marks at the window's edge, for the groups out of view
  const [marks, setMarks] = useState<EdgeMark[]>([]);
  const marksRef = useRef<EdgeMark[]>([]);
  /** Looked at each frame; set only when a mark comes, goes, or has moved more than a little, so none ever twitches. */
  const lookOut = () => {
    const out = battle.over || !framed ? [] : edgeMarks(view, panRef.current, sight, battle.bands.map((_, band) => ({ group: band, points: groupPoints(band) })), seen);
    const was = marksRef.current;
    const next = out.map((mark) => {
      const before = was.find((entry) => entry.group === mark.group);
      return before && Math.abs(before.left - mark.left) < 12 && Math.abs(before.top - mark.top) < 12 && before.turn === mark.turn ? { ...mark, left: before.left, top: before.top } : mark;
    });
    const same = (a: EdgeMark, b: EdgeMark) => a.group === b.group && a.left === b.left && a.top === b.top && a.turn === b.turn && a.count === b.count;
    // (Which scouts a mark stands for is kept up to date without a fresh paint: a tap goes to those out there now.)
    if (next.length === was.length && next.every((mark, index) => same(mark, was[index]))) {
      next.forEach((mark, index) => (was[index].ids = mark.ids));
      return;
    }
    marksRef.current = next;
    setMarks(next);
  };
  const lookAt = (mark: EdgeMark) => {
    playSound("click");
    if (!framed) return;
    const ids = new Set(mark.ids);
    if (still) {
      const box = fightingBox(battle, view, ids);
      if (box) steer.current?.(centreOn(framed, sight, box, screenRatio()));
      return;
    }
    focus.current = ids;
    steer.current?.(null);
  };
  /** The colour what can be picked is ringed in: the rallied group's, or the hero's pale gold. */
  const picking = pick?.kind === "rally" ? APPROACH_COLOURS[(hud.bands[pick.group]?.via ?? 0) % APPROACH_COLOURS.length] : pick ? "#FFF6C2" : undefined;

  return (
    <>
      <RaidField view={view} roomW={roomW} roomH={roomH} pan={framed?.pan} camera={camera} panRef={panRef} steer={steer} scene={scene} looks={looks} paintKey="" tick={tick} label={`${name}: the raid`}>
        <button type="button" className="pip-raid-field-hit" aria-label="Let go" tabIndex={-1} onClick={() => setPick(null)} hidden={!pick} />
        {pick &&
          targets.map((id) => {
            const entry = battle.structures[id];
            const spot = toRoom(view, entry.x, entry.y);
            const size = Math.max(28, (entry.r * 2 + 10) * view.css);
            const group = pick.kind === "rally" ? pick.group : -1;
            return (
              <button
                key={id}
                type="button"
                className="pip-raid-target"
                style={{ left: spot.left - size / 2, top: spot.top - size * 0.7, width: size, height: size, "--group": picking } as CSSProperties}
                aria-label={pick.kind === "rally" ? `Rally the ${approachShort(battle.approaches[hud.bands[group]?.via ?? 0]).toLowerCase()} group to ${structureName(entry, king)}` : `${moveInfo?.name ?? "The hero's move"} at ${structureName(entry, king)}`}
                onClick={() => (pick.kind === "rally" ? give({ kind: "rally", group, target: id }, `group-${group}`) : give({ kind: "hero", target: id }, "hero"))}
              />
            );
          })}
      </RaidField>

      {!hud.over &&
        marks.map((mark) => {
          const band = hud.bands[mark.group];
          if (!band) return null;
          const way = approachShort(battle.approaches[band.via]).toLowerCase();
          return (
            <button
              key={mark.group}
              type="button"
              className="pip-raid-edge"
              data-group={mark.group}
              style={{ left: mark.left, top: mark.top, "--group": APPROACH_COLOURS[band.via % APPROACH_COLOURS.length] } as CSSProperties}
              aria-label={`${mark.count} of the ${way} group, out of view: look`}
              title={`${approachShort(battle.approaches[band.via])}: look`}
              onClick={() => lookAt(mark)}
            >
              <ArrowUp size={14} strokeWidth={3} style={{ transform: `rotate(${mark.turn}deg)` }} aria-hidden />
              <strong>{mark.count}</strong>
            </button>
          );
        })}

      <div className="pip-raid-hud" role="group" aria-label="The raid">
        <span className={`pip-raid-hud-cell pip-raid-bell${hud.rung ? " is-rung" : ""}${hud.seconds <= 10 && !hud.over ? " is-bad" : ""}`} title={hud.rung ? "The bell has rung" : `The bell rings at ${BELL_SECONDS} s`}>
          <Bell size={18} aria-hidden />
          <strong>{hud.seconds}</strong>
          <small>s</small>
        </span>
        <span className="pip-raid-hud-cell pip-raid-stars" title="The nest · most of it · the feat">
          <StarPips earned={hud.stars} size="hud" />
        </span>
        <span className={`pip-raid-hud-cell pip-raid-orders-left${hud.orders === 0 ? " is-spent" : ""}`} title="Orders left">
          <Megaphone size={18} aria-hidden />
          <strong>{hud.orders}</strong>
        </span>
        {!hud.over && (
          <button type="button" className="pip-raid-key pip-raid-end" aria-label="End the raid" title="End the raid as it stands" onClick={() => (battle.over = true)}>
            <Flag size={16} aria-hidden />
          </button>
        )}
      </div>

      {!hud.over && (
        <div className="pip-raid-dock" role="group" aria-label="Orders" data-picking={pick?.kind}>
          {hud.bands.map((band, index) => {
            const chosen = pick?.kind === "rally" && pick.group === index;
            return (
              <button
                key={index}
                type="button"
                className={`pip-raid-group${chosen ? " is-chosen" : ""}${band.held ? " is-held" : ""}${hud.orders <= 0 ? " is-spent" : ""}${nudged === `group-${index}` ? " is-nudged" : ""}`}
                style={{ "--group": APPROACH_COLOURS[band.via % APPROACH_COLOURS.length] } as CSSProperties}
                aria-pressed={chosen}
                aria-label={`The ${approachShort(battle.approaches[band.via]).toLowerCase()} group, ${band.alive} left${band.held ? ", waiting" : ""}: rally`}
                title={`${approachShort(battle.approaches[band.via])}: rally`}
                disabled={band.alive === 0}
                onClick={() => {
                  if (hud.orders <= 0) {
                    nudge(`group-${index}`);
                    return;
                  }
                  setPick((was) => (was?.kind === "rally" && was.group === index ? null : { kind: "rally", group: index }));
                  playSound("click");
                }}
              >
                <span className="pip-raid-group-kinds" aria-hidden="true">
                  {band.kinds.slice(0, 3).map((kind) => {
                    const look = KIND_ART[kind as keyof typeof KIND_ART];
                    return <Sprite key={kind} name={look.name} variant={look.variant} box={32} />;
                  })}
                </span>
                <strong className="pip-raid-group-count">{band.alive}</strong>
                {band.held && <Hourglass size={14} aria-hidden />}
                {chosen && <Crosshair size={18} className="pip-raid-sight" aria-hidden />}
              </button>
            );
          })}
          {held >= 0 && (
            <button
              type="button"
              className={`pip-raid-order${nudged === "release" ? " is-nudged" : ""}`}
              style={{ "--group": APPROACH_COLOURS[(hud.bands[held]?.via ?? 0) % APPROACH_COLOURS.length] } as CSSProperties}
              title="The group held back goes in"
              onClick={() => give({ kind: "release" }, "release")}
            >
              <i className="pip-raid-swatch" aria-hidden="true" />
              <Play size={15} aria-hidden /> Release
            </button>
          )}
          {moveInfo && heroId !== null && !hud.heroMoved && (
            <button
              type="button"
              className={`pip-raid-order is-hero${pick?.kind === "aim" ? " is-chosen" : ""}${nudged === "hero" ? " is-nudged" : ""}`}
              aria-pressed={pick?.kind === "aim"}
              title={`${HEROES[heroId]?.short ?? "The hero"}: ${moveInfo.does}`}
              onClick={() => {
                if (!hud.heroOn || hud.orders <= 0) {
                  nudge("hero");
                  return;
                }
                if (moveInfo.aimed) {
                  setPick((was) => (was?.kind === "aim" ? null : { kind: "aim" }));
                  playSound("click");
                } else give({ kind: "hero" }, "hero");
              }}
            >
              <Sprite name="hero" variant={heroId} box={24} /> {moveInfo.name}
              {pick?.kind === "aim" && <Crosshair size={16} className="pip-raid-sight" aria-hidden />}
            </button>
          )}
          <button type="button" className="pip-raid-key pip-raid-dock-info" aria-label="How orders work" aria-expanded={told} onClick={() => setTold((was) => !was)}>
            <Info size={15} aria-hidden />
          </button>
          {told && (
            <p className="pip-raid-told" role="note">
              Tap a group, then what to send it at. Each order spends one <Megaphone size={12} aria-label="order" />
            </p>
          )}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {hud.stars.filter(Boolean).length} of 3 stars
      </p>
    </>
  );
};
