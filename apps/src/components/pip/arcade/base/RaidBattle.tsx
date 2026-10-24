import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Bell, Flag, Megaphone, Play, Sparkles } from "lucide-react";
import { BATTLE_TICK, RAID_SECONDS, type Battle, type Result } from "../../../../pip/base/battle";
import { BELL_SECONDS } from "../../../../pip/base/feats";
import { HERO_MOVES, HEROES, heroMove } from "../../../../pip/base/heroes";
import type { OrderGiven } from "../../../../pip/base/orders";
import { playSound } from "../../../../pip/sound";
import type { GameArt } from "../gameArt";
import { RaidField } from "./RaidField";
import { StarPips } from "./RaidScout";
import { moving, newFx, stepFx, takeEvents, type FxState } from "./raidFx";
import { toRoom, type FieldView } from "./raidLayout";
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
  region: number;
  season: number;
  name: string;
  /** Nothing moves but the fight itself: falls and specks are shown at their end. */
  still: boolean;
  /** The raid is over: called once, with how it went. */
  onDone: (result: Result) => void;
};

export const RaidBattle = ({ battle, art, view, region, season, name, still, onDone }: Props) => {
  const king = Boolean(battle.setup.king);
  const fx = useMemo(() => newFx(still), [battle, still]);
  const looks = useMemo(() => newLooks(battle), [battle]);
  const [pick, setPick] = useState<Pick>(null);
  const [nudged, setNudged] = useState<string | null>(null);
  const [hud, setHud] = useState<Hud>(() => hudOf(battle, fx));
  const clock = useRef({ last: -1, acc: 0, done: false, hud: "", rung: false });
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

  return (
    <>
      <RaidField view={view} scene={scene} looks={looks} paintKey="" tick={tick} label={`${name}: the raid`}>
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
                style={{ left: spot.left - size / 2, top: spot.top - size * 0.7, width: size, height: size }}
                aria-label={pick.kind === "rally" ? `Rally the ${approachShort(battle.approaches[hud.bands[group]?.via ?? 0]).toLowerCase()} group to ${structureName(entry, king)}` : `${moveInfo?.name ?? "The hero's move"} at ${structureName(entry, king)}`}
                onClick={() => (pick.kind === "rally" ? give({ kind: "rally", group, target: id }, `group-${group}`) : give({ kind: "hero", target: id }, "hero"))}
              />
            );
          })}
      </RaidField>

      <div className="pip-raid-hud" role="group" aria-label="The raid">
        <span className={`pip-base-chip pip-raid-bell${hud.rung ? " is-rung" : ""}${hud.seconds <= 10 && !hud.over ? " is-bad" : ""}`} title={hud.rung ? "The bell has rung" : `The bell rings at ${BELL_SECONDS} s`}>
          <Bell size={13} aria-hidden />
          <strong>{hud.seconds}</strong>s
        </span>
        <span className="pip-base-chip pip-raid-stars" title="The nest · most of it · the feat">
          <StarPips earned={hud.stars} />
        </span>
        <span className={`pip-base-chip pip-raid-orders-left${hud.orders === 0 ? " is-spent" : ""}`} title="Orders left">
          <Megaphone size={13} aria-hidden />
          <strong>{hud.orders}</strong>
        </span>
        {!hud.over && (
          <button type="button" className="pip-base-round pip-raid-end" aria-label="End the raid" title="End the raid as it stands" onClick={() => (battle.over = true)}>
            <Flag size={14} aria-hidden />
          </button>
        )}
      </div>

      {!hud.over && (
        <div className="pip-raid-dock" role="group" aria-label="Orders">
          {hud.bands.map((band, index) => (
            <button
              key={index}
              type="button"
              className={`pip-raid-group${pick?.kind === "rally" && pick.group === index ? " is-chosen" : ""}${band.held ? " is-held" : ""}${nudged === `group-${index}` ? " is-nudged" : ""}`}
              style={{ "--group": APPROACH_COLOURS[band.via % APPROACH_COLOURS.length] } as CSSProperties}
              aria-pressed={pick?.kind === "rally" && pick.group === index}
              aria-label={`The ${approachShort(battle.approaches[band.via]).toLowerCase()} group, ${band.alive} left${band.held ? ", waiting" : ""}: rally`}
              title="Tap, then tap what to send them at"
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
              <i className="pip-raid-swatch" aria-hidden="true" />
              <span>{approachShort(battle.approaches[band.via])}</span>
              {band.kinds.slice(0, 3).map((kind) => (
                <Sprite key={kind} name={KIND_ART[kind as keyof typeof KIND_ART]} box={16} />
              ))}
              <strong>{band.alive}</strong>
            </button>
          ))}
          {held >= 0 && (
            <button
              type="button"
              className={`tactile-button flex items-center gap-1.5 px-3 py-1 text-xs font-semibold${nudged === "release" ? " is-nudged" : ""}`}
              title="The group held back goes in"
              onClick={() => give({ kind: "release" }, "release")}
            >
              <Play size={12} aria-hidden /> Release
            </button>
          )}
          {moveInfo && heroId !== null && !hud.heroMoved && (
            <button
              type="button"
              className={`tactile-button flex items-center gap-1.5 px-3 py-1 text-xs font-semibold${pick?.kind === "aim" ? " is-chosen" : ""}${nudged === "hero" ? " is-nudged" : ""}`}
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
              <Sparkles size={12} aria-hidden /> {moveInfo.name}
            </button>
          )}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {hud.stars.filter(Boolean).length} of 3 stars
      </p>
    </>
  );
};
