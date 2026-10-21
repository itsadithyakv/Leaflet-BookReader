//! The Studio voice's engine, apart from the model and the speakers (given
//! to it as a `Synth` and an `Opener`, so the tests run it on a fake):
//!
//! - a queue of items (the page's `speak`), cut into pieces (`text.rs`);
//! - one thread making the pieces in order, ahead of playback — about 30 s
//!   ahead when the device keeps up ("live"), the rest of the chapter, kept
//!   on disk, when it does not ("prepare", `lead.rs`);
//! - the made audio in a `Timeline`, read by the speakers' callback, which
//!   says when each item starts, each sentence, and when it is done;
//! - a thread bringing pieces back from disk as playback nears them;
//! - a thread handing the news on to the page.
//!
//! A new speed or voice drops what was made ahead (it is made again);
//! pausing holds at the sample. The model is loaded on first use and let go
//! after five minutes with nothing to say; the speakers, after 15 s.

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Deserialize;

use super::dsp::{self, MODEL_RATE};
use super::lead::{self, Mode, Rolling};
use super::packs::{PackSpec, VoiceSpec};
use super::text::{self, Piece};
use super::timeline::{group_of, Audio, EngineEvent, Key, Mark, Segment, Timeline};

/// Made ahead of playback when the device keeps up.
pub const LIVE_AHEAD_S: f64 = 30.0;
/// Kept in memory ahead of playback (more goes to disk, in prepare mode).
pub const MEMORY_WINDOW_S: f64 = 30.0;
/// The most the cache folder holds.
pub const CACHE_CAP_BYTES: u64 = 300 * 1024 * 1024;
/// The model is let go after this long with nothing to say.
pub const UNLOAD_AFTER: Duration = Duration::from_secs(5 * 60);
/// The speakers are let go after this long silent.
pub const CLOSE_OUTPUT_AFTER: Duration = Duration::from_secs(15);
/// After a sentence, before the next of the same item (at 1x).
pub const SENTENCE_GAP_MS: f32 = 140.0;
/// With less than this made ahead, the next piece is cut to take no longer than this to make.
pub const MIN_WORK_BUDGET_S: f64 = 0.6;
/// Seconds of speech per character at 1x, until measured.
pub const DEFAULT_SECONDS_PER_CHAR: f64 = 0.068;

/// Makes speech. `speak` loads the model when it must (for this voice's lexicon).
pub trait Synth: Send + 'static {
  fn speak(&mut self, text: &str, voice: &VoiceSpec, speed: f32) -> Result<Vec<f32>, String>;
  fn unload(&mut self);
  fn loaded(&self) -> bool;
  fn threads(&self) -> u32;
}

/// The speakers, as opened by an `Opener`.
pub trait Output {
  fn rate(&self) -> u32;
  /// The device went away (unplugged): opened again on the next piece.
  fn broken(&self) -> bool;
}

/// The news, each with the reading it is of (`Timeline::reading`, read under the
/// same lock as the timeline it came from): news of an older reading is dropped.
pub type Events = Sender<(u64, EngineEvent)>;

pub type Opener = Box<dyn FnMut(&Arc<Mutex<Timeline>>, &Events) -> Result<Box<dyn Output>, String> + Send>;

/// An item, as the page gives it.
#[derive(Debug, Clone, Deserialize)]
pub struct ItemIn {
  pub id: String,
  pub text: String,
  #[serde(default)]
  pub silence: Option<f64>,
  #[serde(default)]
  pub marks: Option<Vec<usize>>,
}

struct PlanItem {
  id: Arc<str>,
  group: Arc<str>,
  pieces: Vec<Piece>,
  silence_ms: f32,
  voice: Option<String>,
  rate: Option<f32>,
}

enum Job {
  SelfTest(Sender<Result<(f64, u32), String>>),
  Unload(Sender<()>),
}

struct Control {
  items: Vec<PlanItem>,
  /// The next piece to make: (item, piece).
  cursor: (usize, usize),
  /// Bumped whenever what is being made is no longer wanted.
  epoch: u64,
  rate: f32,
  voice: Option<String>,
  jobs: VecDeque<Job>,
  shutdown: bool,
}

struct Stats {
  rtf: Rolling,
  seconds_per_char: Rolling,
  last_preparing: Option<(Instant, u64)>,
}

struct Shared {
  control: Mutex<Control>,
  wake: Condvar,
  timeline: Arc<Mutex<Timeline>>,
  stats: Mutex<Stats>,
  cache_bytes: AtomicU64,
  /// The most the cache folder may hold.
  cache_cap: u64,
  /// A piece could not be written to the cache (the disk is full): what is made
  /// ahead stays in memory, so no more than a little is.
  disk_failed: AtomicBool,
  stop_loader: AtomicBool,
  events: Mutex<Events>,
  pack: PackSpec,
  fixed_rtf: Option<f64>,
  cache_dir: PathBuf,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
  mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Shared {
  fn rtf(&self) -> Option<f64> {
    self.fixed_rtf.or_else(|| lock(&self.stats).rtf.get())
  }

  /// Whether more may be made now, `ahead` seconds being made and not yet played.
  fn room(&self, mode: Mode, ahead: f64) -> bool {
    match mode {
      Mode::Live => ahead < LIVE_AHEAD_S,
      _ if self.disk_failed.load(Ordering::SeqCst) => ahead < MEMORY_WINDOW_S * 2.0,
      _ => self.cache_bytes.load(Ordering::SeqCst) < self.cache_cap,
    }
  }

  fn delete(&self, files: Vec<PathBuf>) {
    for file in files {
      let size = fs::metadata(&file).map(|meta| meta.len()).unwrap_or(0);
      if fs::remove_file(&file).is_ok() {
        self.cache_bytes.fetch_sub(size.min(self.cache_bytes.load(Ordering::SeqCst)), Ordering::SeqCst);
      }
    }
  }
}

pub struct Engine {
  shared: Arc<Shared>,
  threads: Vec<JoinHandle<()>>,
}

pub struct EngineConfig {
  pub pack: PackSpec,
  /// Where pieces made far ahead wait (emptied at start).
  pub cache_dir: PathBuf,
  /// The real-time factor measured before (the self-test), until it is measured live.
  pub rtf: Option<f64>,
  /// The most the cache folder holds (`CACHE_CAP_BYTES`).
  pub cache_cap: u64,
  /// Taken as the real-time factor whatever is measured (tests; trying a mode by hand).
  pub fixed_rtf: Option<f64>,
}

impl Engine {
  pub fn start(config: EngineConfig, synth: Box<dyn Synth>, opener: Opener, emit: Box<dyn Fn(EngineEvent) + Send>) -> Engine {
    let _ = fs::remove_dir_all(&config.cache_dir);
    let _ = fs::create_dir_all(&config.cache_dir);
    let (events_tx, events_rx) = mpsc::channel::<(u64, EngineEvent)>();
    let shared = Arc::new(Shared {
      control: Mutex::new(Control { items: Vec::new(), cursor: (0, 0), epoch: 1, rate: 1.0, voice: None, jobs: VecDeque::new(), shutdown: false }),
      wake: Condvar::new(),
      timeline: Arc::new(Mutex::new(Timeline::new(MODEL_RATE))),
      stats: Mutex::new(Stats { rtf: Rolling::new(config.rtf, 0.3), seconds_per_char: Rolling::new(None, 0.2), last_preparing: None }),
      cache_bytes: AtomicU64::new(0),
      cache_cap: config.cache_cap,
      disk_failed: AtomicBool::new(false),
      stop_loader: AtomicBool::new(false),
      events: Mutex::new(events_tx.clone()),
      pack: config.pack,
      fixed_rtf: config.fixed_rtf,
      cache_dir: config.cache_dir,
    });
    let forwarder_timeline = shared.timeline.clone();
    let forwarder = std::thread::Builder::new().name("studio-voice-events".into()).spawn(move || forward(events_rx, &forwarder_timeline, emit)).expect("thread");
    let worker_shared = shared.clone();
    let worker = std::thread::Builder::new()
      .name("studio-voice".into())
      .spawn(move || Worker { shared: worker_shared, synth, opener, output: None, events: events_tx, silent_since: None, last_work: Instant::now(), leveller: dsp::Leveller::default() }.run())
      .expect("thread");
    let loader_shared = shared.clone();
    let loader = std::thread::Builder::new().name("studio-voice-cache".into()).spawn(move || load_from_disk(loader_shared)).expect("thread");
    Engine { shared, threads: vec![worker, loader, forwarder] }
  }

  fn wake(&self) {
    self.shared.wake.notify_all();
  }

  /// Drops everything queued and made (a new reading, or stop): news of it still on its way is not passed on.
  fn reset(&self, control: &mut Control) {
    control.items.clear();
    control.cursor = (0, 0);
    control.epoch += 1;
    self.shared.disk_failed.store(false, Ordering::SeqCst);
    let files = {
      let mut timeline = lock(&self.shared.timeline);
      timeline.new_reading();
      timeline.clear()
    };
    self.shared.delete(files);
  }

  pub fn speak(&self, items: Vec<ItemIn>, replace: bool) {
    let mut control = lock(&self.shared.control);
    if replace {
      self.reset(&mut control);
      let mut timeline = lock(&self.shared.timeline);
      if items.is_empty() {
        timeline.pause();
      } else {
        timeline.start();
      }
    }
    let first_clause = replace;
    for (index, item) in items.into_iter().enumerate() {
      let marks = item.marks.unwrap_or_default();
      let group: Arc<str> = Arc::from(group_of(&item.id));
      control.items.push(PlanItem {
        pieces: text::pieces(&item.text, &marks, first_clause && index == 0),
        id: Arc::from(item.id.as_str()),
        group,
        silence_ms: item.silence.unwrap_or(0.0).max(0.0) as f32,
        voice: None,
        rate: None,
      });
    }
    drop(control);
    self.wake();
  }

  /// One sample sentence in a voice at a speed, instead of what was queued (Settings' ▶).
  pub fn preview(&self, voice: Option<String>, rate: f32, sample: &str) {
    let mut control = lock(&self.shared.control);
    self.reset(&mut control);
    lock(&self.shared.timeline).start();
    control.items.push(PlanItem {
      id: Arc::from("preview"),
      group: Arc::from("preview"),
      pieces: text::pieces(sample, &[0], true),
      silence_ms: 0.0,
      voice,
      rate: Some(clamp_rate(rate)),
    });
    drop(control);
    self.wake();
  }

  pub fn pause(&self) {
    lock(&self.shared.timeline).pause();
  }

  pub fn resume(&self) {
    lock(&self.shared.timeline).resume();
    self.wake();
  }

  pub fn stop(&self) {
    let mut control = lock(&self.shared.control);
    self.reset(&mut control);
    lock(&self.shared.timeline).pause();
  }

  /// What was made ahead goes; it is made again from the piece after the one playing.
  fn remake_ahead(&self, control: &mut Control) {
    control.epoch += 1;
    let (front, files) = lock(&self.shared.timeline).keep_front();
    self.shared.delete(files);
    if let Some(key) = front {
      control.cursor = next_after(&control.items, key.item, key.piece);
    }
  }

  pub fn set_rate(&self, rate: f32) {
    let mut control = lock(&self.shared.control);
    let rate = clamp_rate(rate);
    if (control.rate - rate).abs() < 1e-4 {
      return;
    }
    control.rate = rate;
    self.remake_ahead(&mut control);
    drop(control);
    self.wake();
  }

  pub fn set_voice(&self, voice: Option<String>) {
    let mut control = lock(&self.shared.control);
    if control.voice == voice {
      return;
    }
    control.voice = voice;
    self.remake_ahead(&mut control);
    drop(control);
    self.wake();
  }

  /// Warms the model, then times the sample sentence: (real-time factor, threads).
  pub fn self_test(&self) -> Result<(f64, u32), String> {
    let (tx, rx) = mpsc::channel();
    lock(&self.shared.control).jobs.push_back(Job::SelfTest(tx));
    self.wake();
    rx.recv_timeout(Duration::from_secs(300)).map_err(|_| "The self-test did not finish".to_string())?
  }

  /// Lets the model and the speakers go now (before the pack is removed).
  pub fn unload(&self) {
    self.stop();
    let (tx, rx) = mpsc::channel();
    lock(&self.shared.control).jobs.push_back(Job::Unload(tx));
    self.wake();
    let _ = rx.recv_timeout(Duration::from_secs(30));
  }

  /// The real-time factor as measured so far.
  pub fn rtf(&self) -> Option<f64> {
    self.shared.rtf()
  }

  /// For the tests: the timeline the speakers read.
  #[cfg(test)]
  pub fn timeline(&self) -> Arc<Mutex<Timeline>> {
    self.shared.timeline.clone()
  }

  /// For the tests: news as the speakers' callback sends it (of the reading
  /// `reading`, as it was when the samples were played).
  #[cfg(test)]
  pub fn speakers_said(&self, reading: u64, events: Vec<EngineEvent>) {
    let sender = lock(&self.shared.events).clone();
    for event in events {
      let _ = sender.send((reading, event));
    }
  }

  /// For the tests: the reading being heard.
  #[cfg(test)]
  pub fn reading(&self) -> u64 {
    lock(&self.shared.timeline).reading
  }

  /// For the tests: what the cache folder holds.
  #[cfg(test)]
  pub fn cache_bytes(&self) -> u64 {
    self.shared.cache_bytes.load(Ordering::SeqCst)
  }

  /// Whether every queued piece has been made.
  #[cfg(test)]
  pub fn all_made(&self) -> bool {
    let control = lock(&self.shared.control);
    control.cursor.0 >= control.items.len()
  }
}

impl Drop for Engine {
  fn drop(&mut self) {
    lock(&self.shared.control).shutdown = true;
    self.shared.stop_loader.store(true, Ordering::SeqCst);
    self.wake();
    // The forwarder ends when every sender is gone: the worker's, and this one.
    let (dead, _) = mpsc::channel();
    *lock(&self.shared.events) = dead;
    for thread in self.threads.drain(..) {
      let _ = thread.join();
    }
    let _ = fs::remove_dir_all(&self.shared.cache_dir);
  }
}

pub fn clamp_rate(rate: f32) -> f32 {
  if rate.is_finite() {
    rate.clamp(0.5, 3.0)
  } else {
    1.0
  }
}

/// The piece after (item, piece).
fn next_after(items: &[PlanItem], item: usize, piece: usize) -> (usize, usize) {
  match items.get(item) {
    Some(found) if piece + 1 < found.pieces.len() => (item, piece + 1),
    _ => (item + 1, 0),
  }
}

/// Hands the news on, but none of a reading that has since been stopped or replaced
/// (the speakers' callback may have gathered it just before).
fn forward(events: Receiver<(u64, EngineEvent)>, timeline: &Mutex<Timeline>, emit: Box<dyn Fn(EngineEvent) + Send>) {
  while let Ok((reading, event)) = events.recv() {
    if reading == lock(timeline).reading {
      emit(event);
    }
  }
}

/// Brings pieces back from disk as playback nears them.
fn load_from_disk(shared: Arc<Shared>) {
  while !shared.stop_loader.load(Ordering::SeqCst) {
    let (due, rate) = {
      let timeline = lock(&shared.timeline);
      let window = (MEMORY_WINDOW_S * 0.5 * timeline.rate as f64) as usize;
      (timeline.due_from_disk(window), timeline.rate)
    };
    for (key, path) in due {
      let Ok(bytes) = fs::read(&path) else {
        lock(&shared.timeline).hydrate_silent(key);
        continue;
      };
      let samples = dsp::resample(&dsp::from_i16(&bytes), MODEL_RATE, rate);
      lock(&shared.timeline).hydrate(key, samples);
      shared.delete(vec![path]);
    }
    std::thread::sleep(Duration::from_millis(150));
  }
}

/// A piece to make, taken from the queue.
struct Task {
  epoch: u64,
  item: usize,
  piece: usize,
  id: Arc<str>,
  group: Arc<str>,
  text: String,
  at: usize,
  sentence: bool,
  gap_after: bool,
  first_of_item: bool,
  last_of_item: bool,
  silent: bool,
  silence_ms: f32,
  voice: VoiceSpec,
  speed: f32,
}

enum Next {
  Job(Job),
  Piece(Task),
  Wait,
  Quit,
}

struct Worker {
  shared: Arc<Shared>,
  synth: Box<dyn Synth>,
  opener: Opener,
  output: Option<Box<dyn Output>>,
  events: Events,
  silent_since: Option<Instant>,
  last_work: Instant,
  leveller: dsp::Leveller,
}

impl Worker {
  fn run(mut self) {
    loop {
      match self.next() {
        Next::Quit => return,
        Next::Job(job) => self.job(job),
        Next::Piece(task) => {
          self.last_work = Instant::now();
          self.make(task);
          self.tick();
        }
        Next::Wait => {
          self.tick();
          let control = lock(&self.shared.control);
          if !control.shutdown && control.jobs.is_empty() {
            let _ = self.shared.wake.wait_timeout(control, Duration::from_millis(200));
          }
        }
      }
    }
  }

  fn next(&mut self) -> Next {
    let mut control = lock(&self.shared.control);
    if control.shutdown {
      return Next::Quit;
    }
    if let Some(job) = control.jobs.pop_front() {
      return Next::Job(job);
    }
    let (item_index, piece_index) = control.cursor;
    let Some(item) = control.items.get(item_index) else { return Next::Wait };
    let Some(piece) = item.pieces.get(piece_index) else {
      // An item with nothing in it: on to the next.
      control.cursor = (item_index + 1, 0);
      drop(control);
      return self.next();
    };
    // How far ahead it may go.
    let rtf = self.shared.rtf();
    let mode = rtf.map(lead::mode_for).unwrap_or(Mode::Live);
    let ahead = {
      let timeline = lock(&self.shared.timeline);
      timeline.unplayed(None) as f64 / timeline.rate as f64
    };
    if !self.shared.room(mode, ahead) {
      return Next::Wait;
    }
    // Live, with little made ahead (just started, or the voice fell behind): a long
    // piece is cut where a clause ends, so the next sound is ready before this runs out.
    if mode == Mode::Live && !piece.silent {
      let speed = item.rate.unwrap_or(control.rate).max(0.1) as f64;
      let seconds_per_char = lock(&self.shared.stats).seconds_per_char.get().unwrap_or(DEFAULT_SECONDS_PER_CHAR);
      let work_per_unit = seconds_per_char / speed * rtf.unwrap_or(0.5);
      let budget = ahead.max(MIN_WORK_BUDGET_S);
      if text::utf16_len(&piece.text) as f64 * work_per_unit > budget {
        if let Some((head, tail)) = text::split_piece(piece, (budget / work_per_unit) as usize) {
          let pieces = &mut control.items[item_index].pieces;
          pieces[piece_index] = head;
          pieces.insert(piece_index + 1, tail);
        }
      }
    }
    let item = &control.items[item_index];
    let piece = &item.pieces[piece_index];
    let voice = self.shared.pack.voice(item.voice.as_deref().or(control.voice.as_deref())).clone();
    Next::Piece(Task {
      epoch: control.epoch,
      item: item_index,
      piece: piece_index,
      id: item.id.clone(),
      group: item.group.clone(),
      text: piece.text.clone(),
      at: piece.at,
      sentence: piece.sentence,
      gap_after: piece.ends_sentence && piece_index + 1 < item.pieces.len(),
      first_of_item: piece_index == 0,
      last_of_item: piece_index + 1 == item.pieces.len(),
      silent: piece.silent,
      silence_ms: item.silence_ms,
      voice,
      speed: item.rate.unwrap_or(control.rate),
    })
  }

  fn job(&mut self, job: Job) {
    match job {
      Job::SelfTest(reply) => {
        let voice = self.shared.pack.voice(None).clone();
        let result = (|| {
          // Warm the model first: the first run is always slower.
          self.synth.speak("Hello.", &voice, 1.0)?;
          // Twice, keeping the better: a moment of other work on the computer is not its speed.
          let mut rtf = f64::INFINITY;
          for _ in 0..2 {
            let started = Instant::now();
            let samples = self.synth.speak(&self.shared.pack.sample, &voice, 1.0)?;
            let seconds = samples.len() as f64 / MODEL_RATE as f64;
            if seconds <= 0.0 {
              return Err("The voice said nothing".to_string());
            }
            rtf = rtf.min(started.elapsed().as_secs_f64() / seconds);
          }
          lock(&self.shared.stats).rtf = Rolling::new(Some(rtf), 0.3);
          Ok((rtf, self.synth.threads()))
        })();
        self.last_work = Instant::now();
        let _ = reply.send(result);
      }
      Job::Unload(reply) => {
        self.synth.unload();
        self.output = None;
        let _ = reply.send(());
      }
    }
  }

  /// The speakers, opened if they are not (or went away).
  fn ensure_output(&mut self) -> Result<u32, String> {
    if self.output.as_ref().is_some_and(|output| output.broken()) {
      self.output = None;
    }
    if self.output.is_none() {
      let output = (self.opener)(&self.shared.timeline, &self.events)?;
      let rate = output.rate();
      let mut control = lock(&self.shared.control);
      let mut timeline = lock(&self.shared.timeline);
      if timeline.rate != rate {
        timeline.set_rate(rate);
        if let Some(front) = timeline.segments.front().map(|segment| segment.key) {
          // Made for another device's rate (it changed): made again from the piece playing.
          let open = timeline.open.clone();
          let files = timeline.clear();
          timeline.open = open;
          self.shared.delete(files);
          control.epoch += 1;
          control.cursor = (front.item, front.piece);
        }
      }
      drop(timeline);
      drop(control);
      self.output = Some(output);
    }
    Ok(self.output.as_ref().map(|output| output.rate()).unwrap_or(MODEL_RATE))
  }

  /// A piece could not be made: the reading it was of is let go, and the page told
  /// (it reads on in another voice). Not when that reading is gone already (a new
  /// one, a new speed or voice, while it was made): the new one is left alone.
  fn fail(&mut self, task: &Task, message: String) {
    let mut control = lock(&self.shared.control);
    if control.epoch != task.epoch {
      return;
    }
    control.items.clear();
    control.cursor = (0, 0);
    control.epoch += 1;
    let (files, reading) = {
      let mut timeline = lock(&self.shared.timeline);
      timeline.new_reading();
      (timeline.clear(), timeline.reading)
    };
    drop(control);
    self.shared.delete(files);
    let _ = self.events.send((reading, EngineEvent::Error { id: Some(task.id.to_string()), message }));
  }

  fn make(&mut self, task: Task) {
    let device_rate = match self.ensure_output() {
      Ok(rate) => rate,
      Err(message) => return self.fail(&task, message),
    };
    // The speech, at the model's rate.
    let speech = if task.silent || task.text.is_empty() {
      Vec::new()
    } else {
      let started = Instant::now();
      match self.synth.speak(&task.text, &task.voice, task.speed) {
        Ok(mut samples) => {
          let seconds = samples.len() as f64 / MODEL_RATE as f64;
          if seconds >= 0.3 {
            let mut stats = lock(&self.shared.stats);
            stats.rtf.add(started.elapsed().as_secs_f64() / seconds);
            stats.seconds_per_char.add(seconds * task.speed as f64 / text::utf16_len(&task.text).max(1) as f64);
          }
          self.leveller.apply(&mut samples, MODEL_RATE);
          dsp::soften_edges(&mut samples, MODEL_RATE);
          samples
        }
        Err(message) => return self.fail(&task, message),
      }
    };
    let speed = task.speed.max(0.1);
    let pre = if task.first_of_item { dsp::silence(MODEL_RATE, task.silence_ms) } else { 0 };
    let post = if task.gap_after { dsp::silence(MODEL_RATE, SENTENCE_GAP_MS / speed) } else { 0 };
    let mut samples = vec![0.0f32; pre];
    samples.extend_from_slice(&speech);
    samples.extend(std::iter::repeat_n(0.0, post));
    let total = samples.len();
    let mut marks = Vec::new();
    if task.first_of_item {
      marks.push((pre, Mark::Start));
    }
    if task.sentence {
      marks.push((pre, Mark::Boundary(task.at)));
    }
    if task.last_of_item {
      marks.push((total, Mark::Done));
    }
    let len = dsp::resampled_len(total, MODEL_RATE, device_rate);
    let marks = marks.into_iter().map(|(at, mark)| (dsp::map_offset(at, MODEL_RATE, device_rate).min(len), mark)).collect();
    let key = Key { epoch: task.epoch, item: task.item, piece: task.piece };
    let far = {
      let timeline = lock(&self.shared.timeline);
      timeline.unplayed(None) as f64 / timeline.rate as f64 > MEMORY_WINDOW_S
    };
    let audio = if far && total > 0 {
      let path = self.shared.cache_dir.join(format!("{}-{}-{}.pcm", task.epoch, task.item, task.piece));
      let bytes = dsp::to_i16(&samples);
      match fs::write(&path, &bytes) {
        Ok(()) => {
          self.shared.cache_bytes.fetch_add(bytes.len() as u64, Ordering::SeqCst);
          Audio::Disk(path)
        }
        Err(_) => {
          // The disk is full (or the folder gone): kept in memory, and no more made far ahead.
          self.shared.disk_failed.store(true, Ordering::SeqCst);
          Audio::Memory(dsp::resample(&samples, MODEL_RATE, device_rate))
        }
      }
    } else {
      Audio::Memory(dsp::resample(&samples, MODEL_RATE, device_rate))
    };
    let segment = Segment { key, id: task.id.clone(), group: task.group.clone(), audio, len, marks };
    let mut control = lock(&self.shared.control);
    if control.epoch != task.epoch || control.cursor != (task.item, task.piece) {
      // No longer wanted (a new reading, speed or voice while it was made).
      if let Audio::Disk(path) = segment.audio {
        self.shared.delete(vec![path]);
      }
      return;
    }
    control.cursor = next_after(&control.items, task.item, task.piece);
    lock(&self.shared.timeline).push(segment);
    drop(control);
  }

  /// Seconds still to make in a group, from the cursor on (a guess from its length).
  fn unmade_seconds(&self, control: &Control, group: &str, rate: f32) -> (f64, bool) {
    let seconds_per_char = lock(&self.shared.stats).seconds_per_char.get().unwrap_or(DEFAULT_SECONDS_PER_CHAR);
    let (item_index, piece_index) = control.cursor;
    let mut chars = 0usize;
    let mut any = false;
    for (offset, item) in control.items.iter().enumerate().skip(item_index) {
      if &*item.group != group {
        if any || offset > item_index {
          break;
        }
        continue;
      }
      let from = if offset == item_index { piece_index } else { 0 };
      for piece in item.pieces.iter().skip(from) {
        any = true;
        chars += text::utf16_len(&piece.text);
      }
    }
    (chars as f64 * seconds_per_char / rate.max(0.1) as f64, any)
  }

  /// Opens the chapters that have enough made; tells the page how long the one waited on will be.
  fn tick(&mut self) {
    let rtf = self.shared.rtf().unwrap_or(0.5);
    {
      let control = lock(&self.shared.control);
      let mut timeline = lock(&self.shared.timeline);
      // Ran dry with more to make: the chapter waits again until enough is made.
      if timeline.ran_dry && timeline.segments.is_empty() {
        if let Some(item) = control.items.get(control.cursor.0) {
          if lead::mode_for(rtf) != Mode::Live {
            timeline.open.remove(&item.group);
          }
        }
        timeline.ran_dry = false;
      }
      let mut groups: Vec<Arc<str>> = Vec::new();
      for segment in &timeline.segments {
        if !timeline.open.contains(&segment.group) && !groups.contains(&segment.group) {
          groups.push(segment.group.clone());
        }
      }
      let front = timeline.front_group().map(|(group, _)| group);
      // No room to make more (the cache is full, or the disk): what is made plays now, or nothing ever would.
      let ahead = timeline.unplayed(None) as f64 / timeline.rate as f64;
      let full = !self.shared.room(lead::mode_for(rtf), ahead);
      for group in groups {
        let made = timeline.unplayed(Some(&group)) as f64 / timeline.rate as f64;
        let (unmade, pending) = self.unmade_seconds(&control, &group, control.rate);
        if !pending || full || lead::ready(made, made + unmade, rtf) {
          timeline.open.insert(group);
        } else if front.as_deref() == Some(&*group) {
          let ready_in = (lead::ready_in(made, made + unmade, rtf) * 1000.0) as u64;
          let mut stats = lock(&self.shared.stats);
          let due = stats.last_preparing.is_none_or(|(at, last)| at.elapsed() >= Duration::from_millis(900) || last.abs_diff(ready_in) >= 2000);
          if due {
            stats.last_preparing = Some((Instant::now(), ready_in));
            if let Some(id) = timeline.first_id_in(&group) {
              // Whole seconds, at least one while it waits (as Android says it).
              let seconds = ready_in.div_ceil(1000).max(1);
              let _ = self.events.send((timeline.reading, EngineEvent::Preparing { id: id.to_string(), seconds: Some(seconds) }));
            }
          }
        }
      }
    }
    // The speakers let go when silent a while; the model after longer.
    let silent = {
      let timeline = lock(&self.shared.timeline);
      timeline.segments.is_empty() || !timeline.playing
    };
    if silent {
      let since = *self.silent_since.get_or_insert_with(Instant::now);
      if self.output.is_some() && since.elapsed() >= CLOSE_OUTPUT_AFTER {
        self.output = None;
      }
    } else {
      self.silent_since = None;
    }
    if self.output.as_ref().is_some_and(|output| output.broken()) {
      self.output = None;
      let pending = !lock(&self.shared.timeline).segments.is_empty();
      if pending {
        let _ = self.ensure_output();
      }
    }
    let idle = {
      let control = lock(&self.shared.control);
      control.cursor.0 >= control.items.len()
    };
    if idle && silent && self.synth.loaded() && self.last_work.elapsed() >= UNLOAD_AFTER {
      self.synth.unload();
    }
  }
}

/// The cache folder for pieces made far ahead.
#[cfg_attr(not(studio_voice), allow(dead_code))]
pub fn cache_dir_under(cache_root: &Path) -> PathBuf {
  cache_root.join("studio-voice")
}

#[cfg(test)]
mod tests;
