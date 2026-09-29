/**
 * Pip's house, heard: a handful of small sounds made on the spot with Web
 * Audio, no files, for the moments the effects layer draws. A plant picked,
 * a seed popping into the soil, seeds dropping into the counter, a chime for
 * a first step or a wish, a piece of decor set down, rain on the garden.
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

export type PipSound = "pick" | "pop" | "chime" | "coin" | "place" | "splash";

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
  }
};

/**
 * The same sound again this soon is dropped: a dozen seeds landing are a
 * patter, not a dozen coins at once.
 */
const GAP_MS: Record<PipSound, number> = { pick: 90, pop: 60, chime: 280, coin: 50, place: 90, splash: 220 };
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
