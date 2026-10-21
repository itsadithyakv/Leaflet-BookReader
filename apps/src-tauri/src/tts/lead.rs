//! How far ahead the voice must be before it may start: the same rule on
//! Android (Kotlin) and here.
//!
//! `r` is the real-time factor: seconds of work per second of speech. At
//! `r <= 0.85` the voice keeps up as it goes ("live"). Up to 2.5 it can still
//! read a chapter without a break if it starts once enough is made ahead
//! ("prepare"): with `A` seconds made and `D` seconds of the chapter left
//! (made or not), the rest takes `(D - A)·r` to make while `D` plays, which
//! never runs dry when `A >= D·(1 - 1/r)`; 15% more for the guess in `D`.
//! Past 2.5 the wait would be most of the chapter: not offered.

// (The lead rule is used where Leaflet makes the sound itself: Windows. Android runs the same rule in Kotlin.)
#![cfg_attr(not(any(test, studio_voice)), allow(dead_code))]

use serde::Serialize;

/// At or under this, live.
pub const LIVE_MAX_RTF: f64 = 0.85;
/// Over this, not offered.
pub const PREPARE_MAX_RTF: f64 = 2.5;
/// Headroom for the guess of how long the rest takes to say.
pub const LEAD_MARGIN: f64 = 1.15;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
  Live,
  Prepare,
  TooSlow,
}

pub fn mode_for(rtf: f64) -> Mode {
  if !rtf.is_finite() || rtf <= 0.0 {
    // Not measured: taken as live until it is.
    Mode::Live
  } else if rtf <= LIVE_MAX_RTF {
    Mode::Live
  } else if rtf <= PREPARE_MAX_RTF {
    Mode::Prepare
  } else {
    Mode::TooSlow
  }
}

/// Seconds that must be made before playing, of `remaining` seconds left in the chapter.
pub fn required_lead(remaining: f64, rtf: f64) -> f64 {
  if rtf.is_nan() || rtf <= 1.0 || remaining <= 0.0 {
    return 0.0;
  }
  remaining * (1.0 - 1.0 / rtf) * LEAD_MARGIN
}

/// Whether `lead` seconds made is enough to start.
pub fn ready(lead: f64, remaining: f64, rtf: f64) -> bool {
  lead + 1e-9 >= required_lead(remaining, rtf)
}

/// How long until it is (seconds), making the rest at `rtf`.
pub fn ready_in(lead: f64, remaining: f64, rtf: f64) -> f64 {
  let short = required_lead(remaining, rtf) - lead;
  if short <= 0.0 {
    0.0
  } else {
    short * rtf.max(0.0)
  }
}

/// A rolling average (the live RTF, the seconds per character).
#[derive(Debug, Clone, Copy)]
pub struct Rolling {
  value: Option<f64>,
  weight: f64,
}

impl Rolling {
  pub fn new(start: Option<f64>, weight: f64) -> Self {
    Rolling { value: start.filter(|v| v.is_finite() && *v > 0.0), weight }
  }

  pub fn add(&mut self, sample: f64) {
    if !sample.is_finite() || sample <= 0.0 {
      return;
    }
    self.value = Some(match self.value {
      None => sample,
      Some(old) => old + (sample - old) * self.weight,
    });
  }

  pub fn get(&self) -> Option<f64> {
    self.value
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn modes_follow_the_thresholds() {
    assert_eq!(mode_for(0.3), Mode::Live);
    assert_eq!(mode_for(0.85), Mode::Live);
    assert_eq!(mode_for(0.86), Mode::Prepare);
    assert_eq!(mode_for(2.5), Mode::Prepare);
    assert_eq!(mode_for(2.51), Mode::TooSlow);
    assert_eq!(mode_for(f64::NAN), Mode::Live);
  }

  #[test]
  fn a_voice_that_keeps_up_starts_at_once() {
    assert_eq!(required_lead(600.0, 0.5), 0.0);
    assert_eq!(required_lead(600.0, 1.0), 0.0);
    assert!(ready(0.0, 600.0, 0.9));
  }

  #[test]
  fn a_slow_voice_needs_part_of_the_chapter_made_first() {
    // r = 2: half the chapter, plus 15%.
    let need = required_lead(600.0, 2.0);
    assert!((need - 345.0).abs() < 1e-9, "{need}");
    assert!(!ready(300.0, 600.0, 2.0));
    assert!(ready(345.0, 600.0, 2.0));
    // 45 s short at r = 2: 90 s of work.
    assert!((ready_in(300.0, 600.0, 2.0) - 90.0).abs() < 1e-9);
    assert_eq!(ready_in(400.0, 600.0, 2.0), 0.0);
  }

  #[test]
  fn the_lead_never_runs_dry_when_the_rule_holds() {
    // Simulate: make at r, play at 1, start once ready; the made audio never falls behind.
    for &rtf in &[1.2, 1.6, 2.0, 2.5] {
      let total = 900.0;
      let mut made = 0.0;
      let mut clock = 0.0;
      let step = 0.5;
      while !ready(made, total, rtf) && made < total {
        made += step / rtf;
        clock += step;
      }
      let start = clock;
      let mut played = 0.0;
      while played < total {
        clock += step;
        made = (made + step / rtf).min(total);
        played = (clock - start).min(total);
        assert!(made + 1e-6 >= played, "ran dry at r={rtf}: made {made} played {played}");
      }
    }
  }

  #[test]
  fn the_rolling_average_moves_toward_new_samples() {
    let mut rolling = Rolling::new(None, 0.5);
    assert_eq!(rolling.get(), None);
    rolling.add(1.0);
    assert_eq!(rolling.get(), Some(1.0));
    rolling.add(2.0);
    assert_eq!(rolling.get(), Some(1.5));
    rolling.add(f64::NAN);
    assert_eq!(rolling.get(), Some(1.5));
    assert_eq!(Rolling::new(Some(0.0), 0.3).get(), None);
  }
}
