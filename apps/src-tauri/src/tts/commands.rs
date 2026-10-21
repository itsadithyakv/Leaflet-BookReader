//! The Studio voice's commands (named and shaped in `mod.rs`).

use tauri::{AppHandle, Emitter};

use super::lead;
use super::packs::{self, DownloadError, Manifest, PackDirs, Progress, StudioVoiceStatus, PACK_ID};

pub const PROGRESS_EVENT: &str = "studio-voice:progress";
#[cfg_attr(not(studio_voice), allow(dead_code))]
pub const ENGINE_EVENT: &str = "studio-voice:event";

fn pack() -> Result<packs::PackSpec, String> {
  Manifest::shipped().pack(PACK_ID).cloned().ok_or_else(|| "No Studio voice is known".to_string())
}

fn status(dirs: &PackDirs) -> Result<StudioVoiceStatus, String> {
  let pack = pack()?;
  let mut status = packs::status_of(&pack, dirs, packs::downloading(), can_speak());
  // Measured while reading, where it has been.
  if let Some(rtf) = engine::live_rtf() {
    status.mode = lead::mode_for(rtf);
  }
  Ok(status)
}

/// This build can make the voice's sound (Windows, with the runtime next to the exe).
pub fn can_speak() -> bool {
  #[cfg(studio_voice)]
  {
    super::native::runtime_present()
  }
  #[cfg(not(studio_voice))]
  {
    false
  }
}

#[tauri::command]
pub async fn studio_voice_status() -> Result<StudioVoiceStatus, String> {
  tauri::async_runtime::spawn_blocking(|| status(&PackDirs::app(PACK_ID)?)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn studio_voice_download(app: AppHandle) -> Result<StudioVoiceStatus, String> {
  let pack = pack()?;
  let dirs = PackDirs::app(PACK_ID)?;
  let cancel = packs::begin_download().ok_or("The Studio voice is already downloading")?;
  // A pack being replaced is let go first.
  engine::shut_down().await;
  let report_app = app.clone();
  let report = move |progress: Progress| {
    let _ = report_app.emit(PROGRESS_EVENT, progress);
  };
  let result = async {
    let client = packs::http_client().map_err(DownloadError::Failed)?;
    packs::download_pack(&client, &pack, &dirs, &cancel, &report).await
  }
  .await;
  packs::end_download();
  match result {
    Err(DownloadError::Cancelled) => return Err("cancelled".into()),
    Err(DownloadError::Failed(message)) => {
      crate::diag::warn(&format!("Studio voice download failed: {message}"));
      return Err(message);
    }
    Ok(_) => {}
  }
  // Desktop: how fast it is here, before it is offered (Android's Kotlin runs its own).
  #[cfg(studio_voice)]
  {
    report(Progress { phase: packs::Phase::Test, done: 0, total: 1 });
    if let Err(message) = engine::self_test(&app).await {
      crate::diag::warn(&format!("Studio voice self-test failed: {message}"));
    }
    report(Progress { phase: packs::Phase::Test, done: 1, total: 1 });
  }
  status(&dirs)
}

#[tauri::command]
pub fn studio_voice_cancel() {
  packs::cancel_download();
}

#[tauri::command]
pub async fn studio_voice_remove() -> Result<u64, String> {
  packs::cancel_download();
  engine::shut_down().await;
  let dirs = PackDirs::app(PACK_ID)?;
  tauri::async_runtime::spawn_blocking(move || packs::remove(&dirs)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn studio_voice_record_self_test(rtf: f64, threads: u32) -> Result<StudioVoiceStatus, String> {
  let dirs = PackDirs::app(PACK_ID)?;
  packs::record_self_test(&dirs, rtf, threads)?;
  status(&dirs)
}

#[tauri::command]
pub async fn studio_voice_self_test(app: AppHandle) -> Result<StudioVoiceStatus, String> {
  engine::self_test(&app).await?;
  status(&PackDirs::app(PACK_ID)?)
}

#[tauri::command]
pub async fn studio_speak(app: AppHandle, items: Vec<ItemArg>, replace: bool) -> Result<(), String> {
  engine::with(&app, move |engine| engine.speak(items, replace)).await
}

#[tauri::command]
pub async fn studio_pause(app: AppHandle) -> Result<(), String> {
  engine::with_running(&app, |engine| engine.pause()).await
}

#[tauri::command]
pub async fn studio_resume(app: AppHandle) -> Result<(), String> {
  engine::with_running(&app, |engine| engine.resume()).await
}

#[tauri::command]
pub async fn studio_stop(app: AppHandle) -> Result<(), String> {
  engine::with_running(&app, |engine| engine.stop()).await
}

#[tauri::command]
pub async fn studio_set_rate(app: AppHandle, rate: f32) -> Result<(), String> {
  engine::set_rate(&app, rate).await
}

#[tauri::command]
pub async fn studio_set_voice(app: AppHandle, voice: Option<String>) -> Result<(), String> {
  engine::set_voice(&app, voice).await
}

#[tauri::command]
pub async fn studio_preview(app: AppHandle, voice: Option<String>, rate: f32) -> Result<(), String> {
  let sample = pack()?.sample;
  engine::with(&app, move |engine| engine.preview(voice, rate, &sample)).await
}

#[cfg(studio_voice)]
pub type ItemArg = super::player::ItemIn;

#[cfg(not(studio_voice))]
#[derive(serde::Deserialize)]
pub struct ItemArg {}

#[cfg(studio_voice)]
mod engine {
  use std::sync::{Arc, Mutex};

  use tauri::{AppHandle, Emitter, Manager};

  use super::super::native::{open_speakers, SherpaSynth};
  use super::super::packs::{self, PackDirs, PACK_ID};
  use super::super::player::{cache_dir_under, Engine, EngineConfig, CACHE_CAP_BYTES};
  use super::{pack, ENGINE_EVENT};

  /// The engine, made on first use; the speed and voice the page last asked for.
  struct Slot {
    engine: Option<Arc<Engine>>,
    rate: f32,
    voice: Option<String>,
  }

  static SLOT: Mutex<Slot> = Mutex::new(Slot { engine: None, rate: 1.0, voice: None });

  fn slot() -> std::sync::MutexGuard<'static, Slot> {
    SLOT.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
  }

  /// Held while an engine is made: two first uses at once (the reader, Settings'
  /// sample) would otherwise each make one, the second emptying the cache folder
  /// the first is using.
  static MAKING: Mutex<()> = Mutex::new(());

  fn make(app: &AppHandle) -> Result<Arc<Engine>, String> {
    if let Some(engine) = slot().engine.clone() {
      return Ok(engine);
    }
    let _making = MAKING.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(engine) = slot().engine.clone() {
      return Ok(engine);
    }
    let pack = pack()?;
    let dirs = PackDirs::app(PACK_ID)?;
    let install = packs::read_install(&dirs.dir).ok_or("The Studio voice is not downloaded")?;
    let runtime = super::super::native::load_runtime()?;
    crate::diag::info(&format!(
      "Studio voice runtime from {} (onnxruntime in use: {})",
      runtime.display(),
      super::super::native::onnxruntime_in_use().map(|path| path.display().to_string()).unwrap_or_default()
    ));
    let cache_root = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let emitter = app.clone();
    let engine = Arc::new(Engine::start(
      EngineConfig {
        pack,
        cache_dir: cache_dir_under(&cache_root),
        rtf: install.self_test.as_ref().map(|test| test.rtf),
        cache_cap: CACHE_CAP_BYTES,
        fixed_rtf: None,
      },
      Box::new(SherpaSynth::new(dirs.dir.clone(), install)),
      Box::new(open_speakers),
      Box::new(move |event| {
        let _ = emitter.emit(ENGINE_EVENT, event);
      }),
    ));
    let mut slot = slot();
    engine.set_rate(slot.rate);
    engine.set_voice(slot.voice.clone());
    Ok(slot.engine.get_or_insert(engine).clone())
  }

  /// Runs on the engine (made if need be), off the async threads.
  pub async fn with<F: FnOnce(&Engine) + Send + 'static>(app: &AppHandle, work: F) -> Result<(), String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || make(&app).map(|engine| work(&engine))).await.map_err(|e| e.to_string())?
  }

  /// Only if it is running (pausing a voice never started needs no model).
  pub async fn with_running<F: FnOnce(&Engine) + Send + 'static>(_app: &AppHandle, work: F) -> Result<(), String> {
    let engine = slot().engine.clone();
    if let Some(engine) = engine {
      tauri::async_runtime::spawn_blocking(move || work(&engine)).await.map_err(|e| e.to_string())?;
    }
    Ok(())
  }

  pub async fn set_rate(app: &AppHandle, rate: f32) -> Result<(), String> {
    slot().rate = rate;
    with_running(app, move |engine| engine.set_rate(rate)).await
  }

  pub async fn set_voice(app: &AppHandle, voice: Option<String>) -> Result<(), String> {
    slot().voice = voice.clone();
    with_running(app, move |engine| engine.set_voice(voice)).await
  }

  pub async fn self_test(app: &AppHandle) -> Result<(), String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
      let engine = make(&app)?;
      let (rtf, threads) = engine.self_test()?;
      packs::record_self_test(&PackDirs::app(PACK_ID)?, rtf, threads)?;
      crate::diag::info(&format!("Studio voice self-test: RTF {rtf:.2} at {threads} threads"));
      Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
  }

  /// The model and speakers let go, and the engine's threads ended.
  pub async fn shut_down() {
    let engine = slot().engine.take();
    if let Some(engine) = engine {
      let _ = tauri::async_runtime::spawn_blocking(move || {
        engine.unload();
        drop(engine);
      })
      .await;
    }
  }

  pub fn live_rtf() -> Option<f64> {
    slot().engine.as_ref().and_then(|engine| engine.rtf())
  }
}

#[cfg(not(studio_voice))]
mod engine {
  use tauri::AppHandle;

  use super::ItemArg;

  const UNAVAILABLE: &str = "The Studio voice is spoken by the device itself on this platform";

  /// Stands in for the engine where there is none (Android speaks in Kotlin).
  pub struct Engine;
  #[allow(dead_code)]
  impl Engine {
    pub fn speak(&self, _items: Vec<ItemArg>, _replace: bool) {}
    pub fn pause(&self) {}
    pub fn resume(&self) {}
    pub fn stop(&self) {}
    pub fn preview(&self, _voice: Option<String>, _rate: f32, _sample: &str) {}
  }

  pub async fn with<F: FnOnce(&Engine)>(_app: &AppHandle, _work: F) -> Result<(), String> {
    Err(UNAVAILABLE.into())
  }
  pub async fn with_running<F: FnOnce(&Engine)>(_app: &AppHandle, _work: F) -> Result<(), String> {
    Ok(())
  }
  pub async fn set_rate(_app: &AppHandle, _rate: f32) -> Result<(), String> {
    Ok(())
  }
  pub async fn set_voice(_app: &AppHandle, _voice: Option<String>) -> Result<(), String> {
    Ok(())
  }
  pub async fn self_test(_app: &AppHandle) -> Result<(), String> {
    Err(UNAVAILABLE.into())
  }
  pub async fn shut_down() {}
  pub fn live_rtf() -> Option<f64> {
    None
  }
}
