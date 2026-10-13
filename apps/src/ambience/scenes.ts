/**
 * What the radio can play, written down as data: each scene is a few layers
 * that sound all the time (noise through filters; in the cafe, a few voices'
 * buzz through a mouth's resonances) and a few streams of things that happen
 * (a level that wanders, drops, a swell of thunder, a phrase of talk).
 *
 * Nothing here makes a sound or needs a browser. The engine (engine.ts) builds
 * the layers, the schedule (schedule.ts) turns the streams into timed events,
 * and both read only this, so a scene can be changed, and tested, as a table.
 */
import type { Span } from "./random";

export type SceneId = "rain" | "fire" | "cafe" | "wind" | "waves" | "brown" | "crickets" | "stream" | "train";

/** White is hiss, pink is softer (rain, a crowd), brown is a low rumble. */
export type NoiseColour = "white" | "pink" | "brown";

/** The short sounds, made once as samples (grains.ts) and played at a pitch. */
export type GrainKind = "drop" | "crackle" | "pop" | "clink" | "chirp" | "bubble";

export type FilterDef = {
  type: "lowpass" | "highpass" | "bandpass" | "peaking";
  freq: number;
  q?: number;
  /** For "peaking": how far the band is lifted, in decibels. */
  db?: number;
};

export type LayerDef = {
  id: string;
  /**
   * A loop of noise (at a speed, so two layers of one colour never line up),
   * or the buzz of a voice at a pitch.
   */
  source: { noise: NoiseColour; speed?: number } | { buzz: number };
  /** One after the other. A stream names them `f0`, `f1`, … */
  filters: FilterDef[];
  /** The level it rests at; 0 for a layer heard only when a stream lifts it. */
  gain: number;
  /** -1 (left) to 1 (right). Left out, noise keeps its own two channels. */
  pan?: number;
  /** How much of it goes to the room's echo, where the scene has a room. */
  wet?: number;
};

/** A layer's control: `rain.patter.gain`, `cafe.v1.f1` (its second filter's frequency), `cafe.v1.pitch`. */
export type ParamRef = string;

/** A control that drifts: a new value in its range every so often, reached slowly. */
export type WanderDef = {
  kind: "wander";
  param: ParamRef;
  range: Span;
  /** By ratio rather than evenly: for frequencies. */
  ratio?: boolean;
  every: Span;
};

/** Short sounds at random moments. */
export type GrainsDef = {
  kind: "grains";
  grain: GrainKind;
  perSecond: number;
  /** Loudness, mostly near the low end (`skew` 1 is even). */
  gain: Span;
  skew: number;
  pan: Span;
  /** Playing speed: pitch and length together. */
  speed: Span;
  /** The rate itself comes and goes: every so often, a new multiple of it. */
  flurry?: { every: Span; times: Span };
  /**
   * Each time, a few in a row (a spoon in a cup). `steady`: one creature
   * keeping its own time (a cricket), so the whole run has one loudness and
   * one gap, not a new one for each.
   */
  cluster?: { count: Span; gap: Span; steady?: boolean };
};

/** A layer that rises and falls back: thunder, a wave, a gust, the coffee machine. */
export type SwellDef = {
  kind: "swell";
  every: Span;
  /** The wait before the first; left out, the same as between any two. */
  first?: Span;
  rise: Span;
  hold: Span;
  fall: Span;
  /** What moves, each to a peak and back to where it rests. `late` starts it that long after the others. */
  parts: Array<{ param: ParamRef; peak: Span; rest: number; ratio?: boolean; late?: number }>;
  /** It rolls: after the first peak, this many more, each lower. */
  rolls?: Span;
  /** A switch the reader has that silences it ("thunder"). */
  option?: SceneOption;
};

/** Someone at another table: phrases of syllables, a pause, another phrase. */
export type TalkerDef = {
  kind: "talker";
  layer: string;
  /** Which of the layer's filters are the mouth's two resonances. */
  formants: [number, number];
  pitch: number;
  level: Span;
  syllables: Span;
  syllable: Span;
  pause: Span;
};

export type StreamDef = WanderDef | GrainsDef | SwellDef | TalkerDef;

export type SceneOption = "thunder";

export type SceneDef = {
  id: SceneId;
  name: string;
  /** One line for the control. */
  hint: string;
  layers: LayerDef[];
  streams: StreamDef[];
  /** A room for the sound to sit in: how long its echo lasts, and how much of each short sound goes to it. */
  room?: { seconds: number; grains: number };
  /** Brings the scene to the same loudness as the others (measured, see engine.ts `renderScene`). */
  level: number;
  options?: SceneOption[];
};

/** Vowels, as the two resonances of a mouth (Hz): which one a syllable gets is chance. */
export const VOWELS: ReadonlyArray<readonly [number, number]> = [
  [730, 1090],
  [270, 2290],
  [300, 870],
  [530, 1840],
  [570, 840],
  [440, 1020],
  [660, 1720],
  [390, 1990]
];

/**
 * One talker's layer: a buzz through a mouth's two resonances, which a
 * stream moves. The first lifts a band; the second is a low-pass that rings
 * at its corner, so it takes the buzz's brightness off above it as well.
 */
const voice = (id: string, pitch: number, pan: number): LayerDef => ({
  id,
  source: { buzz: pitch },
  filters: [
    { type: "peaking", freq: 500, q: 4, db: 14 },
    { type: "lowpass", freq: 1500, q: 4 }
  ],
  gain: 0,
  pan,
  wet: 0.75
});

const talker = (layer: string, pitch: number, level: Span, pause: Span): TalkerDef => ({
  kind: "talker",
  layer,
  formants: [0, 1],
  pitch,
  level,
  syllables: [4, 14],
  syllable: [0.13, 0.3],
  pause
});

/** One band of a crowd's murmur: it swells and sinks a few times a second, as talk does, on its own. */
const murmur = (id: string, freq: number, q: number, gain: number, pan: number, speed: number): [LayerDef, StreamDef[]] => [
  { id, source: { noise: "pink", speed }, filters: [{ type: "bandpass", freq, q }], gain, pan, wet: 0.4 },
  [
    { kind: "wander", param: `${id}.gain`, range: [gain * 0.35, gain * 1.45], every: [0.18, 0.7] },
    { kind: "wander", param: `${id}.f0`, range: [freq * 0.8, freq * 1.25], ratio: true, every: [0.4, 1.6] }
  ]
];

const MURMUR = [
  murmur("cafe.m1", 300, 1.1, 0.5, -0.45, 1),
  murmur("cafe.m2", 560, 1.3, 0.46, 0.35, 0.93),
  murmur("cafe.m3", 1050, 1.4, 0.36, -0.15, 1.07),
  murmur("cafe.m4", 2100, 1, 0.22, 0.55, 0.88)
];

export const SCENES: Record<SceneId, SceneDef> = {
  // Steady rain: a far wash, a nearer patter that comes and goes, the dull
  // drum of it on a roof, single drops close by, and now and then thunder a
  // long way off.
  rain: {
    id: "rain",
    name: "Rain",
    hint: "Steady rain, drops on the sill, thunder far off",
    layers: [
      { id: "rain.wash", source: { noise: "pink" }, filters: [{ type: "highpass", freq: 450, q: 0.5 }, { type: "lowpass", freq: 8500, q: 0.5 }], gain: 0.55 },
      { id: "rain.patter", source: { noise: "white", speed: 0.91 }, filters: [{ type: "bandpass", freq: 3200, q: 0.6 }], gain: 0.2 },
      { id: "rain.roof", source: { noise: "brown" }, filters: [{ type: "lowpass", freq: 380, q: 0.6 }], gain: 0.3 },
      { id: "rain.thunder", source: { noise: "brown", speed: 0.8 }, filters: [{ type: "lowpass", freq: 90, q: 0.7 }], gain: 0 }
    ],
    streams: [
      { kind: "wander", param: "rain.wash.gain", range: [0.45, 0.65], every: [4, 11] },
      { kind: "wander", param: "rain.patter.gain", range: [0.12, 0.3], every: [2, 6] },
      { kind: "wander", param: "rain.patter.f0", range: [2400, 4400], ratio: true, every: [3, 8] },
      { kind: "wander", param: "rain.roof.gain", range: [0.22, 0.4], every: [4, 10] },
      {
        kind: "grains",
        grain: "drop",
        perSecond: 7,
        gain: [0.03, 0.34],
        skew: 2.6,
        pan: [-0.9, 0.9],
        speed: [0.7, 1.5],
        flurry: { every: [3, 9], times: [0.5, 1.7] }
      },
      {
        kind: "swell",
        option: "thunder",
        every: [70, 190],
        first: [20, 70],
        rise: [0.2, 0.7],
        hold: [0.3, 1],
        fall: [3, 6.5],
        rolls: [1, 3],
        parts: [
          { param: "rain.thunder.gain", peak: [0.35, 0.8], rest: 0 },
          { param: "rain.thunder.f0", peak: [130, 240], rest: 90, ratio: true }
        ]
      }
    ],
    level: 0.58,
    options: ["thunder"]
  },

  // A fire in a grate: the low roar of the draught, the flutter of the
  // flames, a thread of hiss, crackles in fits and starts, and a pop when a
  // log gives.
  fire: {
    id: "fire",
    name: "Fireplace",
    hint: "A low roar, crackles and the odd pop",
    layers: [
      { id: "fire.roar", source: { noise: "pink" }, filters: [{ type: "lowpass", freq: 420, q: 0.6 }], gain: 0.5 },
      { id: "fire.flame", source: { noise: "pink", speed: 0.87 }, filters: [{ type: "bandpass", freq: 900, q: 0.7 }], gain: 0.4 },
      { id: "fire.hiss", source: { noise: "white" }, filters: [{ type: "highpass", freq: 4200, q: 0.5 }], gain: 0.03 }
    ],
    streams: [
      { kind: "wander", param: "fire.roar.gain", range: [0.38, 0.62], every: [1.5, 5] },
      { kind: "wander", param: "fire.roar.f0", range: [300, 560], ratio: true, every: [2, 6] },
      { kind: "wander", param: "fire.flame.gain", range: [0.2, 0.6], every: [0.5, 2.2] },
      { kind: "wander", param: "fire.flame.f0", range: [650, 1300], ratio: true, every: [1, 4] },
      { kind: "wander", param: "fire.hiss.gain", range: [0.015, 0.05], every: [2, 7] },
      {
        kind: "grains",
        grain: "crackle",
        perSecond: 8,
        gain: [0.04, 0.55],
        skew: 3,
        pan: [-0.6, 0.6],
        speed: [0.6, 1.8],
        flurry: { every: [0.8, 4], times: [0.15, 2.6] }
      },
      { kind: "grains", grain: "pop", perSecond: 0.22, gain: [0.2, 0.55], skew: 1.6, pan: [-0.4, 0.4], speed: [0.7, 1.3] }
    ],
    level: 1
  },

  // A cafe heard from a corner table. The murmur is four bands of noise, each
  // rising and falling at the pace of talk; over it, five voices that say
  // nothing (a buzz through a mouth's two resonances, in phrases); cups and
  // spoons; a knock of crockery; the machine's steam from the far side.
  cafe: {
    id: "cafe",
    name: "Cafe",
    hint: "A room of talk, cups and spoons, the machine now and then",
    layers: [
      { id: "cafe.air", source: { noise: "brown" }, filters: [{ type: "lowpass", freq: 420, q: 0.5 }], gain: 0.09 },
      ...MURMUR.map(([layer]) => layer),
      voice("cafe.v1", 112, -0.7),
      voice("cafe.v2", 196, 0.6),
      voice("cafe.v3", 138, 0.2),
      voice("cafe.v4", 224, -0.3),
      voice("cafe.v5", 165, 0.8),
      { id: "cafe.steam", source: { noise: "white" }, filters: [{ type: "bandpass", freq: 5200, q: 0.8 }], gain: 0, pan: 0.65, wet: 0.75 }
    ],
    streams: [
      ...MURMUR.flatMap(([, streams]) => streams),
      talker("cafe.v1", 112, [0.05, 0.12], [0.6, 3.5]),
      talker("cafe.v2", 196, [0.04, 0.1], [0.8, 4]),
      talker("cafe.v3", 138, [0.04, 0.11], [0.8, 4.5]),
      talker("cafe.v4", 224, [0.032, 0.085], [1, 5]),
      talker("cafe.v5", 165, [0.032, 0.09], [1, 6]),
      {
        kind: "grains",
        grain: "clink",
        perSecond: 0.16,
        gain: [0.05, 0.2],
        skew: 1.5,
        pan: [-0.85, 0.85],
        speed: [0.8, 1.45],
        cluster: { count: [1, 4], gap: [0.11, 0.34] }
      },
      { kind: "grains", grain: "pop", perSecond: 0.12, gain: [0.06, 0.2], skew: 1.5, pan: [-0.8, 0.8], speed: [0.45, 0.8] },
      {
        kind: "swell",
        every: [45, 130],
        first: [9, 30],
        rise: [0.15, 0.45],
        hold: [1.5, 4],
        fall: [0.4, 1.1],
        parts: [
          { param: "cafe.steam.gain", peak: [0.035, 0.08], rest: 0 },
          { param: "cafe.steam.f0", peak: [5600, 7200], rest: 4600, ratio: true }
        ]
      }
    ],
    room: { seconds: 0.6, grains: 0.55 },
    level: 1.1
  },

  // Wind round a house: a low push, a howl that slides, a thin whistle, and
  // leaves when it gusts.
  wind: {
    id: "wind",
    name: "Wind",
    hint: "Wind round the house, gusting and easing",
    layers: [
      { id: "wind.low", source: { noise: "brown" }, filters: [{ type: "lowpass", freq: 480, q: 0.6 }], gain: 0.45 },
      { id: "wind.rush", source: { noise: "pink" }, filters: [{ type: "bandpass", freq: 900, q: 0.5 }], gain: 0.12 },
      { id: "wind.howl", source: { noise: "pink", speed: 0.9 }, filters: [{ type: "bandpass", freq: 420, q: 2.2 }], gain: 0.3 },
      { id: "wind.whistle", source: { noise: "white" }, filters: [{ type: "bandpass", freq: 1700, q: 5 }], gain: 0.012 },
      { id: "wind.leaves", source: { noise: "white", speed: 1.1 }, filters: [{ type: "highpass", freq: 3000, q: 0.5 }], gain: 0.03 }
    ],
    streams: [
      { kind: "wander", param: "wind.low.gain", range: [0.3, 0.6], every: [3, 9] },
      { kind: "wander", param: "wind.rush.gain", range: [0.05, 0.2], every: [2, 7] },
      { kind: "wander", param: "wind.rush.f0", range: [600, 1400], ratio: true, every: [3, 8] },
      { kind: "wander", param: "wind.howl.f0", range: [300, 1000], ratio: true, every: [2, 7] },
      { kind: "wander", param: "wind.howl.gain", range: [0.12, 0.4], every: [2, 6] },
      { kind: "wander", param: "wind.whistle.f0", range: [1200, 2500], ratio: true, every: [2, 6] },
      { kind: "wander", param: "wind.whistle.gain", range: [0, 0.05], every: [2, 6] },
      {
        kind: "swell",
        every: [9, 26],
        first: [3, 10],
        rise: [1.5, 4],
        hold: [0.5, 3],
        fall: [3, 7],
        parts: [
          { param: "wind.leaves.gain", peak: [0.08, 0.16], rest: 0.03 },
          { param: "wind.howl.gain", peak: [0.45, 0.7], rest: 0.25 }
        ]
      }
    ],
    level: 1.1
  },

  // Waves on a beach: the sea's low body, a wave that gathers, breaks bright
  // and draws back, and the foam it leaves, a little after.
  waves: {
    id: "waves",
    name: "Waves",
    hint: "Waves coming in and drawing back",
    layers: [
      { id: "waves.deep", source: { noise: "brown" }, filters: [{ type: "lowpass", freq: 300, q: 0.6 }], gain: 0.4 },
      { id: "waves.surf", source: { noise: "pink" }, filters: [{ type: "lowpass", freq: 700, q: 0.6 }], gain: 0.1 },
      { id: "waves.foam", source: { noise: "white", speed: 0.9 }, filters: [{ type: "highpass", freq: 3500, q: 0.5 }], gain: 0.006 }
    ],
    streams: [
      { kind: "wander", param: "waves.deep.gain", range: [0.3, 0.5], every: [4, 10] },
      {
        kind: "swell",
        every: [7.5, 13],
        first: [0.5, 3],
        rise: [1.6, 3.2],
        hold: [0.3, 1],
        fall: [3, 5.5],
        parts: [
          { param: "waves.surf.gain", peak: [0.45, 0.8], rest: 0.1 },
          { param: "waves.surf.f0", peak: [2400, 4800], rest: 700, ratio: true },
          { param: "waves.foam.gain", peak: [0.03, 0.06], rest: 0.006, late: 1.2 }
        ]
      }
    ],
    level: 0.8
  },

  // Brown noise and nothing else: a steady low hush for a reader who wants
  // the room covered and nothing to listen to.
  brown: {
    id: "brown",
    name: "Brown noise",
    hint: "A steady low hush, nothing else",
    layers: [{ id: "brown.bed", source: { noise: "brown" }, filters: [{ type: "lowpass", freq: 900, q: 0.5 }], gain: 0.9 }],
    streams: [{ kind: "wander", param: "brown.bed.gain", range: [0.85, 0.95], every: [8, 20] }],
    level: 0.62
  },

  // A summer night out of doors. The night's own low air; the far fields as
  // two thin bands of hiss that come and go; a breath of wind in the grass
  // now and then; and crickets, each keeping its own time for a while and
  // then falling quiet: a few near, more a long way off.
  crickets: {
    id: "crickets",
    name: "Summer night",
    hint: "Crickets near and far in the night air",
    layers: [
      { id: "crickets.air", source: { noise: "brown" }, filters: [{ type: "lowpass", freq: 320, q: 0.5 }], gain: 0.1 },
      { id: "crickets.field", source: { noise: "white" }, filters: [{ type: "bandpass", freq: 5200, q: 7 }], gain: 0.2 },
      { id: "crickets.grass", source: { noise: "pink", speed: 0.93 }, filters: [{ type: "bandpass", freq: 3300, q: 5 }], gain: 0.22 },
      { id: "crickets.breeze", source: { noise: "pink", speed: 1.07 }, filters: [{ type: "bandpass", freq: 700, q: 0.6 }], gain: 0.05 }
    ],
    streams: [
      { kind: "wander", param: "crickets.air.gain", range: [0.07, 0.13], every: [5, 12] },
      { kind: "wander", param: "crickets.field.gain", range: [0.14, 0.25], every: [3, 9] },
      { kind: "wander", param: "crickets.field.f0", range: [4700, 5600], ratio: true, every: [6, 15] },
      { kind: "wander", param: "crickets.grass.gain", range: [0.15, 0.3], every: [3, 8] },
      {
        kind: "swell",
        every: [14, 40],
        first: [6, 20],
        rise: [2, 5],
        hold: [1, 4],
        fall: [3, 7],
        parts: [
          { param: "crickets.breeze.gain", peak: [0.12, 0.22], rest: 0.05 },
          { param: "crickets.breeze.f0", peak: [900, 1400], rest: 700, ratio: true }
        ]
      },
      {
        kind: "grains",
        grain: "chirp",
        perSecond: 0.3,
        gain: [0.07, 0.18],
        skew: 1.6,
        pan: [-0.8, 0.8],
        speed: [0.85, 1.05],
        cluster: { count: [5, 18], gap: [0.5, 0.64], steady: true }
      },
      {
        kind: "grains",
        grain: "chirp",
        perSecond: 0.6,
        gain: [0.02, 0.07],
        skew: 2,
        pan: [-0.9, 0.9],
        speed: [0.95, 1.25],
        cluster: { count: [6, 24], gap: [0.36, 0.48], steady: true }
      }
    ],
    level: 1.8
  },

  // A brook over stones, heard from its bank. The weight of the water, the
  // run of it, a ripple that never holds still, a little spray; and bubbles,
  // which are most of what a stream says, with a drop or two off the stones.
  stream: {
    id: "stream",
    name: "Stream",
    hint: "A brook running over stones",
    layers: [
      { id: "stream.bed", source: { noise: "brown" }, filters: [{ type: "lowpass", freq: 420, q: 0.6 }], gain: 0.22 },
      { id: "stream.run", source: { noise: "pink" }, filters: [{ type: "bandpass", freq: 1300, q: 0.55 }], gain: 0.34 },
      { id: "stream.ripple", source: { noise: "pink", speed: 0.89 }, filters: [{ type: "bandpass", freq: 2600, q: 1.4 }], gain: 0.1 },
      { id: "stream.spray", source: { noise: "white", speed: 1.1 }, filters: [{ type: "highpass", freq: 5000, q: 0.5 }], gain: 0.02 }
    ],
    streams: [
      { kind: "wander", param: "stream.bed.gain", range: [0.16, 0.3], every: [4, 10] },
      { kind: "wander", param: "stream.run.gain", range: [0.26, 0.42], every: [2, 6] },
      { kind: "wander", param: "stream.run.f0", range: [1000, 1700], ratio: true, every: [2, 6] },
      { kind: "wander", param: "stream.ripple.gain", range: [0.05, 0.16], every: [0.6, 2.2] },
      { kind: "wander", param: "stream.ripple.f0", range: [1900, 3400], ratio: true, every: [0.8, 2.5] },
      { kind: "wander", param: "stream.spray.gain", range: [0.01, 0.03], every: [2, 6] },
      {
        kind: "grains",
        grain: "bubble",
        perSecond: 11,
        gain: [0.02, 0.2],
        skew: 2.6,
        pan: [-0.8, 0.8],
        speed: [0.7, 1.6],
        flurry: { every: [1.5, 5], times: [0.5, 1.8] }
      },
      { kind: "grains", grain: "drop", perSecond: 2.5, gain: [0.02, 0.14], skew: 2.4, pan: [-0.8, 0.8], speed: [0.6, 1.1] }
    ],
    level: 1.1
  },

  // A carriage at night. The low drone under the floor, the roar of the
  // air outside, a thread of rattle from the fittings; and the wheels over
  // the joints in the rail, two soft knocks and a wait, at a pace that
  // holds. Now and then the train runs over points or through a cutting,
  // and for a moment everything is nearer.
  train: {
    id: "train",
    name: "Night train",
    hint: "A carriage at night, wheels over the joints",
    layers: [
      { id: "train.rumble", source: { noise: "brown" }, filters: [{ type: "lowpass", freq: 170, q: 0.7 }], gain: 0.32 },
      { id: "train.roar", source: { noise: "pink" }, filters: [{ type: "lowpass", freq: 700, q: 0.6 }], gain: 0.42 },
      { id: "train.air", source: { noise: "pink", speed: 0.9 }, filters: [{ type: "bandpass", freq: 1700, q: 0.7 }], gain: 0.08 },
      { id: "train.rattle", source: { noise: "white" }, filters: [{ type: "bandpass", freq: 3100, q: 3 }], gain: 0.004 },
      // The knocks: noise in a low band, let through for a moment. One axle a little to the left, the next to the right.
      { id: "train.wheel", source: { noise: "pink", speed: 1.2 }, filters: [{ type: "bandpass", freq: 240, q: 2 }], gain: 0, pan: -0.25 },
      { id: "train.wheel2", source: { noise: "pink", speed: 0.85 }, filters: [{ type: "bandpass", freq: 190, q: 2 }], gain: 0, pan: 0.25 },
      { id: "train.tick", source: { noise: "pink", speed: 1.15 }, filters: [{ type: "bandpass", freq: 1100, q: 2.5 }], gain: 0, pan: 0 }
    ],
    streams: [
      { kind: "wander", param: "train.rumble.gain", range: [0.26, 0.38], every: [3, 9] },
      { kind: "wander", param: "train.rumble.f0", range: [140, 210], ratio: true, every: [4, 10] },
      { kind: "wander", param: "train.roar.gain", range: [0.33, 0.5], every: [3, 8] },
      { kind: "wander", param: "train.roar.f0", range: [560, 880], ratio: true, every: [3, 9] },
      {
        kind: "swell",
        every: [0.87, 0.885],
        first: [0.6, 1.2],
        rise: [0.01, 0.014],
        hold: [0.02, 0.03],
        fall: [0.12, 0.16],
        parts: [
          { param: "train.wheel.gain", peak: [1, 1.4], rest: 0 },
          { param: "train.tick.gain", peak: [0.12, 0.18], rest: 0 },
          { param: "train.wheel2.gain", peak: [0.8, 1.1], rest: 0, late: 0.19 }
        ]
      },
      {
        kind: "swell",
        every: [35, 90],
        first: [12, 40],
        rise: [1, 2.5],
        hold: [2, 6],
        fall: [2, 5],
        parts: [
          { param: "train.rattle.gain", peak: [0.012, 0.022], rest: 0.004 },
          { param: "train.air.gain", peak: [0.12, 0.17], rest: 0.08 }
        ]
      }
    ],
    level: 1.15
  }
};

/**
 * In the order the control shows them: the three asked for, then the plainer
 * ones, then the three that seeds buy (pip/shop.js SOUNDS; unlock.ts).
 */
export const SCENE_ORDER: SceneId[] = ["rain", "fire", "cafe", "wind", "waves", "brown", "crickets", "stream", "train"];

export const isSceneId = (value: unknown): value is SceneId => typeof value === "string" && Object.prototype.hasOwnProperty.call(SCENES, value);

/** Every control a scene's layers offer a stream, with the value each rests at. */
export const sceneParams = (scene: SceneDef): Map<ParamRef, number> => {
  const params = new Map<ParamRef, number>();
  for (const layer of scene.layers) {
    params.set(`${layer.id}.gain`, layer.gain);
    layer.filters.forEach((filter, index) => params.set(`${layer.id}.f${index}`, filter.freq));
    if ("buzz" in layer.source) {
      params.set(`${layer.id}.pitch`, layer.source.buzz);
    }
  }
  return params;
};

/** The short sounds a scene needs made. */
export const sceneGrains = (scene: SceneDef): GrainKind[] =>
  Array.from(new Set(scene.streams.flatMap((stream) => (stream.kind === "grains" ? [stream.grain] : []))));
