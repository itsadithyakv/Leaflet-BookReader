# Building

## Prerequisites

- **Node** 18+ and **Rust** (stable, MSVC toolchain on Windows)
- Tauri's platform prerequisites — WebView2 on Windows, `webkit2gtk` on Linux,
  Xcode command line tools on macOS

```bash
npm install
npm --prefix ./apps install
```

## Desktop

```bash
npm run tauri -- dev            # dev, frontend on port 1421
npm --prefix ./apps run tauri build
```

Frontend only, in a browser (no Tauri backend, so `invoke` calls no-op and the
library stays empty):

```bash
npm --prefix ./apps run dev
```

## Android

The generated project is committed at `apps/src-tauri/gen/android`. Four things
have to be right, and each fails at a different, confusing point:

### 1. NDK

Separate from the SDK, and not installed with it.

```bash
sdkmanager "ndk;27.3.13750724"
export NDK_HOME="$ANDROID_HOME/ndk/27.3.13750724"
```

### 2. JDK 17 or 21 — **not** a newer one

Gradle's build scripts are compiled by Groovy, which cannot read class files
newer than it supports. A JDK 26 **launches Gradle fine** and then fails minutes
later with `Unsupported class file major version 70`.

```bash
export JAVA_HOME=/path/to/jdk-21
```

### 3. Rust targets

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi \
                  i686-linux-android x86_64-linux-android
```

### 4. Windows only — Developer Mode

The Tauri CLI **symlinks** the compiled `.so` into `app/src/main/jniLibs/`, and
Windows refuses to create symlinks without it. The build otherwise runs to
completion and dies at the very last step with
`Creation symbolic link is not allowed for this system`.

Turn on *Settings → System → For developers → Developer Mode*, or build from an
Administrator terminal.

### Build

```bash
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.3.13750724"
export JAVA_HOME="$LOCALAPPDATA/Programs/jdk21/jdk-21.0.12.1+1"

npm --prefix ./apps run tauri android dev                      # on device/emulator
npm --prefix ./apps run tauri android build -- --apk --aab     # release artifacts
```

Output: `apps/src-tauri/gen/android/app/build/outputs/`.

> Gradle drives the Rust build **through the Tauri CLI**
> (`:app:rustBuildArm64Debug` shells back out to `tauri android android-studio-script`),
> so run the CLI commands above. `gradlew assemble*` on its own cannot satisfy
> that callback.

## Size

Measured on this project, arm64:

| Artifact | Debug | Release |
| --- | --- | --- |
| Native library | 199.7 MB | **13.6 MB** |
| APK | 206.5 MB | **16.2 MB** |
| AAB | 61.9 MB | **10.7 MB** |

Almost all of the debug bulk is the Rust library's symbol table. **Never install
a debug APK to judge size.**

Further levers, in order of effect:

1. **Ship the AAB.** Play splits it per device, so a phone downloads one
   architecture rather than all of them.
2. **`--split-per-abi`** does the same for direct APK distribution.
3. The Calibre converter is already **compiled out** of mobile builds; the
   release binary contains no `ebook-convert`, `calibre-portable` or related
   strings.

The frontend contributes about 4 MB, of which pdf.js (1.3 MB) and the leather
texture (1.3 MB) are the largest — not worth chasing next to the native library.

## Google Drive credentials

Drive sync needs an OAuth client of type **Desktop app**. It resolves from, in
order: a client the reader entered in Settings, `option_env!` values compiled in
at build time, then the runtime environment.

```bash
LEAFLET_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
LEAFLET_GOOGLE_CLIENT_SECRET=...
```

See `apps/.env.example`. Compiling them in is what makes a *release* build work —
a packaged app is launched from wherever the shortcut points and finds no `.env`.
The Settings route exists so Drive is usable without a rebuild.

Google treats desktop clients as public: the secret is not confidential, and PKCE
is the actual protection. Folder sync needs none of this.

**One client for everyone.** Readers never create their own Google client: you
create one Desktop client, compile it into the release, and every reader signs
in with their own Google account. Their files land in their own Drive.
`drive.file` only lets a client see files that same client created, so readers
using different clients would each get a separate, invisible Leaflet folder. In
Google's consent screen, publish the app to **Production**: in Testing mode,
Drive sign-ins expire every 7 days and only 100 listed test users can sign in.

## Build-time values

Everything compiled into a release, in one place. Set them in the environment of
the build (the MSIX script warns about any that are missing):

| Variable | Read by | Effect |
| --- | --- | --- |
| `LEAFLET_GOOGLE_CLIENT_ID`, `LEAFLET_GOOGLE_CLIENT_SECRET` | Rust, `option_env!` | Drive backup |
| `VITE_ENABLE_ACCOUNTS` | Frontend | Shows the Account card (`"true"`) |
| `VITE_ENABLE_COMMUNITY` | Frontend | Leaderboards and the community UI (`"true"`) |
| `VITE_ENABLE_MULTI_DEVICE` | Frontend | Folder sync and multi-device wording; off until mobile ships |
| `LEAFLET_API_BASE` | Rust, `option_env!` | Fallback API address; the signed config normally wins |
| `LEAFLET_CONFIG_URL` | Rust, `option_env!` | Where the signed config lives; defaults to GitHub Pages |
| `LEAFLET_STORE_BUILD` | Rust, `option_env!` | Set by the MSIX script: compiles out the Calibre auto-installer |

`build.rs` declares each Rust one with `rerun-if-env-changed`, so changing a
value rebuilds the crate instead of silently keeping the old one.

## Microsoft Store

`apps/src-tauri/msix/build-msix.ps1` builds and packages the MSIX. The whole
release, including the website and the API server, is in
[release-msix.md](release-msix.md).
