# Product: what ships, and on what terms

The plan the rest of the docs are built around. When code and this page
disagree, one of them is out of date; fix whichever is wrong.

## Releases

| | Desktop (Windows) | Mobile (Android, later iOS) |
| --- | --- | --- |
| **Price** | Free | Paid |
| **Where** | Microsoft Store (MSIX), published by PaperKite | Play Store / App Store (not yet built for release) |
| **Locked features** | None. Everything works without paying or signing in. | Decided at mobile launch |
| **Status** | First release | "Coming soon" banner in the desktop app |

Store identity (Partner Center):

| Field | Value |
| --- | --- |
| Package identity name | `AdithyaKV.LeafletBookReader` |
| Publisher | `CN=30ED0224-8255-4781-8ACD-EE3EF146115F` |
| Publisher display name | PaperKite |
| Package family name | `AdithyaKV.LeafletBookReader_dhc63ph4798te` |
| Store ID | `9PH0NLGJFF9W` |

Packaging and submission steps are in [release-msix.md](release-msix.md).

## What the desktop release is

- **A local library and reader.** EPUB, PDF, comics and plain text open
  directly; other formats convert through an optional Calibre install.
- **A reading habit.** Daily goal, streaks with freezes and a grace day, focus
  sessions, and the session bookshelf.
- **Pip**, the reading companion who lives in the app. See [pip.md](pip.md).
- **Backup to the reader's own Google Drive.** One computer's library and
  history, restorable on a new computer by signing in with the same Google
  account. Not multi-device sync; see below.
- **Optional Leaflet account** (email and password) on PaperKite's server. It
  gives one identity across devices ahead of the mobile app, and is required
  for leaderboards when they launch.

## What is switched off, and how it comes back

Build-time switches in `apps/src/constants/features.ts`, all off unless the
build environment sets them. Version 1.0 is built with:

| Flag | Turns on | In 1.0 |
| --- | --- | --- |
| `VITE_ENABLE_ACCOUNTS` | Optional email + password accounts | **On** |
| `VITE_ENABLE_COMMUNITY` | Leaderboards, follows, kudos, duels, shared shelves | **On** |
| `VITE_ENABLE_MULTI_DEVICE` | Folder sync and "sync across devices" wording | Off, until the mobile app |
| `VITE_ENABLE_FULL_PIP_HOUSE` | Every floor of Pip's house and the arcade | Off: the bedroom and garden with starter decor |

The code behind each is complete. The switches exist so that the first release
promises only what it delivers.

## Why backup and not sync, for now

Drive already carries the merged sync document, so a second desktop signed in
to the same Google account converges with the first. The reason to call it
"backup" is honesty about what is tested and supported: one computer, restorable.
Several known issues only bite when two devices write at once (see the known
issues in [release-notes-1.0.md](release-notes-1.0.md) and
[architecture.md](architecture.md)); they are fixed before multi-device is
advertised.

## Money

- Nothing is sold in the desktop app, and nothing will be locked behind the
  mobile purchase retroactively.
- The server runs on MongoDB's free tier. The account model keeps per-reader
  data small (an account row, hashed sessions, an optional profile, an optional
  compressed state blob) so the free tier lasts well into the thousands of
  readers.

## Legal pages

Drafts in [legal/](legal/): the privacy policy and terms of use. Both must be
reviewed, have their placeholders filled, and be published at a public URL
before the Store listing goes live; the Store listing and Google's OAuth consent
screen both require the privacy policy URL. Set that URL in
`apps/src/constants/links.ts`.
