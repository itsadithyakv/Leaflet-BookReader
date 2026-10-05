/**
 * Listening with arithmetic. Nobody can hear a test run, so a rendered
 * stretch of a scene (engine.ts `renderScene`) is measured instead: how loud
 * it is, whether it ever clips, whether the two ears differ, where in the
 * spectrum its energy is, whether its level has holes or jumps, and whether
 * it rises and falls the way talk does or sits still the way static does.
 *
 * What these numbers cannot say is whether it sounds like rain. That takes
 * ears.
 */

export const rms = (samples: ArrayLike<number>) => {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
};

export const peak = (samples: ArrayLike<number>) => {
  let top = 0;
  for (let index = 0; index < samples.length; index += 1) {
    top = Math.max(top, Math.abs(samples[index]));
  }
  return top;
};

/** Decibels for a ratio of levels; -Infinity for silence. */
export const decibels = (ratio: number) => (ratio > 0 ? 20 * Math.log10(ratio) : -Infinity);

/** How alike two channels are: 1 the same, 0 unrelated, -1 the same upside down. */
export const correlation = (left: ArrayLike<number>, right: ArrayLike<number>) => {
  const length = Math.min(left.length, right.length);
  let both = 0;
  let leftSum = 0;
  let rightSum = 0;
  for (let index = 0; index < length; index += 1) {
    both += left[index] * right[index];
    leftSum += left[index] * left[index];
    rightSum += right[index] * right[index];
  }
  const scale = Math.sqrt(leftSum * rightSum);
  return scale > 0 ? both / scale : 1;
};

/** How far apart two renders are, as a share of the first one's level: 0 for the same samples. */
export const difference = (first: ArrayLike<number>, second: ArrayLike<number>) => {
  const length = Math.min(first.length, second.length);
  let apart = 0;
  let level = 0;
  for (let index = 0; index < length; index += 1) {
    apart += (first[index] - second[index]) * (first[index] - second[index]);
    level += first[index] * first[index];
  }
  return level > 0 ? Math.sqrt(apart / level) : apart > 0 ? Infinity : 0;
};

/** The level in each stretch of `seconds`, one after the other. */
export const levels = (samples: ArrayLike<number>, sampleRate: number, seconds = 0.25) => {
  const size = Math.max(1, Math.round(seconds * sampleRate));
  const out: number[] = [];
  for (let from = 0; from + size <= samples.length; from += size) {
    let sum = 0;
    for (let index = from; index < from + size; index += 1) {
      sum += samples[index] * samples[index];
    }
    out.push(Math.sqrt(sum / size));
  }
  return out;
};

export type Steadiness = {
  /** The quietest and the loudest stretch, in dB against the middle one. */
  quietestDb: number;
  loudestDb: number;
  /** The biggest change from one stretch to the next, in dB. */
  biggestStepDb: number;
};

/** Whether a level holds: a hole shows as a very quiet stretch, a jump as a big step. */
export const steadiness = (stretches: number[]): Steadiness => {
  if (stretches.length === 0) {
    return { quietestDb: -Infinity, loudestDb: -Infinity, biggestStepDb: 0 };
  }
  const sorted = [...stretches].sort((a, b) => a - b);
  const middle = sorted[sorted.length >> 1];
  let step = 0;
  for (let index = 1; index < stretches.length; index += 1) {
    step = Math.max(step, Math.abs(decibels(stretches[index] / stretches[index - 1])));
  }
  return {
    quietestDb: decibels(sorted[0] / middle),
    loudestDb: decibels(sorted[sorted.length - 1] / middle),
    biggestStepDb: step
  };
};

// ---- the spectrum ----------------------------------------------------------------------

/** In place, for a length that is a power of two. */
const fft = (real: Float64Array, imaginary: Float64Array) => {
  const size = real.length;
  for (let index = 1, swap = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; swap & bit; bit >>= 1) {
      swap ^= bit;
    }
    swap ^= bit;
    if (index < swap) {
      [real[index], real[swap]] = [real[swap], real[index]];
      [imaginary[index], imaginary[swap]] = [imaginary[swap], imaginary[index]];
    }
  }
  for (let span = 2; span <= size; span <<= 1) {
    // The turns for this span, worked out once and used by every block of it.
    const half = span >> 1;
    const turns = new Float64Array(span);
    for (let index = 0; index < half; index += 1) {
      turns[index] = Math.cos((-2 * Math.PI * index) / span);
      turns[half + index] = Math.sin((-2 * Math.PI * index) / span);
    }
    for (let from = 0; from < size; from += span) {
      for (let index = 0; index < half; index += 1) {
        const cos = turns[index];
        const sin = turns[half + index];
        const even = from + index;
        const odd = even + half;
        const oddReal = real[odd] * cos - imaginary[odd] * sin;
        const oddImaginary = real[odd] * sin + imaginary[odd] * cos;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
      }
    }
  }
};

const FFT_SIZE = 4096;

/** The power at each frequency, averaged over the whole stretch (windows half overlapping). */
export const spectrum = (samples: ArrayLike<number>) => {
  const power = new Float64Array(FFT_SIZE >> 1);
  const real = new Float64Array(FFT_SIZE);
  const imaginary = new Float64Array(FFT_SIZE);
  let windows = 0;
  for (let from = 0; from + FFT_SIZE <= samples.length; from += FFT_SIZE >> 1) {
    for (let index = 0; index < FFT_SIZE; index += 1) {
      real[index] = samples[from + index] * (0.5 - 0.5 * Math.cos((2 * Math.PI * index) / FFT_SIZE));
      imaginary[index] = 0;
    }
    fft(real, imaginary);
    for (let bin = 0; bin < power.length; bin += 1) {
      power[bin] += real[bin] * real[bin] + imaginary[bin] * imaginary[bin];
    }
    windows += 1;
  }
  if (windows > 0) {
    for (let bin = 0; bin < power.length; bin += 1) {
      power[bin] /= windows;
    }
  }
  return power;
};

export type Band = { name: string; from: number; to: number };

/** Rumble, body, the range of voices, brightness, air. */
export const BANDS: Band[] = [
  { name: "low", from: 20, to: 200 },
  { name: "lowMid", from: 200, to: 800 },
  { name: "mid", from: 800, to: 3000 },
  { name: "high", from: 3000, to: 8000 },
  { name: "air", from: 8000, to: 24000 }
];

/** The share of the energy in each band (they add up to about 1), and the frequency the energy balances at. */
export const balance = (samples: ArrayLike<number>, sampleRate: number, bands: Band[] = BANDS, power: Float64Array = spectrum(samples)) => {
  const hertzPerBin = sampleRate / FFT_SIZE;
  let total = 0;
  let weighted = 0;
  const shares: Record<string, number> = Object.fromEntries(bands.map((band) => [band.name, 0]));
  for (let bin = 1; bin < power.length; bin += 1) {
    const hertz = bin * hertzPerBin;
    total += power[bin];
    weighted += power[bin] * hertz;
    const band = bands.find((candidate) => hertz >= candidate.from && hertz < candidate.to);
    if (band) {
      shares[band.name] += power[bin];
    }
  }
  for (const band of bands) {
    shares[band.name] = total > 0 ? shares[band.name] / total : 0;
  }
  return { shares, centre: total > 0 ? weighted / total : 0 };
};

/**
 * How much an ear makes of a frequency (the "A" curve, as a weight on power):
 * a rumble at 50 Hz counts for a thousandth of the same level at 2 kHz.
 */
export const earWeight = (hertz: number) => {
  const square = hertz * hertz;
  const response = (12194 ** 2 * square * square) / ((square + 20.6 ** 2) * Math.sqrt((square + 107.7 ** 2) * (square + 737.9 ** 2)) * (square + 12194 ** 2));
  return response * response * 10 ** 0.2;
};

/**
 * How much quieter (or louder) a sound is to the ear than its level says, in
 * dB: about 0 for hiss, well below for a rumble. Scenes are set against each
 * other by level plus this, so a low roar is not left sounding half as loud
 * as rain.
 */
export const earOffsetDb = (samples: ArrayLike<number>, sampleRate: number, power: Float64Array = spectrum(samples)) => {
  const hertzPerBin = sampleRate / FFT_SIZE;
  let total = 0;
  let heard = 0;
  for (let bin = 1; bin < power.length; bin += 1) {
    total += power[bin];
    heard += power[bin] * earWeight(bin * hertzPerBin);
  }
  return total > 0 ? 10 * Math.log10(heard / total) : 0;
};

/**
 * How much the level in a band comes and goes, moment to moment: the spread
 * of its 50 ms levels as a share of their mean. Static sits near 0.1; talk,
 * with its syllables, well above.
 */
export const flutter = (samples: ArrayLike<number>, sampleRate: number, from: number, to: number) => {
  // A band-pass by two one-pole filters: rough, and enough to follow the band's level.
  const low = 1 - Math.exp((-2 * Math.PI * to) / sampleRate);
  const high = 1 - Math.exp((-2 * Math.PI * from) / sampleRate);
  const band = new Float32Array(samples.length);
  let passed = 0;
  let slow = 0;
  for (let index = 0; index < samples.length; index += 1) {
    passed += low * (samples[index] - passed);
    slow += high * (passed - slow);
    band[index] = passed - slow;
  }
  const stretches = levels(band, sampleRate, 0.05);
  if (stretches.length < 2) {
    return 0;
  }
  const mean = stretches.reduce((sum, value) => sum + value, 0) / stretches.length;
  const spread = Math.sqrt(stretches.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / stretches.length);
  return mean > 0 ? spread / mean : 0;
};

export type Measured = {
  seconds: number;
  /** Both channels together. */
  rmsDb: number;
  /** The same as an ear takes it: low rumble counted for less. */
  heardDb: number;
  peak: number;
  /** How alike the two channels are: under 1, or it is mono. */
  correlation: number;
  shares: Record<string, number>;
  centre: number;
  steadiness: Steadiness;
  /** The rise and fall of the level where voices are (300 Hz to 3 kHz). */
  voiceFlutter: number;
};

/** Everything above, for a rendered stretch in two channels. */
export const measure = (left: Float32Array, right: Float32Array, sampleRate: number): Measured => {
  const mono = new Float32Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    mono[index] = (left[index] + right[index]) / 2;
  }
  const power = spectrum(mono);
  const { shares, centre } = balance(mono, sampleRate, BANDS, power);
  const both = Math.sqrt((rms(left) ** 2 + rms(right) ** 2) / 2);
  const rightLevels = levels(right, sampleRate);
  const bothLevels = levels(left, sampleRate).map((level, index) => Math.sqrt((level * level + (rightLevels[index] ?? level) ** 2) / 2));
  return {
    seconds: left.length / sampleRate,
    rmsDb: decibels(both),
    heardDb: decibels(both) + earOffsetDb(mono, sampleRate, power),
    peak: Math.max(peak(left), peak(right)),
    correlation: correlation(left, right),
    shares,
    centre,
    steadiness: steadiness(bothLevels),
    voiceFlutter: flutter(mono, sampleRate, 300, 3000)
  };
};
