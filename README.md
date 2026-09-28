# Leaflet

A calm ebook reader for Windows that turns reading into a daily habit, with
Pip, a pixel-art companion who lives in the app. Built with Tauri 2, Rust and
React. Free on the Microsoft Store, with nothing locked; a paid mobile app comes
later. Made by PaperKite.

Website, privacy policy and terms: https://itsadithyakv.github.io/Leaflet-BookReader/

## What it does

- **Library.** EPUB, PDF, comics and plain text open directly; MOBI, AZW3 and
  others convert through an optional Calibre install. Metadata and covers fill in
  from Open Library and Wikipedia, cached for offline use.
- **Reading.** A scroll reader with chapters and bookmarks, auto-scroll, Smart
  Read (Dotty, the adaptive pacing dot) and RSVP speed reading, and several paper
  finishes.
- **A habit.** A daily goal, streaks with freezes and a grace day, focus
  sessions, and a session bookshelf where every spine is a session you finished.
- **Pip.** Lives in the header logo, hops out to walk the app, celebrates your
  goals (usually by boxing), gives the tour, and can be picked up and thrown.
- **Backup.** Your library and history, backed up to your own Google Drive with
  the `drive.file` scope: Leaflet only sees files it created.
- **Optional account and leaderboards.** Email and password on PaperKite's
  server, for weekly leaderboards, follows, kudos and reading duels. Nothing else
  needs an account.

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

## Key Pipelines

### Import + Convert + Metadata
1. User imports books (EPUB/PDF/AZW3/MOBI).
2. Non-EPUB formats are converted when possible via the bundled converter.
3. Books are stored locally in the library.
4. Metadata refresh attempts fill missing title/author/cover info.
5. Cover artwork is cached locally for offline use.

### Reading Progress
1. Reader updates progress as the user reads.
2. Progress is stored in the library store and persisted locally.
3. Library cards show completion percentage and “Finished” when complete.

### Reader Experience
1. EPUB content is rendered in the reader view.
2. Theme, typography, and layout are applied consistently.
3. Optional reader dot marks the last read line after a short idle delay.
4. Auto-scroll and font sizing are controlled from reader settings.
5. Sidebar open/close uses eased transitions with a masked layout freeze to avoid text reflow flashes.

### Focus Sessions + Bookshelf
1. User starts a timed focus session.
2. Checkpoints (50/90/100%) prompt gentle toasts.
3. On completion, a bookshelf item is created with session metadata.
4. Clean sessions receive a visual bonus.

## Tech Stack

- **Tauri** (desktop shell)
- **React + TypeScript** (UI)
- **Zustand** (state management)
- **epub.js** (EPUB rendering)

## Local Storage + Data

- Library, reader preferences, and bookmarks are stored locally.
- Covers are cached in the app data directory for offline use.

## Notes

- EPUB reading is supported in the reader.
- PDF files are stored in the library and can be imported; reader support is focused on EPUB.
- Converter download is optional in dev; enable with `LEAFLET_AUTO_DOWNLOAD_CONVERTER=1`.

