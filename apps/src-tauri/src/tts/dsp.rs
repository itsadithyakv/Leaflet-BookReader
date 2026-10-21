//! The sound itself: as loud as the system voices, soft at the edges, and
//! at the rate the speakers want.

/// The model's own rate (Kokoro).
pub const MODEL_RATE: u32 = 24_000;
/// Speech is levelled toward this loudness (about Windows' own voices, −20,
/// a little louder). Measured as gated RMS over 50 ms blocks: a stand-in for
/// LUFS that is close for speech.
pub const TARGET_DB: f32 = -18.0;
/// Never raised more than this (a whispered line stays a whisper).
pub const MAX_GAIN_DB: f32 = 9.0;
/// Above this the limiter bends the peaks rather than clipping them.
pub const LIMIT_KNEE: f32 = 0.8;
/// Fade in and out of each piece, against clicks.
pub const EDGE_MS: f32 = 4.0;

pub fn db_to_gain(db: f32) -> f32 {
  10f32.powf(db / 20.0)
}

/// The loudness of speech in dB: the RMS of the 50 ms blocks louder than −50 dB.
pub fn loudness_db(samples: &[f32], rate: u32) -> Option<f32> {
  let block = ((rate as usize) / 20).max(1);
  let gate = db_to_gain(-50.0).powi(2);
  let (mut sum, mut count) = (0f64, 0usize);
  for chunk in samples.chunks(block) {
    let power = chunk.iter().map(|s| (*s as f64) * (*s as f64)).sum::<f64>() / chunk.len() as f64;
    if power > gate as f64 {
      sum += power * chunk.len() as f64;
      count += chunk.len();
    }
  }
  (count > 0).then(|| (10.0 * (sum / count as f64).log10()) as f32)
}

/// The gain (dB) that brings speech of this loudness to `TARGET_DB`: never down, at most `MAX_GAIN_DB` up.
pub fn level_gain_db(loudness: f32) -> f32 {
  (TARGET_DB - loudness).clamp(0.0, MAX_GAIN_DB)
}

/// A soft limiter: below the knee untouched, above it bent toward 1, never past it.
pub fn limit(sample: f32) -> f32 {
  let magnitude = sample.abs();
  if magnitude <= LIMIT_KNEE {
    return sample;
  }
  let room = 1.0 - LIMIT_KNEE;
  let bent = LIMIT_KNEE + room * ((magnitude - LIMIT_KNEE) / room).tanh();
  bent.copysign(sample)
}

/// Keeps the level steady from piece to piece: the gain moves halfway to each piece's own.
#[derive(Debug, Default, Clone, Copy)]
pub struct Leveller {
  gain_db: Option<f32>,
}

impl Leveller {
  pub fn apply(&mut self, samples: &mut [f32], rate: u32) {
    let Some(loudness) = loudness_db(samples, rate) else { return };
    let wanted = level_gain_db(loudness);
    let gain_db = match self.gain_db {
      None => wanted,
      Some(old) => old + (wanted - old) * 0.5,
    };
    self.gain_db = Some(gain_db);
    let gain = db_to_gain(gain_db);
    samples.iter_mut().for_each(|sample| *sample = limit(*sample * gain));
  }
}

/// A short fade at each end.
pub fn soften_edges(samples: &mut [f32], rate: u32) {
  let edge = ((rate as f32) * EDGE_MS / 1000.0) as usize;
  let edge = edge.min(samples.len() / 2);
  for index in 0..edge {
    let gain = index as f32 / edge as f32;
    samples[index] *= gain;
    let back = samples.len() - 1 - index;
    samples[back] *= gain;
  }
}

pub fn silence(rate: u32, ms: f32) -> usize {
  ((rate as f32) * ms.max(0.0) / 1000.0).round() as usize
}

/// How many samples `len` at `from` makes at `to`.
pub fn resampled_len(len: usize, from: u32, to: u32) -> usize {
  if from == to {
    len
  } else {
    ((len as u64 * to as u64) / from as u64) as usize
  }
}

/// An offset at `from` as one at `to`.
pub fn map_offset(offset: usize, from: u32, to: u32) -> usize {
  resampled_len(offset, from, to)
}

/// Cubic (Catmull-Rom) resampling: good enough for speech, and exactly `resampled_len` long.
pub fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
  if from == to || input.is_empty() {
    return input.to_vec();
  }
  let out_len = resampled_len(input.len(), from, to);
  let step = from as f64 / to as f64;
  let at = |index: isize| -> f32 { input[index.clamp(0, input.len() as isize - 1) as usize] };
  (0..out_len)
    .map(|n| {
      let position = n as f64 * step;
      let base = position.floor() as isize;
      let t = (position - base as f64) as f32;
      let (p0, p1, p2, p3) = (at(base - 1), at(base), at(base + 1), at(base + 2));
      let a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
      let b = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
      let c = -0.5 * p0 + 0.5 * p2;
      ((a * t + b) * t + c) * t + p1
    })
    .collect()
}

pub fn to_i16(samples: &[f32]) -> Vec<u8> {
  let mut out = Vec::with_capacity(samples.len() * 2);
  for sample in samples {
    let value = (sample.clamp(-1.0, 1.0) * 32767.0).round() as i16;
    out.extend_from_slice(&value.to_le_bytes());
  }
  out
}

pub fn from_i16(bytes: &[u8]) -> Vec<f32> {
  bytes.chunks_exact(2).map(|pair| i16::from_le_bytes([pair[0], pair[1]]) as f32 / 32767.0).collect()
}

/// A mono 16-bit WAV (for the end-to-end check).
#[cfg(test)]
pub fn wav_bytes(samples: &[f32], rate: u32) -> Vec<u8> {
  let data = to_i16(samples);
  let mut out = Vec::with_capacity(44 + data.len());
  out.extend_from_slice(b"RIFF");
  out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
  out.extend_from_slice(b"WAVEfmt ");
  out.extend_from_slice(&16u32.to_le_bytes());
  out.extend_from_slice(&1u16.to_le_bytes());
  out.extend_from_slice(&1u16.to_le_bytes());
  out.extend_from_slice(&rate.to_le_bytes());
  out.extend_from_slice(&(rate * 2).to_le_bytes());
  out.extend_from_slice(&2u16.to_le_bytes());
  out.extend_from_slice(&16u16.to_le_bytes());
  out.extend_from_slice(b"data");
  out.extend_from_slice(&(data.len() as u32).to_le_bytes());
  out.extend_from_slice(&data);
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  fn tone(amplitude: f32, len: usize) -> Vec<f32> {
    (0..len).map(|n| amplitude * (n as f32 * 2.0 * std::f32::consts::PI * 220.0 / 24_000.0).sin()).collect()
  }

  #[test]
  fn loudness_is_measured_over_the_speech_not_the_silence() {
    // A sine of amplitude a is a/√2 RMS: 0.1 → −23 dB.
    let mut samples = tone(0.1, 24_000);
    let loud = loudness_db(&samples, 24_000).unwrap();
    assert!((loud + 23.0).abs() < 0.2, "{loud}");
    samples.extend(vec![0.0; 48_000]);
    assert!((loudness_db(&samples, 24_000).unwrap() - loud).abs() < 0.2);
    assert_eq!(loudness_db(&[0.0; 100], 24_000), None);
  }

  #[test]
  fn quiet_speech_is_raised_toward_the_target_and_loud_left_alone() {
    assert!((level_gain_db(-23.0) - 5.0).abs() < 1e-6);
    assert_eq!(level_gain_db(-12.0), 0.0);
    assert_eq!(level_gain_db(-40.0), MAX_GAIN_DB);
    let mut samples = tone(0.1, 24_000);
    Leveller::default().apply(&mut samples, 24_000);
    let after = loudness_db(&samples, 24_000).unwrap();
    assert!((after - TARGET_DB).abs() < 0.3, "{after}");
  }

  #[test]
  fn the_limiter_bends_peaks_and_never_clips() {
    assert_eq!(limit(0.5), 0.5);
    assert_eq!(limit(-0.8), -0.8);
    assert!(limit(0.9) > 0.8 && limit(0.9) < 0.9);
    assert!(limit(5.0) <= 1.0 && limit(-5.0) >= -1.0);
    let mut samples = tone(0.6, 2400);
    Leveller::default().apply(&mut samples, 24_000);
    assert!(samples.iter().all(|sample| sample.abs() <= 1.0));
  }

  #[test]
  fn the_level_moves_gently_between_pieces() {
    let mut leveller = Leveller::default();
    let mut quiet = tone(0.05, 24_000);
    leveller.apply(&mut quiet, 24_000);
    let first = leveller.gain_db.unwrap();
    let mut loud = tone(0.4, 24_000);
    leveller.apply(&mut loud, 24_000);
    let second = leveller.gain_db.unwrap();
    assert!(second < first && second > level_gain_db(loudness_db(&tone(0.4, 24_000), 24_000).unwrap()));
  }

  #[test]
  fn edges_fade() {
    let mut samples = vec![1.0; 1000];
    soften_edges(&mut samples, 24_000);
    assert_eq!(samples[0], 0.0);
    assert_eq!(samples[999], 0.0);
    assert_eq!(samples[500], 1.0);
  }

  #[test]
  fn resampling_keeps_length_and_shape() {
    let input: Vec<f32> = (0..2400).map(|n| (n as f32 * 2.0 * std::f32::consts::PI * 440.0 / 24_000.0).sin()).collect();
    let output = resample(&input, 24_000, 48_000);
    assert_eq!(output.len(), 4800);
    assert_eq!(output.len(), resampled_len(input.len(), 24_000, 48_000));
    // Every other output sample is an input sample.
    for n in (0..4000).step_by(2) {
      assert!((output[n] - input[n / 2]).abs() < 1e-4);
    }
    // In between, close to the true sine.
    let truth = (101.0f32 / 2.0 * 2.0 * std::f32::consts::PI * 440.0 / 24_000.0).sin();
    assert!((output[101] - truth).abs() < 0.01);
    assert_eq!(resample(&input, 24_000, 44_100).len(), resampled_len(2400, 24_000, 44_100));
    assert_eq!(map_offset(24_000, 24_000, 48_000), 48_000);
  }

  #[test]
  fn sixteen_bit_round_trips() {
    let samples = vec![0.0, 0.5, -0.5, 1.0, -1.0];
    let back = from_i16(&to_i16(&samples));
    for (a, b) in samples.iter().zip(back.iter()) {
      assert!((a - b).abs() < 1e-4);
    }
    let wav = wav_bytes(&samples, 24_000);
    assert_eq!(&wav[..4], b"RIFF");
    assert_eq!(wav.len(), 44 + 10);
  }
}
