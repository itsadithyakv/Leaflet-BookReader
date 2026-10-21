//! What the speakers play: the made audio, piece by piece, with the news to
//! give the page as each place in it is reached (an item starting, each
//! sentence, an item done). The audio callback reads it; the synthesis
//! thread fills it. A chapter (an item's group) plays only once its gate is
//! open (`lead.rs`), so a slow device can make enough of it first.

use std::collections::{HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;

/// The page's `EngineEvent` (`apps/src/readers/readAloud/engine.ts`), plus `preparing`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EngineEvent {
  Start {
    id: String,
  },
  #[serde(rename_all = "camelCase")]
  Boundary {
    id: String,
    char_index: usize,
    kind: &'static str,
  },
  Done {
    id: String,
  },
  Error {
    id: Option<String>,
    message: String,
  },
  // (Android's: paused from outside the page. Not sent on Windows, where nothing outside pauses it.)
  #[allow(dead_code)]
  State {
    playing: bool,
  },
  #[allow(dead_code)]
  Stopped,
  /// A slow device making the chapter ahead before it starts (or carries on):
  /// about `seconds` to go (the page's `{type:"preparing",seconds}`, as Android
  /// sends it); `id`, the item it waits to start.
  Preparing {
    id: String,
    seconds: Option<u64>,
  },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mark {
  Start,
  /// A sentence starts at this offset of the item's text.
  Boundary(usize),
  Done,
}

#[derive(Debug)]
pub enum Audio {
  /// At the device's rate.
  Memory(Vec<f32>),
  /// 16-bit mono at the model's rate, in the cache folder until it is near.
  Disk(PathBuf),
}

/// Which piece of which reading it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Key {
  pub epoch: u64,
  pub item: usize,
  pub piece: usize,
}

#[derive(Debug)]
pub struct Segment {
  pub key: Key,
  pub id: Arc<str>,
  /// The chapter it belongs to (the item id's part before `:`).
  pub group: Arc<str>,
  pub audio: Audio,
  /// Frames at the device's rate.
  pub len: usize,
  /// Sorted by offset (frames at the device's rate; `len` for the end).
  pub marks: Vec<(usize, Mark)>,
}

pub struct Timeline {
  pub segments: VecDeque<Segment>,
  /// The frame of the front segment being played.
  pos: usize,
  /// The front segment's next mark.
  next_mark: usize,
  /// Playing (or paused).
  pub playing: bool,
  /// Gain against clicks when pausing or resuming mid-word.
  fade: f32,
  fade_step: f32,
  /// Chapters allowed to play.
  pub open: HashSet<Arc<str>>,
  /// Playback is held: at a closed gate, or a piece still on disk.
  pub waiting: bool,
  /// Playback ran out of made audio (the maker fell behind).
  pub ran_dry: bool,
  /// The device's rate.
  pub rate: u32,
  /// Which reading this is (a new one at each new reading, stop, or failure):
  /// news from the speakers carries it, and news of an older one is not passed on.
  pub reading: u64,
}

/// The group of an item id: "12:40" → "12" (the player's `section:n`), else the whole id.
pub fn group_of(id: &str) -> &str {
  id.split_once(':').map(|(group, _)| group).unwrap_or(id)
}

impl Timeline {
  pub fn new(rate: u32) -> Self {
    Timeline {
      segments: VecDeque::new(),
      pos: 0,
      next_mark: 0,
      playing: false,
      fade: 1.0,
      fade_step: 1.0 / (rate as f32 * 0.012),
      open: HashSet::new(),
      waiting: false,
      ran_dry: false,
      rate,
      reading: 1,
    }
  }

  /// What is heard from now on is a new reading's: news of the old one still on its way is dropped.
  pub fn new_reading(&mut self) {
    self.reading += 1;
  }

  pub fn set_rate(&mut self, rate: u32) {
    self.rate = rate;
    self.fade_step = 1.0 / (rate as f32 * 0.012);
  }

  /// Everything gone (a new reading, or stop): the files to delete.
  pub fn clear(&mut self) -> Vec<PathBuf> {
    let files = self
      .segments
      .drain(..)
      .filter_map(|segment| match segment.audio {
        Audio::Disk(path) => Some(path),
        Audio::Memory(_) => None,
      })
      .collect();
    self.pos = 0;
    self.next_mark = 0;
    self.open.clear();
    self.waiting = false;
    self.ran_dry = false;
    files
  }

  /// Keeps only the piece being played (a new speed or voice: the rest is made again).
  /// Returns the piece kept, and the files to delete.
  pub fn keep_front(&mut self) -> (Option<Key>, Vec<PathBuf>) {
    let front = self.segments.front().map(|segment| segment.key);
    let mut files = Vec::new();
    while self.segments.len() > 1 {
      if let Some(Segment { audio: Audio::Disk(path), .. }) = self.segments.pop_back() {
        files.push(path);
      }
    }
    (front, files)
  }

  pub fn push(&mut self, segment: Segment) {
    self.ran_dry = false;
    self.segments.push_back(segment);
  }

  /// Frames not yet played (in a group, or all).
  pub fn unplayed(&self, group: Option<&str>) -> usize {
    self
      .segments
      .iter()
      .enumerate()
      .filter(|(_, segment)| group.is_none_or(|group| &*segment.group == group))
      .map(|(index, segment)| if index == 0 { segment.len.saturating_sub(self.pos) } else { segment.len })
      .sum()
  }

  /// The group playback is at, and whether it may play.
  pub fn front_group(&self) -> Option<(Arc<str>, bool)> {
    self.segments.front().map(|segment| (segment.group.clone(), self.open.contains(&segment.group)))
  }

  /// The first item id of a group in the timeline.
  pub fn first_id_in(&self, group: &str) -> Option<Arc<str>> {
    self.segments.iter().find(|segment| &*segment.group == group).map(|segment| segment.id.clone())
  }

  /// Segments on disk that start within `window` frames of playback, with their keys.
  pub fn due_from_disk(&self, window: usize) -> Vec<(Key, PathBuf)> {
    let mut start = 0usize;
    let mut due = Vec::new();
    for (index, segment) in self.segments.iter().enumerate() {
      if start > window {
        break;
      }
      if let Audio::Disk(path) = &segment.audio {
        due.push((segment.key, path.clone()));
      }
      start += if index == 0 { segment.len.saturating_sub(self.pos) } else { segment.len };
    }
    due
  }

  /// A segment brought back from disk. False when it is no longer there.
  pub fn hydrate(&mut self, key: Key, samples: Vec<f32>) -> bool {
    match self.segments.iter_mut().find(|segment| segment.key == key) {
      Some(segment) => {
        segment.len = samples.len();
        segment.audio = Audio::Memory(samples);
        true
      }
      None => false,
    }
  }

  /// A piece whose file has gone (the cache was emptied): silence in its place, not a hold.
  pub fn hydrate_silent(&mut self, key: Key) {
    if let Some(segment) = self.segments.iter_mut().find(|segment| segment.key == key) {
      segment.audio = Audio::Memory(vec![0.0; segment.len]);
    }
  }

  /// Fills an interleaved buffer of `channels`, saying what was reached into `events`.
  pub fn fill(&mut self, out: &mut [f32], channels: usize, events: &mut Vec<EngineEvent>) {
    let channels = channels.max(1);
    for frame in out.chunks_mut(channels) {
      let sample = self.next_sample(events);
      frame.iter_mut().for_each(|slot| *slot = sample);
    }
  }

  fn emit_marks(&mut self, events: &mut Vec<EngineEvent>, through: usize) {
    let Some(front) = self.segments.front() else { return };
    while let Some(&(at, mark)) = front.marks.get(self.next_mark) {
      if at > through {
        break;
      }
      let id = front.id.to_string();
      events.push(match mark {
        Mark::Start => EngineEvent::Start { id },
        Mark::Boundary(char_index) => EngineEvent::Boundary { id, char_index, kind: "sentence" },
        Mark::Done => EngineEvent::Done { id },
      });
      self.next_mark += 1;
    }
  }

  fn next_sample(&mut self, events: &mut Vec<EngineEvent>) -> f32 {
    loop {
      let Some(front) = self.segments.front() else {
        self.waiting = false;
        return 0.0;
      };
      if !self.open.contains(&front.group) {
        self.waiting = true;
        return 0.0;
      }
      if !self.playing && self.fade <= 0.0 {
        return 0.0;
      }
      let len = front.len;
      if self.pos >= len {
        self.emit_marks(events, usize::MAX);
        self.segments.pop_front();
        self.pos = 0;
        self.next_mark = 0;
        if self.segments.is_empty() {
          self.ran_dry = true;
        }
        continue;
      }
      self.emit_marks(events, self.pos);
      let front = self.segments.front().expect("checked above");
      let sample = match &front.audio {
        Audio::Memory(samples) => samples.get(self.pos).copied().unwrap_or(0.0),
        Audio::Disk(_) => {
          // Not back from disk yet: hold here.
          self.waiting = true;
          return 0.0;
        }
      };
      self.waiting = false;
      self.pos += 1;
      if self.playing {
        self.fade = (self.fade + self.fade_step).min(1.0);
      } else {
        self.fade = (self.fade - self.fade_step).max(0.0);
      }
      return sample * self.fade;
    }
  }

  pub fn pause(&mut self) {
    self.playing = false;
    // Nothing being heard (not started, or held): nothing to fade out, so none
    // of what comes next is played, or said to have started, while paused.
    if self.segments.is_empty() || self.waiting {
      self.fade = 0.0;
    }
  }

  pub fn resume(&mut self) {
    if !self.playing {
      self.playing = true;
      // Fades back in from where it stopped.
      self.fade = 0.0;
    }
  }

  /// Starts afresh, playing (a new reading).
  pub fn start(&mut self) {
    self.playing = true;
    self.fade = 1.0;
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn segment(epoch: u64, item: usize, piece: usize, id: &str, len: usize, marks: Vec<(usize, Mark)>) -> Segment {
    Segment {
      key: Key { epoch, item, piece },
      id: Arc::from(id),
      group: Arc::from(group_of(id)),
      audio: Audio::Memory((0..len).map(|n| 0.5 + n as f32 * 1e-4).collect()),
      len,
      marks,
    }
  }

  fn play(timeline: &mut Timeline, frames: usize) -> Vec<EngineEvent> {
    let mut events = Vec::new();
    let mut out = vec![0.0; frames];
    timeline.fill(&mut out, 1, &mut events);
    events
  }

  #[test]
  fn groups_are_the_section() {
    assert_eq!(group_of("12:40"), "12");
    assert_eq!(group_of("12:40+31"), "12");
    assert_eq!(group_of("preview"), "preview");
  }

  #[test]
  fn events_come_as_their_samples_are_played() {
    let mut timeline = Timeline::new(1000);
    timeline.open.insert(Arc::from("1"));
    timeline.start();
    timeline.push(segment(1, 0, 0, "1:0", 100, vec![(10, Mark::Start), (10, Mark::Boundary(0))]));
    timeline.push(segment(1, 0, 1, "1:0", 100, vec![(0, Mark::Boundary(14)), (100, Mark::Done)]));
    assert!(play(&mut timeline, 10).is_empty());
    assert_eq!(
      play(&mut timeline, 1),
      vec![EngineEvent::Start { id: "1:0".into() }, EngineEvent::Boundary { id: "1:0".into(), char_index: 0, kind: "sentence" }]
    );
    assert!(play(&mut timeline, 89).is_empty());
    assert_eq!(play(&mut timeline, 1), vec![EngineEvent::Boundary { id: "1:0".into(), char_index: 14, kind: "sentence" }]);
    assert!(play(&mut timeline, 98).is_empty());
    // The last sample, then the end.
    assert_eq!(play(&mut timeline, 2), vec![EngineEvent::Done { id: "1:0".into() }]);
    assert!(timeline.segments.is_empty());
    assert!(timeline.ran_dry);
  }

  #[test]
  fn a_closed_chapter_holds_playback() {
    let mut timeline = Timeline::new(1000);
    timeline.start();
    timeline.push(segment(1, 0, 0, "2:0", 50, vec![(0, Mark::Start)]));
    assert!(play(&mut timeline, 20).is_empty());
    assert!(timeline.waiting);
    assert_eq!(timeline.unplayed(None), 50);
    timeline.open.insert(Arc::from("2"));
    assert_eq!(play(&mut timeline, 1), vec![EngineEvent::Start { id: "2:0".into() }]);
    assert!(!timeline.waiting);
  }

  #[test]
  fn pause_stops_at_the_sample_and_resume_goes_on_from_it() {
    let mut timeline = Timeline::new(1000);
    timeline.open.insert(Arc::from("1"));
    timeline.start();
    timeline.push(segment(1, 0, 0, "1:0", 1000, vec![(1000, Mark::Done)]));
    play(&mut timeline, 100);
    timeline.pause();
    // Fades out over 12 ms, then holds.
    play(&mut timeline, 50);
    let held = timeline.unplayed(None);
    play(&mut timeline, 200);
    assert_eq!(timeline.unplayed(None), held);
    assert!((1000 - 100 - 13..=1000 - 100 - 11).contains(&held), "{held}");
    timeline.resume();
    let mut out = vec![0.0; 5];
    timeline.fill(&mut out, 1, &mut Vec::new());
    // Fading back in.
    assert!(out[0] < out[4]);
    assert_eq!(timeline.unplayed(None), held - 5);
  }

  #[test]
  fn keeping_the_front_drops_what_was_made_ahead() {
    let mut timeline = Timeline::new(1000);
    timeline.push(segment(1, 0, 0, "1:0", 10, vec![]));
    timeline.push(segment(1, 0, 1, "1:0", 10, vec![]));
    let mut later = segment(1, 1, 0, "1:1", 10, vec![]);
    later.audio = Audio::Disk(PathBuf::from("x.pcm"));
    timeline.push(later);
    let (front, files) = timeline.keep_front();
    assert_eq!(front, Some(Key { epoch: 1, item: 0, piece: 0 }));
    assert_eq!(files, vec![PathBuf::from("x.pcm")]);
    assert_eq!(timeline.segments.len(), 1);
  }

  #[test]
  fn a_piece_on_disk_holds_until_it_is_back() {
    let mut timeline = Timeline::new(1000);
    timeline.open.insert(Arc::from("1"));
    timeline.start();
    let mut first = segment(1, 0, 0, "1:0", 10, vec![(0, Mark::Start)]);
    first.audio = Audio::Disk(PathBuf::from("a.pcm"));
    timeline.push(first);
    timeline.push(segment(1, 0, 1, "1:0", 10, vec![]));
    let due = timeline.due_from_disk(100);
    assert_eq!(due.len(), 1);
    play(&mut timeline, 5);
    assert!(timeline.waiting);
    assert_eq!(timeline.unplayed(None), 20);
    assert!(timeline.hydrate(due[0].0, vec![0.1; 10]));
    play(&mut timeline, 5);
    assert_eq!(timeline.unplayed(None), 15);
    assert!(!timeline.hydrate(Key { epoch: 9, item: 0, piece: 0 }, vec![]));
  }

  #[test]
  fn paused_before_anything_is_heard_nothing_starts() {
    let mut timeline = Timeline::new(1000);
    timeline.open.insert(Arc::from("1"));
    timeline.start();
    // Paused while the first piece is still being made.
    timeline.pause();
    timeline.push(segment(1, 0, 0, "1:0", 100, vec![(0, Mark::Start)]));
    let mut out = vec![1.0; 50];
    let mut events = Vec::new();
    timeline.fill(&mut out, 1, &mut events);
    assert!(events.is_empty(), "{events:?}");
    assert!(out.iter().all(|sample| *sample == 0.0));
    assert_eq!(timeline.unplayed(None), 100);
    timeline.resume();
    assert_eq!(play(&mut timeline, 1), vec![EngineEvent::Start { id: "1:0".into() }]);
  }

  #[test]
  fn interleaved_channels_get_the_same_sample() {
    let mut timeline = Timeline::new(1000);
    timeline.open.insert(Arc::from("1"));
    timeline.start();
    timeline.push(segment(1, 0, 0, "1:0", 4, vec![]));
    let mut out = vec![0.0; 8];
    timeline.fill(&mut out, 2, &mut Vec::new());
    assert_eq!(out[0], out[1]);
    assert_eq!(out[2], out[3]);
  }

  #[test]
  fn events_serialise_as_the_page_expects() {
    let json = serde_json::to_string(&EngineEvent::Boundary { id: "1:2".into(), char_index: 5, kind: "sentence" }).unwrap();
    assert_eq!(json, r#"{"type":"boundary","id":"1:2","charIndex":5,"kind":"sentence"}"#);
    let json = serde_json::to_string(&EngineEvent::Preparing { id: "3:0".into(), seconds: Some(42) }).unwrap();
    assert_eq!(json, r#"{"type":"preparing","id":"3:0","seconds":42}"#);
    let json = serde_json::to_string(&EngineEvent::Preparing { id: "3:0".into(), seconds: None }).unwrap();
    assert_eq!(json, r#"{"type":"preparing","id":"3:0","seconds":null}"#);
    assert_eq!(serde_json::to_string(&EngineEvent::Stopped).unwrap(), r#"{"type":"stopped"}"#);
    assert_eq!(serde_json::to_string(&EngineEvent::Error { id: None, message: "x".into() }).unwrap(), r#"{"type":"error","id":null,"message":"x"}"#);
  }
}
