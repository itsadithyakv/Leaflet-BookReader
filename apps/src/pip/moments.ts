/**
 * What Pip does when something happens, and what it says.
 *
 * Each moment has a pool of moves so the same event does not always get the
 * same dance. The pick is seeded (by the day, a session, a book) rather than
 * random, so the wrap-up, the stage and the reader peek agree on one move for
 * one event instead of each rolling their own.
 *
 * Lines follow Pip's voice: short, lowercase, and drama aimed at Pip itself.
 */
export type PipMoment =
  | "goal"
  | "streakMilestone"
  | "newRecord"
  | "deepRead"
  | "bookFinished"
  | "sessionStart"
  | "sessionShort"
  | "sessionProgress"
  | "bonus"
  | "imported"
  | "backup"
  | "welcomeBack"
  | "streakLost"
  | "dustyBook"
  | "poke"
  | "awayReturn"
  | "exitGuard"
  | "flowerBloomed"
  | "flowerWilted"
  | "kudosReceived"
  | "newFollower"
  | "duelInvite"
  | "duelAccepted"
  | "duelWon"
  | "duelLost"
  | "duelTie"
  | "passedBy";

type Vars = { streak?: number; minutes?: number; left?: number; days?: number; count?: number; name?: string };
type Beat = { move: string; line: (vars: Vars) => string };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const POOLS: Record<PipMoment, Beat[]> = {
  // Boxing leads, and appears twice, so knocking out the goal is the signature.
  goal: [
    { move: "boxing", line: (v) => `goal down. knockout in round ${v.streak ?? 1}.` },
    { move: "goal", line: (v) => `goal met. day ${v.streak ?? 1} is safe.` },
    { move: "airguitar", line: () => "goal met. the crowd goes wild." },
    { move: "boxing", line: () => "that goal never saw it coming." },
    { move: "tapdance", line: () => "goal met. my feet did this on their own." },
    { move: "cheer", line: () => "g-o-a-l! goal!" },
    { move: "floss", line: () => "goal met. i'm flossing about it." }
  ],
  streakMilestone: [
    { move: "kick", line: (v) => `day ${v.streak}. look at you.` },
    { move: "onfire", line: (v) => `${v.streak} days. the leaf is literally on fire.` },
    { move: "fireworks", line: (v) => `day ${v.streak}! someone light the sky.` },
    { move: "levelup", line: (v) => `${v.streak} days in a row. level up.` }
  ],
  newRecord: [
    { move: "backflip", line: (v) => `longest streak yet: ${plural(v.streak ?? 0, "day")}.` },
    { move: "kickflip", line: (v) => `new record. ${plural(v.streak ?? 0, "day")} and counting.` },
    { move: "headspin", line: () => "new personal best. i'm spinning." }
  ],
  deepRead: [
    { move: "dive", line: (v) => `${v.minutes} minutes without surfacing.` },
    { move: "press", line: (v) => `${v.minutes} minutes. heavy lifting.` }
  ],
  bookFinished: [
    { move: "theend", line: () => "the end. i'm not crying, you're crying." },
    { move: "champ", line: () => "book finished. champion of the shelf." },
    { move: "fireworks", line: () => "the end! fireworks, obviously." }
  ],
  sessionStart: [
    { move: "countdown", line: () => "3, 2, 1… reading." },
    { move: "jog", line: () => "warming up. let's read." },
    { move: "whistle", line: () => "and we're off." }
  ],
  sessionShort: [
    { move: "stretch", line: () => "short and sweet. it still counts." },
    { move: "tree", line: () => "a few calm minutes. that counts." }
  ],
  sessionProgress: [
    { move: "xp", line: (v) => `${plural(v.left ?? 1, "more minute")} and today counts.` },
    { move: "cycling", line: (v) => `${plural(v.left ?? 1, "minute")} to the finish line.` }
  ],
  bonus: [
    { move: "sunbathe", line: () => "bonus minutes. pip is photosynthesizing." },
    { move: "xp", line: () => "bonus minutes. pip grew a little." }
  ],
  imported: [
    { move: "magic", line: (v) => (v.count && v.count > 1 ? `${v.count} new books. ta-da.` : "a new book. ta-da.") }
  ],
  backup: [{ move: "backup", line: () => "library backed up to drive. safe and sound." }],
  welcomeBack: [{ move: "welcome", line: (v) => `${plural(v.days ?? 3, "day")}! i missed you. one page?` }],
  streakLost: [{ move: "streaklost", line: () => "streak ended. comeback arc starts now." }],
  dustyBook: [{ move: "sneeze", line: (v) => `achoo. ${plural(v.days ?? 30, "day")} on the shelf. welcome back.` }],
  // Focus. Coming back from another app mid-session: the clock waited, and
  // Pip is (theatrically) cross with the other app, never with the reader.
  awayReturn: [
    { move: "steamed", line: (v) => `${plural(v.minutes ?? 1, "minute")} in another app. the clock waited. i fumed.` },
    { move: "lockin", line: () => "welcome back. timer's paused till now. lock in." },
    { move: "alarm", line: (v) => `${plural(v.minutes ?? 1, "minute")} away! back to the page.` }
  ],
  // A full-screen session's focus flower: it bloomed, or leaving early wilted
  // it. `name` is the flower.
  flowerBloomed: [
    { move: "smitten", line: (v) => `the ${v.name ?? "flower"} bloomed. i may cry.` },
    { move: "cheer", line: (v) => `a whole ${v.name ?? "flower"}, grown from focus alone!` },
    { move: "fireworks", line: (v) => `${v.name ?? "flower"}: bloomed. focus: legendary.` }
  ],
  flowerWilted: [
    { move: "sob", line: (v) => `the ${v.name ?? "flower"} wilted. i'll be fine. eventually.` },
    { move: "melt", line: (v) => `rip, ${v.name ?? "flower"}. we'll grow another.` },
    { move: "faint", line: (v) => `the ${v.name ?? "flower"}... it didn't make it.` }
  ],
  // Reaching for the exit under focus lock. Pip guards the door, but the door
  // always opens: holding Escape or confirming still leaves.
  exitGuard: [
    { move: "swat", line: () => "shoo. we're mid-session. hold esc to leave." },
    { move: "swat", line: () => "nope. not yet. hold esc if you mean it." },
    { move: "whistle", line: () => "foul! the session's still on. hold esc to leave." }
  ],
  poke: [
    { move: "laugh", line: () => "that tickles!" },
    { move: "dizzy", line: () => "whoa. the room is spinning." },
    { move: "jumpscare", line: () => "you scared the leaf off me." },
    { move: "robot", line: () => "beep. boop. read more books." },
    { move: "disco", line: () => "you found the dance floor." },
    { move: "moonwalk", line: () => "smooth." },
    { move: "faint", line: () => "i'm fine. i'm fine." },
    { move: "kick", line: () => "hee!" },
    { move: "smitten", line: () => "oh. hi. you." },
    { move: "steamed", line: () => "i was napping. mildly steamed." },
    { move: "blastoff", line: () => "brb, space." },
    { move: "surf", line: () => "cowabookga." },
    { move: "headspin", line: () => "watch this." },
    { move: "melt", line: () => "too much attention. melting." }
  ],
  // Community. `name` is "@handle". Friendly rivalry: the drama is Pip's, the
  // reader is never behind or letting anyone down.
  kudosReceived: [
    { move: "kudos", line: (v) => `${v.name ?? "someone"} sent you kudos. i'm keeping them.` },
    { move: "kudos", line: (v) => `kudos from ${v.name ?? "a reader"}. we're glowing.` }
  ],
  newFollower: [
    { move: "welcome", line: (v) => `${v.name ?? "someone"} is following along now. hi!` },
    { move: "welcome", line: (v) => `new reading buddy: ${v.name ?? "a reader"}.` }
  ],
  duelInvite: [
    { move: "bringit", line: (v) => `${v.name ?? "someone"} wants a duel this week. bring it?` },
    { move: "bringit", line: (v) => `${v.name ?? "someone"} threw down the bookmark. duel?` }
  ],
  duelAccepted: [
    { move: "bringit", line: (v) => `${v.name ?? "they"} said yes. may the best reader win.` },
    { move: "boxing", line: (v) => `duel on with ${v.name ?? "a rival"}. gloves up.` }
  ],
  duelWon: [
    { move: "champ", line: (v) => `duel won against ${v.name ?? "a worthy rival"}. champion of the week.` },
    { move: "champ", line: (v) => `you out-read ${v.name ?? "them"}. tiny trophy, huge feelings.` }
  ],
  duelLost: [
    { move: "sob", line: (v) => `${v.name ?? "they"} took this one. rematch next week?` },
    { move: "streaklost", line: (v) => `close one with ${v.name ?? "them"}. the comeback starts now.` }
  ],
  duelTie: [{ move: "cheer", line: (v) => `a dead heat with ${v.name ?? "your rival"}. perfectly balanced.` }],
  passedBy: [
    { move: "boxing", line: (v) => `${v.name ?? "someone"} just passed you. rematch?` },
    { move: "boxing", line: (v) => `${v.name ?? "someone"} slipped ahead. a few pages and we're back.` }
  ]
};

/** Stable small hash, so a seed maps to the same beat on every call. */
const hash = (value: string) => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Final avalanche: FNV alone barely moves the low bits between seeds that
  // differ by one character (consecutive dates), so a week of goals clumped
  // onto two moves.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
};

export const STREAK_MILESTONES = new Set([3, 7, 10, 14, 21, 30, 50, 75, 100, 150, 200, 250, 300, 365]);
export const isStreakMilestone = (streak: number) => STREAK_MILESTONES.has(streak) || (streak > 0 && streak % 100 === 0);

export type PipBeat = { move: string; line: string };

export const pickBeat = (moment: PipMoment, seed: string | number, vars: Vars = {}): PipBeat => {
  const pool = POOLS[moment];
  const beat = pool[hash(`${moment}:${seed}`) % pool.length];
  return { move: beat.move, line: beat.line(vars) };
};

/** A goal met today: milestone beats plain goal, and the seed is the day. */
export const goalBeat = (streak: number, dateKey: string, newRecord = false): PipBeat => {
  if (isStreakMilestone(streak)) {
    return pickBeat("streakMilestone", dateKey, { streak });
  }
  if (newRecord) {
    return pickBeat("newRecord", dateKey, { streak });
  }
  return pickBeat("goal", dateKey, { streak });
};
