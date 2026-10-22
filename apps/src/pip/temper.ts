/**
 * Pip's temper, and the mood she is in.
 *
 * Her long mood (the hearts: Rust keeps it, habit/seeds.rs) moves slowly, and
 * nothing a reader does in a sitting used to show on it: she was, in effect,
 * always fine. The owner asked for more (2026-10-13: "let her throw
 * tantrums", and then "the emotions seem very temporary so let it stay for a
 * bit"). This is what was added, worked out here and played by the house
 * scene:
 *
 * - **Patience**, 0 to 100. What the reader does to her here and now wears it
 *   down (`ANNOYS`: poked past the end of the ladder, woken, dropped, whirled,
 *   her leaf tickled till she sneezes...), affection gives it back
 *   (`SOOTHES`), and it comes back by itself at `PATIENCE_PER_MIN`. A poke too
 *   many is a flash of temper, gone in a minute or two. Never absence: nothing
 *   here runs while the app is shut except the clock running a mood out.
 * - **A tantrum**, when her patience runs out: a little performance (the
 *   scene plays `tantrumPlan`, a different one for each cause), at most one
 *   every `TANTRUM_EVERY_MS` however hard she is provoked.
 * - **A mood she is in, that lasts** (`Spell`). After a tantrum she sulks: for
 *   `HUFF_MS` she will have nothing to do with the reader, and then it eases,
 *   sulking, then merely cool, then herself, over a quarter of an hour to
 *   half an hour (`SULK_MS`, by what set her off). Making up (a cuddle, a
 *   snack) cuts that to a few tender minutes (`TENDER_MS`), not to nothing.
 *   Good moods last too: after a snack, a long cuddle, a dance, a game, or
 *   food found in a fridge that was bare, she is glad for ten or twenty
 *   minutes (`GLAD_MS`).
 * - **It shows on the hearts** for as long as it lasts (`heartsOff`): laid
 *   over the stored mood in the webview, never written to Rust, so no swing
 *   can leave a lasting wrong number.
 * - **It survives leaving the room**, and closing the app within the time it
 *   would have lasted: when it began and what it was are kept on this device
 *   (`TEMPER_STORE`, localStorage, like the furnishings: not the backup, not
 *   the sync), and what is left is worked out from the clock (`temperAt`).
 *   Past its time it is simply gone, so a reader who was away for a day
 *   never comes back to an old sulk: being away is not punished.
 *
 * Everything here is a pure function of a state, what happened, and the time
 * (milliseconds since the epoch: these outlive the page). temper.test.ts
 * holds the rules to their word.
 */
import type { Activity, Rand, Step } from "./behaviour";

/** What the reader can do to her that she minds. */
export type Annoyance = "poked" | "woken" | "dropped" | "tossed" | "whirled" | "sneezed" | "light" | "picture" | "ball" | "fridge";
/** What the reader can do that she likes. */
export type Kindness = "cuddle" | "stroke" | "tickle" | "highfive" | "fetch" | "dance" | "game" | "bed" | "treat" | "food";

export const PATIENCE_FULL = 100;

/**
 * What each annoyance takes off her patience. Poked: each poke at or past the
 * last rung of the ladder. Tossed: any throw; dropped: let fall from a height.
 * Light: switched again within a few seconds of the last switch. Fridge: she
 * found it bare, and minded.
 */
export const ANNOYS: Readonly<Record<Annoyance, number>> = {
  poked: 20,
  woken: 30,
  dropped: 15,
  tossed: 8,
  whirled: 25,
  sneezed: 20,
  light: 12,
  picture: 25,
  ball: 12,
  fridge: 35
};

/** What each kindness gives back. */
export const SOOTHES: Readonly<Record<Kindness, number>> = {
  cuddle: 30,
  stroke: 15,
  tickle: 5,
  highfive: 10,
  fetch: 8,
  dance: 20,
  game: 10,
  bed: 15,
  treat: 40,
  food: 25
};

/** Her patience comes back by itself this fast: a poke too many is forgotten in a minute or two. */
export const PATIENCE_PER_MIN = 15;
/** At or under this her patience has run out: the next thing would have been the last straw anyway. */
export const PATIENCE_GONE = 10;
/** After a tantrum she has this much patience again: enough that the next small thing is not another. */
export const PATIENCE_AFTER_TANTRUM = 50;
/** At most one tantrum in this long, however hard she is provoked. */
export const TANTRUM_EVERY_MS = 8 * 60_000;

const MIN = 60_000;

/** How long she sulks after a tantrum if nothing is done about it, by what set her off: the worse it was, the longer. */
export const SULK_MS: Readonly<Record<Annoyance, number>> = {
  poked: 15 * MIN,
  woken: 15 * MIN,
  sneezed: 15 * MIN,
  light: 15 * MIN,
  ball: 15 * MIN,
  tossed: 18 * MIN,
  dropped: 20 * MIN,
  whirled: 20 * MIN,
  picture: 20 * MIN,
  fridge: 25 * MIN
};
/** A second tantrum within the hour is a longer sulk, by this much; and no mood lasts longer than `SPELL_MAX_MS`. */
export const SULK_AGAIN = 1.25;
export const SPELL_MAX_MS = 30 * MIN;
/** The start of a sulk: she will not be picked up or played with. */
export const HUFF_MS = 2 * MIN;
/** Made up with, she is still a little tender for this long. */
export const TENDER_MS = 4 * MIN;
/** How strong a sulk still is once she has been made up with (of 1). */
export const TENDER_FROM = 0.4;
/** A smaller kindness during a sulk (a stroke, a dance) takes this share off what is left of it. */
export const KINDNESS_SHORTENS = 0.25;

/** How long she is glad after each of the things that make her so; the others are too small to last. */
export const GLAD_MS: Readonly<Partial<Record<Kindness, number>>> = {
  treat: 20 * MIN,
  food: 15 * MIN,
  dance: 12 * MIN,
  game: 12 * MIN,
  cuddle: 10 * MIN
};

/** The kindnesses that make up with a sulking Pip outright. */
const MAKES_UP: ReadonlySet<Kindness> = new Set<Kindness>(["cuddle", "treat", "food"]);

/** What a mood at its strongest moves the hearts by, in points of mood (a heart is 20): a sulk down, a good mood up. */
export const SULK_POINTS = 30;
export const GLAD_POINTS = 20;
/** And what a temper with no mood to it takes, at the very end of her patience. */
export const CROSS_POINTS = 20;

/**
 * A mood she is in: a sulk after a tantrum, or a good mood after something
 * lovely. At `from` strength until `holdUntil` (the huff of a sulk, the first
 * half of a good mood), then easing evenly to nothing at `ends`.
 */
export type Spell = {
  kind: "sulk" | "glad";
  cause: Annoyance | Kindness;
  since: number;
  holdUntil: number;
  ends: number;
  from: number;
  /** A sulk the reader has made up with: the tender minutes after. */
  madeUp?: boolean;
};

export type Temper = {
  /** 0 (at the end of it) to 100, as of `at`. */
  patience: number;
  at: number;
  spell: Spell | null;
  /** When her last tantrum began; 0 for never. */
  tantrumAt: number;
};

/** How she is, in a word: `huff` (will have nothing to do with the reader), `sulk`, `cool`, `glad`, or herself. */
export type Humour = "huff" | "sulk" | "cool" | "glad" | null;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export const temperStart = (now: number): Temper => ({ patience: PATIENCE_FULL, at: now, spell: null, tantrumAt: 0 });

/** How strong a mood is at `now`, 0 to 1. */
export const spellStrength = (spell: Spell | null, now: number) => {
  if (!spell || now >= spell.ends) return 0;
  if (now <= spell.holdUntil || spell.ends <= spell.holdUntil) return spell.from;
  return spell.from * ((spell.ends - now) / (spell.ends - spell.holdUntil));
};

/**
 * The temper as it stands at `now`: her patience come back by the clock, and
 * a mood that has run its time gone. A clock that went backwards is no time
 * passing.
 */
export const temperAt = (temper: Temper, now: number): Temper => {
  const passed = Math.max(0, now - temper.at);
  const patience = clamp(temper.patience + (passed / MIN) * PATIENCE_PER_MIN, 0, PATIENCE_FULL);
  const spell = temper.spell && now < temper.spell.ends ? temper.spell : null;
  return { ...temper, patience, at: Math.max(temper.at, now), spell };
};

/** How she is at `now`. */
export const humourOf = (temper: Temper, now: number): Humour => {
  const spell = temper.spell;
  const strength = spellStrength(spell, now);
  if (!spell || strength <= 0) return null;
  if (spell.kind === "glad") return "glad";
  if (!spell.madeUp && now < spell.holdUntil) return "huff";
  return strength > 0.45 ? "sulk" : "cool";
};

/** Whether she will have nothing to do with the reader just now. */
export const huffing = (temper: Temper, now: number) => humourOf(temper, now) === "huff";

/** How many minutes of the mood she is in are left (0: none). */
export const spellMinutesLeft = (temper: Temper, now: number) => (temper.spell && now < temper.spell.ends ? Math.max(1, Math.ceil((temper.spell.ends - now) / MIN)) : 0);

/**
 * What her temper adds to the mood the hearts show, in points (below zero:
 * takes): a sulk down and a good mood up, by how strong it still is, and a
 * temper wearing thin a little down by itself. Whole points, so the hearts
 * do not shimmer.
 */
export const heartsOff = (temper: Temper, now: number) => {
  const at = temperAt(temper, now);
  const strength = spellStrength(at.spell, now);
  const mood = at.spell ? (at.spell.kind === "sulk" ? -SULK_POINTS : GLAD_POINTS) * strength : 0;
  const cross = -((PATIENCE_FULL - at.patience) / PATIENCE_FULL) * CROSS_POINTS;
  // A sulk already says she is cross: the two do not add up past it.
  const off = at.spell?.kind === "sulk" ? Math.min(mood, cross) : mood + cross;
  return Math.round(off) || 0;
};

/**
 * Something annoyed her at `now`. Says whether that was the last straw
 * (`tantrum`: what she is having one about). In the huff of a sulk she is
 * past minding: nothing more is taken. With a tantrum too lately behind her
 * she is at the end of her patience and stays there, without another.
 */
export const annoy = (temper: Temper, what: Annoyance, now: number): { temper: Temper; tantrum: Annoyance | null } => {
  const at = temperAt(temper, now);
  if (huffing(at, now)) return { temper: at, tantrum: null };
  const patience = Math.max(0, at.patience - ANNOYS[what]);
  if (patience > PATIENCE_GONE || (at.tantrumAt > 0 && now - at.tantrumAt < TANTRUM_EVERY_MS)) return { temper: { ...at, patience }, tantrum: null };
  // The last straw. A second one within the hour is a longer sulk.
  const again = at.tantrumAt > 0 && now - at.tantrumAt < 60 * MIN;
  const lasts = Math.min(SPELL_MAX_MS, SULK_MS[what] * (again ? SULK_AGAIN : 1));
  const spell: Spell = { kind: "sulk", cause: what, since: now, holdUntil: now + HUFF_MS, ends: now + lasts, from: 1 };
  return { temper: { patience: PATIENCE_AFTER_TANTRUM, at: now, spell, tantrumAt: now }, tantrum: what };
};

/**
 * Something kind at `now`. Her patience comes back by its amount. Sulking, a
 * cuddle or a snack makes up with her (`madeUp`: she comes round, and is
 * tender for a few minutes more), and a smaller kindness, once she is past
 * the huff, shortens what is left. Not sulking, the bigger kindnesses put
 * her in a good mood for a while (`glad`), or keep one going.
 */
export const soothe = (temper: Temper, what: Kindness, now: number): { temper: Temper; madeUp: boolean; glad: boolean } => {
  const at = temperAt(temper, now);
  const patience = Math.min(PATIENCE_FULL, at.patience + SOOTHES[what]);
  const spell = at.spell;
  if (spell?.kind === "sulk") {
    if (spell.madeUp) return { temper: { ...at, patience }, madeUp: false, glad: false };
    if (MAKES_UP.has(what)) {
      const from = Math.min(TENDER_FROM, spellStrength(spell, now));
      const tender: Spell = { ...spell, since: now, holdUntil: now, ends: Math.min(spell.ends, now + TENDER_MS), from, madeUp: true };
      return { temper: { ...at, patience, spell: tender }, madeUp: true, glad: false };
    }
    // Still in the huff, a smaller kindness is not taken.
    if (now < spell.holdUntil) return { temper: at, madeUp: false, glad: false };
    const ends = now + (spell.ends - now) * (1 - KINDNESS_SHORTENS);
    return { temper: { ...at, patience, spell: { ...spell, ends } }, madeUp: false, glad: false };
  }
  const lasts = GLAD_MS[what];
  if (!lasts) return { temper: { ...at, patience }, madeUp: false, glad: false };
  // A good mood: full for the first half, then easing. One already under way is kept going, never cut short.
  const ends = Math.max(spell?.kind === "glad" ? spell.ends : 0, now + lasts);
  const glad: Spell = { kind: "glad", cause: what, since: now, holdUntil: now + (ends - now) / 2, ends, from: 1 };
  return { temper: { ...at, patience, spell: glad }, madeUp: false, glad: true };
};

/**
 * A peace offering at `now` (the ball rolled gently to her feet: pip/catch.ts,
 * `peaceOffering`). In the huff it is the one small kindness she takes: the
 * huff ends there and then, and the kindness counts as it would have a moment
 * later, so the sulk goes on, a little shorter, and she will play again with
 * half a heart. No numbers of its own: out of the huff it is simply `what`.
 */
export const offerPeace = (temper: Temper, what: Kindness, now: number): { temper: Temper; madeUp: boolean; glad: boolean } => {
  const at = temperAt(temper, now);
  if (!at.spell || !huffing(at, now)) return soothe(at, what, now);
  return soothe({ ...at, spell: { ...at.spell, holdUntil: now } }, what, now);
};

// ---- kept on this device -----------------------------------------------------------
//
// One localStorage entry: the temper as it last changed. Read tolerantly, as
// of the clock: a mood past its time is gone, her patience is back, and
// anything that does not read (or says a mood lasts longer than one can) is
// a fresh temper. Nothing is kept for a Pip who is simply herself.

export const TEMPER_STORE = "leaflet.pip.temper";

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const ANNOYANCES = Object.keys(ANNOYS);
const KINDNESSES = Object.keys(SOOTHES);

const readSpell = (raw: unknown, now: number): Spell | null => {
  if (!raw || typeof raw !== "object") return null;
  const spell = raw as Partial<Spell>;
  if (spell.kind !== "sulk" && spell.kind !== "glad") return null;
  if (typeof spell.cause !== "string" || !(spell.kind === "sulk" ? ANNOYANCES : KINDNESSES).includes(spell.cause)) return null;
  if (!finite(spell.since) || !finite(spell.holdUntil) || !finite(spell.ends) || !finite(spell.from)) return null;
  // Begun in the future (the clock was changed), over already, or longer than any mood lasts: not a mood.
  if (spell.since > now + MIN || spell.ends <= now || spell.ends - spell.since > SPELL_MAX_MS + MIN || spell.holdUntil < spell.since || spell.holdUntil > spell.ends) return null;
  return { kind: spell.kind, cause: spell.cause, since: spell.since, holdUntil: spell.holdUntil, ends: spell.ends, from: clamp(spell.from, 0, 1), ...(spell.madeUp === true ? { madeUp: true } : {}) };
};

/** The temper kept in `text`, as it stands at `now`; a fresh one for anything that does not read. */
export const parseTemper = (text: string | null | undefined, now: number): Temper => {
  if (!text) return temperStart(now);
  try {
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return temperStart(now);
    const kept = raw as Partial<Temper>;
    if (!finite(kept.patience) || !finite(kept.at) || kept.at > now + MIN) return temperStart(now);
    const tantrumAt = finite(kept.tantrumAt) && kept.tantrumAt > 0 && kept.tantrumAt <= now + MIN ? kept.tantrumAt : 0;
    return temperAt({ patience: clamp(kept.patience, 0, PATIENCE_FULL), at: kept.at, spell: readSpell(kept.spell, now), tantrumAt }, now);
  } catch {
    return temperStart(now);
  }
};

/** What to keep of a temper at `now`; null when she is simply herself and there is nothing to remember. */
export const keepTemper = (temper: Temper, now: number): string | null => {
  const at = temperAt(temper, now);
  const recent = at.tantrumAt > 0 && now - at.tantrumAt < 60 * MIN;
  if (!at.spell && at.patience >= PATIENCE_FULL && !recent) return null;
  return JSON.stringify({ patience: Math.round(at.patience * 10) / 10, at: at.at, spell: at.spell, tantrumAt: recent ? at.tantrumAt : 0 });
};

// ---- the performance ----------------------------------------------------------------------
//
// A tantrum is a few moves in a row with a line each, different for what set
// her off, ending with her back turned somewhere out of the way. The scene
// walks it like any other activity (pip/behaviour.ts, `Activity`).

const pick = <T,>(rand: Rand, items: readonly T[]): T => items[Math.min(items.length - 1, Math.floor(rand() * items.length))];

/** What she says with her back turned, to a hand that will not leave her be. */
const HUFF_LINES = ["hmph.", "no.", "not talking to you.", "i'm sulking. it takes as long as it takes.", "go away. ...not far."];
/** And once the worst is over, still sulking. */
const SULK_LINES = ["hmph. ...what.", "still a bit cross.", "i'm thinking about forgiving you.", "...fine. hello."];
/** Poked in a good mood. */
const GLAD_LINES = ["hee! hi!", "best day.", "hello, hello!", "i like today."];
const ROUND_LINES = ["...okay. friends.", "fine. i forgive you.", "...i missed you a bit.", "all right. but be nice."];
const EASED_LINES = ["...fine.", "i'm done sulking. mostly.", "hmph. hello, then."];

export const huffLine = (rand: Rand) => pick(rand, HUFF_LINES);
export const sulkLine = (rand: Rand) => pick(rand, SULK_LINES);
export const gladLine = (rand: Rand) => pick(rand, GLAD_LINES);

type Act = { move: string; seconds: number; lines: readonly string[] };

/**
 * Each tantrum, as she plays it. Woken, she is grumpy and sleepy; dropped or
 * thrown about, indignant; a bare fridge is theatre; the rest is plain cross.
 */
const TANTRUMS: Readonly<Record<Annoyance, readonly Act[]>> = {
  woken: [
    { move: "yawn", seconds: 4, lines: ["i was *asleep*.", "i was in the middle of a dream."] },
    { move: "steamed", seconds: 2, lines: ["do you know what time it is.", "some of us were sleeping."] }
  ],
  dropped: [
    { move: "steamed", seconds: 2, lines: ["you *dropped* me.", "ow. that was the floor."] },
    { move: "stamp", seconds: 2.7, lines: ["i am not. a thing. you drop."] }
  ],
  tossed: [
    { move: "steamed", seconds: 2, lines: ["i am *not* a ball.", "enough throwing."] },
    { move: "stamp", seconds: 2.7, lines: ["not. a. ball.", "feet. floor. mine."] }
  ],
  whirled: [
    { move: "dizzy", seconds: 2, lines: ["the room... won't stop..."] },
    { move: "stamp", seconds: 2.7, lines: ["no more spinning!", "i am not a top."] },
    { move: "steamed", seconds: 2, lines: ["i mean it."] }
  ],
  fridge: [
    { move: "faint", seconds: 7, lines: ["nothing. not a crumb. i shall perish.", "an empty fridge. this is how it ends."] },
    { move: "sob", seconds: 3, lines: ["perish!", "wasting away!"] }
  ],
  poked: [
    { move: "stamp", seconds: 2.7, lines: ["stop. poking. me.", "that is *enough* poking."] },
    { move: "steamed", seconds: 2, lines: ["i have a limit. that was it."] }
  ],
  sneezed: [
    { move: "stamp", seconds: 2.7, lines: ["my leaf is *not* a toy.", "leave. my leaf. alone."] },
    { move: "steamed", seconds: 2, lines: ["i sneezed four times."] }
  ],
  light: [
    { move: "steamed", seconds: 2, lines: ["on. off. on. off. *enough*.", "pick one!"] },
    { move: "stamp", seconds: 2.7, lines: ["my eyes!"] }
  ],
  picture: [
    { move: "stamp", seconds: 2.7, lines: ["that was my *favourite*.", "pictures go on the *wall*."] },
    { move: "sob", seconds: 3, lines: ["it's all bent now."] }
  ],
  ball: [
    { move: "stamp", seconds: 2.7, lines: ["i was *fetching* that.", "that was mine to bring back."] },
    { move: "steamed", seconds: 2, lines: ["we had a game going."] }
  ]
};

/** The move she sulks in, her back to the room. */
export const SULK_MOVE = "sulk";

/** Every move a tantrum or a making-up uses, for the tests. */
export const TEMPER_MOVES: readonly string[] = [...new Set([...Object.values(TANTRUMS).flatMap((acts) => acts.map((act) => act.move)), SULK_MOVE, "sniffle", "glance", "shift"])];

/** How near the walls she goes to sulk, in floor pixels (the scene keeps her this far in anyway). */
const CORNER = 20;

/**
 * The tantrum she throws about `cause`, from where she stands (`x`, on a
 * floor from `floorLeft`, 0 when left out, to `floorW`). The performance, then off to the nearer wall, her
 * back to the room; or, woken with a bed to go back to (`bed`: its name among
 * the spots), back into it without a word. With motion reduced it is a line
 * and a pose, not a performance.
 */
export const tantrumPlan = (cause: Annoyance, state: { x: number; floorW: number; floorLeft?: number; bed?: string | null; reduced?: boolean }, rand: Rand): Activity => {
  const label = "having a tantrum";
  const turned: Step = { kind: "do", move: SULK_MOVE, seconds: 6, line: "hmph." };
  if (state.reduced) return { id: "tantrum", label, steps: [{ kind: "do", move: SULK_MOVE, seconds: 5, line: pick(rand, TANTRUMS[cause][0].lines) }] };
  const acts: Step[] = TANTRUMS[cause].map((act) => ({ kind: "do", move: act.move, seconds: act.seconds, line: pick(rand, act.lines) }));
  if (cause === "woken" && state.bed) return { id: "tantrum", label, steps: [...acts, { kind: "do", move: SULK_MOVE, seconds: 3, line: "hmph." }, { kind: "use", id: state.bed, what: "bed" }] };
  const from = state.floorLeft ?? 0;
  const left = state.x < (from + state.floorW) / 2;
  const wall = left ? from + CORNER : state.floorW - CORNER;
  return { id: "tantrum", label, steps: [...acts, { kind: "walk", x: wall }, { kind: "face", dir: left ? -1 : 1 }, turned] };
};

/**
 * Coming round. Made up with (`madeUp`): a sniff, a look over her shoulder,
 * and back to herself, with a word. The huff simply over: the look, and a
 * grudging one.
 */
export const comeRound = (madeUp: boolean, rand: Rand, reduced = false): Activity => ({
  id: "tantrum",
  label: "coming round",
  steps: madeUp
    ? [...(reduced ? [] : [{ kind: "do", move: "sniffle", seconds: 3 } as Step]), { kind: "do", move: "glance", seconds: 3 }, { kind: "do", move: "shift", seconds: 2, line: pick(rand, ROUND_LINES) }]
    : [{ kind: "do", move: "glance", seconds: 3 }, { kind: "do", move: "shift", seconds: 2, line: pick(rand, EASED_LINES) }]
});
