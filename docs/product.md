# Product: what ships, and on what terms

The plan the rest of the docs are built around. When code and this page
disagree, one of them is out of date; fix whichever is wrong.

## Releases

| | Desktop (Windows) | Mobile (Android, later iOS) |
| --- | --- | --- |
| **Price** | Free | Paid |
| **Where** | Microsoft Store (MSIX), published by PaperKite | Google Play (Android); the App Store later |
| **Locked features** | None. Everything works without paying or signing in. | Decided at mobile launch |
| **Status** | 1.5.6 in the Store; 1.5.7 to 1.5.10 on the `android` branch, not released | Android 1.5.10 (version code 1005010), built as test APKs; not yet on Play (the steps, the 14-day closed test first, are in [play-store.md](play-store.md)). iOS is not built |

Store identity (Partner Center):

| Field | Value |
| --- | --- |
| Package identity name | `AdithyaKV.LeafletBookReader` |
| Publisher | `CN=30ED0224-8255-4781-8ACD-EE3EF146115F` |
| Publisher display name | PaperKite |
| Package family name | `AdithyaKV.LeafletBookReader_dhc63ph4798te` |
| Store ID | `9PH0NLGJFF9W` |

Packaging and submission steps are in [release-msix.md](release-msix.md).

## What ships

The same app on Windows and Android (one codebase; [android.md](android.md)
has what differs on a phone).

- **A local library and reader.** EPUB, PDF, comics and plain text open
  directly; other formats convert through an optional Calibre install
  (Windows only).
- **Read aloud** in the system's own voices (Windows' voices, or the phone's
  text-to-speech), a paragraph at a time with pauses, the best voice picked
  for the book, and a speed setting. The optional downloadable **Studio
  voice** ([studio-voice.md](studio-voice.md)) is **not shipped**: sherpa-onnx
  1.x has eSpeak NG (GPL-3.0) compiled in, so Store builds leave it out (it
  is packed only with `LEAFLET_STUDIO_VOICE=1`) until Leaflet runs on
  sherpa-onnx 2.0.
- **A reading habit.** Daily goal, streaks with freezes and a grace day (the
  same streak on every device since 1.5.7), focus sessions, and the session
  bookshelf.
- **Pip**, the reading companion who lives in the app, and **the Hollow**,
  her camp, which grows by chapters of hours read. See [pip.md](pip.md).
- **The Liquid Glass look**, with Settings → General → Appearance → Visual
  effects (Auto, Full, Smooth). A phone defaults to Smooth: no live blur.
- **The reading and the books across devices.** Signed in, the reading
  (places, highlights, history, Pip) goes with the Leaflet account; Google
  Drive or a synced folder carries the book files. Signed out, Drive carries
  both. See [two-devices.md](two-devices.md).
- **Optional Leaflet account** (email and password) on PaperKite's server,
  for the reading across devices and the community. It can be deleted in the
  app or by email ([legal/delete-account.md](legal/delete-account.md)), and
  the server's database is backed up nightly, encrypted
  ([backups.md](backups.md)).
- **Report a problem** in Settings sends the reader's words (and diagnostics,
  if left on) to the server only when they press Send; reports go after 90
  days.

## What is switched off, and how it comes back

Build-time switches in `apps/src/constants/features.ts`. All are off unless
the build environment sets them, except multi-device, which is on from the
`android` branch unless set to `false`. Release builds read them from
`build.env` ([building.md](building.md)):

| Flag | Turns on | In a release |
| --- | --- | --- |
| `VITE_ENABLE_ACCOUNTS` | Optional email + password accounts | **On** |
| `VITE_ENABLE_COMMUNITY` | Leaderboards, follows, kudos, duels, shared shelves | **On** |
| `VITE_ENABLE_MULTI_DEVICE` | Folder sync and "sync across devices" wording | **On** from 1.5 (off in 1.0 to 1.4) |
| `VITE_ENABLE_FULL_PIP_HOUSE` | Every floor of Pip's house and the arcade | Off: the bedroom and garden with starter decor |
| `VITE_ENABLE_DESKTOP_PIP` | Pip on the Windows taskbar | Off, until her window has been tried on a real desktop |

One switch is not a page flag but a build one: `LEAFLET_STUDIO_VOICE=1` packs
the Studio voice's runtime (`msix/build-msix.ps1`, the Android Gradle build).
A Store build must not set it yet (above).

The code behind each is complete. The switches exist so that the first release
promises only what it delivers.

## Why it was backup, and is now sync

Until 1.4 the desktop app called Drive a "backup": one computer, restorable,
because several known issues only bit when two devices wrote at once (see
[release-notes-1.0.md](release-notes-1.0.md) and
[architecture.md](architecture.md)). The two-device fixes came with 1.5
([two-devices.md](two-devices.md)), and since 1.5.3 a signed-in reader's
reading lives with the account. A computer and a phone need 1.5.7 or later
on both to agree on the streak.

## Money

- Nothing is sold in the desktop app, and nothing will be locked behind the
  mobile purchase retroactively.
- The server runs on MongoDB's free tier. The account model keeps per-reader
  data small (an account row, hashed sessions, an optional profile, an optional
  compressed state blob) so the free tier lasts well into the thousands of
  readers.

## Legal pages

Drafts in [legal/](legal/): the privacy policy, the terms of use, and the
delete-account page Google Play asks for (`delete-account.md`). Each must be
reviewed, have its placeholders filled, and be published at a public URL
before a store listing goes live; the Store listing and Google's OAuth consent
screen both require the privacy policy URL. `node site/build.mjs` builds the
pages for GitHub Pages ([play-store.md](play-store.md)). Set the privacy policy URL in
`apps/src/constants/links.ts`.
