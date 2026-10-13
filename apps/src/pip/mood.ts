/**
 * Why Pip feels as she does, in plain words.
 *
 * The hearts used to be all a reader saw: a mood that went down with no word
 * of why. This turns the real inputs into sentences: the mood Rust reports
 * (habit/seeds.rs: it drifts down a little every day since she was last
 * cheered up, and the drift stops at a floor), what last cheered her up (the
 * mood log Rust keeps), today's reading and play, and the rules themselves,
 * which come from Rust with the overview. Nothing here is decided or guessed:
 * every sentence is one of those numbers, said aloud. Pure, so the wording is
 * tested (mood.test.ts).
 *
 * Two things were added on 2026-10-13, at the owner's request, and are said
 * here too: her fridge (bare, it takes a little off her mood when she finds
 * it so: pip/fridge.rs), and the mood she is in for the moment (a sulk after
 * a tantrum, a good mood after a snack: pip/temper.ts), which is laid over
 * the hearts for as long as it lasts and never changes the number Rust keeps.
 */
import type { MoodEvent, MoodRules } from "../services/pipService";
import { GLAD_POINTS, SULK_POINTS, type Humour } from "./temper";

/**
 * Below this she mopes (pages/pip/common.ts keeps the same number). The drift
 * stops well above it (the rules' `driftFloor`), so only a mood that was
 * already this low is ever here: time alone does not bring her to it.
 */
const MOPES_BELOW = 20;

export const moodWord = (mood: number) =>
  mood >= 80 ? "Blissful" : mood >= 60 ? "Happy" : mood >= 40 ? "Content" : mood >= MOPES_BELOW ? "Wistful" : "Missing you";

export type MoodInputs = {
  /** 0..100, as of now. */
  mood: number;
  /** When she was last cheered up (or first met), RFC 3339. */
  moodUpdatedAt: string;
  /** Now, in milliseconds. */
  now: number;
  rules: MoodRules;
  /** What cheered her up lately, oldest first. */
  log: readonly MoodEvent[];
  /** Mood games and play have added today. */
  playToday: number;
  /** Mood reading has added today, out of the day's allowance (Rust's count, this device's). */
  readingToday: number;
  /** Focus sessions recorded today, and all the minutes read today. */
  sessionsToday: number;
  minutesToday: number;
  /** Today's wish, if there is one. */
  wish: { granted: boolean; mood: number } | null;
  /** Plants ripe to pick. */
  ripe: number;
  /** The best snack the reader can afford now, if any. */
  snack: { name: string; price: number; mood: number } | null;
  /** Names for the things the log mentions. */
  treatName: (id: string) => string;
  gameName: (id: string) => string;
  /**
   * Her fridge, where Rust says anything of it: bare or not as of now, the hours of food left in it, whether
   * finding it bare has taken its toll today, and how long a snack stocks it for (and the most it holds).
   */
  fridge?: { bare: boolean; hoursLeft: number; mindedToday: boolean; hoursPerSnack: number; maxHours: number } | null;
  /** The mood she is in for now (pip/temper.ts): what it adds to the hearts, in points, and how long it has left. */
  temper?: { off: number; humour: Humour; minutesLeft: number } | null;
};

export type MoodLine = { id: string; text: string; tone: "down" | "up" | "plain" };
export type MoodLift = { id: "wish" | "snack" | "reading" | "session" | "harvest" | "play"; text: string; gain: number };

export type MoodReport = {
  word: string;
  /** The mood as a whole number, 0 to 100: the one Rust keeps. */
  level: number;
  /** What the hearts show: that, with the mood she is in for now laid over it. */
  felt: number;
  /** One sentence: how she is and the main reason. */
  headline: string;
  /** What is acting on her mood now. */
  why: MoodLine[];
  /** What changed it most recently. */
  last: string | null;
  /** What would cheer her up, the most first. */
  lifts: MoodLift[];
  /** The rule, said once. */
  rule: string;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const whole = (value: number) => Math.round(value);
/**
 * A gain, as it is said. A minute of reading adds a fraction, so a gain
 * under one is "less than 1": never rounded up to a 1 it was not.
 */
const points = (gain: number) => (gain >= 1 ? `${whole(gain)}` : "less than 1");
const plus = (gain: number) => (gain >= 1 ? `+${whole(gain)}` : "less than +1");

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago". */
export const ago = (ms: number) => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  return `${plural(Math.floor(hours / 24), "day")} ago`;
};

const PLAY_WORDS: Record<string, string> = {
  pet: "Being stroked",
  tickle: "A tickle",
  fetch: "Fetching the ball",
  toss: "Being tossed in the air",
  dance: "A dance together"
};

/** What a log entry was, in words. */
export const causeWords = (cause: string, names: Pick<MoodInputs, "treatName" | "gameName">) => {
  const [kind, id = ""] = cause.split(":");
  if (kind === "reading") return "Reading";
  if (kind === "session") return "A focus session";
  if (kind === "treat") return names.treatName(id);
  if (kind === "harvest") return "Picking a ripe plant";
  if (kind === "game") return `A game of ${names.gameName(id)}`;
  if (kind === "play") return PLAY_WORDS[id] ?? "Playing";
  if (kind === "wish") return "Her wish coming true";
  if (kind === "fridge") return "Finding her fridge bare";
  return "Something";
};

/** "about 5 hours", "about a day", "about 2 days". */
const about = (hours: number) => {
  if (hours < 1) return "less than an hour";
  if (hours < 20) return `about ${plural(whole(hours), "hour")}`;
  const days = whole(hours / 24);
  return days <= 1 ? "about a day" : `about ${days} days`;
};

export const explainMood = (input: MoodInputs): MoodReport => {
  const { rules, now } = input;
  const level = whole(Math.max(0, Math.min(100, input.mood)));
  // What the hearts show: the mood she is in for now, laid over the one that is kept.
  const temper = input.temper && input.temper.off !== 0 ? input.temper : null;
  const felt = whole(Math.max(0, Math.min(100, level + (temper?.off ?? 0))));
  const word = moodWord(felt);
  const since = Math.max(0, now - Date.parse(input.moodUpdatedAt));
  const days = since / 86_400_000;
  // What the drift would have taken since she was last cheered up. It stops
  // at the floor, and a mood already under the floor does not drift at all.
  const drifted = whole(days * rules.driftPerDay);
  const floor = rules.driftFloor;
  const underFloor = input.mood < floor - 1e-6;
  const atFloor = !underFloor && input.mood <= floor + 1e-6;
  const why: MoodLine[] = [];

  if (!Number.isFinite(since)) {
    // No telling when it last changed: say nothing about the drift.
  } else if (underFloor) {
    why.push({
      id: "drift",
      tone: "plain",
      text:
        drifted >= 1
          ? `Nothing has cheered her up since ${ago(since)}. Under ${floor} her mood does not drift: it stays where it is until something cheers her up.`
          : `Her mood last changed ${ago(since)}. Under ${floor} it does not drift: it stays where it is until something cheers her up.`
    });
  } else if (drifted >= 1) {
    why.push({
      id: "drift",
      tone: "down",
      text: atFloor
        ? `Nothing has cheered her up since ${ago(since)}. Her mood is at ${floor}, where the drift stops.`
        : `Nothing has cheered her up since ${ago(since)}, so her mood has drifted down by ${drifted}.`
    });
  } else {
    // (For a Pip just met, the last change is the meeting: so "changed", not "cheered up".)
    why.push({ id: "drift", tone: "plain", text: `Her mood last changed ${ago(since)}, so it has hardly drifted.` });
  }

  // Any reading counts, by the minute, up to the day's allowance. The number
  // is the one Rust kept as the minutes were credited, not one worked out here.
  const minutes = whole(input.minutesToday);
  const readingToday = Math.max(0, Math.min(rules.readingPerDay, input.readingToday));
  const readingLeft = Math.max(0, rules.readingPerDay - readingToday);
  if (minutes >= 1 && readingToday > 0) {
    why.push({
      id: "reading",
      tone: "up",
      text:
        readingLeft > 1e-6
          ? `You read ${plural(minutes, "minute")} today: ${plus(readingToday)}.`
          : `You read ${plural(minutes, "minute")} today: +${whole(rules.readingPerDay)}, all that reading adds in a day.`
    });
  } else if (minutes >= 1) {
    // Minutes this device's mood has no count for (they came by sync, say).
    why.push({ id: "reading", tone: "plain", text: `You read ${plural(minutes, "minute")} today.` });
  } else {
    why.push({ id: "reading", tone: "down", text: "No reading yet today." });
  }
  if (input.sessionsToday > 0) {
    why.push({ id: "session", tone: "up", text: `${plural(input.sessionsToday, "focus session")} today: +${rules.perSession} each.` });
  }

  if (input.playToday > 0) {
    why.push({ id: "play", tone: "up", text: `Games and play have added ${whole(input.playToday)} today, of the ${rules.playPerDay} they can in a day.` });
  }
  if (input.wish?.granted) why.push({ id: "wish", tone: "up", text: `Her wish was granted today: +${input.wish.mood}.` });
  if (level < MOPES_BELOW) why.push({ id: "mope", tone: "plain", text: `Under ${MOPES_BELOW} she mopes. That is all it does: nothing is lost, and nothing withers.` });

  // Her fridge: bare, it costs her a little when she finds it so (once a day, never below the floor); stocked, it says for how long.
  const fridge = input.fridge ?? null;
  const bareCost = rules.bareFridge ?? 0;
  if (fridge?.bare) {
    const stocks = `A snack stocks it for ${about(fridge.hoursPerSnack)}.`;
    why.push({
      id: "fridge",
      tone: "down",
      text:
        bareCost <= 0
          ? `Her fridge is bare. ${stocks}`
          : fridge.mindedToday
            ? `Her fridge is bare, and she has found it so today: that took up to ${whole(bareCost)}, and takes no more today. ${stocks}`
            : `Her fridge is bare. When she looks in it and finds it so, that takes ${whole(bareCost)}: once a day at most, never below ${floor}, and never while Leaflet is shut. ${stocks}`
    });
  } else if (fridge) {
    why.push({ id: "fridge", tone: "plain", text: `There is food in her fridge for ${about(fridge.hoursLeft)} more.` });
  }

  // The mood she is in for now: on the hearts for as long as it lasts, and nowhere else.
  let temperLine: string | null = null;
  if (temper) {
    const left = temper.minutesLeft > 0 ? ` for about ${plural(temper.minutesLeft, "more minute")}` : "";
    const by = Math.abs(temper.off);
    temperLine =
      temper.humour === "glad"
        ? `She is in a good mood: the hearts show ${by} more${left}.`
        : temper.humour === "huff"
          ? `She has had a tantrum and is in a huff: the hearts show ${by} less${left}. It passes by itself; a cuddle or a snack makes it up sooner.`
          : temper.humour === "sulk"
            ? `She is sulking: the hearts show ${by} less${left}. It eases by itself; a cuddle or a snack makes it up sooner.`
            : temper.humour === "cool"
              ? `She is still a little cool with you: the hearts show ${by} less${left}.`
              : temper.off < 0
                ? `Her patience is thin just now: the hearts show ${by} less. It comes back in a minute or two.`
                : null;
    if (temperLine) why.push({ id: "temper", tone: temper.off < 0 ? "down" : "up", text: temperLine });
  }

  const newest = input.log[input.log.length - 1];
  const last = !newest
    ? null
    : newest.gain < 0
      ? `${causeWords(newest.cause, input)} took ${points(-newest.gain)} off her mood, ${ago(now - Date.parse(newest.at))}.`
      : `${causeWords(newest.cause, input)} cheered her up by ${points(newest.gain)}, ${ago(now - Date.parse(newest.at))}.`;

  const lifts: MoodLift[] = [];
  if (level >= 100) {
    // As happy as she gets: nothing to add.
  } else {
    if (input.wish && !input.wish.granted) lifts.push({ id: "wish", gain: input.wish.mood, text: `Grant today's wish: +${input.wish.mood}.` });
    if (input.snack) {
      const stocks = fridge?.bare ? ", and it stocks her fridge" : "";
      lifts.push({ id: "snack", gain: input.snack.mood, text: `Give her ${input.snack.name} (${plural(input.snack.price, "seed")}): +${input.snack.mood}${stocks}.` });
    }
    if (readingLeft > 1e-6 && rules.perReadingMinute > 0) {
      const minutesLeft = Math.ceil(readingLeft / rules.perReadingMinute - 1e-6);
      lifts.push({
        id: "reading",
        gain: readingLeft,
        text: `Read, in a focus session or not: +${rules.perReadingMinute} a minute, up to ${plus(readingLeft)} ${readingToday > 0 ? "more " : ""}today (${plural(minutesLeft, "minute")}).`
      });
    }
    lifts.push({ id: "session", gain: rules.perSession, text: `Read in a focus session: +${rules.perSession} each time, on top of the minutes.` });
    const playLeft = Math.max(0, rules.playPerDay - input.playToday);
    if (playLeft > 0) lifts.push({ id: "play", gain: playLeft, text: `Play with her, or play a game: up to +${whole(playLeft)} more today.` });
    if (input.ripe > 0) lifts.push({ id: "harvest", gain: rules.perHarvest, text: `Pick ${input.ripe === 1 ? "the ripe plant" : "a ripe plant"}: +${rules.perHarvest}.` });
    lifts.sort((a, b) => b.gain - a.gain);
  }

  const main = temperLine ?? (why[0]?.tone === "down" ? why[0].text : why.find((line) => line.tone === "up")?.text ?? why[0]?.text ?? "");
  const fridgeRule =
    bareCost > 0 && fridge
      ? ` Finding her fridge bare takes ${whole(bareCost)}: once a day at most, only when she looks, and never below ${rules.driftFloor}. Each snack stocks the fridge for ${about(fridge.hoursPerSnack)}, ${about(fridge.maxHours)} at most.`
      : "";
  const temperRule = input.temper
    ? ` What you do with her in a sitting shows on the hearts for a while without changing that number: a tantrum and the sulk after it take up to ${SULK_POINTS} for up to half an hour, a good mood adds up to ${GLAD_POINTS} for ten or twenty minutes, and both run out by the clock, whether Leaflet is open or not.`
    : "";
  return {
    word,
    level,
    felt,
    headline: (temper ? `${word} for now: the hearts show ${felt} out of 100 (${level} without the mood she is in). ${main}` : `${word}: ${level} out of 100. ${main}`).trim(),
    why,
    last,
    lifts,
    rule: `Her mood drifts down ${rules.driftPerDay} a day from the last time she was cheered up, whether Leaflet is open or not, and the drift stops at ${rules.driftFloor}. Reading adds ${rules.perReadingMinute} a minute, in a focus session or not, up to ${rules.readingPerDay} a day. A focus session adds ${rules.perSession} more. Games and play add up to ${rules.playPerDay} a day between them, picking a ripe plant adds ${rules.perHarvest}, her wish coming true adds ${rules.perWish}, and each snack or toy adds its own amount.${fridgeRule}${temperRule}`
  };
};
