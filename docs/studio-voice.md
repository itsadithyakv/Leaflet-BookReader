# The Studio voice

Leaflet's own read-aloud voice: Kokoro-82M v1.0, run on the device by
sherpa-onnx, downloaded on request in **Settings → Reading → Studio voice**.
Optional: without it, reading aloud uses the system's voices as before.

- **Windows**: offered up front. Until it is downloaded the Windows voices read;
  once it is in and its self-test shows the computer keeps up, it is the voice
  picked by itself (a voice the reader chose still wins).
- **Android**: offered lower-key; the phone's own voice stays the default and
  the Studio voice is never picked by itself. The sound is made in Kotlin
  (`StudioVoice.kt`); the pack is the same download, made by the same Rust code.

> **Before release:** sherpa-onnx 1.x has eSpeak NG (GPL-3.0) compiled in.
> Leaflet is MIT. Do not ship the Studio voice to users until it runs on
> sherpa-onnx 2.0, which removes eSpeak NG (see "Moving to sherpa-onnx 2.0").

## How it works

```
page (TS)                                   Rust (src-tauri/src/tts)
──────────                                  ────────────────────────
player.ts ── speak/pause/rate/voice ──►  desktopEngine.ts ──► neuralEngine.ts ── invoke ──► commands.rs
   ▲                                     (Studio or Windows voice)                          │
   └──── start / boundary / done ◄──── "studio-voice:event" ◄────────── player.rs (engine) ◄┘
                                                                          │   │
                                                         text.rs pieces ──┘   └── timeline.rs ◄── cpal callback
                                                         native.rs: sherpa-onnx (Kokoro), cpal (WASAPI)
```

- **Items** come from the page as `{ id, text, silence?, marks? }` (`engine.ts`):
  a paragraph, with `marks` at the start of each sentence (UTF-16 offsets).
- **Pieces** (`text.rs`): each sentence is given to the model on its own; a long
  one (over 160 units) is cut where a clause ends. After play is pressed the
  first clause goes first (the benchmark: whole first sentence 2.6 s, first
  clause 1.1 s), and whenever little is made ahead a long piece is cut again so
  the next sound is ready before this one runs out.
- **One synthesis thread** makes pieces in order, ahead of playback: about 30 s
  ahead when the device keeps up. Each piece is levelled toward −18 dB (gated
  RMS, ≈ LUFS for speech; Kokoro is ~5 dB quieter than Windows' voices) with a
  soft limiter, faded at its edges, and resampled to the speakers' rate.
- **The timeline** (`timeline.rs`) holds the made audio with its news at exact
  sample offsets: `start` (after the item's silence), a `boundary` of kind
  `sentence` at each mark, `done` at its end. The speakers' callback plays it
  and sends the news as it is reached, so the page lights each sentence as it
  is heard.
- **Pause** holds at the sample (a 12 ms fade); resume goes on from it.
- **Speed** is Kokoro's own `speed` (natural pitch). The pill's slider applies
  on release and restarts from the sentence being read; the Settings slider is
  the same preference (`leaflet.readAloud` → `rate`). What was made ahead at the
  old speed is dropped and made again.
- **Voices**: Heart (`af_heart`, sid 3, default), Emma (`bf_emma`, 21, British
  lexicon), Michael (`am_michael`, 16). A change of accent reloads the model with
  that lexicon (a second or two).
- **Memory**: the model (~680 MB resident) loads on first use and is let go after
  5 minutes with nothing to say; the speakers are let go after 15 s of silence.
- **Threads**: 4 on mains, 2 on battery (never more than half the cores);
  `"threads"` in the pack's `install.json`, or `LEAFLET_STUDIO_THREADS`, overrides.
- **Fallback**: if the Studio voice fails (files damaged, model refused, speakers
  gone), `desktopEngine.ts` carries on at once in the best Windows voice from the
  sentence it had reached, with a small toast.

### Slow devices: live, prepare, or not offered (`lead.rs`)

`r` = seconds of work per second of speech (the self-test's, then measured
while reading). The same thresholds and rule on Android (Kotlin) and Windows:

| r | mode | |
|---|---|---|
| ≤ 0.85 | live | reads as it goes |
| 0.85 – 2.5 | prepare | makes the chapter ahead, starts once the lead `A ≥ D·(1 − 1/r)·1.15` (`D`: seconds of the chapter left, made or not) |
| > 2.5 | not offered | the system voices read |

In prepare mode the page queues the rest of the chapter (`ahead()`), pieces made
more than 30 s ahead wait in `<app cache>/studio-voice/` as 16-bit 24 kHz PCM
(at most 300 MB; brought back into memory as playback nears; deleted as played,
on stop, on a new reading, and at start-up), and while it waits the page is told
`{ type: "preparing", seconds }` (from Rust's `{ id, readyInMs, preparedMs }`).
A chapter that runs dry waits again by the same rule. The self-test's (i) in
Settings says which mode the device is in.

### Self-test

After a download (Windows: in Rust; Android: in Kotlin, recorded with
`studio_voice_record_self_test`), one warm-up sentence, then the sample sentence
twice, keeping the better. RTF > 0.8: kept, offered, never picked by itself
(`slow`). This laptop (i5-13420H): 0.43–0.48 at 4 threads.

## The pack

`apps/src-tauri/src/tts/packs.json`, versioned in the repo: per variant, the
files (path, size, SHA-256) and where to get them, tried in order:

- `{ "kind": "files", "base": "https://…/" }` — loose files at `base + path`;
- `{ "kind": "archive", "url", "size", "sha256", "root" }` — a `.tar.bz2`, from
  which only the listed files under `root/` are kept.

`"variant": "fp32"` picks the model: fp32 is 2.3–2.7× faster than int8 on a
laptop (int8 is also known to be broken on Android ARM). Switching is that one
line. English-only, fp32: 367 MB installed (model.onnx 325.6 MB, voices.bin 28.2,
the two lexicons 12.3, English eSpeak data 0.8); the archive is 350 MB.

Download (`packs.rs`): HTTP `Range` resume (a part file per file, kept across
cancels and restarts), every file checked against its SHA-256 as it is written,
gathered in `voices/.kokoro-v1.partial/` and renamed into `voices/kokoro-v1/` in
one step, `install.json` written inside before the swap. Remove deletes the pack
and anything half-downloaded at once and says what it freed. The User-Agent is
`Leaflet/<version>`: no address, nothing about the reader.

Pack folder: `<app data>/voices/kokoro-v1/` — Windows `%APPDATA%\com.leaflet.app\…`
(virtualised under MSIX), Android `Context.getDataDir()/voices/kokoro-v1`.

### For the owner: host pinned copies

The k2-fsa `tts-models` release assets are **re-uploaded in place** (their hashes
change), so a pinned archive can stop matching. Leaflet then refuses it
("may have changed upstream") rather than install something unchecked. To make
the download dependable, host the files yourself and put that source first:

1. Make the English-only pack from the archive (the files in `packs.json`).
2. Upload them as assets of a GitHub release on the Leaflet repository (e.g. tag
   `voice-kokoro-v1`) — one asset per file; flatten paths if needed and mirror
   the names in `base`.
3. Add `{ "kind": "files", "base": "https://github.com/<owner>/<repo>/releases/download/voice-kokoro-v1/" }`
   before the archive source. The hashes already in `packs.json` stay as they are.

Kokoro's weights are Apache-2.0 (its `LICENSE` is part of the pack). The pack is
data, not code, so the Store's rule against downloaded code is not engaged.

## The runtime DLLs (Windows)

The `sherpa-onnx` crate (1.13.8, `shared`) puts `sherpa-onnx-c-api.dll` (4.6 MB)
and `onnxruntime.dll` (17.8 MB) next to the exe: **+22.4 MB** to the install
(about 9–10 MB compressed in the MSIX). `msix/build-msix.ps1` copies them into
the package **only when `LEAFLET_STUDIO_VOICE=1`** (as the Android build does; never for a
Store build before sherpa-onnx 2.0). They are **delay-loaded** (build.rs: `/DELAYLOAD`): Leaflet starts
without them, and `native.rs` loads them by full path from Leaflet's own folder
on first use, so Windows 11's own `System32\onnxruntime.dll` is never picked up
(the diagnostics log names the one in use). If they are missing, the Studio
voice is simply not offered. The NSIS/MSI bundles (`tauri build`) do not yet
carry them; add them as resources next to the exe if those are ever shipped.

### Building: the vendored archive

sherpa-onnx-sys's build script downloads a prebuilt archive from GitHub unless
told where one is. `apps/src-tauri/.cargo/config.toml` sets
`SHERPA_ONNX_ARCHIVE_DIR=apps/src-tauri/vendor/sherpa-onnx` (git-ignored), so a
build never downloads anything itself and always links the same bytes. Once per
checkout:

```
node apps/scripts/fetch-sherpa-onnx.mjs
```

(fetches `sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-lib.tar.bz2`, 8.0 MB,
SHA-256 `b8eedf41…a0b9e7`; `--check` only checks). Without it a Windows build
stops with "SHERPA_ONNX_ARCHIVE_DIR does not contain expected archive". The
feature is on by default; `cargo build --no-default-features` builds without the
engine (the voice is then not offered on Windows). Android never builds it.
Android's native libraries come separately: `apps/src-tauri/msix/fetch-sherpa-onnx.ps1`
(the sherpa-onnx AAR, checked in `app/build.gradle.kts`; docs/android.md).

## Moving to sherpa-onnx 2.0

2.0 (PR #4055, merged 2026-10-20, not yet released) removes eSpeak NG. Without
it, `data_dir` is ignored and a word missing from the lexicon is **silently
skipped** ("OOV word skipped"): names and inflections vanish ("Bennet",
"Netherfield", "families", "returned" are not in `lexicon-us-en.txt`). 2.0 adds
`GenerationConfig.tokens` / phoneme input, so Leaflet supplies its own English
G2P (permissively licensed) and passes phonemes. The switch, in one place:

1. `Cargo.toml`: `sherpa-onnx = "=2.x"`; `apps/scripts/fetch-sherpa-onnx.mjs`:
   version and SHA-256.
2. `src/tts/native.rs`: `SHERPA_ONNX_VERSION`, `TAKES_PHONEMES = true`, the
   `ModelInput::Phonemes` arm of `SherpaSynth::speak` (pass them as `tokens`),
   and a `Phonemizer` that gives `Phonemes` (Leaflet's G2P; the page may also
   send per-sentence `phonemes` with each item).
3. `packs.json`: drop `espeak-ng-data/…`; bump the pack id if the files change.
4. `THIRD_PARTY_NOTICES.md` and `apps/src/constants/thirdParty.ts`: remove eSpeak NG.

## Commands and events

The shapes are at the top of `apps/src-tauri/src/tts/mod.rs` (shared with the
Android side): `studio_voice_status`, `studio_voice_download` (progress on
`studio-voice:progress`), `studio_voice_cancel`, `studio_voice_remove`,
`studio_voice_record_self_test`; Windows only: `studio_voice_self_test`,
`studio_speak`, `studio_pause`, `studio_resume`, `studio_stop`,
`studio_set_rate`, `studio_set_voice`, `studio_preview`, news on
`studio-voice:event`.

## Testing

- `cargo test --lib tts::` — manifest, hashes, Range resume against a local
  server that drops the connection, archive extraction, install swap, the
  engine's queue on a fake model (events at samples, speed and voice changes,
  pause, prepare mode, disk cache), the lead rule, the leveller.
- End to end with the real model (ignored by default):
  `LEAFLET_STUDIO_PACK=<pack folder> LEAFLET_STUDIO_OUT=<folder> cargo test --lib tts::e2e -- --ignored --nocapture`
  writes `studio-voice-e2e.wav` and prints the RTF, first-audio time, the speed
  change's delay and each event's time; `studio_voice_plays_through_the_speakers`
  plays two quiet seconds.
- `npx vitest run src/readers/readAloud src/components/StudioVoiceCard.test.tsx`.
