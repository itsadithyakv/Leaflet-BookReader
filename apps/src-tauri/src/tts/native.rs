//! The Studio voice's model and speakers on Windows: sherpa-onnx (Kokoro)
//! behind `Synth`, cpal (WASAPI) behind `Output`.
//!
//! sherpa-onnx comes as two DLLs next to `leaflet.exe` (`sherpa-onnx-c-api.dll`,
//! `onnxruntime.dll`), delay-loaded (build.rs): Leaflet starts without them,
//! and they are loaded by full path from its own folder on first use, so
//! Windows' own `System32\onnxruntime.dll` is never picked up instead. If
//! they are missing, the Studio voice says it cannot speak; nothing else changes.
//!
//! ## The engine version, in one place
//!
//! sherpa-onnx 1.x turns text into phonemes itself (its lexicons, and
//! espeak-ng — GPL-3.0 — for words not in them). 2.0 drops espeak-ng and
//! skips words not in the lexicon, but takes phonemes made elsewhere
//! (`GenerationConfig.tokens`). Text reaches the model through a
//! `Phonemizer`: today `EngineOwn` (1.x, the text as it is); with 2.0, a G2P
//! of Leaflet's own giving `ModelInput::Phonemes`. Moving to 2.0 is the
//! crate version in Cargo.toml, `SHERPA_ONNX_VERSION` and `TAKES_PHONEMES`
//! here, the `Phonemes` arm of `SherpaSynth::speak`, and the pack (no
//! `espeak-ng-data`). See docs/studio-voice.md.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SizedSample};

use super::dsp::{self, MODEL_RATE};
use super::packs::{InstallInfo, VoiceSpec};
use super::player::{Events, Output, Synth};
use super::timeline::{EngineEvent, Timeline};

/// The sherpa-onnx the app is built against (the `sherpa-onnx` crate's version).
pub const SHERPA_ONNX_VERSION: &str = "1.13.8";
/// Whether this engine version takes phonemes from outside (2.0's `tokens`).
pub const TAKES_PHONEMES: bool = false;

// ---- the runtime DLLs -------------------------------------------------------

pub const SHERPA_DLL: &str = "sherpa-onnx-c-api.dll";
pub const ONNXRUNTIME_DLL: &str = "onnxruntime.dll";

/// Where to look for the DLLs: next to the exe, and only there in a release
/// build (code is loaded from Leaflet's own folder alone). A debug or test
/// build also looks in `LEAFLET_SHERPA_DIR` and the folder above the exe (a
/// test binary runs from `target\debug\deps`).
fn candidates() -> Vec<PathBuf> {
  let mut out = Vec::new();
  let dev = cfg!(any(test, debug_assertions));
  if dev {
    if let Some(dir) = std::env::var_os("LEAFLET_SHERPA_DIR") {
      out.push(PathBuf::from(dir));
    }
  }
  if let Ok(exe) = std::env::current_exe() {
    if let Some(dir) = exe.parent() {
      out.push(dir.to_path_buf());
      if dev {
        if let Some(up) = dir.parent() {
          out.push(up.to_path_buf());
        }
      }
    }
  }
  // Only full paths (a relative one would be searched for).
  out.retain(|dir| dir.is_absolute());
  out
}

#[cfg(windows)]
fn load_by_path(path: &Path) -> Result<(), String> {
  use windows::core::HSTRING;
  use windows::Win32::System::LibraryLoader::{LoadLibraryExW, LOAD_WITH_ALTERED_SEARCH_PATH};
  // SAFETY: loading a DLL by its full path; it stays loaded for the life of the process.
  unsafe { LoadLibraryExW(&HSTRING::from(path.as_os_str()), None, LOAD_WITH_ALTERED_SEARCH_PATH) }
    .map(|_| ())
    .map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(not(windows))]
fn load_by_path(_path: &Path) -> Result<(), String> {
  Ok(())
}

/// Whether the DLLs are there to load (without loading them: Settings asks this).
pub fn runtime_present() -> bool {
  candidates().iter().any(|dir| dir.join(SHERPA_DLL).is_file() && dir.join(ONNXRUNTIME_DLL).is_file())
}

/// Loads the DLLs from Leaflet's own folder (once); the folder they came from.
pub fn load_runtime() -> Result<PathBuf, String> {
  static LOADED: OnceLock<Result<PathBuf, String>> = OnceLock::new();
  LOADED
    .get_or_init(|| {
      let dir = candidates()
        .into_iter()
        .find(|dir| dir.join(SHERPA_DLL).is_file() && dir.join(ONNXRUNTIME_DLL).is_file())
        .ok_or_else(|| "The Studio voice's runtime is not installed with this copy of Leaflet".to_string())?;
      // onnxruntime first: sherpa-onnx's import of it then finds this one, already loaded.
      load_by_path(&dir.join(ONNXRUNTIME_DLL))?;
      load_by_path(&dir.join(SHERPA_DLL))?;
      Ok(dir)
    })
    .clone()
}

/// The onnxruntime.dll actually in use (for diagnostics: it must be Leaflet's, not System32's).
#[cfg(windows)]
pub fn onnxruntime_in_use() -> Option<PathBuf> {
  use windows::core::HSTRING;
  use windows::Win32::System::LibraryLoader::{GetModuleFileNameW, GetModuleHandleW};
  // SAFETY: asks for the path of a module by name; no handle is kept.
  unsafe {
    let module = GetModuleHandleW(&HSTRING::from(ONNXRUNTIME_DLL)).ok()?;
    let mut buffer = vec![0u16; 1024];
    let len = GetModuleFileNameW(Some(module), &mut buffer) as usize;
    (len > 0).then(|| PathBuf::from(String::from_utf16_lossy(&buffer[..len])))
  }
}

// ---- threads ----------------------------------------------------------------

/// On battery (Windows says so).
#[cfg(windows)]
pub fn on_battery() -> bool {
  use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
  let mut status = SYSTEM_POWER_STATUS::default();
  // SAFETY: fills a plain struct.
  unsafe { GetSystemPowerStatus(&mut status) }.is_ok() && status.ACLineStatus == 0
}

#[cfg(not(windows))]
pub fn on_battery() -> bool {
  false
}

/// Threads to synthesise with: the pack's own setting, `LEAFLET_STUDIO_THREADS`,
/// else 4 on mains and 2 on battery (never more than half the cores).
pub fn threads_for(install: Option<&InstallInfo>) -> u32 {
  if let Some(threads) = install.and_then(|info| info.threads).filter(|n| *n > 0) {
    return threads.min(16);
  }
  if let Some(threads) = std::env::var("LEAFLET_STUDIO_THREADS").ok().and_then(|value| value.parse::<u32>().ok()).filter(|n| *n > 0) {
    return threads.min(16);
  }
  let cores = std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(2);
  let wanted = if on_battery() { 2 } else { 4 };
  wanted.min((cores / 2).max(1))
}

// ---- text to the model ------------------------------------------------------

/// What the model is given for a piece.
pub enum ModelInput {
  /// The text: the engine makes the phonemes (sherpa-onnx 1.x).
  Text(String),
  /// Phonemes from a G2P of Leaflet's own (sherpa-onnx 2.0's `tokens`).
  #[allow(dead_code)]
  Phonemes(String),
}

pub trait Phonemizer: Send {
  fn input(&self, text: &str, voice: &VoiceSpec) -> ModelInput;
}

/// The engine's own: the text as it is.
pub struct EngineOwn;

impl Phonemizer for EngineOwn {
  fn input(&self, text: &str, _voice: &VoiceSpec) -> ModelInput {
    ModelInput::Text(text.to_string())
  }
}

// ---- the model --------------------------------------------------------------

struct Loaded {
  tts: sherpa_onnx::OfflineTts,
  /// The accent it was made for: its lexicon, and espeak-ng's voice.
  lexicon: String,
  lang: &'static str,
  threads: u32,
}

pub struct SherpaSynth {
  dir: PathBuf,
  install: InstallInfo,
  loaded: Option<Loaded>,
  phonemizer: Box<dyn Phonemizer>,
}

impl SherpaSynth {
  pub fn new(dir: PathBuf, install: InstallInfo) -> Self {
    SherpaSynth { dir, install, loaded: None, phonemizer: Box::new(EngineOwn) }
  }

  fn path(&self, name: &str) -> String {
    self.dir.join(name).display().to_string()
  }

  fn load(&mut self, voice: &VoiceSpec) -> Result<(), String> {
    let lang = voice.espeak_lang();
    if self.loaded.as_ref().is_some_and(|loaded| loaded.lexicon == voice.lexicon && loaded.lang == lang) {
      return Ok(());
    }
    // Another accent: its own lexicon, so the model is made again (a second or two).
    self.loaded = None;
    load_runtime()?;
    let threads = threads_for(Some(&self.install));
    let config = sherpa_onnx::OfflineTtsConfig {
      model: sherpa_onnx::OfflineTtsModelConfig {
        kokoro: sherpa_onnx::OfflineTtsKokoroModelConfig {
          model: Some(self.path(&self.install.model)),
          voices: Some(self.path("voices.bin")),
          tokens: Some(self.path("tokens.txt")),
          data_dir: Some(self.path("espeak-ng-data")),
          lexicon: Some(self.path(&voice.lexicon)),
          // espeak-ng's: "en-us" for an American voice, "en" (British) for a British one.
          lang: Some(lang.into()),
          ..Default::default()
        },
        num_threads: threads as i32,
        debug: false,
        provider: Some("cpu".into()),
        ..Default::default()
      },
      max_num_sentences: 1,
      silence_scale: 0.2,
      ..Default::default()
    };
    let tts = sherpa_onnx::OfflineTts::create(&config).ok_or_else(|| "The Studio voice could not be loaded (its files may be damaged)".to_string())?;
    self.loaded = Some(Loaded { tts, lexicon: voice.lexicon.clone(), lang, threads });
    Ok(())
  }
}

impl Synth for SherpaSynth {
  fn speak(&mut self, text: &str, voice: &VoiceSpec, speed: f32) -> Result<Vec<f32>, String> {
    self.load(voice)?;
    let input = self.phonemizer.input(text, voice);
    let loaded = self.loaded.as_ref().expect("loaded above");
    let text = match input {
      ModelInput::Text(text) => text,
      ModelInput::Phonemes(_) if !TAKES_PHONEMES => return Err(format!("sherpa-onnx {SHERPA_ONNX_VERSION} takes text, not phonemes")),
      ModelInput::Phonemes(phonemes) => phonemes,
    };
    let generation = sherpa_onnx::GenerationConfig { sid: voice.sid, speed, silence_scale: 0.2, ..Default::default() };
    let audio = loaded.tts.generate_with_config(&text, &generation, None::<fn(&[f32], f32) -> bool>).ok_or_else(|| "The Studio voice could not say this".to_string())?;
    let rate = audio.sample_rate().max(1) as u32;
    let samples = audio.samples().to_vec();
    Ok(if rate == MODEL_RATE { samples } else { dsp::resample(&samples, rate, MODEL_RATE) })
  }

  fn unload(&mut self) {
    self.loaded = None;
  }

  fn loaded(&self) -> bool {
    self.loaded.is_some()
  }

  fn threads(&self) -> u32 {
    self.loaded.as_ref().map(|loaded| loaded.threads).unwrap_or_else(|| threads_for(Some(&self.install)))
  }
}

// ---- the speakers -----------------------------------------------------------

pub struct CpalOutput {
  _stream: cpal::Stream,
  rate: u32,
  broken: Arc<AtomicBool>,
}

impl Output for CpalOutput {
  fn rate(&self) -> u32 {
    self.rate
  }
  fn broken(&self) -> bool {
    self.broken.load(Ordering::SeqCst)
  }
}

/// The default speakers, in their own format (the timeline's audio is made at their rate).
pub fn open_speakers(timeline: &Arc<Mutex<Timeline>>, events: &Events) -> Result<Box<dyn Output>, String> {
  let host = cpal::default_host();
  let device = host.default_output_device().ok_or("No speakers or headphones found")?;
  let supported = device.default_output_config().map_err(|e| format!("The speakers can't be used: {e}"))?;
  let rate = supported.sample_rate();
  let channels = supported.channels() as usize;
  let config = supported.config();
  let broken = Arc::new(AtomicBool::new(false));
  let stream = match supported.sample_format() {
    cpal::SampleFormat::F32 => build::<f32>(&device, &config, channels, timeline, events, &broken),
    cpal::SampleFormat::I16 => build::<i16>(&device, &config, channels, timeline, events, &broken),
    cpal::SampleFormat::U16 => build::<u16>(&device, &config, channels, timeline, events, &broken),
    cpal::SampleFormat::I32 => build::<i32>(&device, &config, channels, timeline, events, &broken),
    other => return Err(format!("The speakers use a format Leaflet can't play ({other})")),
  }?;
  stream.play().map_err(|e| format!("The speakers can't be used: {e}"))?;
  Ok(Box::new(CpalOutput { _stream: stream, rate, broken }))
}

fn build<T: SizedSample + FromSample<f32> + Send + 'static>(
  device: &cpal::Device,
  config: &cpal::StreamConfig,
  channels: usize,
  timeline: &Arc<Mutex<Timeline>>,
  events: &Events,
  broken: &Arc<AtomicBool>,
) -> Result<cpal::Stream, String> {
  let timeline = timeline.clone();
  let events = events.clone();
  let broken = broken.clone();
  let mut buffer: Vec<f32> = Vec::new();
  let mut reached: Vec<EngineEvent> = Vec::new();
  device
    .build_output_stream(
      config,
      move |data: &mut [T], _| {
        buffer.resize(data.len(), 0.0);
        // (Held by the other threads only for a few microseconds at a time.)
        let reading = {
          let mut timeline = timeline.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
          timeline.fill(&mut buffer, channels, &mut reached);
          // The reading these samples were of: a stop or a new reading after this drops their news.
          timeline.reading
        };
        for (slot, sample) in data.iter_mut().zip(buffer.iter()) {
          *slot = T::from_sample(*sample);
        }
        for event in reached.drain(..) {
          let _ = events.send((reading, event));
        }
      },
      move |_error| broken.store(true, Ordering::SeqCst),
      None,
    )
    .map_err(|e| format!("The speakers can't be used: {e}"))
}
