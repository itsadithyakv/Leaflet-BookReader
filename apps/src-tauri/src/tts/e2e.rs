//! The real thing, end to end, without the app: the Kokoro pack from a
//! folder, through the engine's queue, into a WAV. Ignored by default (it
//! needs the ~367 MB pack and takes a while):
//!
//! ```text
//! set LEAFLET_STUDIO_PACK=<folder with model.onnx, voices.bin, … espeak-ng-data>
//! set LEAFLET_STUDIO_OUT=<folder for the WAV>
//! cargo test --lib tts::e2e -- --ignored --nocapture
//! ```
//!
//! `studio_voice_plays_through_the_speakers` plays two quiet seconds on the
//! default output device.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::dsp::{self, MODEL_RATE};
use super::native::{self, SherpaSynth};
use super::packs::{FileEntry, InstallInfo, Manifest, PACK_ID};
use super::player::{Engine, EngineConfig, Events, ItemIn, Output, CACHE_CAP_BYTES};
use super::text::utf16_len;
use super::timeline::{EngineEvent, Timeline};

const PARAGRAPH: [&str; 4] = [
  "The lamp was lit, and the rain had settled into a soft and steady hush against the window.",
  "She turned the page.",
  "Somewhere below, a door opened and closed again, and the house went back to its quiet.",
  "It was, she thought, the best kind of evening for a long book.",
];

struct Recorder;
impl Output for Recorder {
  fn rate(&self) -> u32 {
    MODEL_RATE
  }
  fn broken(&self) -> bool {
    false
  }
}

fn pack_dir() -> PathBuf {
  PathBuf::from(std::env::var("LEAFLET_STUDIO_PACK").expect("set LEAFLET_STUDIO_PACK to the pack folder"))
}

fn install_for(dir: &std::path::Path) -> InstallInfo {
  let pack = Manifest::shipped().pack(PACK_ID).unwrap().clone();
  InstallInfo {
    pack: pack.id.clone(),
    manifest_version: 1,
    variant: pack.variant.clone(),
    model: pack.chosen().model.clone(),
    bytes: super::packs::dir_size(dir),
    installed_at: "test".into(),
    files: pack.chosen().files.iter().map(|file| (file.path.clone(), FileEntry { size: file.size, sha256: file.sha256.clone() })).collect(),
    self_test: None,
    threads: None,
  }
}

#[test]
#[ignore]
fn studio_voice_reads_a_paragraph_into_a_wav() {
  let dir = pack_dir();
  let out_dir = PathBuf::from(std::env::var("LEAFLET_STUDIO_OUT").unwrap_or_else(|_| std::env::temp_dir().display().to_string()));
  let runtime = native::load_runtime().expect("the sherpa-onnx DLLs (target\\debug)");
  println!("runtime: {} (onnxruntime in use: {:?})", runtime.display(), native::onnxruntime_in_use());
  let pack = Manifest::shipped().pack(PACK_ID).unwrap().clone();
  let events = Arc::new(Mutex::new(Vec::<(Instant, EngineEvent)>::new()));
  let sink = events.clone();
  let cache = std::env::temp_dir().join(format!("leaflet-e2e-cache-{}", std::process::id()));
  let started = Instant::now();
  let engine = Engine::start(
    EngineConfig { pack, cache_dir: cache, rtf: None, cache_cap: CACHE_CAP_BYTES, fixed_rtf: None },
    Box::new(SherpaSynth::new(dir.clone(), install_for(&dir))),
    Box::new(|_: &Arc<Mutex<Timeline>>, _: &Events| Ok(Box::new(Recorder) as Box<dyn Output>)),
    Box::new(move |event| sink.lock().unwrap().push((Instant::now(), event))),
  );

  // The self-test first, as after a download (it loads the model).
  let (rtf, threads) = engine.self_test().expect("self-test");
  let loaded = started.elapsed();
  println!("self-test: RTF {rtf:.3} at {threads} threads (model load + test {:.1} s)", loaded.as_secs_f64());

  // A paragraph as the page gives it: one item, its sentences at `marks`.
  let text = PARAGRAPH.join(" ");
  let mut marks = Vec::new();
  let mut at = 0;
  for sentence in PARAGRAPH {
    marks.push(at);
    at += utf16_len(sentence) + 1;
  }
  let asked = Instant::now();
  engine.speak(
    vec![
      ItemIn { id: "3:0".into(), text: text.clone(), silence: None, marks: Some(marks.clone()) },
      ItemIn { id: "3:4".into(), text: "And then, at last, the chapter ended.".into(), silence: Some(400.0), marks: Some(vec![0]) },
    ],
    true,
  );
  let timeline = engine.timeline();
  let first_audio = loop {
    if !timeline.lock().unwrap().segments.is_empty() {
      break asked.elapsed();
    }
    assert!(asked.elapsed() < Duration::from_secs(60), "nothing made");
    std::thread::sleep(Duration::from_millis(5));
  };
  println!("first audio ready {:.2} s after speak (first clause on its own)", first_audio.as_secs_f64());

  // Play it as the speakers would, paced by the clock, to the end: the WAV, and where each event fell.
  let mut wav = Vec::new();
  let mut at_sample = Vec::new();
  let block = MODEL_RATE as usize / 50;
  // Half way through, a new speed, as the pill does it: the voice starts again from the sentence it is in.
  let mut speed_change: Option<(Instant, usize, usize)> = None;
  let mut dry: Vec<f64> = Vec::new();
  let play_started = Instant::now();
  let mut played_blocks = 0u64;
  loop {
    let due = (play_started.elapsed().as_millis() / 20) as u64;
    while played_blocks < due {
      played_blocks += 1;
      let mut out = vec![0.0f32; block];
      let mut reached = Vec::new();
      let empty = {
        let mut timeline = timeline.lock().unwrap();
        let before = timeline.unplayed(None);
        timeline.fill(&mut out, 1, &mut reached);
        before == 0
      };
      if empty && !engine.all_made() {
        dry.push(wav.len() as f64 / MODEL_RATE as f64);
      }
      for event in reached {
        at_sample.push((wav.len(), event));
      }
      wav.extend_from_slice(&out);
    }
    if speed_change.is_none() && wav.len() > MODEL_RATE as usize * 7 {
      let from = at_sample
        .iter()
        .filter_map(|(_, event)| match event {
          EngineEvent::Boundary { id, char_index, .. } if id == "3:0" => Some(*char_index),
          _ => None,
        })
        .next_back()
        .unwrap_or(0);
      let rest = &text[from..];
      let rest_marks: Vec<usize> = marks.iter().filter(|mark| **mark >= from).map(|mark| mark - from).collect();
      engine.set_rate(1.3);
      engine.speak(
        vec![
          ItemIn { id: "3:0".into(), text: rest.to_string(), silence: None, marks: Some(rest_marks) },
          ItemIn { id: "3:4".into(), text: "And then, at last, the chapter ended.".into(), silence: Some(400.0), marks: Some(vec![0]) },
        ],
        true,
      );
      speed_change = Some((Instant::now(), from, at_sample.len()));
    }
    let done = at_sample.iter().any(|(_, event)| matches!(event, EngineEvent::Done { id } if id == "3:4"));
    if done {
      break;
    }
    assert!(play_started.elapsed() < Duration::from_secs(120), "did not finish");
    std::thread::sleep(Duration::from_millis(5));
  }
  let (changed_at, from, events_before) = speed_change.expect("the speed changed");
  if let Some((sample, _)) = at_sample.iter().skip(events_before).find(|(_, event)| matches!(event, EngineEvent::Start { .. })) {
    println!(
      "speed 1.3x (from the sentence at {from}): heard again {:.2} s of playback after the change",
      (*sample as f64 / MODEL_RATE as f64) - ((changed_at - play_started).as_secs_f64())
    );
  }
  let audio_s = wav.len() as f64 / MODEL_RATE as f64;
  let mut spells: Vec<String> = dry.iter().map(|t| format!("{t:.1}")).collect();
  spells.dedup();
  println!("played {audio_s:.1} s of audio; ran dry for {:.2} s in all (at {})", dry.len() as f64 * 0.02, spells.join(", "));
  println!("live RTF after the paragraph: {:.3}", engine.rtf().unwrap_or(f64::NAN));
  println!("events at their samples:");
  for (sample, event) in &at_sample {
    println!("  {:>7.3} s  {}", *sample as f64 / MODEL_RATE as f64, serde_json::to_string(event).unwrap());
  }
  let mut boundaries: Vec<usize> = at_sample
    .iter()
    .enumerate()
    .filter_map(|(index, (_, event))| match event {
      // After the change, offsets of the text given again (from the sentence it was in).
      EngineEvent::Boundary { id, char_index, .. } if id == "3:0" => Some(char_index + if index >= events_before { from } else { 0 }),
      _ => None,
    })
    .collect();
  boundaries.dedup();
  assert_eq!(boundaries, marks, "a boundary at each sentence");
  let path = out_dir.join("studio-voice-e2e.wav");
  std::fs::write(&path, dsp::wav_bytes(&wav, MODEL_RATE)).unwrap();
  let loud = dsp::loudness_db(&wav, MODEL_RATE).unwrap_or(f32::NAN);
  let peak = wav.iter().fold(0f32, |most, sample| most.max(sample.abs()));
  println!("wrote {} (loudness {loud:.1} dB RMS-gated, peak {peak:.2})", path.display());
  drop(engine);
}

/// Two quiet seconds through the real speakers (cpal, WASAPI), with the timeline's events.
#[test]
#[ignore]
fn studio_voice_plays_through_the_speakers() {
  let timeline = Arc::new(Mutex::new(Timeline::new(MODEL_RATE)));
  let (tx, rx) = std::sync::mpsc::channel();
  let output = native::open_speakers(&timeline, &tx).expect("speakers");
  let rate = output.rate();
  println!("speakers at {rate} Hz");
  // A soft two-note chime, two seconds, made at the speakers' rate.
  let tone: Vec<f32> = (0..MODEL_RATE * 2)
    .map(|n| {
      let t = n as f32 / MODEL_RATE as f32;
      let note = if t < 1.0 { 523.25 } else { 659.25 };
      0.08 * (2.0 * std::f32::consts::PI * note * t).sin() * (1.0 - (t % 1.0)).powf(0.5)
    })
    .collect();
  let samples = dsp::resample(&tone, MODEL_RATE, rate);
  {
    let mut timeline = timeline.lock().unwrap();
    timeline.set_rate(rate);
    let group: Arc<str> = Arc::from("t");
    timeline.open.insert(group.clone());
    let len = samples.len();
    timeline.push(super::timeline::Segment {
      key: super::timeline::Key { epoch: 1, item: 0, piece: 0 },
      id: Arc::from("t:0"),
      group,
      audio: super::timeline::Audio::Memory(samples),
      len,
      marks: vec![(0, super::timeline::Mark::Start), (len, super::timeline::Mark::Done)],
    });
    timeline.start();
  }
  let started = Instant::now();
  let mut seen = Vec::new();
  while started.elapsed() < Duration::from_secs(4) {
    if let Ok((_, event)) = rx.recv_timeout(Duration::from_millis(100)) {
      println!("{:.3} s: {}", started.elapsed().as_secs_f64(), serde_json::to_string(&event).unwrap());
      let done = matches!(event, EngineEvent::Done { .. });
      seen.push(event);
      if done {
        break;
      }
    }
  }
  assert!(matches!(seen.first(), Some(EngineEvent::Start { .. })));
  assert!(matches!(seen.last(), Some(EngineEvent::Done { .. })), "{seen:?}");
  assert!(!output.broken());
}
