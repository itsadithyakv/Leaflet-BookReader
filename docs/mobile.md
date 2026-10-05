# The phone app: a plan

Written 2026-10-05, before any phone work. Nothing here is built unless it
says "exists". It is a plan to argue with, in the order the work should go.

## Where it starts from

More is in place than "a phone version" suggests, because the app was laid out
for it from the start (see [architecture.md](architecture.md)):

- **It is one codebase.** The Android project is committed
  (`apps/src-tauri/gen/android`), the Rust side is a library for exactly this
  reason, Calibre is compiled out of phone builds, and a release APK was
  measured at 16 MB ([building.md](building.md)).
- **The build tools are on the owner's machine** (checked 2026-10-05): the
  Android SDK and NDK 27.3, platform 36, JDK 21, the four Rust targets, and
  Windows Developer Mode. Android Studio itself is gone and is not needed.
  See "Building it today" at the end.
- **The layout already bends.** One responsive layout, a bottom tab bar on an
  upright phone, a side rail on a landscape one, 44 px touch targets,
  safe-area insets, and every page measured down to 380 x 480.
- **Sync is built for several devices.** One merged document over Drive, a
  folder, or the Leaflet account; book ids are the file's hash, so a book is
  the same book everywhere. It is sold as "backup" only because two devices
  were never tested together.
- **Turning pages by touch exists**: tap zones, swipes and `touch-action`
  were added in the 1.2 bug pass.

What has never happened: the app has not been run on a phone in this round of
work, and nothing below has been seen on one.

## What "hand in hand" means

The phone and the laptop are one library and one reader:

1. **The same shelf.** A book added on the laptop shows on the phone at once
   (title, cover, progress) and downloads when tapped.
2. **The same place.** Open a book on the phone and it offers the laptop's
   place: "Your laptop is further on: Chapter 14 · 62%. Go there / Stay
   here." Offered, never done silently: a place lost to a sync is worse than
   one tap.
3. **The same habit.** One streak, one daily goal, one count of minutes, read
   on either. One Pip, one house, one purse of seeds.
4. **The same notes.** Highlights, bookmarks, the character sheets, and the
   pace Dotty has learned.
5. **Each device keeps its own look.** Type size, layout, margins and page
   colour are per device already (they are preferences, not library data),
   which is right: nobody wants a laptop's type size on a phone.

## Stage 0: make two devices safe (before any phone screen)

These are faults in what exists. They do not show with one computer and will
show on the first day with a phone.

| Fault | Why it bites | Fix |
| --- | --- | --- |
| **Sign-in does not survive a restart on Android.** The session token is kept with the `keyring` crate, which has Windows, macOS and Linux stores only; elsewhere it keeps the token in memory. | Signed out at every launch; the same for the Drive token. | Keep tokens in the Android Keystore (iOS Keychain later) behind the same two functions in `sync/cloud.rs` and `sync/drive.rs`. |
| **A day read on both devices counts once.** `merge.rs` takes the larger of the two devices' minutes for a day, not the sum ("neither device knows how much the other read"). | 20 minutes on the laptop and 20 on the phone is 20: the goal is missed and seeds are short. | Minutes per device inside the day: each device's own figure merges by maximum, the day's total is their sum. Old documents read as one unnamed device. |
| **Mixed versions drop data.** An older app saving the document drops fields it does not know (release notes, known issues). | A phone on last month's version erases the laptop's new records. | A document version: an app that meets a newer one reads it and does not write it, and says "update Leaflet on this device". |
| **Edits at the same moment can overwrite each other** on Drive. | Reading on the train while the laptop is open at home. | Already retried on a conflict (`If-Match`); needs a two-device test that proves it, which has never been run. |
| **Sync runs on launch and when a book closes.** | Android stops a background app without warning: the last half hour never leaves the phone. | Also sync when the app goes to the background and when it comes back, and pull before offering a place. |
| **Seeds spent on both devices offline can overdraw** (shows as 0, the garden refills). | Rare; harmless. | Leave. |

Also in this stage: split `ReaderView.tsx`. **Done 2026-10-05**: the reader
is now a page of 150 lines over 24 hook files and 8 components in
`apps/src/readers/text/` ([features.md](features.md), "Where its own code
lives"). A phone change to the reader now lands in the file for its concern:
the keys in `useReaderKeys.ts`, page turns and their gestures in
`usePageTurning.ts`, the toolbar and its menu in `ReaderToolbar.tsx` and
`ReaderMoreMenu.tsx`, SpeedRead's stage in `SpeedReadStage.tsx`.

**Done when:** two copies of the desktop app on two Windows accounts, signed
in to the same accounts, pass a written two-device script (read on both in one
day, edit a highlight on both, delete on one, go offline on one).

## Stage 1: it runs on a phone and reads a book

The Android shell, each a small native piece (Tauri plugins exist for most):

- **Back** (the button and the edge swipe) closes the top thing: a popover,
  a panel, then the book, then leaves the app. Today these are the Escape
  layers; Back should walk the same list.
- **Edge to edge.** Android 15 draws apps under the status and gesture bars.
  The CSS insets exist; they need checking on a real notch, with a fallback
  that passes the insets in from the native side if the WebView reports none.
- **Reading mode hides the system bars**; a tap in the middle brings back
  them and the toolbar together.
- **The screen stays on** while a book is open and something has been touched
  in the last few minutes, and always while Dotty or auto-scroll runs.
- **Rotation lock** (see the next section).
- **The keyboard** must not cover the search field or a note being typed.
- **"Open with Leaflet"** and the share sheet for EPUB, PDF and comics: the
  way most books reach a phone. The manifest has no file intents yet.
- **Phones are narrower than the smallest window.** Most Android phones are
  360 to 412 CSS px wide; the layout was measured to 380. Add 360 x 640,
  360 x 800, 393 x 852, 412 x 915 and their landscapes to the measured sizes.
- **Nothing may depend on hovering**: the dock is drawn small until pointed
  at, the pace control wakes on hover, avatars play their move on hover, the
  progress bar's bubble shows on hover. Each needs a touch answer (mostly:
  a tap wakes it).

**Done when:** import a book on the phone, read it in both layouts and both
orientations, close it, reopen at the same line.

## Reading upright and sideways

People read both ways and switch mid-chapter, often lying down. The rules:

**Rotation**
- Follows the phone by default, with a **lock in the reader** (a button in
  the toolbar and in the text settings): this way up, sideways, or follow the
  phone. Reading on your side in bed is the case that makes people hate
  auto-rotate, and the system's own lock is two swipes away.
- **The place survives a turn.** It should already: a rotation is a resize,
  the 1.2 bug pass made a resize lay the page out round the reading line, and
  the Android activity is set not to restart on rotation. This is the first
  thing to test on a real phone, in both layouts, twenty turns in a row.

**Upright (about 390 x 844)**
- One column, 16 to 20 px side margins, about 35 to 45 characters a line at a
  comfortable size, which is what a paperback has.
- Pages or scroll, the reader's choice. Pages is what most phone readers
  expect: tap the right third to go on, the left to go back, the middle for
  the toolbar; swipe either way.
- Everything reachable with a thumb is at the bottom: the dock, and the
  panels (text settings, contents, notes, search) as **sheets that rise from
  the bottom**, not popovers hanging from a toolbar the thumb cannot reach.
  The 1.2 work pinned the popovers inside a narrow window; on a touch screen
  they should become sheets.

**Sideways (about 844 x 390)**
- The problem is height: under the toolbar and over the dock there are eight
  or nine lines. So **all chrome hides** while reading, and one tap brings it
  back.
- The line is too long across the whole screen (over 100 characters). Two
  honest choices, offered as a setting, defaulting to the first:
  1. **Two columns with pages**: a spread, like an open paperback. About
     twenty lines a turn.
  2. **One centred column, scrolling**: margins either side, the natural way
     to read a long article sideways.
- Controls move to the **right-hand edge**, under the thumb, instead of a bar
  that costs a line of text.
- Notches and camera holes are on the short sides now: the text keeps clear
  of them, the page colour runs under them.

**Each orientation remembers its own layout and columns.** Upright in pages
and sideways in scroll is a perfectly sensible reader; type size is shared.

**Fixed pages (PDF, comics)** are the hard case: a page made for A4 is tiny
upright. Pinch to zoom, double-tap to fit the text column, and sideways
defaults to fit-width and scrolling, which is how a PDF is read on a phone.
The PDF renderer's sharpness budget (50 million pixels) is a desktop figure
and must drop with the phone's memory; iOS caps a single canvas near 16.7
million pixels.

**Selecting text.** Press and hold selects, as everywhere on a phone. Android
shows its own Copy / Share bar over a selection, which will sit on top of
Leaflet's (highlight, look up, "Who is this?"): the native one has to be
switched off inside the book. This is the piece of the reader most likely to
need trial and error on a real device.

## Dotty on a phone

Dotty today is driven by Space, the arrow keys, a mouse drag and the − / +
keys. None of those exist on a phone. What replaces each:

| On the laptop | On the phone |
| --- | --- |
| Space starts and pauses | A play button in the dock, under the thumb. While Dotty runs, a tap in the middle of the page pauses. |
| Holding the mouse on the text makes Dotty wait | **Resting a finger on the page makes Dotty wait; lifting it carries on.** This exists already and is the most natural gesture a phone has. |
| Drag Dotty, or arrow keys, to choose a line | Press and hold a word, then **"Read from here"** in the selection bar (new). Dragging Dotty still works, but lifted clear of the finger with its line marked, since a 7 px dot under a thumb cannot be seen. |
| − and + keys set the pace | The − / + pill at 44 px in the bottom corner, and a **slide up or down the right edge** while Dotty runs, showing "310 wpm" as it changes. |
| Scrolling ahead: Dotty catches up and learns | The same; a flick's coasting counts as scrolling until it settles. |
| "Still reading? Press Space" after 5 minutes | "Tap to carry on." A finger on the screen is input, so a reader who rests a thumb never sees it. |

- **The screen never sleeps while Dotty runs**, and Dotty stops when the app
  goes to the background, the screen locks or a call comes in.
- **Sideways**, the page step is already worked out from the lines actually
  visible, so it will step more often; the controls go to the side.
- **Smart Read is for the scrolling layout only** today (the menu says so).
  On a phone most people will be in pages. First release: starting Smart
  Read switches to scrolling, as on the laptop. Later: Dotty walks a page and
  turns it.
- **A short buzz** when Dotty is placed and when it pauses (Android; iOS has
  no vibration from a web view).
- **The tour** is rewritten for touch: every "press Space" becomes a tap.

**SpeedRead is the phone's best trick.** One word at a time needs no screen
at all, and the stage already fits a word to any width. Tap to play and
pause; swipe left for the sentence again, right to skip one; slide up and
down for speed. And one new mode worth trying: **hold to read**, where the
words run only while a thumb is down. It cannot run on unattended, and it
suits a bus.

**Pip** needs less: she is thrown with a finger as with a mouse (pointer
events), her house was fitted to a 380 px window in the 1.2 pass, and the
room is twice as wide as tall, so it sits across the top of an upright phone
with the shop as a sheet below, and fills a sideways one. Left to do: the
smallest things in the room (the fridge is 12 x 20 px) need finger-sized
targets. Pip on the desktop has no phone meaning; a home-screen widget is its
phone cousin and comes after launch.

## Signing in

Three things get signed in to, and they should not be confused:

**1. The Leaflet account** (who you are: streak, seeds, Pip, the community).

- **From the laptop, with a code.** Settings → Account → **Add your phone**
  shows an eight-character code and a QR of it, good for five minutes and one
  use. The phone's first screen offers "I have Leaflet on my computer": type
  the code or scan it. No password is typed on a phone keyboard, and the
  laptop is proof enough. On the server it is the password-reset machinery
  again (codes stored hashed, a few tries, one use) issuing an ordinary
  session. Typed code first; the camera is a convenience added after.
- **Email and password**, as now, with the fields marked so the phone's
  password manager fills them.
- **Not at all.** The phone works as a reader with no account, as the laptop
  does.
- Later, if wanted: "Continue with Google". It would mean the server
  learning to check Google's tokens, and on the App Store it obliges "Sign in
  with Apple" as well. Not for the first release.

**2. Google Drive** (where the book files are). The server never holds books
and the free database tier could not. So a phone that wants the laptop's
books connects the same Google account, once, after signing in: "Get your
books: connect Google Drive."

- The laptop's sign-in listens on `127.0.0.1` for Google's answer. On a phone
  the browser must hand back to the app by a link instead, with an OAuth
  client of the Android kind (tied to the app's package and signing key, no
  secret).
- **To settle by a one-hour experiment before anything else is built on it:**
  that an Android client and the existing Desktop client in the same Google
  project see the same Leaflet folder under the `drive.file` scope. If they
  do not, the phone cannot see the laptop's books through Drive and the plan
  changes (the fallback is the Desktop client's own flow on the phone, which
  Google discourages).
- Without Drive the phone still gets the shelf, the places and the habit
  through the Leaflet account; books are then added on the phone by hand.

**3. The Play Store purchase**, which is the Google account on the phone and
asks nothing of Leaflet (see Money).

**The first five minutes on a phone**, then: open → "I have Leaflet on my
computer" → type the code → the shelf appears with covers → "Connect Google
Drive to download your books" → tap a book → it opens at the laptop's place.

## What comes across, and what does not

| | On the phone |
| --- | --- |
| Library, series, collections, search, filters | Yes |
| EPUB, PDF, comics, text | Yes |
| Kindle and other formats that need Calibre | Not converted on a phone. Convert on the laptop; the converted book arrives as an EPUB. A phone-only reader is told so. |
| Scroll and pages, type settings, page colours | Yes, with the work above |
| Smart Read, SpeedRead, auto-scroll | Yes, with the work above |
| Highlights, notes, bookmarks, look-up, characters | Yes; selection needs the native bar tamed |
| Daily goal, streak, sessions, the bookshelf | Yes |
| Reminders | **Yes, and better**: real notifications, which the phone delivers whether Leaflet is open or not. Today the card is hidden on Android. One rule to add: a phone should not nag about a goal the laptop met an hour ago, so it syncs quietly before a reminder is due when it can. |
| Focus lock | Not at first. Android's screen pinning is the nearest thing and asks the reader each time. |
| Pip's house, garden, shop, diary, expeditions, visitors, arcade | Yes |
| The radio | Yes while Leaflet is in front. Playing on with the screen off is a later, separate piece. |
| Community, leaderboards, duels | Yes |
| Pip on the desktop | No. A home-screen widget, after launch. |
| Keyboard shortcuts sheet | Replaced by a short sheet of gestures (shown when a keyboard is attached, as on a tablet) |

## Money and the store

- Product.md says the phone app is **paid**. The simplest honest form is
  **paid once, up front, in Play**: no purchase code in the app, no receipts
  on the server, nothing locked on the laptop. A free app with an unlock
  inside needs Play Billing and server checks, for no gain at this size.
- **Play's rule for new personal developer accounts** is a closed test with
  twelve testers for fourteen days before a public release. If the Play
  account is new, that fortnight is on the calendar whatever the code does;
  the demo readers are the obvious testers.
- The upload signing key is the owner's to make and keep, like the config
  key. The Android icons are still the old ones (HANDOFF).
- The privacy policy gains a phone section (notifications, the camera if the
  QR scan is built) and Play's data-safety form is filled from it.
- **iPhone after Android**: it needs a Mac and Apple's developer programme,
  and its web view differs in ways that cost time (canvas limits, no
  vibration, its own selection behaviour).

## Order of work

| Stage | What | Size |
| --- | --- | --- |
| 0 | Two devices safe: token storage, minutes per device, document version, sync on background, two-device test; split the reader file | Medium |
| 1 | Runs and reads: Back, insets, system bars, screen on, keyboard, "Open with", 360 px widths, no hover | Medium |
| 2 | Reading upright and sideways: rotation lock, sheets, sideways columns, per-orientation layout, selection, PDF and comic zoom | Large |
| 3 | Hand in hand: account pairing by code, Drive on Android, download on tap, "your laptop is further on", multi-device switched on in both apps | Large |
| 4 | Dotty and SpeedRead by touch; the tour | Medium |
| 5 | Notifications; Pip's finger-sized targets | Small |
| 6 | Store: signing, listing, closed test, policy | Small, plus the fortnight |

Stages 0 and 1 unblock everything. The Drive experiment in "Signing in"
should be run during stage 0, because stage 3's shape depends on it. The
desktop app needs a release alongside the phone's (pairing, minutes per
device, the document version), so 1.2 should go out first as it is.

## Building it today

Everything needed is installed; only three variables are missing from the
shell, and the `java` on the PATH is version 26, which Gradle cannot use.
In PowerShell, from `D:\Leaflet`:

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME     = "$env:ANDROID_HOME\ndk\27.3.13750724"
$env:JAVA_HOME    = "$env:LOCALAPPDATA\Programs\jdk21\jdk-21.0.12.1+1"
npm --prefix .\apps run tauri android dev
```

with a phone plugged in and USB debugging on (or an emulator running). For a
file to copy to a phone instead:

```powershell
npm --prefix .\apps run tauri android build -- --apk --debug
```

The first build compiles the Rust side for Android and takes a good while.
What to expect from it today: the library and the reader work; sign-in is
forgotten at every launch; Back leaves the app; reminders are hidden; Drive
sign-in will probably not come back to the app. That list is stages 0 and 1.
