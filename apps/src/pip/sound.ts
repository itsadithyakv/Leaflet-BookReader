/**
 * Pip's house, heard: a handful of small sounds made on the spot with Web
 * Audio, no files, for the moments the effects layer draws. A plant picked,
 * a seed popping into the soil, seeds dropping into the counter, a chime for
 * a first step or a wish, a piece of decor set down, rain on the garden; and
 * Pip herself under the reader's hand: a squeak when poked, a giggle when
 * tickled, a purr when stroked, a whee when tossed, the ball's bounce, the
 * pat of a catch and the bonk of one that came down on her head; and
 * the room under the hand: the swish of a curtain, the fridge's hum while
 * its door is open and the click and thud of it shutting; a clap for a high
 * five and a sneeze for a tickled leaf; and the things in the room that
 * answer a tap: the cuckoo, a tune, bubbles, a fire, a cat. And the camp in
 * the arcade: a hammer on a new building, a scout sent in, a thing pulled
 * down, a star won, a raid's end either way, and the magpies at night.
 *
 * Off unless the reader turns it on (Settings, Pip), and quiet on purpose:
 * every sound is short and soft, well under the system's other sounds, and
 * Web Audio follows the system's volume and mute like any other page audio,
 * so there is no volume of its own to manage.
 *
 * Nothing is made until the first sound plays (after a click, so the webview
 * lets audio start), and a sound that fails is simply not heard: the moment
 * still happens on screen.
 */
import { useSyncExternalStore } from "react";

export type PipSound =
  | "pick"
  | "pop"
  | "chime"
  | "coin"
  | "place"
  | "splash"
  | "squeak"
  | "giggle"
  | "purr"
  | "whee"
  | "bounce"
  | "caught"
  | "bonk"
  | "swish"
  | "click"
  | "hum"
  | "shut"
  | "knock"
  | "hammer"
  | "march"
  | "crumble"
  | "star"
  | "fanfare"
  | "womp"
  | "caw"
  | "pebble"
  | "horn"
  | "clap"
  | "achoo"
  | "cuckoo"
  | "tune"
  | "bubble"
  | "crackle"
  | "mew";

const KEY = "leaflet.pip.sound";
/** The loudest any voice gets, before the per-sound levels below. */
const MASTER = 0.2;

const readOn = () => {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
};

let on = readOn();
const listeners = new Set<() => void>();

/** Whether Pip's sounds are on (off by default). */
export const soundOn = () => on;

/** Turns Pip's sounds on or off, for this device. */
export const setSoundOn = (next: boolean) => {
  on = next;
  try {
    localStorage.setItem(KEY, next ? "on" : "off");
  } catch {
    // Remembered for this session only.
  }
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The switch, for Settings: `[on, setOn]`. */
export const useSoundOn = (): [boolean, (next: boolean) => void] => [useSyncExternalStore(subscribe, soundOn, () => false), setSoundOn];

// ---- the synth ------------------------------------------------------------------

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

const audio = () => {
  if (typeof window === "undefined") return null;
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  if (!context) {
    context = new Context();
    master = context.createGain();
    master.gain.value = MASTER;
    master.connect(context.destination);
  }
  if (context.state === "suspended") void context.resume().catch(() => undefined);
  return context;
};

type Tone = { type: OscillatorType; from: number; to?: number; at: number; length: number; peak: number; attack?: number };

/** A short note: an oscillator, gliding from one pitch to another, through a quick envelope. */
const tone = (ctx: AudioContext, out: AudioNode, { type, from, to = from, at, length, peak, attack = 0.006 }: Tone) => {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, at);
  if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(to, at + length);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  oscillator.connect(gain).connect(out);
  oscillator.start(at);
  oscillator.stop(at + length + 0.03);
};

type Hiss = { at: number; length: number; peak: number; freq: number; q: number };

/** A breath of noise through a band-pass filter: a rustle of leaves, rain on soil. */
const hiss = (ctx: AudioContext, out: AudioNode, { at, length, peak, freq, q }: Hiss) => {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  }
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  source.connect(filter).connect(gain).connect(out);
  source.start(at);
  source.stop(at + length + 0.03);
};

/** Each sound, at a start time, a pitch (1 is as written) into an output. */
const RECIPES: Record<PipSound, (ctx: AudioContext, out: AudioNode, at: number, pitch: number) => void> = {
  // A leafy pluck: a quick rising note over a rustle.
  pick: (ctx, out, at, pitch) => {
    tone(ctx, out, { type: "triangle", from: 440 * pitch, to: 880 * pitch, at, length: 0.13, peak: 0.55 });
    hiss(ctx, out, { at, length: 0.09, peak: 0.22, freq: 2600, q: 1.1 });
  },
  // A seed into the soil: a round blip that drops.
  pop: (ctx, out, at, pitch) => tone(ctx, out, { type: "sine", from: 560 * pitch, to: 250 * pitch, at, length: 0.1, peak: 0.6 }),
  // A small bell: two notes a fifth apart, and a shimmer, fading slowly.
  chime: (ctx, out, at, pitch) => {
    tone(ctx, out, { type: "sine", from: 1047 * pitch, at, length: 0.9, peak: 0.34, attack: 0.004 });
    tone(ctx, out, { type: "sine", from: 1568 * pitch, at: at + 0.09, length: 0.8, peak: 0.24, attack: 0.004 });
    tone(ctx, out, { type: "triangle", from: 2093 * pitch, at: at + 0.09, length: 0.3, peak: 0.05 });
  },
  // Seeds into the counter: a bright double tick, soft at the edges.
  coin: (ctx, out, at, pitch) => {
    tone(ctx, out, { type: "square", from: 988 * pitch, at, length: 0.05, peak: 0.1 });
    tone(ctx, out, { type: "square", from: 1319 * pitch, at: at + 0.045, length: 0.09, peak: 0.1 });
  },
  // A piece set down: a soft wooden knock.
  place: (ctx, out, at, pitch) => {
    tone(ctx, out, { type: "sine", from: 190 * pitch, to: 95 * pitch, at, length: 0.15, peak: 0.75 });
    hiss(ctx, out, { at, length: 0.05, peak: 0.16, freq: 900, q: 0.9 });
  },
  // Rain on soil: a soft shush with a drop in it.
  splash: (ctx, out, at, pitch) => {
    hiss(ctx, out, { at, length: 0.38, peak: 0.3, freq: 1500 * pitch, q: 0.7 });
    tone(ctx, out, { type: "sine", from: 720 * pitch, to: 1150 * pitch, at: at + 0.03, length: 0.07, peak: 0.1 });
  },
  // Poked: a short chirp that jumps up.
  squeak: (ctx, out, at, pitch) => tone(ctx, out, { type: "triangle", from: 700 * pitch, to: 1250 * pitch, at, length: 0.09, peak: 0.42 }),
  // Tickled: four quick chirps, each a little higher.
  giggle: (ctx, out, at, pitch) => {
    for (let index = 0; index < 4; index += 1) {
      tone(ctx, out, { type: "triangle", from: (820 + index * 70) * pitch, to: (1040 + index * 70) * pitch, at: at + index * 0.075, length: 0.055, peak: 0.3 });
    }
  },
  // Stroked: a low, soft rumble that wavers.
  purr: (ctx, out, at, pitch) => {
    for (let index = 0; index < 5; index += 1) {
      tone(ctx, out, { type: "sine", from: 150 * pitch, to: 128 * pitch, at: at + index * 0.07, length: 0.065, peak: 0.34, attack: 0.012 });
    }
  },
  // Tossed: a note sliding up and away.
  whee: (ctx, out, at, pitch) => tone(ctx, out, { type: "sine", from: 520 * pitch, to: 1320 * pitch, at, length: 0.3, peak: 0.26, attack: 0.02 }),
  // The ball on the floor: a round, short thump.
  bounce: (ctx, out, at, pitch) => tone(ctx, out, { type: "sine", from: 300 * pitch, to: 140 * pitch, at, length: 0.09, peak: 0.5 }),
  // The ball into a pair of hands, hers or the reader's: a soft pat, with a little lift in it.
  caught: (ctx, out, at, pitch) => {
    hiss(ctx, out, { at, length: 0.05, peak: 0.26, freq: 1300 * pitch, q: 0.8 });
    tone(ctx, out, { type: "sine", from: 420 * pitch, to: 560 * pitch, at, length: 0.07, peak: 0.36, attack: 0.004 });
  },
  // The ball off the top of her head: a hollow knock, and the wobble after it.
  bonk: (ctx, out, at, pitch) => {
    tone(ctx, out, { type: "triangle", from: 520 * pitch, to: 300 * pitch, at, length: 0.07, peak: 0.5, attack: 0.003 });
    tone(ctx, out, { type: "sine", from: 240 * pitch, to: 330 * pitch, at: at + 0.07, length: 0.09, peak: 0.24, attack: 0.02 });
    tone(ctx, out, { type: "sine", from: 330 * pitch, to: 220 * pitch, at: at + 0.16, length: 0.14, peak: 0.2, attack: 0.02 });
  },
  // Curtains drawn along their rail: a soft breath of cloth.
  swish: (ctx, out, at, pitch) => hiss(ctx, out, { at, length: 0.26, peak: 0.24, freq: 2100 * pitch, q: 0.8 }),
  // A lamp's switch: a small dry tick.
  click: (ctx, out, at, pitch) => tone(ctx, out, { type: "square", from: 1500 * pitch, to: 700 * pitch, at, length: 0.03, peak: 0.16, attack: 0.002 }),
  // An open fridge: a low drone and its octave, swelling in slowly. Played again while the door is open, so it carries on.
  hum: (ctx, out, at, pitch) => {
    tone(ctx, out, { type: "sine", from: 62 * pitch, at, length: 1.4, peak: 0.3, attack: 0.4 });
    tone(ctx, out, { type: "sine", from: 124 * pitch, to: 122 * pitch, at, length: 1.4, peak: 0.12, attack: 0.4 });
  },
  // A fridge door pushed to: the latch's click, then the soft thud of the seal.
  shut: (ctx, out, at, pitch) => {
    tone(ctx, out, { type: "square", from: 1100 * pitch, to: 600 * pitch, at, length: 0.025, peak: 0.1, attack: 0.002 });
    tone(ctx, out, { type: "sine", from: 120 * pitch, to: 60 * pitch, at: at + 0.04, length: 0.16, peak: 0.6 });
    hiss(ctx, out, { at: at + 0.04, length: 0.06, peak: 0.1, freq: 500, q: 0.8 });
  },
  // A visitor at the door: three small raps on wood.
  knock: (ctx, out, at, pitch) => {
    for (let index = 0; index < 3; index += 1) {
      tone(ctx, out, { type: "sine", from: 260 * pitch, to: 130 * pitch, at: at + index * 0.17, length: 0.07, peak: 0.7, attack: 0.003 });
      hiss(ctx, out, { at: at + index * 0.17, length: 0.03, peak: 0.12, freq: 1100, q: 1 });
    }
  },
  // Work begun on a building: two taps of a hammer, the second surer.
  hammer: (ctx, out, at, pitch) => {
    for (let index = 0; index < 2; index += 1) {
      tone(ctx, out, { type: "triangle", from: (520 + index * 60) * pitch, to: 240 * pitch, at: at + index * 0.14, length: 0.06, peak: 0.5, attack: 0.002 });
      hiss(ctx, out, { at: at + index * 0.14, length: 0.04, peak: 0.2, freq: 3200, q: 1.4 });
    }
  },
  // A scout put down: two quick feet on the grass.
  march: (ctx, out, at, pitch) => {
    tone(ctx, out, { type: "sine", from: 330 * pitch, to: 220 * pitch, at, length: 0.05, peak: 0.45 });
    tone(ctx, out, { type: "sine", from: 392 * pitch, to: 262 * pitch, at: at + 0.07, length: 0.05, peak: 0.45 });
  },
  // A thing pulled down: twigs giving way, and a low thump under them.
  crumble: (ctx, out, at, pitch) => {
    hiss(ctx, out, { at, length: 0.28, peak: 0.34, freq: 700 * pitch, q: 0.6 });
    tone(ctx, out, { type: "sine", from: 140 * pitch, to: 55 * pitch, at: at + 0.02, length: 0.22, peak: 0.6 });
  },
  // A star won: one bright note that climbs; pitched up for the second and the third.
  star: (ctx, out, at, pitch) => {
    tone(ctx, out, { type: "triangle", from: 784 * pitch, to: 1175 * pitch, at, length: 0.16, peak: 0.36 });
    tone(ctx, out, { type: "sine", from: 2349 * pitch, at: at + 0.05, length: 0.3, peak: 0.08 });
  },
  // A raid won: four notes up a chord, and the last one held.
  fanfare: (ctx, out, at, pitch) => {
    [523, 659, 784, 1047].forEach((note, index) =>
      tone(ctx, out, { type: "triangle", from: note * pitch, at: at + index * 0.11, length: index === 3 ? 0.6 : 0.12, peak: index === 3 ? 0.36 : 0.3 })
    );
    tone(ctx, out, { type: "sine", from: 1568 * pitch, at: at + 0.33, length: 0.5, peak: 0.1 });
  },
  // A raid beaten back: two notes going down, the second sagging.
  womp: (ctx, out, at, pitch) => {
    tone(ctx, out, { type: "triangle", from: 311 * pitch, at, length: 0.2, peak: 0.34, attack: 0.02 });
    tone(ctx, out, { type: "triangle", from: 233 * pitch, to: 175 * pitch, at: at + 0.2, length: 0.42, peak: 0.34, attack: 0.02 });
  },
  // Magpies: two harsh chatters, as heard from a hedge.
  caw: (ctx, out, at, pitch) => {
    for (let index = 0; index < 2; index += 1) {
      tone(ctx, out, { type: "sawtooth", from: 620 * pitch, to: 430 * pitch, at: at + index * 0.16, length: 0.1, peak: 0.12, attack: 0.01 });
      hiss(ctx, out, { at: at + index * 0.16, length: 0.09, peak: 0.16, freq: 2400, q: 2.2 });
    }
  },
  // A pebble landing: a small dry tock.
  pebble: (ctx, out, at, pitch) => tone(ctx, out, { type: "sine", from: 880 * pitch, to: 420 * pitch, at, length: 0.035, peak: 0.26, attack: 0.002 }),
  // The scouts setting out: a little horn, two notes a fourth apart.
  horn: (ctx, out, at, pitch) => {
    tone(ctx, out, { type: "sawtooth", from: 294 * pitch, at, length: 0.16, peak: 0.1, attack: 0.03 });
    tone(ctx, out, { type: "sawtooth", from: 392 * pitch, at: at + 0.16, length: 0.34, peak: 0.12, attack: 0.03 });
    tone(ctx, out, { type: "sine", from: 392 * pitch, at: at + 0.16, length: 0.34, peak: 0.2, attack: 0.03 });
  },
  // A high five: two small hands meeting, a slap with a bright ring to it.
  clap: (ctx, out, at, pitch) => {
    hiss(ctx, out, { at, length: 0.07, peak: 0.5, freq: 1900 * pitch, q: 0.9 });
    tone(ctx, out, { type: "triangle", from: 1320 * pitch, to: 880 * pitch, at, length: 0.06, peak: 0.2, attack: 0.002 });
  },
  // A tickled leaf: the breath going in, then all of it out at once.
  achoo: (ctx, out, at, pitch) => {
    tone(ctx, out, { type: "sine", from: 520 * pitch, to: 900 * pitch, at, length: 0.22, peak: 0.16, attack: 0.08 });
    hiss(ctx, out, { at: at + 0.26, length: 0.2, peak: 0.42, freq: 2600 * pitch, q: 0.7 });
    tone(ctx, out, { type: "triangle", from: 980 * pitch, to: 380 * pitch, at: at + 0.26, length: 0.16, peak: 0.3 });
  },
  // The clock on the wall: cuckoo, twice, a falling third each time.
  cuckoo: (ctx, out, at, pitch) => {
    for (let index = 0; index < 2; index += 1) {
      tone(ctx, out, { type: "sine", from: 784 * pitch, at: at + index * 0.5, length: 0.16, peak: 0.34, attack: 0.02 });
      tone(ctx, out, { type: "sine", from: 622 * pitch, at: at + index * 0.5 + 0.18, length: 0.22, peak: 0.34, attack: 0.02 });
    }
  },
  // A record, a piano, a jukebox: six notes of a tune that goes up and comes home.
  tune: (ctx, out, at, pitch) => {
    [523, 659, 784, 659, 880, 784].forEach((note, index) =>
      tone(ctx, out, { type: "triangle", from: note * pitch, at: at + index * 0.14, length: index === 5 ? 0.34 : 0.13, peak: 0.26, attack: 0.01 })
    );
  },
  // A fish tank, a lava lamp, a pond: three bubbles, each a little higher.
  bubble: (ctx, out, at, pitch) => {
    [0, 0.11, 0.19].forEach((when, index) =>
      tone(ctx, out, { type: "sine", from: (380 + index * 110) * pitch, to: (760 + index * 160) * pitch, at: at + when, length: 0.07, peak: 0.28, attack: 0.01 })
    );
  },
  // A fire in the grate: a low breath, and a few sparks snapping in it.
  crackle: (ctx, out, at, pitch) => {
    hiss(ctx, out, { at, length: 0.5, peak: 0.1, freq: 420 * pitch, q: 0.5 });
    [0.03, 0.12, 0.19, 0.31, 0.42].forEach((when, index) => hiss(ctx, out, { at: at + when, length: 0.025, peak: 0.3, freq: (2400 + index * 380) * pitch, q: 3 }));
  },
  // A cat with something to say: one small note, up and back down.
  mew: (ctx, out, at, pitch) => {
    tone(ctx, out, { type: "triangle", from: 660 * pitch, to: 990 * pitch, at, length: 0.12, peak: 0.22, attack: 0.03 });
    tone(ctx, out, { type: "triangle", from: 990 * pitch, to: 740 * pitch, at: at + 0.12, length: 0.2, peak: 0.22, attack: 0.01 });
  }
};

/**
 * The same sound again this soon is dropped: a dozen seeds landing are a
 * patter, not a dozen coins at once.
 */
const GAP_MS: Record<PipSound, number> = {
  pick: 90,
  pop: 60,
  chime: 280,
  coin: 50,
  place: 90,
  splash: 220,
  squeak: 70,
  giggle: 320,
  purr: 380,
  whee: 260,
  bounce: 70,
  caught: 90,
  bonk: 400,
  swish: 200,
  click: 80,
  hum: 1000,
  shut: 200,
  knock: 900,
  hammer: 300,
  march: 70,
  crumble: 140,
  star: 120,
  fanfare: 1200,
  womp: 1200,
  caw: 700,
  pebble: 190,
  horn: 800,
  clap: 200,
  achoo: 900,
  cuckoo: 1200,
  tune: 1000,
  bubble: 300,
  crackle: 600,
  mew: 500
};
const lastPlayed = new Map<PipSound, number>();

/** Whether a sound may play at `now`, given when it last did. Pure, for the tests. */
export const spaced = (sound: PipSound, now: number, last: number | undefined) => last === undefined || now - last >= GAP_MS[sound];

type PlayOptions = { pitch?: number; volume?: number; delay?: number };

/** Plays one of Pip's sounds, if sounds are on. */
export const playSound = (sound: PipSound, { pitch = 1, volume = 1, delay = 0 }: PlayOptions = {}) => {
  if (!on) return;
  const now = performance.now() + delay;
  if (!spaced(sound, now, lastPlayed.get(sound))) return;
  lastPlayed.set(sound, now);
  try {
    const ctx = audio();
    if (!ctx || !master) return;
    const out = ctx.createGain();
    out.gain.value = Math.max(0, Math.min(1, volume));
    out.connect(master);
    RECIPES[sound](ctx, out, ctx.currentTime + 0.01 + delay / 1000, Math.max(0.25, pitch));
    // Let the voice go once it has played out.
    window.setTimeout(() => out.disconnect(), delay + 1500);
  } catch {
    // No audio here: the moment still happens on screen.
  }
};
