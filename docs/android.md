# Leaflet on Android: the touch and orientation design

Written 2026-10-15, when the Android work began (branch `android`). It
builds on [mobile.md](mobile.md), the plan from 2026-10-05, and on a survey
of every place the app leans on a mouse, hover or a keyboard. Where the two
differ, this one is newer. "Phone" is any Android device under 768 px wide
or 520 px tall; "tablet" is one larger in both.

## The rules everything follows

1. **Nothing is only on hover.** A phone has no hover, and a tapped
   element keeps its `:hover` look until the next tap ("sticky hover").
   Hover may decorate (a lift, a colour); it may not reveal, open or
   explain. `hover:` in Tailwind applies only where a device can hover
   (`future.hoverOnlyWhenSupported`); hover rules in CSS that reveal
   something are put under `@media (hover: hover)`, and the thing they
   revealed gets a tap.
2. **A tap does one thing.** A control that opens on hover *and* toggles on
   click opens and shuts on a tap (Android sends the hover events just
   before the click). Open on hover only for a mouse (`pointerType`).
3. **Every `title` can be read.** Holding a finger on anything with a
   tooltip for half a second shows it as a bubble (the Hollow's `TipLayer`,
   made app-wide on touch). Key hints in tooltips ("(Esc)", "Ctrl+F") are
   left out of the bubble on touch.
4. **Targets are 44 px** at least (`--touch-target`), by padding or an
   invisible hit area when the drawing must stay small.
5. **Back closes the top thing**, one press at a time, and leaves Leaflet
   only from the Library with nothing open (`platform/back.ts`).
6. **The system's bars are respected.** Leaflet draws edge to edge, under
   the status and gesture bars, and keeps text and controls clear of them
   with `--inset-top/right/bottom/left` (`platform/device.css`), set from
   the real window insets on Android.
7. **The keyboard never covers what is typed.** The window resizes for it,
   and a field near the bottom (a note, go-to-page) rides above it
   (`--inset-keyboard`).
8. **A turn of the phone loses nothing.** Rotation is a resize (the activity
   is not restarted); open sheets stay open, the reading place stays the
   place, a half-typed note stays typed.
9. **Words follow the device.** No "click", "right-click", "drag a file
   here", "Esc", "Windows" or "your computer" on a phone: tap, press and
   hold, Back, "this phone".
10. **Sheets, not popovers, on a phone.** Anything that hangs from a button
    on the desktop rises from the bottom on a phone, where the thumb is,
    with a handle, and closes by Back, by a tap outside or a swipe down.

`html` carries what CSS needs: `data-platform="android"`,
`data-input="touch"`, `data-orientation="portrait|landscape"`,
`data-keyboard="open"` (`platform/device.ts`). React has `useOrientation`
and `useTouchInput`.

## The shapes of screen

| | Upright phone (≈ 360–412 × 640–915) | Sideways phone (≈ 640–915 × 360–412) | Tablet |
| --- | --- | --- | --- |
| Navigation | Bottom tab bar (exists) | Side rail, icons with a small label under each; never widens on a tap | Side rail, compact on touch |
| Header | Slim; hides on scroll down (exists) | Hidden while scrolling; title and search only | As desktop |
| Dialogs | Bottom sheets, full width, up to 92 % tall | Centred, as tall as the screen allows, two columns where they have two kinds of thing | Centred |
| Menus (book ⋯, filters) | Sheets | Sheets anchored to the side of the thumb | Popovers |
| Toasts, banners | Above the tab bar | Bottom right, clear of the rail | As desktop |

**The page you are on is the same page turned round.** No screen has a
"portrait version" and a "landscape version" with different contents; the
same parts rearrange.

## Navigation and the app around the pages

- **The side rail** (sideways phone) grows to show labels on hover on the
  desktop. On touch it stays a rail: icons with a 10 px label beneath, and
  never covers the page.
- **Back**: on another tab, Back goes to the Library; on the Library with
  nothing open, Leaflet goes to the background (it is not closed, as other
  apps are not).
- **Adding books**: the Library has an "Add books" button (a round + above
  the tab bar on an upright phone, in the header sideways), opening the
  system picker for EPUB, PDF, comics and Kindle files. Books also arrive
  by **"Open with Leaflet"** and **Share → Leaflet** from Files, Drive,
  Gmail, a browser's downloads. "Drop a book here" is not said on a phone.
- **Long-press a book** opens its menu (the ⋯ is still there, at 44 px);
  the menu is a sheet, and does not close when the keyboard opens for "New
  collection".
- **Pip on the pages** (the one who wanders the app): a tap pokes her; a
  hold without moving opens her menu (the desktop's right-click: continue
  the book, start a focus session, back up, show me around); a hold and move
  picks her up, as now.
- **The phone-is-coming-soon banner and welcome line** are not shown in the
  phone app.

## The reader

### Upright

- **The page is all there is** while reading. The toolbar and the chapter
  dock come and go together with **a tap in the middle third** of the page;
  a tap on either side turns the page; a swipe turns it too. A touch that
  turns a page does not bring the toolbar.
- **The toolbar** has four things: Back, Contents, Aa (type, layout,
  page colour, rotation) and ⋯. Search, Characters, Notes, Ambience and the
  bookmark are in the ⋯ sheet, each a row with its icon. (Eight 44 px
  buttons are 464 px; a phone has 360.)
- **The bottom** has the chapter, "‹ chapter name ›", and the progress bar,
  thick enough to take a thumb (a 28 px hit area over the 4 px line), above
  the gesture bar. Dragging it shows where you would land.
- **Panels are sheets**: contents, Aa, notes, search, characters rise from
  the bottom. Search keeps its field above the keyboard.

### Sideways

- Height is what is short (eight or nine lines under a toolbar), so **all
  chrome hides** while reading, and the middle tap brings it.
- **Layout per orientation**, each remembered: sideways defaults to **two
  columns with pages** (a spread, like an open paperback); "one centred
  column, scrolling" is the other choice. Upright keeps whatever the reader
  chose. Type size is shared.
- **The toolbar is a strip down the right edge** when shown, under the
  thumb, instead of a bar costing a line of text. The chapter dock sits
  bottom left.
- **Notches** are on the short sides now: the text keeps clear
  (`--inset-left/right`); the page colour runs under them.

### Rotation

- Follows the phone, with a **lock in the Aa panel**: "Turn with the phone /
  Keep upright / Keep sideways". Reading lying on your side is the case that
  makes people hate auto-rotate.
- **The place survives every turn**: the line at the top of the page before
  is on the page after.

### Selecting, looking up, notes

- **Press and hold** selects a word, as everywhere on Android; the handles
  widen it. Leaflet's selection bar docks at the bottom (above the gesture
  bar), away from Android's own floating Copy bar near the text.
- **The bar is one row of the five most used** (highlight in the last
  colour, note, look up, "Who is this?", copy) and a ⋯ for the rest (other
  colours, share, "Read from here", search for it). Swatches are 32 px.
- **Look up by double-click** is a mouse thing; on touch the setting is not
  shown, and Look up is first in the bar.
- **A note being typed** sits above the keyboard, never under it.

### PDFs and comics

- **Tap the sides or swipe** to turn, as in books; a tap in the middle for
  the chrome.
- **Pinch to zoom** and pan with one finger when zoomed; **double tap**
  goes between fit-the-page and fit-the-width at the tapped spot.
- Sideways defaults to fit-width and scrolling.
- Go-to-page rides above the keyboard.

### Dotty, SpeedRead, auto-scroll

- **The screen stays on** while a book is open and touched in the last five
  minutes, and always while Dotty, SpeedRead or auto-scroll runs.
- **Resting a finger on the page makes Dotty wait** (exists). The pace pill
  is 44 px, bottom right, above the gesture bar.
- The reader's tour says "tap", not "press Space"; −, + and C keycaps are
  shown only with a keyboard attached.

### Focus lock

Sessions run **full screen**: the status and gesture bars hide (they come
back with a swipe from the edge, as Android does). **Back shows Pip guarding
the way out**, with a "Hold to leave" button; holding it a second leaves,
as holding Escape does on the desktop. ("Hold Esc" is never said on a
phone.)

## Pip's house

- **Upright**: the room across the top (it is twice as wide as tall), the
  shop and drawers as a sheet below. **Sideways**: the room fills the
  screen, the rail of play keys down one side.
- **Small things get finger-sized hit areas** (the fridge is 12 × 20 px
  drawn): an invisible 44 px area round each, never overlapping Pip's own.
- Stroking and tickling by finger: a slow rub on her is a stroke, as the
  mouse's movement over her is.
- The away note and the play keys open on a tap; their labels show on a
  sideways phone too (as small text, not hidden).

## The arcade and the Hollow

- **Upright**: the camp across the top, the bubble and the dock beneath.
  **Sideways**: the camp fills the height; the dock and the next-thing line
  go down the right side. (Today a sideways phone gets 175 px of camp.)
- **Every rule is in a tooltip**, so the hold-for-a-bubble works here as
  everywhere (it already does).
- **Round buttons go to 44 px** on touch (30 today).
- **Dash**: tap to jump, **swipe down to duck** (duck had no touch
  control). Copy says "tap", not "Press Space"; Pause is a button.
- **Double tap** on the burrow and the garden bed works as double-click
  does; the buttons that do the same stay.

## Social

- **Following**: the button says "Following"; a tap asks "Stop following
  X?" (the desktop shows "Unfollow" on hover).
- **The shelf of sessions and the reading calendar**: a tap on a spine or a
  day shows its line (book, minutes, flower), held until the next tap.
- **The composer and the community forms are full-screen sheets** on a
  phone, with the send button above the keyboard.

## Settings

- "Use Windows Theme" is "Use system theme"; sounds follow "the phone's
  volume".
- **Rate Leaflet** goes to Google Play; the update card offers Google Play.
- **Reminders** are real notifications, delivered by the phone whether
  Leaflet is open or not; the same three kinds and rules as on Windows.
  Turning one on is when Android 13+ asks for notifications. When the phone
  has them off, the card says so and "Turn On" opens the phone's page.
  **They do not say the same thing every day** (the owner: "fun
  notifications, not the same all the time"): each kind has several lines
  in Pip's voice (fewer and plainer when she is quiet, none of her when she
  is off), and Saturday and Sunday have their own. A day keeps one line all
  day, never yesterday's, and every line comes round (`reminders/mod.rs`,
  `lines` and `line_for`). Windows says the same lines.
- Desktop-only cards stay hidden (Calibre, library copy, tidy a folder, a
  sync folder, Pip on the desktop). A Kindle file still opens: the built-in
  reader handles most, and the rest are told to convert on a computer.
- **Fonts** are added with the system picker.

## Files on Android

Android gives Leaflet `content://` addresses, not paths. Everything that
picks or saves a file goes through the Android side:

- **Picking** (books, a font): the system picker, the file copied into
  Leaflet's own storage, and that path given to the importer as today.
- **Saving a picture or a sheet** (a quote card, the postcard, the year in
  review, a character sheet): **Share**, which offers Save to Files, Photos,
  Drive and messaging apps alike. "Save" on a phone is the share sheet.
- **Open with / Share to Leaflet**: the manifest takes EPUB, PDF, CBZ/CBR,
  MOBI/AZW3 and plain text, copies the stream in and imports it.

## The Android side (Kotlin and Rust)

- **Back**: MainActivity sends Back to `window.__leafletBack()`; when that
  answers false, the task moves to the background.
- **Insets**: the status, navigation, cutout and keyboard insets, in CSS px,
  sent to the page on every change (`setInsets`).
- **Screen on**, **rotation lock**, **system bars hidden** (focus lock and
  sideways reading): small commands.
- **Sign-in kept**: the session and Drive tokens are kept in Leaflet's
  private storage on Android (no other app can read it), since `keyring` has
  no Android store. (The Keystore is better and comes later.)
- **Google Drive's sign-in** is the laptop's own, run on the phone (see
  "Google Drive between laptop and phone" below).
- **A broken database** shows its message on screen (today it is a Windows
  message box, so on Android the app would start to nothing).
- **Reminders** (`Reminders.kt`, `reminders/phone.rs`): Rust works out the
  plan (`plan_ahead`, as the Windows build leaves with Windows on exit) and
  hands it over whenever Leaflet comes to the front or leaves it, a session
  ends, a book closes or the settings change. Kotlin keeps it in
  `AlarmManager` (inexact: a ten-minute window, and again allowed while
  idle; no exact-alarm permission), sets it again after a reboot or an
  update, and at fire time drops a reminder when Leaflet is in front, the
  day's goal is already met, it is over an hour late, or that kind went out
  today. What went out is read back at the next hand-over. A tap opens the
  book the reader was in. In a debug build,
  `adb shell am broadcast -n com.leaflet.app/.ReminderBootReceiver -a com.leaflet.app.REMINDER_TEST --ei seconds 60`
  sends a sample through the alarm path a minute later.

## Not in this first round

Pairing a phone to a computer by code, Play Store signing and listing, the Keystore,
a home-screen widget. Each is in mobile.md's stages.

## Building it

From PowerShell, in `apps\src-tauri\msix` (run it plainly; piping its
output through `*>&1` makes PowerShell 5.1 stop it, as with the MSIX):

```powershell
.\build-android.ps1                  # debug APK for a phone (arm64)
.\build-android.ps1 -Target x86_64   # debug APK for the emulator
.\build-android.ps1 -Release         # release APK and AAB, unsigned
```

It reads the same `build.env` as `build-msix.ps1` (the Google Drive client,
the account and community switches, the API's address), and in a git
worktree, which has no `build.env` of its own, the main checkout's. It
prints the names of what it took, never the values, finds the SDK, the NDK
and a JDK 21 (Gradle cannot use a newer Java), and says where the APK is.
A debug APK installs on any phone with USB debugging (`adb install -r`).
A release build has to be signed with the upload key before Google Play
takes it; that key is the owner's to make and keep.

## Google Drive between laptop and phone

Built 2026-10-15; not yet tried on a real phone or with a real Google
sign-in. The rules for two devices are in [two-devices.md](two-devices.md).

**One OAuth client for both.** The phone runs the laptop's own sign-in: the
Desktop client compiled in (`LEAFLET_GOOGLE_CLIENT_ID` / `_SECRET`, from
`build.env`), PKCE, and Google's answer to a listener on `127.0.0.1` — on
the phone itself. The consent page opens in the phone's browser; when Google
sends it back to `127.0.0.1:<port>`, Leaflet (still running behind the
browser) takes the code and answers with a page that links back into the
app, `intent://drive-connected#Intent;scheme=com.leaflet.app;…`, followed at
once and as a "Back to Leaflet" button (Chrome sometimes wants the tap). The
manifest has a BROWSABLE filter for that scheme; DevicePlugin ignores it as
a book. Android does not let an app in the background bring itself forward,
so a native "bring to front" would not work; the link is the way back.
`drive.file` belongs to the Google project, not to the client, so the phone
sees the `Leaflet` folder the laptop made. A client pasted in Settings works
the same way on the phone.

An Android-type OAuth client was not used: Google has turned custom URI
schemes off for new Android clients, and its replacement (Credential
Manager with an authorization request) is a native SDK and a Play Services
dependency. If Google ever stops the loopback flow for this client on a
phone, that is the way, and the Drive code below the sign-in stays as it is.

**What the phone gets.** After connecting: the shelf (titles, places,
progress, highlights, the habit, Pip) from `state.json` in one round; covers
are looked up again on the phone (a cover is never synced). A book whose
file is not on the phone shows **Cloud** and downloads when tapped
(`download_book`, streamed into Leaflet's own storage). Opening a book pulls
first, opens where this phone left it, and offers the other device's place
("Your other device is further on: Chapter 14 · 62%. Go there / Stay
here"). It syncs as the app goes to the background and pulls as it comes
back.

**The laptop needs this branch too**: 1.4.2 adds up a day read on both
devices as the larger, not the sum, until it is updated.

**What the owner does by hand**

1. Build the phone app with `apps\src-tauri\msix\build-android.ps1` (it
   reads the same `build.env`, so the same Google client is compiled in;
   nothing new to set). Build the desktop app from this branch as usual
   (`build-msix.ps1`) and install both.
2. On the laptop: Settings → Library → Sync → Connect Drive, sign in, Sync
   Now. Read a few minutes in a book, close it.
3. On the phone: Settings → Library → Sync (or the profile button) →
   Connect Drive. Chrome opens Google's page; sign in with the same account
   and allow. Chrome shows "Leaflet is connected" and should switch back to
   Leaflet (tap "Back to Leaflet" if it does not). Expect the shelf with
   Cloud badges within a few seconds.
4. Tap a book: it downloads and opens at the laptop's place.
5. Read on the phone for five minutes; press Home (a sync goes up). On the
   laptop, Sync Now: the day's minutes are the laptop's and the phone's
   together, and the book offers "Your other device is further on".
6. Edit one highlight's note on both; delete a book on one; turn the
   phone's network off, read, turn it back on: all arrive (two-devices.md).

If step 3 fails at Google ("invalid request", or the browser cannot reach
127.0.0.1), say what the page said: that is the loopback flow refused on a
phone, and the Android-client route above is next.

## How it is checked

- **In the browser preview**, at 360 × 800, 412 × 915 and their sideways
  turns, with touch emulated (`resize_window` mobile preset): every page,
  every sheet, every hover replaced.
- **On the emulator** (`leaflet_phone`, a Pixel 7, Android 37): the app
  built and installed, each part used upright and sideways, Back walked
  from the deepest sheet out, a book read across twenty turns of the phone.
- **Not checked until a real phone**: the feel of the swipes and the
  long-press timing, the selection handles against Android's own bar,
  battery with the screen kept on, a real notch.

## Every feature on a phone

Gone through on 2026-10-15, feature by feature from [features.md](features.md),
outside the reader and Pip (theirs are their own sections). "Preview" is the
browser preview at 360 × 800 and 640/740 × 360 with touch emulated; the
community screens were drawn there against a made-up server (board, reader
card, feed, Discover, communities, duels, inbox, clubs), the rest of them
read in the code. Status: **works**, **fixed** (changed this round),
**hidden** (not offered on a phone), **not checked**.

| Feature | Upright | Sideways | What changed | Status |
| --- | --- | --- | --- | --- |
| Any dialog's backdrop | Sheet; a tap outside closes it | Centred card; same | Closes on the tap's click, and only if the press began on the backdrop (`components/ui/backdrop.ts`): it closed on the press, and the rest of the tap landed on what was under it | fixed |
| Library grid and list | Two covers a row; ⋯ hit at 44 px, hold a book for its menu | Rail; three to four a row | The big "Import Books" box gives way to the books once there are some (the + over the tab bar, or in the header sideways, adds them; the tour points at the +) | fixed |
| Search, filters, sort | Search above the shelf; selects on a row of their own | Header search | The author and genre selects were squeezed to empty 40 px boxes beside the buttons at 360 px; the search key now closes the keyboard | fixed |
| Series, series covers, shelves | Cards one a row; a series' page | Two to three a row | Back from a series, shelf, genre or collection returns to Collections, not to the Library; the back link is hit at 44 px | fixed |
| Collections and the book picker | Sheet with its own scrolling list | Card | — | works |
| Genre wall | Two tiles a row (twelve screen-wide blocks before) | Three a row | `touch-shell.css` | fixed |
| Book menu (collections, series, highlights, finished, remove) | Sheet, by ⋯ or a held finger | Sheet at the thumb's side | — (no rename, details or cover in this menu) | works |
| Highlights and Kindle clippings | Sheet; the clippings file by the system picker (`<input type=file>`, which the WebView supports) | Card | — | works |
| Search inside books | Sheet, field on top | Card | Search key on the keyboard | works |
| Reading calendar, session shelf | A tap on a day or a spine shows its line | Same | — | works |
| Reading pace, daily goal, streak | Settings → Reading; goal ± at 44 px tall | Two columns | — | works |
| Quote card, year in review | Sheet; **Share** opens the share sheet (Save to Files, Photos, a message) | Picture down the left at full height, choices beside it | "Save picture" reads "Share" and says no "Saved." on Android; the Hollow postcard uses the same path (`savePicture`) | fixed |
| Focus session, wrap-up, flower | Library card; wrap-up a sheet | Wrap-up a card, its Done pinned | "Full screen" switch hit at 44 px | works |
| Focus lock | Full screen; Back shows Pip and "Hold to leave" | Same | — (round 1) | works, not on a device |
| Settings | Four tabs; desktop-only cards hidden (Calibre, copies, tidy, sync folder, Pip on the desktop) | Two columns | "A rating on Google Play"; Delete All Data no longer lists a sync folder, copies and Calibre on a phone. Drive and Reminders are their own sections | fixed |
| Fonts | System picker (reader's Aa) | — | — | not checked here (reader) |
| Account: sign up, sign in, confirm, reset | Sheet that scrolls; the window shrinks for the keyboard, so fields stay above it | Card | Email is `username` + email keyboard, so the phone's password manager pairs it with the password; Next/Go keys; codes not autocorrected; "this phone" | fixed |
| Profile and ProfileButton panel | Sheet | Sheet | — | works |
| Friends, add friends, invites | Feed, inbox, clubs, search | Same | Invite, handle and club code go through the **share sheet** on a phone ("Share"), not the clipboard; club code keyboard in capitals | fixed |
| Reader cards, follow | Full-screen drawer; "Following" asks before unfollowing | Drawer at the right | Close, Report and Block hit at 44 px | fixed |
| Posts, composer, feed, Discover | Composer a tall sheet | Card | Post/Cancel stay at the sheet's foot above the keyboard; stars 40 px; like, dislike, report, remove, More hit at 44 px | fixed |
| Communities and threads | List, community, thread | Same | Back walks thread → community → list before leaving the tab; thread actions hit at 44 px | fixed |
| Clubs, duels, presents, leaderboards, badges | As drawn on the board | Same | — | works (preview, made-up server) |
| Admin panel | — | — | Version field takes a number keyboard; the notice is "its store", not "the Store" | fixed |
| Update banner | Above the tab bar; Update opens Google Play | Bottom right | × hit at 44 px | works |
| Rate prompt | Says Google Play, opens it | Same | — | works |
| Welcome and the account offer | Sheet, no Drive or folder choice on a phone | Card | — | works |
| Converter | No Calibre on a phone | — | A book that needs it says to convert it to EPUB on a computer (it promised a sync back that a phone does not have) | fixed |
| "Open with", Share to Leaflet | Imports and opens the book | Same | A file Leaflet cannot read now says so instead of vanishing | fixed |

Left for their owners: Pip's dialogs (`PipShop`, `AlbumDialog`, `DiaryBook`,
`ArcadeOverlay`, `PurchaseConfirm`, `HollowPostcard`) and `ReminderOptIn`
still close on the press; `{...backdropClose(close)}` is the one-line fix.
The Hollow postcard's button still reads "Save picture" on a phone. The
characters setting's three choices are 29 px tall.
