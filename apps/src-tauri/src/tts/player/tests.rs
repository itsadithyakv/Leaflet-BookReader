//! The engine on a fake model and fake speakers: the tests play the
//! timeline by hand, as the speakers' callback would.

use super::*;
use crate::tts::packs::Manifest;
use std::sync::atomic::AtomicUsize;

/// Seconds of fake speech per character at 1x.
const FAKE_SPC: f64 = 0.05;
/// The fake speakers' rate (small, so the tests play quickly).
const RATE: u32 = 1_000;

#[derive(Clone, Default)]
struct Calls(Arc<Mutex<Vec<(String, String, f32)>>>);

struct FakeSynth {
  calls: Calls,
  loaded: Arc<AtomicBool>,
  delay: Duration,
  fail_on: Option<String>,
}

impl Synth for FakeSynth {
  fn speak(&mut self, text: &str, voice: &VoiceSpec, speed: f32) -> Result<Vec<f32>, String> {
    // (A failure takes its time too, as the model's does.)
    std::thread::sleep(self.delay);
    if self.fail_on.as_deref().is_some_and(|word| text.contains(word)) {
      return Err("the model failed".into());
    }
    self.loaded.store(true, Ordering::SeqCst);
    lock(&self.calls.0).push((text.to_string(), voice.id.clone(), speed));
    let seconds = text.chars().count() as f64 * FAKE_SPC / speed as f64;
    Ok(vec![0.05; (seconds * MODEL_RATE as f64) as usize])
  }
  fn unload(&mut self) {
    self.loaded.store(false, Ordering::SeqCst);
  }
  fn loaded(&self) -> bool {
    self.loaded.load(Ordering::SeqCst)
  }
  fn threads(&self) -> u32 {
    2
  }
}

struct FakeOutput;
impl Output for FakeOutput {
  fn rate(&self) -> u32 {
    RATE
  }
  fn broken(&self) -> bool {
    false
  }
}

struct Rig {
  engine: Engine,
  calls: Calls,
  events: Arc<Mutex<Vec<EngineEvent>>>,
  opened: Arc<AtomicUsize>,
  _cache: tempdir::Dir,
}

mod tempdir {
  use std::path::PathBuf;
  pub struct Dir(pub PathBuf);
  impl Dir {
    pub fn new(name: &str) -> Dir {
      let path = std::env::temp_dir().join(format!("leaflet-tts-{name}-{}-{:?}", std::process::id(), std::thread::current().id()));
      let _ = std::fs::remove_dir_all(&path);
      Dir(path)
    }
  }
  impl Drop for Dir {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.0);
    }
  }
}

fn rig(name: &str, fixed_rtf: Option<f64>, delay_ms: u64, fail_on: Option<&str>) -> Rig {
  rig_with(name, fixed_rtf, delay_ms, fail_on, CACHE_CAP_BYTES, None)
}

/// A rig with its own cache cap, and (`cache_at`) its cache folder at a path of the test's.
fn rig_with(name: &str, fixed_rtf: Option<f64>, delay_ms: u64, fail_on: Option<&str>, cache_cap: u64, cache_at: Option<PathBuf>) -> Rig {
  let pack = Manifest::shipped().pack("kokoro-v1").unwrap().clone();
  let cache = tempdir::Dir::new(name);
  let calls = Calls::default();
  let events = Arc::new(Mutex::new(Vec::new()));
  let opened = Arc::new(AtomicUsize::new(0));
  let sink = events.clone();
  let count = opened.clone();
  let engine = Engine::start(
    EngineConfig { pack, cache_dir: cache_at.unwrap_or_else(|| cache.0.join("studio-voice")), rtf: None, cache_cap, fixed_rtf },
    Box::new(FakeSynth { calls: calls.clone(), loaded: Arc::new(AtomicBool::new(false)), delay: Duration::from_millis(delay_ms), fail_on: fail_on.map(String::from) }),
    Box::new(move |_, _| {
      count.fetch_add(1, Ordering::SeqCst);
      Ok(Box::new(FakeOutput) as Box<dyn Output>)
    }),
    Box::new(move |event| lock(&sink).push(event)),
  );
  Rig { engine, calls, events, opened, _cache: cache }
}

fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
  let until = Instant::now() + Duration::from_secs(10);
  while !done() {
    assert!(Instant::now() < until, "timed out waiting for {what}");
    std::thread::sleep(Duration::from_millis(5));
  }
}

impl Rig {
  /// Plays `seconds` of the timeline, as the speakers would; the events it gave.
  fn play(&self, seconds: f64) -> Vec<EngineEvent> {
    let timeline = self.engine.timeline();
    let mut out = vec![0.0; (seconds * RATE as f64) as usize];
    let mut events = Vec::new();
    lock(&timeline).fill(&mut out, 1, &mut events);
    events
  }

  fn play_all(&self) -> Vec<EngineEvent> {
    let mut all = Vec::new();
    for _ in 0..2000 {
      all.extend(self.play(0.25));
      if self.engine.all_made() && lock(&self.engine.timeline()).segments.is_empty() {
        break;
      }
      std::thread::sleep(Duration::from_millis(1));
    }
    all
  }

  fn said(&self) -> Vec<String> {
    lock(&self.calls.0).iter().map(|(text, _, _)| text.clone()).collect()
  }

  fn emitted(&self) -> Vec<EngineEvent> {
    // The forwarder runs on its own thread.
    std::thread::sleep(Duration::from_millis(30));
    lock(&self.events).clone()
  }
}

fn item(id: &str, text: &str, marks: &[usize]) -> ItemIn {
  ItemIn { id: id.into(), text: text.into(), silence: None, marks: Some(marks.to_vec()) }
}

#[test]
fn an_item_starts_says_each_sentence_and_ends() {
  let rig = rig("basic", None, 0, None);
  rig.engine.speak(vec![item("4:0", "It was late. The rain had stopped.", &[0, 13]), item("4:2", "Nobody came.", &[0])], true);
  wait_for("the queue to be made", || rig.engine.all_made());
  let events = rig.play_all();
  let id = |id: &str| id.to_string();
  assert_eq!(
    events,
    vec![
      EngineEvent::Start { id: id("4:0") },
      EngineEvent::Boundary { id: id("4:0"), char_index: 0, kind: "sentence" },
      EngineEvent::Boundary { id: id("4:0"), char_index: 13, kind: "sentence" },
      EngineEvent::Done { id: id("4:0") },
      EngineEvent::Start { id: id("4:2") },
      EngineEvent::Boundary { id: id("4:2"), char_index: 0, kind: "sentence" },
      EngineEvent::Done { id: id("4:2") },
    ]
  );
  assert_eq!(rig.said(), ["It was late.", "The rain had stopped.", "Nobody came."]);
  assert_eq!(rig.opened.load(Ordering::SeqCst), 1);
}

#[test]
fn a_sentence_boundary_comes_at_its_sample() {
  let rig = rig("timing", None, 0, None);
  // 12 chars of fake speech: 0.6 s; then the gap between sentences.
  rig.engine.speak(vec![item("1:0", "It was late. More.", &[0, 13])], true);
  wait_for("made", || rig.engine.all_made());
  let early = rig.play(0.55);
  assert!(!early.iter().any(|event| matches!(event, EngineEvent::Boundary { char_index: 13, .. })));
  let gap = (SENTENCE_GAP_MS as f64) / 1000.0;
  let later = rig.play(0.05 + gap + 0.01);
  assert!(later.iter().any(|event| matches!(event, EngineEvent::Boundary { char_index: 13, .. })), "{later:?}");
}

#[test]
fn the_first_clause_is_made_on_its_own_after_play() {
  let rig = rig("clause", None, 0, None);
  let text = "When the morning came at last, grey and cold over the hills, she rose and went out to the gate.";
  rig.engine.speak(vec![item("1:0", text, &[0]), item("1:1", text, &[0])], true);
  wait_for("made", || rig.engine.all_made());
  let said = rig.said();
  assert_eq!(said[0], "When the morning came at last,");
  // Only the first item of a new reading.
  assert_eq!(said.last().unwrap(), text);
  let events = rig.play_all();
  // One boundary for the sentence, not one per piece.
  assert_eq!(events.iter().filter(|event| matches!(event, EngineEvent::Boundary { id, .. } if id == "1:0")).count(), 1);
}

#[test]
fn silence_before_an_item_is_kept() {
  let rig = rig("silence", None, 0, None);
  rig.engine.speak(vec![ItemIn { id: "1:0".into(), text: "Hello there.".into(), silence: Some(400.0), marks: Some(vec![0]) }], true);
  wait_for("made", || rig.engine.all_made());
  assert!(rig.play(0.39).is_empty());
  assert!(matches!(rig.play(0.02).first(), Some(EngineEvent::Start { .. })));
}

#[test]
fn a_new_speed_drops_what_was_made_ahead_and_makes_it_again() {
  let rig = rig("rate", None, 0, None);
  rig.engine.speak(vec![item("1:0", "One two three.", &[0]), item("1:1", "Four five six.", &[0]), item("1:2", "Seven eight.", &[0])], true);
  wait_for("made", || rig.engine.all_made());
  rig.play(0.1);
  rig.engine.set_rate(1.5);
  wait_for("made again", || rig.engine.all_made());
  let calls = lock(&rig.calls.0).clone();
  // The piece playing is kept; the two after it are made again at 1.5x.
  let fast: Vec<&str> = calls.iter().filter(|(_, _, speed)| (*speed - 1.5).abs() < 1e-6).map(|(text, _, _)| text.as_str()).collect();
  assert_eq!(fast, ["Four five six.", "Seven eight."]);
  let events = rig.play_all();
  let done: Vec<String> = events.iter().filter_map(|event| if let EngineEvent::Done { id } = event { Some(id.clone()) } else { None }).collect();
  assert_eq!(done, ["1:0", "1:1", "1:2"]);
}

#[test]
fn a_new_voice_is_heard_from_the_next_piece() {
  let rig = rig("voice", None, 0, None);
  rig.engine.speak(vec![item("1:0", "One two three.", &[0]), item("1:1", "Four five six.", &[0])], true);
  wait_for("made", || rig.engine.all_made());
  rig.play(0.1);
  rig.engine.set_voice(Some("neural:bf_emma".into()));
  wait_for("made again", || rig.engine.all_made());
  let calls = lock(&rig.calls.0).clone();
  assert_eq!(calls.last().unwrap().1, "neural:bf_emma");
  assert_eq!(calls[0].1, "neural:af_heart");
}

#[test]
fn a_new_reading_replaces_the_old_one_even_mid_making() {
  let rig = rig("replace", None, 30, None);
  rig.engine.speak((0..6).map(|n| item(&format!("1:{n}"), "A sentence of some length.", &[0])).collect(), true);
  std::thread::sleep(Duration::from_millis(40));
  rig.engine.speak(vec![item("9:0", "Somewhere else.", &[0])], true);
  wait_for("made", || rig.engine.all_made());
  let events = rig.play_all();
  let ids: Vec<String> = events
    .iter()
    .filter_map(|event| match event {
      EngineEvent::Start { id } | EngineEvent::Done { id } => Some(id.clone()),
      _ => None,
    })
    .collect();
  assert_eq!(ids, ["9:0", "9:0"]);
}

#[test]
fn pause_holds_and_resume_carries_on() {
  let rig = rig("pause", None, 0, None);
  rig.engine.speak(vec![item("1:0", "A fairly long sentence to say here.", &[0])], true);
  wait_for("made", || rig.engine.all_made());
  rig.play(0.2);
  rig.engine.pause();
  rig.play(0.1);
  let held = lock(&rig.engine.timeline()).unplayed(None);
  rig.play(1.0);
  assert_eq!(lock(&rig.engine.timeline()).unplayed(None), held);
  rig.engine.resume();
  assert!(rig.play_all().iter().any(|event| matches!(event, EngineEvent::Done { .. })));
}

#[test]
fn stop_empties_everything() {
  let rig = rig("stop", None, 0, None);
  rig.engine.speak(vec![item("1:0", "Hello.", &[0])], true);
  wait_for("made", || rig.engine.all_made());
  rig.engine.stop();
  assert!(lock(&rig.engine.timeline()).segments.is_empty());
  assert!(rig.play(0.5).is_empty());
}

#[test]
fn queued_items_follow_on() {
  let rig = rig("append", None, 0, None);
  rig.engine.speak(vec![item("1:0", "First.", &[0])], true);
  rig.engine.speak(vec![item("1:1", "Second.", &[0])], false);
  wait_for("made", || rig.engine.all_made());
  let events = rig.play_all();
  assert!(matches!(events.last(), Some(EngineEvent::Done { id }) if id == "1:1"));
}

#[test]
fn a_model_failure_is_said_once_and_the_queue_let_go() {
  let rig = rig("fail", None, 0, Some("broken"));
  rig.engine.speak(vec![item("1:0", "This is broken.", &[0]), item("1:1", "And this.", &[0])], true);
  wait_for("the error", || rig.emitted().iter().any(|event| matches!(event, EngineEvent::Error { .. })));
  let errors: Vec<_> = rig.emitted().into_iter().filter(|event| matches!(event, EngineEvent::Error { .. })).collect();
  assert_eq!(errors, vec![EngineEvent::Error { id: Some("1:0".into()), message: "the model failed".into() }]);
  assert!(rig.engine.all_made());
  assert!(rig.said().is_empty());
}

#[test]
fn a_slow_device_prepares_the_chapter_before_it_plays() {
  // r = 2: half the chapter (plus 15%) must be made first.
  let rig = rig("prepare", Some(2.0), 0, None);
  let sentence = "This is one sentence of the chapter, said in order.";
  let items: Vec<ItemIn> = (0..20).map(|n| item(&format!("7:{n}"), sentence, &[0])).collect();
  rig.engine.speak(items, true);
  // Held at the gate while it is made, telling the page how long.
  let first = rig.play(0.2);
  assert!(first.is_empty(), "{first:?}");
  wait_for("made", || rig.engine.all_made());
  wait_for("the gate", || lock(&rig.engine.timeline()).open.contains("7"));
  let preparing: Vec<_> = rig.emitted().into_iter().filter(|event| matches!(event, EngineEvent::Preparing { .. })).collect();
  assert!(!preparing.is_empty());
  match &preparing[0] {
    EngineEvent::Preparing { id, seconds } => {
      assert_eq!(id, "7:0");
      assert!(seconds.is_some_and(|seconds| seconds >= 1), "{seconds:?}");
    }
    _ => unreachable!(),
  }
  assert!(matches!(rig.play(0.3).first(), Some(EngineEvent::Start { id }) if id == "7:0"));
}

#[test]
fn a_device_that_keeps_up_starts_at_once_and_only_makes_a_little_ahead() {
  let rig = rig("live", Some(0.4), 0, None);
  let sentence = "A sentence of about a second and a half of speech, or so.";
  rig.engine.speak((0..60).map(|n| item(&format!("2:{n}"), sentence, &[0])).collect(), true);
  wait_for("the first piece", || !lock(&rig.engine.timeline()).segments.is_empty());
  assert!(matches!(rig.play(0.1).first(), Some(EngineEvent::Start { .. })));
  std::thread::sleep(Duration::from_millis(200));
  // About 30 s ahead, not all 60 items (~170 s).
  let ahead = lock(&rig.engine.timeline()).unplayed(None) as f64 / RATE as f64;
  assert!((LIVE_AHEAD_S - 0.1..LIVE_AHEAD_S + 5.0).contains(&ahead), "{ahead}");
  assert!(!rig.engine.all_made());
  assert!(rig.emitted().iter().all(|event| !matches!(event, EngineEvent::Preparing { .. })));
}

#[test]
fn far_ahead_goes_to_disk_and_comes_back_in_time() {
  let rig = rig("disk", Some(1.5), 0, None);
  let sentence = "A sentence of about a second and a half of speech, or so.";
  rig.engine.speak((0..40).map(|n| item(&format!("3:{n}"), sentence, &[0])).collect(), true);
  wait_for("made", || rig.engine.all_made());
  assert!(rig.engine.cache_bytes() > 0);
  let on_disk = lock(&rig.engine.timeline()).segments.iter().filter(|segment| matches!(segment.audio, Audio::Disk(_))).count();
  assert!(on_disk > 0);
  wait_for("the gate", || lock(&rig.engine.timeline()).open.contains("3"));
  // Played through, every item is heard (the loader brings each back before it is due).
  let mut done = 0;
  for _ in 0..4000 {
    done += rig.play(0.05).iter().filter(|event| matches!(event, EngineEvent::Done { .. })).count();
    if done == 40 {
      break;
    }
    std::thread::sleep(Duration::from_micros(500));
  }
  assert_eq!(done, 40);
  wait_for("the cache emptied", || rig.engine.cache_bytes() == 0);
}

#[test]
fn the_self_test_warms_then_times_the_sample() {
  let rig = rig("selftest", None, 0, None);
  let (rtf, threads) = rig.engine.self_test().unwrap();
  assert!(rtf > 0.0 && rtf < 1.0, "{rtf}");
  assert_eq!(threads, 2);
  let said = rig.said();
  assert_eq!(said[0], "Hello.");
  assert!(said[1].starts_with("The lamp was lit") && said[2] == said[1]);
  assert_eq!(rig.engine.rtf(), Some(rtf));
}

#[test]
fn a_preview_says_the_sample_in_its_voice_and_speed() {
  let rig = rig("preview", None, 0, None);
  rig.engine.preview(Some("neural:am_michael".into()), 1.3, "One sample line, for the ear.");
  wait_for("made", || rig.engine.all_made());
  let calls = lock(&rig.calls.0).clone();
  assert!(calls.iter().all(|(_, voice, speed)| voice == "neural:am_michael" && (*speed - 1.3).abs() < 1e-6));
  assert!(matches!(rig.play_all().last(), Some(EngineEvent::Done { id }) if id == "preview"));
}

#[test]
fn unloading_lets_the_model_go() {
  let rig = rig("unload", None, 0, None);
  rig.engine.self_test().unwrap();
  rig.engine.unload();
  // A new reading loads it again.
  rig.engine.speak(vec![item("1:0", "Again.", &[0])], true);
  wait_for("made", || rig.engine.all_made());
  assert!(rig.said().iter().any(|text| text == "Again."));
}

#[test]
fn news_of_a_reading_stopped_is_not_passed_on() {
  let rig = rig("stale", None, 0, None);
  rig.engine.speak(vec![item("1:0", "Hello there, again.", &[0])], true);
  wait_for("made", || rig.engine.all_made());
  // The speakers' callback gathers the start just as the page stops the reading.
  let reading = rig.engine.reading();
  let heard = rig.play(0.05);
  assert!(matches!(heard.first(), Some(EngineEvent::Start { .. })));
  rig.engine.stop();
  rig.engine.speakers_said(reading, heard.clone());
  assert!(rig.emitted().is_empty(), "{:?}", rig.emitted());
  // A new reading of the same item: its own news comes, the old reading's does not.
  rig.engine.speak(vec![item("1:0", "Hello there, again.", &[0])], true);
  wait_for("made", || rig.engine.all_made());
  rig.engine.speakers_said(reading, vec![EngineEvent::Done { id: "1:0".into() }]);
  let now = rig.engine.reading();
  assert_ne!(now, reading);
  rig.engine.speakers_said(now, rig.play(0.05));
  assert_eq!(rig.emitted(), vec![EngineEvent::Start { id: "1:0".into() }, EngineEvent::Boundary { id: "1:0".into(), char_index: 0, kind: "sentence" }]);
}

#[test]
fn a_failure_of_a_reading_already_replaced_leaves_the_new_one_alone() {
  // The old reading's piece fails while the new reading is asked for.
  let rig = rig("stale-fail", None, 150, Some("broken"));
  rig.engine.speak(vec![item("1:0", "This is broken.", &[0])], true);
  std::thread::sleep(Duration::from_millis(40));
  rig.engine.speak(vec![item("2:0", "Somewhere else entirely.", &[0])], true);
  wait_for("made", || rig.engine.all_made() && !lock(&rig.engine.timeline()).segments.is_empty());
  let events = rig.play_all();
  assert!(events.iter().any(|event| matches!(event, EngineEvent::Done { id } if id == "2:0")), "{events:?}");
  assert!(rig.emitted().iter().all(|event| !matches!(event, EngineEvent::Error { .. })), "{:?}", rig.emitted());
}

#[test]
fn paused_while_the_first_piece_is_made_nothing_starts_until_resumed() {
  let rig = rig("pause-early", None, 60, None);
  rig.engine.speak(vec![item("1:0", "A first sentence to say.", &[0])], true);
  rig.engine.pause();
  wait_for("made", || rig.engine.all_made() && !lock(&rig.engine.timeline()).segments.is_empty());
  assert!(rig.play(0.3).is_empty());
  rig.engine.resume();
  assert!(matches!(rig.play(0.05).first(), Some(EngineEvent::Start { .. })));
}

/// A chapter too long for the lead to fit in the cache.
fn long_chapter() -> Vec<ItemIn> {
  let sentence = "This is one sentence of a very long chapter, said in order.";
  (0..120).map(|n| item(&format!("5:{n}"), sentence, &[0])).collect()
}

#[test]
fn a_chapter_whose_lead_does_not_fit_in_the_cache_plays_once_the_cache_is_full() {
  // r = 2 wants about 200 s made of a 350 s chapter; the cache holds a few seconds past the 30 in memory.
  let rig = rig_with("cache-full", Some(2.0), 0, None, 200_000, None);
  rig.engine.speak(long_chapter(), true);
  wait_for("the gate", || lock(&rig.engine.timeline()).open.contains("5"));
  assert!(!rig.engine.all_made());
  assert!(rig.engine.cache_bytes() >= 200_000);
  assert!(matches!(rig.play(0.3).first(), Some(EngineEvent::Start { id }) if id == "5:0"));
}

#[test]
fn with_the_disk_full_a_slow_device_keeps_only_a_little_in_memory_and_plays() {
  // The cache folder cannot be made: a file is where it should be.
  let dir = tempdir::Dir::new("disk-full");
  std::fs::create_dir_all(&dir.0).unwrap();
  let in_the_way = dir.0.join("studio-voice");
  std::fs::write(&in_the_way, b"a file, not a folder").unwrap();
  let rig = rig_with("disk-full-rig", Some(2.0), 0, None, CACHE_CAP_BYTES, Some(in_the_way.clone()));
  rig.engine.speak(long_chapter(), true);
  wait_for("the gate", || lock(&rig.engine.timeline()).open.contains("5"));
  std::thread::sleep(Duration::from_millis(100));
  let ahead = lock(&rig.engine.timeline()).unplayed(None) as f64 / RATE as f64;
  assert!(ahead < MEMORY_WINDOW_S * 2.0 + 5.0, "{ahead} s in memory");
  assert!(!rig.engine.all_made());
  assert!(matches!(rig.play(0.3).first(), Some(EngineEvent::Start { id }) if id == "5:0"));
}
