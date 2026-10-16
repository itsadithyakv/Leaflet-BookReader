# Google Play listing and release — Leaflet 1.5 for Android

Paste-ready text and answers for the Play Console, written 2026-10-15 for the
first Android release. Everything here is drafted from what the code does;
the owner checks each answer before submitting, because the answers are the
owner's statement to Google. The Microsoft Store's text is in
[store-listing.md](store-listing.md); the policy is
[legal/privacy-policy.md](legal/privacy-policy.md).

## Before the first upload (the owner's)

1. **A Google Play developer account.** A new *personal* account must run a
   **closed test with at least 12 testers for 14 days in a row** before it
   can publish to everyone. Start that test as early as possible; the
   fortnight runs whatever the code does.
2. **The upload key**, made once and kept forever (docs/android.md,
   "Signing for Google Play"), and **Play App Signing** turned on when the
   first build is uploaded (Google keeps the key that signs what phones
   install; you keep the upload key).
3. **The privacy policy published** at the address the listing gives, with its
   **effective date set** for the 1.5 changes (the date at the top is still
   4 October 2026).
4. **A release build**: `.\build-android.ps1 -Release` in
   `apps\src-tauri\msix`, with `build.env` (the Google Drive client, accounts
   and community switched on) and the signing key in place. Upload the
   `.aab`.
5. **The desktop app from the same branch.** Sync between a computer and a
   phone needs 1.5 on both (docs/two-devices.md); a computer still on 1.4.2
   counts a day read on both only once.

## Store listing

**App name** (30 characters at most): `Leaflet: Book Reader & Pip` (26)

**Short description** (80 at most):

> Read your own EPUBs, PDFs and comics, build a reading habit, and meet Pip. (74)

**Full description** (4,000 at most):

> Leaflet is a book reader for the books you already own. Add your EPUBs,
> PDFs and comics from your phone, from Drive or from any app that shares
> them, and read them your way: no store, no subscription, nothing locked.
>
> **Made for your phone, upright and on its side**
> Turn pages with a tap or a swipe, or scroll. Turn the phone on its side and
> the page becomes a two-column spread, like an open paperback; turn it back
> and you are on the same line. Lock the rotation when you read lying down.
> Pinch to zoom a PDF, double-tap to fit it to the width.
>
> **A library that sorts itself**
> Own a whole series? Leaflet puts it together in reading order and tells you
> what's next. Shelves for what you're reading, what you've finished and what
> you just added keep themselves up to date. Make your own collections too.
>
> **Reading the way you like it**
> Highlight in four colours, add notes, look words up, and see who's who in a
> long fantasy. Smart Read's guide dot learns how fast you read, book by book;
> rest a finger on the page and it waits. Or try SpeedRead, one word at a
> time.
>
> **A habit, not a chore**
> Set a daily goal and build a streak, with freezes and a grace day for busy
> weeks. Gentle reminders (never at night, never once you've read) come with
> a different line from Pip each day.
>
> **Meet Pip**
> Pip lives in the app. Your reading grows Pip's garden, fills Pip's house,
> and builds Pip's camp in the Hollow, a little game your reading runs. Pip's
> tab plays sideways, as games do.
>
> **One library on your phone and your computer**
> Sign in to the same Leaflet account on both, and your places, highlights
> and streak follow you; your own Google Drive brings the books. Open a book
> on the phone and Leaflet offers the place you reached on the computer.
> Leaflet can see only the files it made in your Drive. An account is
> optional (without one, the same Google Drive on both keeps everything in
> step), and so is the community: friends, book clubs, reviews, quotes and
> book communities, with a profile that you control.
>
> Opens EPUB, PDF, CBZ, TXT, HTML and FB2, and most Kindle books (MOBI, AZW3)
> without DRM.

**Category:** Books & Reference. **Tags:** e-reader, reading habit, EPUB.
**Contact email:** the support address in the app (constants/links.ts).
**Privacy policy URL:** where `legal/privacy-policy.md` is published.

**Screenshots** (phone: at least 2, 16:9 or 9:16; tablet 7" and 10" if the
tablet layouts are to be featured): the library upright, a book upright, the
sideways spread, Pip's house sideways, the Hollow sideways, Settings →
Reminders. Take them on a real phone or the emulator with
`adb exec-out screencap -p` (the DevTools route leaves canvases blank).

## App content answers

**Ads:** No ads.

**App access:** All of the app can be used without signing in; nothing to
give reviewers. (If asked: the community needs an account, which anyone can
create in the app.)

**Target audience and content:** 13 and over. Not designed for children
(the policy says so: "not directed at children under 13").

**Content rating (IARC questionnaire):** Category "Reference, News, or
Educational" or "Other" (a reader, with a game inside). Violence: none
(Pip's camp has cartoon "prowlers" turned away; no blood, no injury). Users
can interact: **yes** (posts for followers or everyone, threads and
replies in book communities, follows, book clubs, presents). User-generated
content is shared: **yes**, moderated (reporting, blocking, removal,
suspension; [community guidelines](legal/community-guidelines.md)). Shares
location: no. Digital purchases: no (none yet). Gambling: no (the seeds staked
on a duel are earned by reading and buy nothing outside the app).

**Data safety form** (what leaves the phone, per the policy):

| Data type | Collected | Shared with third parties | Optional | Why |
| --- | --- | --- | --- | --- |
| Email address | Yes, with an account | No | Yes | Account management |
| Name (display name) | Yes, with an account | No | Yes | Account, app functionality (profile) |
| User IDs (the `@handle`) | Yes, with an account | No | Yes | App functionality |
| Other user-generated content (posts, reviews, quotes, threads, replies; highlights and notes inside the synced reading state) | Yes, with an account | No | Yes | App functionality |
| App activity: other actions (reading places and history, reading minutes, streak, books finished, shelf titles, the book open now, level, badges, arcade scores, the camp's layout, likes, follows, reports, blocks) | Yes, with an account | No | Yes | App functionality |
| Device or other IDs (a random per-installation identifier in the synced reading state) | Yes, with an account | No | Yes | App functionality (sync) |

- **Book files (always), and reading state kept in Google Drive by a reader
  who is signed out**, go from the phone to the reader's own Drive and never
  reach us: by Google's definitions that is not data the developer collects.
  Signed in (from 1.5.3), the reading state always goes to the Leaflet
  account too: hence "Yes, with an account" above. It is compressed, sent
  over HTTPS, and not read.
- **Words looked up, names looked up on a fan wiki, titles sent to Open
  Library:** sent only when the reader asks, with no identifier; list them
  under "Other actions" only if Google's reviewer asks, since nothing is
  stored or linked to the reader.
- **Encrypted in transit:** yes (HTTPS). **Deletion:** yes, in the app
  (Settings → Account → Delete account) and by email.
- **Not collected:** location, financial information, health, messages,
  photos and videos, audio, files (beyond the above), calendar, contacts,
  web browsing, crash logs (diagnostics are copied by the reader and sent
  only if they choose to email them).

**Permissions** the app asks for, and why (Play asks for no declaration for
these): `INTERNET` (the account, sync, look-ups), `POST_NOTIFICATIONS`
(reading reminders, asked when one is turned on), `RECEIVE_BOOT_COMPLETED`
(to set reminders again after a restart), `FOREGROUND_SERVICE` (a short
service, type `shortService`, only while Google Drive's sign-in is open in
the browser, so Android does not pause Leaflet before Google sends the
reader back). If the Play Console's foreground-service form asks about it
anyway: "Short service: finishing Google Drive sign-in; ends when the browser
returns, at most ~3 minutes; user-started."

**News app:** no. **Government app:** no. **Financial features:** none.
**Health:** none.

## Release notes for 1.5 (Play's "What's new", 500 characters)

> Leaflet is on Android. Read upright or sideways, with taps, swipes and pinch
> to zoom. Pip's house and the Hollow, sideways. Reminders with a different
> line from Pip each day. Connect the same Google Drive on your computer and
> your phone, and your books, places, highlights and streak follow you.

## Release notes for 1.5.3 (Play's "What's new", 500 characters)

> Signed in, your places, highlights, notes and reading days now follow your
> Leaflet account to every device, with nothing to switch on. Your own Google
> Drive brings the book files. One phone, two readers: each account keeps a
> library of its own, and Leaflet never mixes two accounts' reading.
