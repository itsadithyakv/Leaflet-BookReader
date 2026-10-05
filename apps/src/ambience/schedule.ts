/**
 * When things happen in a scene: its streams (scenes.ts) turned into timed
 * events, a stretch at a time. A wandering level becomes "be at this value,
 * reached this slowly"; drops and crackles become "this short sound, this
 * loud, here between the ears"; thunder, a wave and a phrase of talk become
 * a handful of the first kind.
 *
 * It is all arithmetic on a seeded source of chance (random.ts): no clock, no
 * audio. The engine asks for the next few seconds and puts them on the audio
 * clock; a measured render asks for the whole stretch at once. The same seed
 * gives the same shower.
 */
import { between, betweenRatio, forkSeed, mostlyLow, seeded, waitFor, wholeBetween, type Random, type Span } from "./random";
import { VOWELS, type GrainKind, type GrainsDef, type ParamRef, type SceneDef, type SceneOption, type StreamDef, type SwellDef, type TalkerDef, type WanderDef } from "./scenes";

/** A control heads for a value: most of the way there after three `tau`s. */
export type RampEvent = { kind: "ramp"; at: number; param: ParamRef; to: number; tau: number };
/** A short sound: which of its makes, how loud, where, how fast it is played. */
export type GrainEvent = { kind: "grain"; at: number; grain: GrainKind; variant: number; gain: number; pan: number; speed: number };
export type SceneEvent = RampEvent | GrainEvent;

/** How many different makes of each short sound there are to pick from. */
export const GRAIN_VARIANTS = 10;

type Stream = {
  /** When it next does something, in seconds from the scene's start. */
  at: number;
  option?: SceneOption;
  /** The controls it moves. */
  params: ParamRef[];
  /** What it does then; moves `at` on to the time after. */
  step: () => SceneEvent[];
};

const pickIn = (random: Random, range: Span, ratio?: boolean) => (ratio && range[0] > 0 ? betweenRatio(random, range) : between(random, range));

const wander = (def: WanderDef, random: Random): Stream => {
  const stream: Stream = {
    at: 0,
    params: [def.param],
    step: () => {
      const gap = between(random, def.every);
      // Reached by about the time the next one is chosen.
      const events: SceneEvent[] = [{ kind: "ramp", at: stream.at, param: def.param, to: pickIn(random, def.range, def.ratio), tau: gap / 3 }];
      stream.at += gap;
      return events;
    }
  };
  return stream;
};

const grains = (def: GrainsDef, random: Random): Stream => {
  let times = 1;
  let flurryEnds = 0;
  const stream: Stream = {
    at: waitFor(random, def.perSecond),
    params: [],
    step: () => {
      if (def.flurry && stream.at >= flurryEnds) {
        times = betweenRatio(random, def.flurry.times);
        flurryEnds = stream.at + between(random, def.flurry.every);
      }
      const events: SceneEvent[] = [];
      const count = def.cluster ? wholeBetween(random, def.cluster.count) : 1;
      // A cluster is one thing struck a few times: the same make, the same place.
      const variant = Math.floor(random() * GRAIN_VARIANTS);
      const pan = between(random, def.pan);
      const speed = betweenRatio(random, def.speed);
      let at = stream.at;
      for (let index = 0; index < count; index += 1) {
        events.push({
          kind: "grain",
          at,
          grain: def.grain,
          variant,
          gain: mostlyLow(random, def.gain, def.skew),
          pan,
          speed: index === 0 ? speed : speed * between(random, [0.97, 1.03])
        });
        if (def.cluster) {
          at += between(random, def.cluster.gap);
        }
      }
      stream.at += waitFor(random, def.perSecond * times);
      return events;
    }
  };
  return stream;
};

const swell = (def: SwellDef, random: Random): Stream => {
  const stream: Stream = {
    at: between(random, def.first ?? def.every),
    option: def.option,
    params: def.parts.map((part) => part.param),
    step: () => {
      const rise = between(random, def.rise);
      const hold = between(random, def.hold);
      const fall = between(random, def.fall);
      // How full it is (1 at the peak, 0 at rest), at times from its start.
      const shape: Array<{ at: number; full: number; tau: number }> = [{ at: 0, full: 1, tau: rise / 3 }];
      let at = rise + hold;
      let full = 1;
      const rolls = def.rolls ? wholeBetween(random, def.rolls) : 0;
      for (let roll = 0; roll < rolls; roll += 1) {
        shape.push({ at, full: full * between(random, [0.3, 0.55]), tau: 0.15 });
        at += between(random, [0.4, 0.9]);
        full *= between(random, [0.55, 0.85]);
        shape.push({ at, full, tau: 0.1 });
        at += between(random, [0.4, 1.2]);
      }
      shape.push({ at, full: 0, tau: fall / 3 });
      const events: SceneEvent[] = [];
      for (const part of def.parts) {
        const peak = pickIn(random, part.peak, part.ratio);
        const start = stream.at + (part.late ?? 0);
        for (const point of shape) {
          const to = part.ratio && part.rest > 0 ? part.rest * Math.pow(peak / part.rest, point.full) : part.rest + (peak - part.rest) * point.full;
          events.push({ kind: "ramp", at: start + point.at, param: part.param, to, tau: point.tau });
        }
      }
      // The next never starts before this one is over.
      stream.at += Math.max(between(random, def.every), at + fall + 0.5);
      return events;
    }
  };
  return stream;
};

const talker = (def: TalkerDef, random: Random): Stream => {
  const gain = `${def.layer}.gain`;
  const pitch = `${def.layer}.pitch`;
  const mouth = def.formants.map((index) => `${def.layer}.f${index}`);
  const stream: Stream = {
    // Nobody starts together.
    at: between(random, [0, def.pause[1]]),
    params: [gain, pitch, ...mouth],
    step: () => {
      const events: SceneEvent[] = [];
      const count = wholeBetween(random, def.syllables);
      const level = between(random, def.level);
      // A phrase starts a little high and comes down, as speech does.
      const from = def.pitch * between(random, [1.02, 1.2]);
      const to = def.pitch * between(random, [0.8, 0.96]);
      let at = stream.at;
      for (let index = 0; index < count; index += 1) {
        const length = between(random, def.syllable);
        const vowel = VOWELS[Math.floor(random() * VOWELS.length)];
        const stress = between(random, [0.5, 1]);
        const glide = count > 1 ? index / (count - 1) : 0;
        events.push({ kind: "ramp", at, param: gain, to: level * stress, tau: 0.025 });
        events.push({ kind: "ramp", at, param: mouth[0], to: vowel[0] * between(random, [0.92, 1.08]), tau: 0.035 });
        events.push({ kind: "ramp", at, param: mouth[1], to: vowel[1] * between(random, [0.92, 1.08]), tau: 0.035 });
        events.push({ kind: "ramp", at, param: pitch, to: (from + (to - from) * glide) * between(random, [0.96, 1.05]), tau: 0.05 });
        // The mouth closes on a consonant between two vowels.
        events.push({ kind: "ramp", at: at + length * 0.62, param: gain, to: level * stress * between(random, [0.08, 0.4]), tau: 0.03 });
        at += length;
      }
      events.push({ kind: "ramp", at, param: gain, to: 0, tau: 0.07 });
      stream.at = at + between(random, def.pause);
      return events;
    }
  };
  return stream;
};

const make = (def: StreamDef, random: Random): Stream => {
  switch (def.kind) {
    case "wander":
      return wander(def, random);
    case "grains":
      return grains(def, random);
    case "swell":
      return swell(def, random);
    default:
      return talker(def, random);
  }
};

export type Schedule = {
  /** Everything that starts before `time` and has not been handed out yet, in order. */
  until: (time: number) => SceneEvent[];
  /** Silences (or brings back) the streams under one of the reader's switches. They keep their time, unheard. */
  mute: (option: SceneOption, muted: boolean) => void;
  /** The controls the streams under a switch move, for sending them back to rest when it goes off. */
  paramsOf: (option: SceneOption) => ParamRef[];
};

/** A stream that never moved on would loop for ever: this many steps in one request is that. */
const STEP_LIMIT = 20000;

export const createSchedule = (scene: SceneDef, seed: number, muted: SceneOption[] = []): Schedule => {
  // Each stream has its own source of chance, so muting one moves nothing else.
  const streams = scene.streams.map((def, index) => make(def, seeded(forkSeed(seed, index))));
  const off = new Set<SceneOption>(muted);
  return {
    until: (time) => {
      const events: SceneEvent[] = [];
      for (const stream of streams) {
        for (let steps = 0; stream.at < time && steps < STEP_LIMIT; steps += 1) {
          const made = stream.step();
          if (!stream.option || !off.has(stream.option)) {
            events.push(...made);
          }
        }
      }
      return events.sort((a, b) => a.at - b.at);
    },
    mute: (option, on) => {
      if (on) {
        off.add(option);
      } else {
        off.delete(option);
      }
    },
    paramsOf: (option) => streams.filter((stream) => stream.option === option).flatMap((stream) => stream.params)
  };
};
