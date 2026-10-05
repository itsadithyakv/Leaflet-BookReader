/**
 * The radio's raw material, made as plain samples: loops of noise in three
 * colours, the short sounds (a raindrop, a crackle, a pop, a cup's clink) and
 * the echo of a room. No files: each is worked out from a seeded source of
 * chance (random.ts) when a scene first needs it, and handed to Web Audio as
 * a buffer (engine.ts).
 *
 * Plain arrays in and out, so the tests can listen with arithmetic: nothing
 * louder than full scale, every short sound ending in silence, a loop whose
 * end runs into its beginning without a step.
 */
import { between, betweenRatio, type Random } from "./random";
import type { GrainKind, NoiseColour } from "./scenes";

/** How loud a noise loop is (root mean square), whatever its colour: layers set their own levels from here. */
export const NOISE_RMS = 0.25;

/** How long each colour's loop is, in seconds: not multiples of each other, so layers never line up twice. */
export const NOISE_SECONDS: Record<NoiseColour, number> = { white: 5.3, pink: 7.1, brown: 9.7 };

/** The last stretch of a loop is blended into its start, so the join cannot be heard. */
const LOOP_BLEND_SECONDS = 0.25;

const rmsOf = (samples: Float32Array) => {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
};

const scaleTo = (samples: Float32Array, factor: number) => {
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] *= factor;
  }
  return samples;
};

/** Below this nothing is heard and a small speaker only strains: the low colours are cut off under it. */
const RUMBLE_HZ = 28;

/** Takes out what is below `RUMBLE_HZ`, in place (two gentle high-pass filters, one after the other). */
const rumbleOff = (samples: Float32Array, sampleRate: number) => {
  const keep = 1 - (2 * Math.PI * RUMBLE_HZ) / sampleRate;
  for (let pass = 0; pass < 2; pass += 1) {
    let before = 0;
    let out = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const now = samples[index];
      out = now - before + keep * out;
      before = now;
      samples[index] = out;
    }
  }
  return samples;
};

/** One channel of noise, as many samples as asked for. */
const colour = (kind: NoiseColour, length: number, sampleRate: number, random: Random) => {
  const raw = new Float32Array(length);
  if (kind === "white") {
    for (let index = 0; index < length; index += 1) {
      raw[index] = random() * 2 - 1;
    }
    return raw;
  }
  if (kind === "pink") {
    // Paul Kellet's filter: white noise through a few leaky sums, falling 3 dB an octave.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let index = 0; index < length; index += 1) {
      const white = random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      raw[index] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
    }
    return rumbleOff(raw, sampleRate);
  }
  // Brown: a leaky running sum, falling 6 dB an octave. The leak keeps it from wandering off.
  let last = 0;
  for (let index = 0; index < length; index += 1) {
    last = (last + 0.02 * (random() * 2 - 1)) / 1.02;
    raw[index] = last;
  }
  return rumbleOff(raw, sampleRate);
};

/**
 * A loop of noise for one ear. The stretch past the end is blended into the
 * start (the two are unrelated, so by equal power), which makes the last
 * sample run into the first as any two neighbours do.
 */
export const noiseLoop = (kind: NoiseColour, seconds: number, sampleRate: number, random: Random): Float32Array => {
  const length = Math.max(2, Math.round(seconds * sampleRate));
  const blend = Math.min(length >> 1, Math.round(LOOP_BLEND_SECONDS * sampleRate));
  // A little more than the loop, to blend its end into its start with.
  const raw = colour(kind, length + blend, sampleRate, random);
  const loop = raw.slice(0, length);
  for (let index = 0; index < blend; index += 1) {
    const turn = ((index + 0.5) / blend) * (Math.PI / 2);
    loop[index] = raw[index] * Math.sin(turn) + raw[length + index] * Math.cos(turn);
  }
  let mean = 0;
  for (let index = 0; index < length; index += 1) {
    mean += loop[index];
  }
  mean /= length;
  for (let index = 0; index < length; index += 1) {
    loop[index] -= mean;
  }
  return scaleTo(loop, NOISE_RMS / Math.max(1e-9, rmsOf(loop)));
};

/** Two ears, unrelated: the noise has width. */
export const noisePair = (kind: NoiseColour, sampleRate: number, random: Random): [Float32Array, Float32Array] => [
  noiseLoop(kind, NOISE_SECONDS[kind], sampleRate, random),
  noiseLoop(kind, NOISE_SECONDS[kind], sampleRate, random)
];

// ---- the short sounds ---------------------------------------------------------------

/** How long each short sound is, in seconds. */
export const GRAIN_SECONDS: Record<GrainKind, number> = { drop: 0.09, crackle: 0.035, pop: 0.16, clink: 0.34 };

/** A resonance: what a ringing thing does to a knock (a band-pass filter, in place). */
const ring = (samples: Float32Array, sampleRate: number, freq: number, q: number) => {
  const omega = (2 * Math.PI * Math.min(freq, sampleRate * 0.45)) / sampleRate;
  const alpha = Math.sin(omega) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const a1 = (-2 * Math.cos(omega)) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const x0 = samples[index];
    const y0 = b0 * x0 - b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    samples[index] = y0;
  }
  return samples;
};

/** A burst of noise that dies away: starting at `at` seconds, `tau` seconds to a third. */
const burst = (samples: Float32Array, sampleRate: number, random: Random, at: number, tau: number, level: number) => {
  const from = Math.floor(at * sampleRate);
  const length = Math.min(samples.length - from, Math.ceil(tau * 8 * sampleRate));
  for (let index = 0; index < length; index += 1) {
    samples[from + index] += (random() * 2 - 1) * level * Math.exp(-index / (tau * sampleRate));
  }
};

/** A note that dies away, sliding from one pitch to another. */
const note = (samples: Float32Array, sampleRate: number, from: number, to: number, tau: number, level: number, attack = 0.001) => {
  let phase = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    const freq = from + (to - from) * Math.min(1, time / (tau * 3));
    phase += (2 * Math.PI * freq) / sampleRate;
    samples[index] += Math.sin(phase) * level * Math.min(1, time / attack) * Math.exp(-time / tau);
  }
};

/** Full scale at its loudest, and silent at its end. */
const finish = (samples: Float32Array, sampleRate: number) => {
  const fade = Math.min(samples.length, Math.round(0.004 * sampleRate));
  for (let index = 0; index < fade; index += 1) {
    samples[samples.length - 1 - index] *= 0.5 - 0.5 * Math.cos((Math.PI * index) / fade);
  }
  // A sample or two of rise, so it does not start on a step either.
  samples[0] = 0;
  let top = 0;
  for (let index = 0; index < samples.length; index += 1) {
    top = Math.max(top, Math.abs(samples[index]));
  }
  return scaleTo(samples, top > 0 ? 1 / top : 0);
};

/**
 * One make of a short sound. Each call with the same source gives another:
 * no two drops, crackles or cups are quite alike.
 */
export const renderGrain = (kind: GrainKind, sampleRate: number, random: Random): Float32Array => {
  const samples = new Float32Array(Math.round(GRAIN_SECONDS[kind] * sampleRate));
  if (kind === "drop") {
    if (random() < 0.6) {
      // A tap: a drop on a sill or a leaf.
      burst(samples, sampleRate, random, 0, between(random, [0.003, 0.009]), 1);
      ring(samples, sampleRate, betweenRatio(random, [1500, 5000]), between(random, [1.5, 3]));
    } else {
      // A plink: a drop into water, its pitch rising as the bubble closes.
      const pitch = betweenRatio(random, [900, 2200]);
      burst(samples, sampleRate, random, 0, 0.0015, 0.25);
      note(samples, sampleRate, pitch, pitch * between(random, [1.3, 1.6]), between(random, [0.01, 0.02]), 1);
    }
  } else if (kind === "crackle") {
    // One to three snaps close together, through whatever the wood rings at.
    const snaps = 1 + Math.floor(random() * 3);
    for (let snap = 0; snap < snaps; snap += 1) {
      burst(samples, sampleRate, random, snap === 0 ? 0 : between(random, [0.002, 0.014]), between(random, [0.0003, 0.002]), between(random, [0.4, 1]));
    }
    ring(samples, sampleRate, betweenRatio(random, [1200, 6000]), between(random, [1, 4]));
  } else if (kind === "pop") {
    // A log giving way: a snap, and the thump of it.
    const pitch = betweenRatio(random, [180, 480]);
    burst(samples, sampleRate, random, 0, 0.006, 0.5);
    ring(samples, sampleRate, pitch * 3, 1.2);
    note(samples, sampleRate, pitch, pitch * 0.7, between(random, [0.015, 0.035]), 1, 0.0008);
    burst(samples, sampleRate, random, 0, 0.001, 0.35);
  } else {
    // A spoon on a cup: a few partials that are not in tune with each other, the high ones dying first.
    const pitch = betweenRatio(random, [2300, 4200]);
    const tau = between(random, [0.035, 0.08]);
    const partials: Array<[number, number]> = [
      [1, 1],
      [between(random, [1.48, 1.6]), 0.5],
      [between(random, [2.55, 2.8]), 0.3],
      [between(random, [3.8, 4.1]), 0.12]
    ];
    for (const [ratio, level] of partials) {
      if (pitch * ratio < sampleRate * 0.45) {
        note(samples, sampleRate, pitch * ratio, pitch * ratio, tau / Math.pow(ratio, 0.8), level, 0.0006);
      }
    }
    burst(samples, sampleRate, random, 0, 0.0005, 0.3);
  }
  return finish(samples, sampleRate);
};

/**
 * A room's echo, for one ear: a few early bounces off the walls, then a wash
 * that dies away and dulls as it goes. Its energy is 1, so what is sent
 * through it comes back about as loud as it went in.
 */
export const renderRoom = (seconds: number, sampleRate: number, random: Random): Float32Array => {
  const length = Math.max(8, Math.round(seconds * sampleRate));
  const echo = new Float32Array(length);
  const wait = Math.round(0.012 * sampleRate);
  // 60 dB down by the end.
  const tau = (seconds / 6.9) * sampleRate;
  let smooth = 0;
  for (let index = wait; index < length; index += 1) {
    const age = (index - wait) / (length - wait);
    // Less of the top as it goes on: walls and coats soak up the bright part first.
    const keep = 0.6 - 0.45 * age;
    smooth += keep * (random() * 2 - 1 - smooth);
    echo[index] = smooth * Math.exp(-(index - wait) / tau);
  }
  for (let bounce = 0; bounce < 6; bounce += 1) {
    const at = Math.round(between(random, [0.007, 0.045]) * sampleRate);
    if (at < length) {
      echo[at] += (random() < 0.5 ? -1 : 1) * between(random, [0.15, 0.4]);
    }
  }
  let energy = 0;
  for (let index = 0; index < length; index += 1) {
    energy += echo[index] * echo[index];
  }
  return scaleTo(echo, energy > 0 ? 1 / Math.sqrt(energy) : 0);
};
