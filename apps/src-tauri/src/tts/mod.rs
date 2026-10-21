//! The Studio voice: a voice of Leaflet's own (Kokoro, run on the device by
//! sherpa-onnx), downloaded on request in Settings. See docs/studio-voice.md.
//!
//! ## Contract (shared with the Android side and the page)
//!
//! **Pack folder**, the same on every platform: `<app data dir>/voices/kokoro-v1/`
//! where `<app data dir>` is Tauri's `app_data_dir()` (the top of the data
//! folder, never a per-account library folder):
//!   - Windows: `%APPDATA%\com.leaflet.app\voices\kokoro-v1\` (MSIX virtualises it).
//!   - Android: `Context.getDataDir()` + `/voices/kokoro-v1`, i.e. Kotlin
//!     `File(context.dataDir, "voices/kokoro-v1")` (`/data/user/0/com.leaflet.app/voices/kokoro-v1`).
//!     (Tauri's Android `app_data_dir()` is `activity.dataDir.absolutePath`.)
//!     `studio_voice_status().dir` also gives the absolute path.
//!
//! Files in it (flat, as sherpa-onnx's Kokoro config wants them):
//!   `model.onnx`, `voices.bin`, `tokens.txt`, `lexicon-us-en.txt`,
//!   `lexicon-gb-en.txt`, `LICENSE` (Kokoro's), `espeak-ng-data/…` (English only),
//!   and `install.json`, which is in place only once every file is (the folder is
//!   renamed into place whole). sherpa-onnx config: `model` (install.json's `model`),
//!   `voices`, `tokens`, `data_dir = espeak-ng-data`, `lexicon` = the voice's own
//!   (`lexicon-us-en.txt` for Heart and Michael, `lexicon-gb-en.txt` for Emma:
//!   the model is loaded again on a change of accent), `lang` = espeak-ng's
//!   voice for the accent (`"en-us"` for Heart and Michael, `"en"` — espeak's
//!   British English — for Emma; `VoiceSpec::espeak_lang`),
//!   `max_num_sentences = 1`; `GenerationConfig { sid, speed }`.
//!
//! `install.json`:
//! ```json
//! { "pack": "kokoro-v1", "manifestVersion": 1, "variant": "fp32", "model": "model.onnx", "bytes": 367000000,
//!   "installedAt": "2026-10-20T12:00:00Z",
//!   "files": { "model.onnx": { "size": 1, "sha256": "…" }, … },
//!   "selfTest": { "rtf": 0.42, "threads": 4, "platform": "windows", "at": "…" } }
//! ```
//! (`selfTest` is null until a self-test has run; `model` is the model file to load,
//! `model.int8.onnx` for the int8 variant; `"threads": n` may be added by hand.)
//!
//! **Commands, every platform** (pack manager, `tts/packs.rs`):
//!   - `studio_voice_status() -> StudioVoiceStatus`
//!   - `studio_voice_download() -> StudioVoiceStatus` — resolves when installed;
//!     rejects with `"cancelled"` when cancelled, or a message. Resumes a
//!     partial download (HTTP Range) on the next call.
//!   - `studio_voice_cancel()`
//!   - `studio_voice_remove() -> u64` (bytes freed)
//!   - `studio_voice_record_self_test({ rtf: f64, threads: u32 }) -> StudioVoiceStatus`
//!     (Android: Kotlin's self-test result, recorded in `install.json`)
//!
//! `StudioVoiceStatus` (camelCase):
//! ```json
//! { "pack": "kokoro-v1", "installed": true, "downloading": false,
//!   "downloadBytes": 349906910, "installedBytes": 330000000, "partialBytes": 0,
//!   "dir": "C:\…\voices\kokoro-v1", "variant": "fp32",
//!   "voices": [ { "id": "neural:af_heart", "name": "Heart", "sid": 3, "lang": "en-US" }, … ],
//!   "defaultVoice": "neural:af_heart",
//!   "selfTest": { "rtf": 0.42, "threads": 4, "platform": "windows", "at": "…" } | null,
//!   "slow": false,            // selfTest.rtf > 0.8: offered, never picked by itself
//!   "mode": "live",           // live | prepare | tooSlow (lead.rs: r <= 0.85 | <= 2.5 | more)
//!   "canSpeak": true }        // this build can synthesise (desktop with `studio-voice`)
//! ```
//! Voices: `neural:af_heart` (sid 3, en-US, default), `neural:bf_emma`
//! (sid 21, en-GB), `neural:am_michael` (sid 16, en-US).
//!
//! **Event** `studio-voice:progress`: `{ "phase": "download"|"verify"|"extract"|"install"|"test",
//! "done": u64, "total": u64 }` (bytes; `extract` counts archive bytes read).
//!
//! **Commands, desktop only** (synthesis and playback, `tts/player.rs`, `tts/native.rs`):
//!   - `studio_speak({ items: [{ id, text, silence?, marks? }], replace: bool })`
//!   - `studio_pause()`, `studio_resume()`, `studio_stop()`
//!   - `studio_set_rate({ rate: f32 })` — Kokoro's own `speed` (pitch kept);
//!     audio made ahead at the old speed is dropped and made again.
//!   - `studio_set_voice({ voice: string | null })` (`"neural:af_heart"`; null = default)
//!   - `studio_preview({ voice: string, rate: f32 })` — one sample sentence, replacing the queue
//!   - `studio_voice_self_test() -> StudioVoiceStatus` (synthesises one sentence, records RTF)
//!
//! **Event** `studio-voice:event`: exactly `EngineEvent` of
//! `apps/src/readers/readAloud/engine.ts`: `{type:"start",id,from?}`,
//! `{type:"boundary",id,charIndex,kind:"sentence"}` (at each of the item's
//! `marks`, when that sample is played), `{type:"done",id}`,
//! `{type:"error",id,message}`, and, while a slow device prepares a chapter (`lead.rs`),
//! `{type:"preparing",id,seconds}` (`id`: the item it waits to start; `seconds`, whole
//! seconds to go, at least 1: the same shape Android's ReadAloud.kt sends, read by
//! `toEngineEvent` in `engine.ts`). A chapter is an item id's part before `:` (the
//! player's `section:n`). News of a reading since stopped or replaced is not sent
//! (each event carries its reading, `Timeline::reading`, `player::forward`).

pub mod commands;
// English text to Kokoro's phonemes, GPL-free (for sherpa-onnx 2.0's `tokens`);
// every platform. Not called yet: the engine takes it up with sherpa-onnx 2.0.
#[allow(dead_code)]
pub mod g2p;
pub mod lead;
pub mod packs;
// The engine itself: Windows, with the `studio-voice` feature (`studio_voice`, set by build.rs).
// Its pure parts also build for the tests everywhere.
#[cfg(any(test, studio_voice))]
pub mod dsp;
#[cfg(any(test, studio_voice))]
pub mod player;
#[cfg(any(test, studio_voice))]
pub mod text;
#[cfg(any(test, studio_voice))]
pub mod timeline;
#[cfg(studio_voice)]
pub mod native;
#[cfg(all(test, studio_voice))]
mod e2e;
