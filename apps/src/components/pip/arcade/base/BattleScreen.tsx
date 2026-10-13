import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Flag, Star } from "lucide-react";
import {
  BATTLE_TICK,
  Battle,
  FIELD_H,
  FIELD_W,
  RAID_SECONDS,
  autoPilot,
  type Foe,
  type Result,
  type Setup,
  type Side,
  type Structure,
  type Unit,
  type UnitKind
} from "../../../../pip/base/battle";
import { BLADES } from "../../../../pip/base/guards";
import { HEROES } from "../../../../pip/base/heroes";
import { DECOR, championName, type Raid, type RaidEnd } from "../../../../pip/base/rules";
import { playSound } from "../../../../pip/sound";
import { CountUp } from "../../../community/CountUp";
import { gameArt, type GameArt } from "../gameArt";
import { drawAt, fitPicture, screenRatio, type Fit } from "./fit";
import { ART_FPS, inLight } from "./scene";
import { Sprite } from "./Sprite";

const KIND_NAMES: Record<UnitKind, string> = { sprout: "Scout", slinger: "Slinger", mole: "Mole", hero: "Hero" };
/** Each kind's picture, for its button. */
const KIND_ART: Record<Exclude<UnitKind, "hero">, string> = { sprout: "scout", slinger: "slinger", mole: "mole" };
const KIND_SAYS: Record<UnitKind, string> = {
  sprout: "Sturdy. Goes for the nearest thing and has to be at it.",
  slinger: "Frail. Throws from further off than most sentries reach.",
  mole: "Goes for the loot, and under a wall instead of through it.",
  hero: ""
};
/** Longest real time folded into one frame, so a stall does not skip the fight. */
const MAX_FRAME = 1 / 10;
/** How long a refused spot stays marked. */
const REFUSED_MS = 500;

/** What is being fought over: a magpie camp the reader raids, or the reader's own camp on a night being watched. */
type Field = { raid: Raid | null; season: number; night: boolean };

/** How long a scout takes to drop in, a thing that was hit to stop shaking, and a won star to float off. */
const DROP_S = 0.22;
const SHAKE_S = 0.28;
const STAR_S = 1.1;

/** A speck in the air: dust from a fall, a bit of loot from a hoard. */
type Bit = { x: number; y: number; vx: number; vy: number; pull: number; age: number; life: number; size: number; colour: string };

/**
 * What the battle looks like beyond where its pieces are: the simulation
 * steps thirty times a second and knows nothing of this. The screen keeps it,
 * so a thing can be drawn between two steps, drop in, shake, and fall in a
 * puff of dust.
 */
type View = {
  /** Canvas pixels to an art pixel: things are placed to these, so they move by the screen's pixels. */
  px: number;
  /** Seconds the screen has been up. */
  time: number;
  /** Where a scout or the champion is drawn: between where the last step left it and where this one has. */
  at: (thing: Unit | Foe) => { x: number; y: number };
  /** How far along the step under way is, 0 to 1: for a pebble in the air. */
  blend: number;
  /** When each scout was first seen, and when each thing was last hit. */
  born: WeakMap<Unit, number>;
  hit: WeakMap<Structure, number>;
  bits: Bit[];
  /** A star just won: which, and when. */
  star: { count: number; at: number } | null;
  /** The raid is won: whoever is left jumps for it. */
  cheer: boolean;
};

/** How long after a raid ends its first star lands, and how long between one star and the next. */
const FIRST_STAR_MS = 500;
const NEXT_STAR_MS = 420;

const stillOnly = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/**
 * How a raid came out, said with some ceremony: the word, the stars landing
 * one at a time (each heard), and then what was carried home, counted up. It
 * sits under the field, not over it, so the scouts jumping for it can be seen.
 */
const RaidResult = ({ end, onClose }: { end: RaidEnd; onClose: () => void }) => {
  const still = stillOnly();
  const [landed, setLanded] = useState(still ? end.stars : 0);
  const [carried, setCarried] = useState(still ? end.loot : 0);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
    if (still) return;
    const timers: number[] = [];
    for (let star = 1; star <= end.stars; star++) {
      timers.push(
        window.setTimeout(() => {
          setLanded(star);
          playSound("star", { pitch: 1 + 0.18 * (star - 1) });
        }, FIRST_STAR_MS + (star - 1) * NEXT_STAR_MS)
      );
    }
    timers.push(
      window.setTimeout(() => {
        setCarried(end.loot);
        for (let drop = 0; drop < Math.min(4, 1 + Math.floor(end.loot / 12)); drop++) playSound("coin", { delay: drop * 85, pitch: 1 + drop * 0.1 });
      }, FIRST_STAR_MS + end.stars * NEXT_STAR_MS + 150)
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [end, still]);
  return (
    <div ref={ref} className={`pip-base-result ${end.won ? "is-won" : "is-lost"}`}>
      <p className="pip-base-result-word">{end.won ? "Taken!" : "Beaten back"}</p>
      <p className="pip-base-result-stars" role="img" aria-label={`${end.stars} of 3 stars`}>
        {[1, 2, 3].map((star) => (
          <span key={star} className={`pip-base-result-star ${star <= landed ? "is-won" : ""}`}>
            <Star size={38} aria-hidden fill={star <= landed ? "currentColor" : "none"} />
          </span>
        ))}
      </p>
      <p className="pip-base-result-loot">
        <Sprite name="acorn" box={20} />
        <strong>
          +<CountUp value={carried} duration={650} />
        </strong>
        <span className="sr-only"> acorns carried home</span>
      </p>
      {end.banner && (
        <p className="pip-base-chip is-lit">
          <Flag size={13} aria-hidden /> The month's banner is yours
        </p>
      )}
      {end.fled && <p className="pip-base-chip is-good">The next stronghold emptied at the news</p>}
      {end.blade !== null && (
        <p className="pip-base-chip is-lit" title={`${BLADES[end.blade].title}. A hero can carry it: see who lives here.`}>
          <Sprite name="blade" variant={end.blade} box={18} /> {BLADES[end.blade].name} is the camp's
        </p>
      )}
      {end.home !== null && (
        <p className="pip-base-chip is-good">
          <Sprite name="decor" variant={end.home} box={18} /> The {DECOR[end.home].name.toLowerCase()} is home again
        </p>
      )}
      <button type="button" className="tactile-button tactile-button-primary px-4 py-1.5 text-xs font-semibold" autoFocus onClick={onClose}>
        Back to camp
      </button>
    </div>
  );
};

const CONFETTI = ["#ffd23f", "#e2557a", "#6cc35a", "#4a9be0", "#ffffff", "#f29b3a"];
/** A raid won: paper from the sky, the whole width of the field. */
const confetti = (bits: Bit[]) => {
  for (let index = 0; index < 54; index++) {
    const x = ((index * 47) % 236) + 2;
    bits.push({ x, y: -4 - ((index * 13) % 30), vx: ((index * 29) % 17) - 8, vy: 22 + ((index * 7) % 22), pull: 16, age: 0, life: 2 + ((index * 11) % 12) / 10, size: index % 4 === 0 ? 2 : 1, colour: CONFETTI[index % CONFETTI.length] });
  }
};

const DUST = ["#d8c9a3", "#b9a57a", "#efe6cc"];
const LOOT = ["#e0a800", "#ffd86b", "#b57a1f"];
/** A puff where something came down, or landed: specks thrown outward that fall and fade. */
const puff = (bits: Bit[], x: number, y: number, count: number, colours: readonly string[], speed: number) => {
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * Math.PI * 2 + (index % 2) * 0.4;
    const fast = speed * (0.55 + ((index * 37) % 10) / 20);
    bits.push({ x, y, vx: Math.cos(angle) * fast, vy: Math.sin(angle) * fast * 0.6 - speed * 0.5, pull: speed * 2.2, age: 0, life: 0.45 + ((index * 13) % 10) / 40, size: index % 3 === 0 ? 2 : 1, colour: colours[index % colours.length] });
  }
};

/** A five-pointed star, for one just won. */
const starShape = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  ctx.beginPath();
  for (let point = 0; point < 10; point++) {
    const angle = -Math.PI / 2 + (point * Math.PI) / 5;
    const reach = point % 2 === 0 ? r : r * 0.45;
    ctx.lineTo(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach);
  }
  ctx.closePath();
};

const spriteOf = (entry: Structure, battle: Battle, tier: number): [string, number | undefined] => {
  if (entry.look) return [entry.look.name, entry.look.variant];
  const down = entry.hp <= 0;
  switch (entry.kind) {
    case "nest":
      return battle.setup.king ? [down ? "kingdown" : "king", undefined] : down ? ["nestdown", undefined] : ["nest", tier];
    case "hoard":
      return ["hoard", down ? 1 : 0];
    case "perch":
      return ["perch", down ? 1 : 0];
    default:
      return ["twigwall", down ? 1 : 0];
  }
};

/** Which picture a unit is: a scout of its kind, the hero, or (by night) a magpie on foot or on the wing. */
const unitArt = (unit: Unit, setup: Setup): { name: string; variant?: number; facesLeft: boolean; lift: number } => {
  if (setup.raiders) {
    // Whoever is not a magpie has a picture of their own, and nobody but a magpie flies.
    if ((setup.faction ?? 0) > 0) return { name: "foe", variant: (setup.faction ?? 1) - 1, facesLeft: false, lift: 0 };
    return unit.kind === "mole" ? { name: "magpie", facesLeft: true, lift: 7 } : { name: "raider", facesLeft: false, lift: 0 };
  }
  if (unit.kind === "hero") return { name: "hero", variant: setup.hero?.id ?? 0, facesLeft: false, lift: 0 };
  return { name: unit.kind === "sprout" ? "scout" : unit.kind, facesLeft: false, lift: 0 };
};

const bar = (ctx: CanvasRenderingContext2D, x: number, y: number, part: number, ours: boolean, wide = 10) => {
  const left = Math.round(x - wide / 2);
  ctx.fillStyle = "#1a1a22";
  ctx.fillRect(left, Math.round(y), wide, 2);
  ctx.fillStyle = ours ? "#7be07b" : "#ff8a5c";
  ctx.fillRect(left, Math.round(y), Math.max(1, Math.round(wide * part)), 2);
};

/** Draws a sprite standing at a point, turned to face the way it is going. */
const facing = (ctx: CanvasRenderingContext2D, image: CanvasImageSource, w: number, left: number, top: number, flip: boolean) => {
  if (!flip) {
    ctx.drawImage(image, left, top);
    return;
  }
  ctx.save();
  ctx.translate(left + w, top);
  ctx.scale(-1, 1);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
};

const paint = (
  ctx: CanvasRenderingContext2D,
  art: GameArt,
  battle: Battle,
  field: Field,
  frame: number,
  cursor: { x: number; y: number } | null,
  refused: { x: number; y: number } | null,
  view: View
) => {
  const snap = (value: number) => Math.round(value * view.px) / view.px;
  ctx.clearRect(0, 0, FIELD_W, FIELD_H);
  const own = Boolean(battle.setup.raiders);
  // The reader's own camp is fought over where it stands, in its own clearing; a magpie camp on the magpies' ground.
  const ground = own ? art.sprite("bg", frame, { variant: (field.season % 4) + (field.night ? 4 : 0) }) : art.sprite("battleground", frame, { variant: field.season % 4 });
  if (ground) {
    ctx.drawImage(ground.image, 0, 0);
  } else {
    ctx.fillStyle = "#8c9a4a";
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  }

  const bars: Array<() => void> = [];
  inLight(ctx, own && field.night, (on) => {
    const things: Array<{ y: number; draw: () => void }> = [];
    for (const entry of battle.structures) {
      const down = entry.hp <= 0;
      things.push({
        // What is down in a magpie camp lies flat: under everything still standing.
        y: down && !entry.look ? entry.y - 200 : entry.y,
        draw: () => {
          const [name, variant] = spriteOf(entry, battle, field.raid?.plan.tier ?? 0);
          // A thing of the reader's own camp holds its first picture: nothing in a fight should blink. The thumper is
          // the one that acts, and it thumps: down for an instant every second or so, not back and forth without rest.
          const thumps = entry.lures && !down && view.time % 1.3 < 0.14;
          const sprite = art.sprite(name, entry.look ? (thumps ? 1 : 0) : frame, variant === undefined ? {} : { variant });
          // The reader's own buildings stand on their feet where they were put; a magpie camp's sit about a point.
          const foot = entry.look ? entry.y + (entry.kind === "wall" ? 3 : 0) : entry.y + entry.r * 0.5;
          // A building of the reader's that the magpies got to is not broken: it is shown faint until morning.
          if (down && entry.look) on.globalAlpha = 0.35;
          // Just hit: it rocks on its feet, and settles.
          const since = view.time - (view.hit.get(entry) ?? -9);
          const rock = !down && since < SHAKE_S ? Math.sin(since * 44) * (1 - since / SHAKE_S) * 1.4 : 0;
          if (sprite) {
            on.drawImage(sprite.image, snap(entry.x - sprite.w / 2 + rock), Math.round(foot - sprite.h));
          } else if (!down) {
            on.fillStyle = entry.kind === "wall" ? "#6b4a2e" : entry.kind === "perch" ? "#2a2a3a" : entry.kind === "hoard" ? "#e0a800" : "#5e3a1f";
            on.beginPath();
            on.arc(entry.x, entry.y, entry.r, 0, Math.PI * 2);
            on.fill();
          }
          on.globalAlpha = 1;
          // The guardian posted at it stands by it, and is seen to be there.
          if (entry.guard !== undefined && !down) {
            const guard = art.sprite("guardian", 0, { variant: entry.guard });
            if (guard) on.drawImage(guard.image, Math.round(entry.x + entry.r + 1), Math.round(foot - guard.h + 1));
          }
          if (!down && entry.hp < entry.max) bars.push(() => bar(ctx, entry.x, foot + 1, entry.hp / entry.max, own));
        }
      });
    }
    for (const unit of battle.units) {
      if (unit.hp <= 0) continue;
      const spot = view.at(unit);
      things.push({
        y: spot.y,
        draw: () => {
          const look = unitArt(unit, battle.setup);
          // Each on their own feet: the same walk, begun at a different moment and kept at a slightly different pace.
          const paces = frame + unit.id * 3 + Math.floor(view.time * (unit.id % 3));
          const sprite = art.sprite(look.name, unit.busy ? paces * 2 : paces, look.variant === undefined ? {} : { variant: look.variant });
          const high = sprite?.h ?? 8;
          // Dropping in from just above; a spring in the step while walking; a jump for a raid that is won.
          const age = view.time - (view.born.get(unit) ?? -9);
          const drop = age < DROP_S ? -((1 - age / DROP_S) ** 2) * 12 : 0;
          const pace = 7.5 + (unit.id % 5) * 0.7;
          const spring = view.cheer ? -Math.abs(Math.sin(view.time * (5.5 + (unit.id % 4) * 0.8) + unit.id)) * 4 : unit.busy || look.lift > 0 ? 0 : -Math.abs(Math.sin(view.time * pace + unit.id * 1.7)) * 1.2;
          const lift = look.lift > 0 ? look.lift + Math.sin(view.time * 6 + unit.id) * 1.2 : 0;
          const left = snap(spot.x - (sprite?.w ?? 6) / 2);
          const top = snap(spot.y - high + 2 - lift + drop + spring);
          if (sprite) {
            facing(on, sprite.image, sprite.w, left, top, unit.left !== look.facesLeft);
          } else {
            on.fillStyle = own ? "#22222e" : unit.kind === "mole" ? "#6b4a2e" : unit.kind === "hero" ? "#c9a227" : "#4fbf5a";
            on.fillRect(snap(spot.x - 3), snap(spot.y - 7 - lift + drop + spring), 6, 7);
          }
          if (unit.hp < unit.max) bars.push(() => bar(ctx, snap(spot.x), snap(spot.y - high - lift), unit.hp / unit.max, !own, unit.kind === "hero" ? 14 : 10));
        }
      });
    }
    const foe = battle.foe;
    if (foe && foe.hp > 0) {
      const spot = view.at(foe);
      things.push({
        y: spot.y,
        draw: () => {
          const sprite = art.sprite("champion", foe.busy ? frame * 2 : frame, { variant: foe.variant });
          // He does not walk: he stamps.
          const stamp = foe.busy ? 0 : -Math.abs(Math.sin(view.time * 6)) * 1.5;
          if (sprite) facing(on, sprite.image, sprite.w, snap(spot.x - sprite.w / 2), snap(spot.y - sprite.h + 2 + stamp), !foe.left);
          else {
            on.fillStyle = "#3a1f4a";
            on.fillRect(snap(spot.x - 5), snap(spot.y - 12), 10, 12);
          }
          bars.push(() => bar(ctx, snap(spot.x), snap(spot.y - (sprite?.h ?? 12) - 1), foe.hp / foe.max, false, 16));
        }
      });
    }
    things.sort((a, b) => a.y - b.y).forEach((thing) => thing.draw());
  }, view.px);
  bars.forEach((draw) => draw());

  const pebble = art.sprite("pebble", frame);
  for (const shot of battle.shots) {
    // As far along as it will be when the step under way is done with.
    const t = Math.min(1, shot.t + view.blend * BATTLE_TICK * 5);
    const x = shot.x0 + (shot.x1 - shot.x0) * t;
    // A little arc, so a thrown stone looks thrown.
    const y = shot.y0 + (shot.y1 - shot.y0) * t - Math.sin(t * Math.PI) * 6;
    if (pebble) ctx.drawImage(pebble.image, snap(x - 2), snap(y - 2));
    else {
      ctx.fillStyle = "#e8e8f0";
      ctx.fillRect(snap(x), snap(y), 2, 2);
    }
  }

  // Dust and loot in the air.
  for (const bit of view.bits) {
    ctx.globalAlpha = Math.max(0, 1 - bit.age / bit.life);
    ctx.fillStyle = bit.colour;
    ctx.fillRect(snap(bit.x), snap(bit.y), bit.size, bit.size);
  }
  ctx.globalAlpha = 1;

  // A star just won: it pops over the camp, hangs, and floats off.
  if (view.star) {
    const age = view.time - view.star.at;
    if (age < STAR_S) {
      const grow = age < 0.18 ? age / 0.18 : 1;
      const overshoot = age < 0.3 ? 1 + Math.sin((age / 0.3) * Math.PI) * 0.35 : 1;
      ctx.globalAlpha = age > STAR_S - 0.35 ? (STAR_S - age) / 0.35 : 1;
      const nest = battle.structures[0];
      const y = nest.y - 34 - age * 9;
      starShape(ctx, nest.x, y, 9 * grow * overshoot);
      ctx.fillStyle = "#1a1a22";
      ctx.fill();
      starShape(ctx, nest.x, y, 7 * grow * overshoot);
      ctx.fillStyle = "#ffd23f";
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  if (refused) {
    ctx.strokeStyle = "#ff5a4a";
    ctx.beginPath();
    ctx.moveTo(refused.x - 4, refused.y - 4);
    ctx.lineTo(refused.x + 4, refused.y + 4);
    ctx.moveTo(refused.x + 4, refused.y - 4);
    ctx.lineTo(refused.x - 4, refused.y + 4);
    ctx.stroke();
  }
  if (cursor) {
    ctx.strokeStyle = battle.canDeploy(cursor.x, cursor.y) ? "#fff6c2" : "#ff5a4a";
    ctx.strokeRect(Math.round(cursor.x) - 4.5, Math.round(cursor.y) - 4.5, 9, 9);
  }
};

type Common = {
  skin: string;
  outfit: readonly string[];
  /** 0 summer to 3 spring: the ground it is fought on. */
  season: number;
  onClose: () => void;
};

type Props = Common &
  (
    | {
        mode: "raid";
        raid: Raid;
        /** The raid is over: called once, with how it went. */
        onDone: (result: Result) => void;
        /** What came of it, once the camp has taken the result in. */
        end: RaidEnd | null;
      }
    | {
        mode: "watch";
        /** Tonight's magpies, the reader's camp as they meet it, and the side they come from. */
        setup: Setup;
        structures: Structure[];
        side: Side;
        night: boolean;
        title: string;
        /** How it comes out, said once it has; and whether that is the camp holding. */
        verdict: string;
        held: boolean;
      }
  );

/**
 * A battle on screen (`pip/base/battle.ts`), two ways.
 *
 * A raid, fought: the reader puts scouts down with a click or a tap anywhere
 * outside the magpies' camp, choosing which kind and where, and a hero if
 * one came; after that they fight by themselves. The clock starts with the
 * first scout, so there is all the time wanted to look the camp over. Keys:
 * 1 to 4 choose who; the arrows move a marker and Space or Enter puts them
 * down at it. A raid can also be sent without being fought, from the list.
 *
 * A night, watched: the reader's own camp where they laid it out, and
 * tonight's magpies coming at it by rule. Nothing to do but look: it is how
 * a layout is tried before the night comes.
 *
 * Both are heard, where Pip's sounds are on: a scout's feet, a pebble, a
 * thing coming down, each star as it is won, and how it ended.
 */
export const BattleScreen = (props: Props) => {
  const { skin, outfit, season, onClose } = props;
  const raid = props.mode === "raid" ? props.raid : null;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [fit, setFit] = useState<Fit>({ css: 2, backing: 2, crisp: true });
  const watched = props.mode === "watch" ? props : null;
  // One battle for the raid or the night this screen was opened on: kept as it is, not worked out again.
  const [battle] = useState(() => (raid ? new Battle(raid.setup, (raid as { structures?: Structure[] }).structures) : new Battle(watched!.setup, watched!.structures)));
  const wornKey = outfit.join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const art = useMemo(() => gameArt("base", skin, outfit), [skin, wornKey]);
  const kinds: UnitKind[] = raid ? [...raid.setup.kinds, ...(raid.setup.hero ? (["hero"] as UnitKind[]) : [])] : [];
  const [kind, setKind] = useState<UnitKind>(kinds[0] ?? "sprout");
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const [hud, setHud] = useState({ left: battle.left, hero: battle.heroLeft, seconds: battle.setup.seconds ?? RAID_SECONDS, stars: 0, destroyed: 0, over: false });
  const cursor = useRef<{ x: number; y: number } | null>(null);
  const refused = useRef<{ x: number; y: number; at: number } | null>(null);
  const done = useRef(false);
  const finish = useRef<((result: Result) => void) | null>(null);
  finish.current = props.mode === "raid" ? props.onDone : null;
  const night = watched?.night ?? false;
  const side = watched?.side ?? "left";

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      // Less the frame it hangs in, on each side (index.css).
      const next = fitPicture(FIELD_W, FIELD_H, wrap.clientWidth - 16, Math.max(180, window.innerHeight - 260), screenRatio());
      setFit((was) => (was.css === next.css && was.backing === next.backing ? was : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const field: Field = { raid, season, night };
    // Where each piece stood before the step under way, so it can be drawn part way to where it stands now.
    const before = new WeakMap<object, { x: number; y: number }>();
    const view: View = {
      px: fit.backing,
      time: 0,
      blend: 1,
      at: (thing) => {
        const from = before.get(thing);
        return from ? { x: from.x + (thing.x - from.x) * view.blend, y: from.y + (thing.y - from.y) * view.blend } : thing;
      },
      born: new WeakMap(),
      hit: new WeakMap(),
      bits: [],
      star: null,
      cheer: false
    };
    const remember = () => {
      for (const unit of battle.units) before.set(unit, { x: unit.x, y: unit.y });
      if (battle.foe) before.set(battle.foe, { x: battle.foe.x, y: battle.foe.y });
    };
    // What each thing had left when last looked at, to see it hit and to see it fall.
    const stood = new Map<Structure, number>(battle.structures.map((entry) => [entry, entry.hp]));
    const landed = new WeakSet<Unit>();
    /** Sees what the steps just taken did, and gives it its dust, its shake and its star. */
    const notice = (dt: number, stars: number) => {
      view.time += dt;
      for (const unit of battle.units) {
        if (!view.born.has(unit)) view.born.set(unit, view.time);
        else if (!landed.has(unit) && view.time - view.born.get(unit)! >= DROP_S) {
          landed.add(unit);
          puff(view.bits, unit.x, unit.y, 5, DUST, 16);
        }
      }
      for (const entry of battle.structures) {
        const had = stood.get(entry) ?? entry.hp;
        if (entry.hp < had) {
          view.hit.set(entry, view.time);
          if (entry.hp <= 0) puff(view.bits, entry.x, entry.y - entry.r * 0.5, entry.kind === "wall" ? 7 : 14, entry.kind === "hoard" ? LOOT : DUST, entry.kind === "wall" ? 22 : 34);
        }
        stood.set(entry, entry.hp);
      }
      for (const bit of view.bits) {
        bit.age += dt;
        bit.x += bit.vx * dt;
        bit.y += bit.vy * dt;
        bit.vy += bit.pull * dt;
      }
      view.bits = view.bits.filter((bit) => bit.age < bit.life);
      if (raid && stars > (view.star?.count ?? 0)) view.star = { count: stars, at: view.time };
      const won = Boolean(raid) && battle.over && stars >= (raid?.plan.need ?? 1);
      if (won && !view.cheer && !stillOnly()) confetti(view.bits);
      view.cheer = won;
    };
    const show = (frame: number, cursor: { x: number; y: number } | null, mark: { x: number; y: number } | null) => {
      // Set again each time: a canvas forgets it when its size changes.
      drawAt(ctx, fit);
      paint(ctx, art, battle, field, frame, cursor, mark, view);
    };
    // What has been heard so far, so each thing is heard once.
    const heard = { fallen: battle.structures.filter((entry) => entry.hp <= 0).length, stars: battle.result().stars, down: battle.units.filter((unit) => unit.hp <= 0).length };
    const listen = (result: Result) => {
      const fallen = battle.structures.filter((entry) => entry.hp <= 0).length;
      if (fallen > heard.fallen) playSound("crumble", { volume: 0.7 });
      heard.fallen = fallen;
      if (raid && result.stars > heard.stars) playSound("star", { pitch: 1 + 0.18 * (result.stars - 1) });
      heard.stars = result.stars;
      if (battle.shots.some((shot) => !shot.ours && shot.t < 0.34)) playSound("pebble", { volume: 0.45 });
    };
    const limit = battle.setup.seconds ?? RAID_SECONDS;
    // A night is not played: the magpies are put down by rule, as they will be when it comes.
    const drive = raid ? null : autoPilot(battle, side);
    let raf = 0;
    let last = 0;
    let acc = 0;
    let elapsed = 0;
    let lastHud = "";

    const sync = () => {
      const result = battle.result();
      listen(result);
      const next = {
        left: battle.left,
        hero: battle.heroLeft,
        seconds: Math.max(0, Math.ceil(limit - battle.time)),
        stars: result.stars,
        destroyed: Math.round(result.destroyed * 100),
        over: battle.over
      };
      const key = JSON.stringify(next);
      if (key !== lastHud) {
        lastHud = key;
        setHud(next);
      }
      if (battle.over && !done.current) {
        done.current = true;
        finish.current?.(result);
      }
    };

    const frame = (time: number) => {
      const dt = last ? Math.min(MAX_FRAME, (time - last) / 1000) : 0;
      last = time;
      elapsed += dt;
      // A raid's clock starts with the first scout put down; a night's at once.
      if (drive || battle.units.length > 0) {
        acc += dt;
        while (acc >= BATTLE_TICK && !battle.over) {
          remember();
          drive?.();
          battle.step(BATTLE_TICK);
          acc -= BATTLE_TICK;
        }
      }
      // Part way through the step under way; once it is over, where things came to rest.
      view.blend = battle.over ? 1 : Math.min(1, acc / BATTLE_TICK);
      notice(dt, battle.result().stars);
      const mark = refused.current && performance.now() - refused.current.at < REFUSED_MS ? refused.current : null;
      show(Math.floor(elapsed * ART_FPS), cursor.current, mark);
      sync();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // Drawn at once too: a window in the background gets few frames.
    show(0, null, null);
    if (!raid && battle.time === 0) playSound("caw", { volume: 0.7 });

    if (!raid) return () => cancelAnimationFrame(raf);

    const put = (x: number, y: number) => {
      if (!battle.deploy(kindRef.current, x, y)) {
        refused.current = { x, y, at: performance.now() };
        playSound("click", { pitch: 0.6 });
      } else if (kindRef.current === "hero") {
        // The hero goes once: back to the scouts after.
        playSound("whee", { volume: 0.8 });
        setKind(raid.setup.kinds[0] ?? "sprout");
      } else {
        playSound("march", { pitch: kindRef.current === "mole" ? 0.75 : kindRef.current === "slinger" ? 1.25 : 1 });
      }
      sync();
    };
    const pointerDown = (event: PointerEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      cursor.current = null;
      put(((event.clientX - rect.left) / rect.width) * FIELD_W, ((event.clientY - rect.top) / rect.height) * FIELD_H);
    };
    const keyDown = (event: KeyboardEvent) => {
      const index = ["1", "2", "3", "4"].indexOf(event.key);
      if (index >= 0 && kinds[index]) {
        setKind(kinds[index]);
        event.preventDefault();
        return;
      }
      const step = { ArrowLeft: [-6, 0], ArrowRight: [6, 0], ArrowUp: [0, -6], ArrowDown: [0, 6] }[event.key];
      if (step) {
        const at = cursor.current ?? { x: 20, y: 64 };
        cursor.current = { x: Math.min(FIELD_W - 4, Math.max(4, at.x + step[0])), y: Math.min(FIELD_H - 4, Math.max(14, at.y + step[1])) };
        event.preventDefault();
        event.stopPropagation();
      } else if ((event.key === " " || event.key === "Enter") && event.target === canvas) {
        const at = cursor.current ?? { x: 20, y: 64 };
        cursor.current = at;
        put(at.x, at.y);
        event.preventDefault();
        event.stopPropagation();
      }
    };
    canvas.addEventListener("pointerdown", pointerDown);
    window.addEventListener("keydown", keyDown, true);
    canvas.focus();
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", pointerDown);
      window.removeEventListener("keydown", keyDown, true);
    };
    // `kinds` is the raid's own list, made again each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art, battle, raid, season, night, side, fit]);

  const stars = (count: number) => (
    <span className="pip-base-stars" aria-label={`${count} of 3 stars`}>
      {[0, 1, 2].map((index) => (
        <Star key={index} size={16} aria-hidden fill={index < count ? "currentColor" : "none"} className={index < count ? "is-won" : ""} />
      ))}
    </span>
  );
  const end = props.mode === "raid" ? props.end : null;
  // How it ended, heard once: when the camp has taken a raid's result in, or a watched night is over.
  const wonRaid = end ? end.won : null;
  useEffect(() => {
    if (wonRaid !== null) playSound(wonRaid ? "fanfare" : "womp");
  }, [wonRaid]);
  const nightOver = Boolean(watched) && hud.over;
  const nightHeld = watched?.held ?? false;
  useEffect(() => {
    if (nightOver) playSound(nightHeld ? "chime" : "womp", { volume: 0.8 });
  }, [nightOver, nightHeld]);
  const villain = raid ? championName(raid.plan) : null;
  const hero = raid?.setup.hero ? HEROES[raid.setup.hero.id] : null;

  return (
    <div className="pip-base mt-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="font-semibold text-on-surface">
          {raid ? raid.plan.name : watched!.title}
          {villain && <span className="ml-2 font-normal text-on-surface-variant">held by {villain}</span>}
          {raid?.plan.kind === "king" && <span className="ml-2 font-normal text-on-surface-variant">(two stars to win)</span>}
        </p>
        <p className="flex items-center gap-2 tabular-nums text-on-surface">
          {raid && (
            <span className="pip-base-chip" title="A star for half the camp, one for the nest, and one for all of it">
              <span key={hud.stars} className={hud.stars > 0 ? "pip-base-pop" : ""}>
                {stars(hud.stars)}
              </span>
            </span>
          )}
          {raid && (
            <span className="pip-base-chip" title="How much of the camp is down">
              {hud.destroyed}%
            </span>
          )}
          <span className={`pip-base-chip ${hud.seconds <= 10 && !hud.over ? "is-bad" : ""}`} title={raid ? "The clock starts with the first scout" : "Until the camp wakes"}>
            {hud.seconds}s
          </span>
        </p>
      </div>
      <div ref={wrapRef} className="pip-arcade-screen pip-base-scene mt-2">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          width={FIELD_W * fit.backing}
          height={FIELD_H * fit.backing}
          className={`${fit.crisp ? "pip-sprite " : ""}pip-arcade-canvas${raid ? " pip-base-field" : ""}`}
          style={{ width: FIELD_W * fit.css, height: FIELD_H * fit.css }}
          aria-label={
            raid
              ? `${raid.plan.name}. Click or tap outside the camp to put a scout down. Arrows move a marker, Space puts one down, 1 to 4 choose who.`
              : `${watched!.title}: your camp, and tonight's magpies coming at it.`
          }
        />
        {raid && !hud.over && hud.left === raid.setup.capacity && hud.hero === Boolean(raid.setup.hero) && (
          <p className="pip-base-hint" aria-hidden="true">
            Tap outside the camp to put a scout down
          </p>
        )}
      </div>
      {hud.over && raid && end && <RaidResult end={end} onClose={onClose} />}
      {hud.over && watched && (
        <div className={`pip-base-result ${watched.held ? "is-won" : "is-lost"}`}>
          <p className="pip-base-result-word">{watched.verdict}</p>
          <button type="button" className="tactile-button tactile-button-primary px-4 py-1.5 text-xs font-semibold" autoFocus onClick={onClose}>
            Back to camp
          </button>
        </div>
      )}
      {raid && !hud.over && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="pip-base-chip" title="Scouts still to put down">
            <strong key={hud.left} className="pip-base-pop">
              {hud.left}
            </strong>{" "}
            left
          </span>
          <span className="flex flex-wrap gap-1.5" role="group" aria-label="Who to put down">
            {kinds.map((entry, index) => (
              <button
                key={entry}
                type="button"
                className={`pip-base-tile ${entry === kind ? "is-chosen" : ""}`}
                aria-pressed={entry === kind}
                aria-label={entry === "hero" ? (hero?.name ?? "Hero") : KIND_NAMES[entry]}
                disabled={entry === "hero" ? !hud.hero : hud.left === 0}
                title={`${entry === "hero" ? `${hero?.name ?? "Hero"}. ${hero?.does ?? ""}` : `${KIND_NAMES[entry]}. ${KIND_SAYS[entry]}`} (${index + 1})`}
                onClick={() => {
                  setKind(entry);
                  playSound("click");
                  canvasRef.current?.focus();
                }}
              >
                {entry === "hero" ? <Sprite name="hero" variant={hero?.id ?? 0} box={30} /> : <Sprite name={KIND_ART[entry]} box={26} />}
                <span className="pip-base-tile-level">{index + 1}</span>
              </button>
            ))}
          </span>
          <button
            type="button"
            className="tactile-button ml-auto px-3 py-1 text-xs"
            title="Ends the raid as it stands"
            onClick={() => {
              battle.over = true;
            }}
          >
            {battle.units.length === 0 ? "Call it off" : "End the raid"}
          </button>
        </div>
      )}
      {!raid && !hud.over && (
        <div className="mt-3 flex justify-end">
          <button type="button" className="tactile-button px-3 py-1 text-xs" onClick={onClose}>
            Back to camp
          </button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {hud.over && end ? `${end.won ? "Taken" : "Beaten back"}, ${end.stars} stars, ${end.loot} acorns.` : ""}
        {hud.over && watched ? watched.verdict : ""}
      </p>
    </div>
  );
};
