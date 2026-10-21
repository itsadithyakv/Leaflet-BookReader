# Leaflet

A calm ebook reader for Windows and Android that turns reading into a daily
habit, with Pip, a pixel-art companion who lives in the app. Built with Tauri 2,
Rust and React. Free on the Microsoft Store, with nothing locked; the Android
app is on its way to Google Play. Made by PaperKite.

Website, privacy policy and terms: https://itsadithyakv.github.io/Leaflet-BookReader/

## What it does

- **Library.** EPUB, PDF, comics and plain text open directly; MOBI, AZW3 and
  others convert through an optional Calibre install on desktop. Metadata and
  covers fill in from Open Library and Wikipedia, cached for offline use. Rust
  makes small cover thumbnails, so a big library scrolls smoothly on a phone.
- **Reading.** A scroll reader and a page reader with chapters, bookmarks and
  highlights; auto-scroll, Smart Read (Dotty, the adaptive pacing dot), RSVP
  speed reading and several paper finishes. The screen stays awake for three
  minutes after your last touch while a book is paused.
- **Read aloud.** Paragraph by paragraph with natural pauses, the best voice
  on the device picked for you, and a speed setting. An optional Studio voice
  (Kokoro, downloaded from Settings) is in development and will ship once its
  engine is free of GPL code; see [studio-voice.md](docs/studio-voice.md).
- **A habit.** A daily goal, streaks with freezes and a grace day, focus
  sessions, and a session bookshelf where every spine is a session you finished.
- **Pip.** Lives in the header logo, hops out to walk the app, celebrates your
  goals (usually by boxing), gives the tour, and can be picked up and thrown.
- **Pip's Hollow.** A small camp paid for by reading: acorns from the minutes
  you read, new chapters from the hours. Build, defend at night while you
  watch, and raid strongholds and (if they allow it) friends' camps. Nothing
  expires and nothing happens while you are away.
- **Backup.** Your library and history, backed up to your own Google Drive with
  the `drive.file` scope: Leaflet only sees files it created.
- **Optional account.** Email and password on PaperKite's server, for weekly
  leaderboards, follows, kudos, reading duels, friend raids and keeping your
  place across devices. Nothing else needs an account, and the account can be
  deleted from the app.
- **Looks.** A Liquid Glass look on desktop (soft blur at scroll edges, glass
  that bends what is behind it). Phones default to Smooth, the same look
  without live blur; Settings > Appearance > Visual effects switches between
  Full, Smooth and a plain minimal mode.

### Coming in 1.5.11

- **The Front.** The Hollow's enemies all come down one trail from the Dark
  Wood, so the wall across it, the traps in front and the towers behind make
  sense at a glance. Six kinds of enemy (including bombers that blow the wall
  open and diggers that go under it), each with one defence that beats it.
- **Your reading, made visible.** The minutes you read arrive as pages that
  become acorns and fill the chapter bar; every finished book blooms on a
  Reading Path in the meadow; standing stones carry your hours past chapter 10.

The documentation is in [docs/](docs/README.md): start with
[product.md](docs/product.md) for what ships, and
[release-msix.md](docs/release-msix.md) to release it.

## Platforms

Leaflet is one responsive UI, not a desktop build and a separate mobile one.

- **Desktop** (Windows/macOS/Linux) — leather sidebar rail, search in the header.
- **Phone, upright** — a bottom tab bar replaces the rail; the Library page owns
  search. Book files download on first open rather than on sync.
- **Phone, landscape** — the rail returns and the header compresses. A landscape
  phone is *wider* than the `md` breakpoint (844x390 on an iPhone 14), so the
  layout keys off height as well as width; a bottom bar would cost the one
  dimension that is already scarce.
- **Tablet** — the desktop layout.

### Building for Android

The Android project is generated and committed at `apps/src-tauri/gen/android`.
Prerequisites, in the order they bite:

1. **Android SDK + NDK.** The NDK is separate from the SDK:
   `sdkmanager "ndk;27.3.13750724"`, then `NDK_HOME=$ANDROID_HOME/ndk/27.3.13750724`.
2. **JDK 21.** Gradle's build scripts are compiled by Groovy, which cannot read
   class files newer than the JDK it ships support for — a JDK 26 fails with
   `Unsupported class file major version 70` well after the build appears to
   start. Point `JAVA_HOME` at a 17 or 21 JDK.
3. **Rust Android targets:**
   `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`
4. **Windows only — Developer Mode.** The Tauri CLI symlinks the compiled
   `.so` into `app/src/main/jniLibs/`, and Windows refuses to create symlinks
   without it. Turn on *Settings → System → For developers → Developer Mode*
   (or run the build from an Administrator terminal), or the build fails at the
   very last step with `Creation symbolic link is not allowed for this system`.

```bash
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.3.13750724"
export JAVA_HOME="$LOCALAPPDATA/Programs/jdk21/jdk-21.0.12.1+1"

npm --prefix ./apps run tauri android dev             # on a device or emulator
npm --prefix ./apps run tauri android build --debug   # APK
```

Output lands in `apps/src-tauri/gen/android/app/build/outputs/`.

**Build release, not debug, for anything you install.** A debug APK carries the
Rust library's full symbol table — around 200 MB of it — while a release build
strips them. Drop `--debug` and the same app is a fraction of the size.

Two more levers, in order of effect:

- **Ship the AAB, not the APK.** Play splits it per device, so a phone downloads
  one architecture instead of all of them. `--apk --aab` builds both.
- **`--split-per-abi`** does the same for direct APK distribution.

The Calibre converter is **not compiled into mobile builds at all** — there is no
Calibre for Android, and the download-and-unpack path it needs cannot run there.
Formats that depend on it (Kindle, Word, and the rest of the 19) therefore do not
open on a phone directly; converted once on a desktop, the resulting EPUB syncs
across like any other book. The formats Leaflet reads itself — EPUB, PDF, CBZ,
TXT, HTML, FB2 — work everywhere.

Gradle drives the Rust build through the Tauri CLI (`:app:rustBuildArm64Debug`
shells back out to `tauri android android-studio-script`), so run the CLI
commands above rather than `gradlew assemble*` directly — Gradle on its own
cannot satisfy that callback.

## Reference

Deeper documentation lives in [`docs/`](docs/README.md): architecture, the full
tech stack, every feature end to end, the data model and sync document, build
instructions for both platforms, and what is and is not tested.

## Tech stack

- **Tauri 2** shell, with the heavy lifting in **Rust**: the library, sync,
  conversion, cover thumbnails and the Studio voice engine.
- **React + TypeScript** UI with **Zustand** state and **Tailwind**, one
  responsive layout for desktop and phone.
- **epub.js** for EPUB; a page reader for PDF and comics.
- **Kotlin** plugins on Android (read aloud, device features).
- **Node.js** server for accounts and the social side (`server/`).

See [tech-stack.md](docs/tech-stack.md), [architecture.md](docs/architecture.md)
and [testing.md](docs/testing.md).

## Local storage and data

- The library, reading progress, preferences, highlights and Pip's state live
  on the device, in the app data folder.
- Covers and thumbnails are cached there for offline use.
- Converter download is optional in dev; enable it with
  `LEAFLET_AUTO_DOWNLOAD_CONVERTER=1`.
- Builds include the Studio voice only with `LEAFLET_STUDIO_VOICE=1`; Store
  builds leave it out.
