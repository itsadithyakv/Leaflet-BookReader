# Leaflet Privacy Policy

**Effective date:** 4 October 2026

**Who we are:** Leaflet is made by PaperKite ("we", "us"). Contact: [adithyakrishnan.vinod@gmail.com](mailto:adithyakrishnan.vinod@gmail.com)

Leaflet is a reading app. Your books and your reading history live on your own
device. We built it so that we do not need to see them, and in most cases we
cannot.

## The short version

- Leaflet has no ads, no analytics and no tracking.
- Your books never leave your device unless you turn on backup to **your own**
  Google Drive. We cannot see what is in your Drive.
- An account is optional. If you create one, we store your email address, a
  scrambled (hashed) form of your password, and, while your profile is public,
  the reading statistics shown on it.
- From Leaflet 1.2, a new account's profile is **public by default**. The
  sign-up form shows the "Share my profile" switch and what it makes visible;
  you can turn it off there, or make your profile private at any time later.
  Accounts created before 1.2 were not changed: they stay private unless
  their owner shares them.
- You can delete your account, and everything we hold about you, from
  Settings at any time.

## What stays on your device

The following is stored only on your computer and is never sent to us: your
book files, your library (titles, authors, covers), your reading position and
progress, your reading time, streaks and session history, your reading pace
(how fast you read, book by book, so Smart Read can keep up with you), your
highlights, notes and bookmarks, your collections, and your settings.

There is one exception, and only while you have an account with a public
profile: the few figures shown on that profile (this week's minutes, your
streak, how many books you have finished, and the titles on your shared shelf)
are sent to our server so other readers can see them. See "Your profile"
below.

## Google Drive backup (optional)

If you connect Google Drive, Leaflet copies your book files and a small file of
your reading progress and history (including your highlights, notes, bookmarks,
collections and reading pace) into a folder called "Leaflet" in **your** Google
Drive.

- Leaflet asks Google only for the `drive.file` permission. It can see only the
  files it created itself, and nothing else in your Drive.
- It also asks for your basic Google profile (your email address) so the app
  can show which account is connected. That email address stays on your device.
- The sign-in key Google gives Leaflet is stored in your operating system's
  secure credential store (the Windows Credential Manager), not in a file.
- These files travel directly between your device and Google. They do not pass
  through our servers, and we cannot access them.

Your use of Google Drive is also covered by Google's own privacy policy. You can
disconnect Drive in Settings, and remove Leaflet's access from your Google
account's security settings at any time. Disconnecting does not delete the
backup from your Drive; delete the "Leaflet" folder there if you want it gone.

## Leaflet accounts (optional)

You can use every feature of the desktop app without an account. If you create
one, we store the following on our server:

- **Account:** your email address, a display name if you give one, and your
  password as a salted scrypt hash. We never store or see your password itself.
- **Sign-in sessions:** a hashed token for each device you are signed in on,
  with when it was created and last used, so that you stay signed in.
- **Password reset:** if you ask for a reset code, a hash of the code, when it
  expires (15 minutes later) and how many wrong tries it has had. It is deleted
  once used, after five wrong tries, or when it expires. We also keep the dates
  of your resets from the last year, because an account can be reset three
  times a year.
- **Email confirmation:** when you create an account or change its email
  address, we email that address a one-time code. Until it is used we store a
  hash of the code, when it expires (30 minutes later) and how many wrong tries
  it has had; it is deleted once used, after five wrong tries, when it
  expires, or when you ask for a new one. We also store whether, and when,
  your address was confirmed. Your account works whether or not you confirm.
- **Profile:** a handle you choose (shown as `@handle`), your display name,
  and whether the profile is public or private. While it is public we also
  store what it shows: this week's reading minutes, your streak, how many
  books you have finished, a shelf of up to twelve titles from your recent
  reading sessions, and the date of the last day you read on, which is used
  only to tell a friend (a reader you follow who also follows you) that you
  have read today; the date itself is never shown to anyone. See "Your profile" below.
- **Synced reading state** (only while you are signed in and either a Google
  Drive backup is connected, or you have turned on "Back up reading to my
  Leaflet account" in Settings): a compressed copy of your progress and
  reading history, so your devices agree. It includes your highlights, notes,
  bookmarks and collections if you have any, and never your book files. We do
  not read it: it is stored as you send it and used only to give it back to
  your devices. It is compressed, not encrypted.

We use this information only to run your account and the features you turn on.
We do not sell it, rent it, or use it for advertising.

**Where it is stored.** Leaflet's server runs on Oracle Cloud in Hyderabad,
India, at `leafletapp.duckdns.org`, and account data is stored in a MongoDB
Atlas database. Your information may therefore be processed outside your own
country.

### Your profile: public by default, private whenever you choose

When you create an account in Leaflet 1.2 or later, the sign-up form has a
"Share my profile" switch. It is on unless you turn it off, and the form says
what it makes visible before you create the account.

- **If it is on,** your profile is public from the moment the account is
  created. Other readers can see your display name, your `@handle`, your Pip
  (the avatar you picked), this week's reading minutes, your streak, how many
  books you have finished, and your shelf (up to twelve titles from your recent
  reading sessions). You appear on the weekly leaderboard and can be found by
  your handle. A reader you follow who also follows you can see that you have
  read today: on such a day your Pip may visit theirs in the app, shown with your
  `@handle`, your name, your streak and this week's minutes.
- **If you turn it off,** the account is created with a private profile:
  nothing about you is shown to anyone, you are on no leaderboard, you cannot
  be looked up, and no reading figures are sent to us.
- **You can change it at any time** in the app under Social → You ("Make
  private" / "Share my profile"). Making your profile private hides you from
  leaderboards, search, inboxes and duels straight away, and removes the
  reading figures, the shelf and the date you last read on that we stored for
  it. Your handle and display name
  are kept, unseen, so you can share again later; deleting your account
  removes them too.
- **Accounts created before Leaflet 1.2 were not changed.** Their profiles
  were private unless the owner had shared them, and they stay that way:
  updating the app does not make an existing profile public.

**Readers you interact with.** If your profile is public, other signed-in
readers can follow you, send you kudos and challenge you to a weekly reading
duel, and we store those interactions (who, to whom, and when) so they can be
shown. Readers with a private profile cannot be followed, sent kudos or
challenged.

## Other services Leaflet talks to

- **Open Library and Wikipedia.** To fill in missing titles, authors and
  covers, Leaflet sends the book's title and author to these public catalogues.
  No account or identifier of yours is included. You can see their privacy
  policies on their websites.
- **Wiktionary and Wikipedia (looking a word up).** When you select a word or
  a short phrase in a book and press **Look up**, Leaflet sends those selected
  words, and nothing else (not the book, not the sentence around them, no
  account or identifier of yours), to Wiktionary and Wikipedia to fetch a
  meaning and a short summary. Nothing is sent until you press it, and what
  you looked up is not stored. "Search the web", offered when nothing is
  found, opens a DuckDuckGo search for those words in your browser.
- **Fandom (a fan wiki's summary of a name).** When a name in a book has its
  card open and you press **Wiki** (or have chosen, in Settings, to have wiki
  summaries fetched straight away), Leaflet asks the book's fan wiki on
  fandom.com for the opening of that name's page. It sends the name, and, to
  find which wiki the book has, the book's series or title and its author's
  name. Nothing else is sent (not the book, not the page you are on, no
  account or identifier of yours), nothing is sent until you ask, and you can
  turn wiki summaries off in Settings. Fandom receives the usual web request
  information, such as your IP address, under its own privacy policy.
- **Calibre (optional).** If you choose to install the optional converter,
  Leaflet downloads it from calibre-ebook.com.
- **GitHub Pages.** Leaflet's website, and a small signed settings file the app
  reads at startup to find our server, are hosted on GitHub Pages. Loading them
  sends GitHub the usual web request information, such as your IP address, under
  GitHub's privacy statement. No account or reading information is sent.
- **Gmail (account emails).** When you create an account, change its email
  address, ask for a new confirmation code or ask to reset your password,
  your email address and the one-time code are passed to Google's Apps Script
  and sent from our Gmail account, so Google handles that email under its own
  privacy terms. Nothing else about you or your reading is included.
- **DuckDNS.** Our server's address, `leafletapp.duckdns.org`, is provided by
  DuckDNS, which only translates the name into the server's IP address.
- **Microsoft Store.** The Store handles downloads and updates of the app under
  Microsoft's own privacy terms.

## Keeping it secure

Connections to our server use HTTPS. Passwords are hashed, and sign-in tokens
are stored hashed on the server and in your operating system's credential
store on your device. No system is perfectly secure, but we keep what we hold
to the minimum the features need.

## How long we keep it

We keep your account information until you delete your account. Sign-in
sessions expire after 90 days without use, an email confirmation code after 30 minutes, and a password reset code after 15
minutes. Community data is kept only as long
as it is useful: kudos for 21 days, your inbox of notifications for 60 days,
weekly duels for 90 days, and a follow until either reader removes it. Making
your profile private hides you from boards, inboxes and duels straight away,
and removes the reading figures and shelf stored for it. When you delete your account from
Settings, we delete your account, profile, synced reading state, all sign-in
sessions, and every follow, kudos, duel and notification that involves you,
straight away.

## Your choices and rights

From inside the app you can see and change what is shared, make your profile
private (or choose that when you create your account), sign out of a device, change your password, and delete your account.
You can also contact us to ask for a copy of your data or for its deletion.
Depending on where you live, you may have further rights under laws such as the
GDPR or the CCPA; contact us and we will help.

## Children

Leaflet is not directed at children under 13, and we do not knowingly collect
personal information from them. If you believe a child has created an account,
contact us and we will delete it.

## Changes

If this policy changes, we will update the date above and, for significant
changes, say so in the app.

- **4 October 2026 (Leaflet 1.2):** visitors. A public profile now also
  stores the date you last read on, so that a reader you follow who also
  follows you can be told you read today. Words you look up, Pip's diary and its weekly postcard,
  and which readers' Pips visited yours today are kept or made on your device
  (and, for the words, in your backup); a postcard leaves it only if you save
  or copy it and send it yourself.
- **3 October 2026 (Leaflet 1.2):** a profile created at sign-up is public by
  default, with the switch shown on the sign-up form; making a profile private
  now also removes its stored reading figures; the shelf titles on a public
  profile are listed among what is shared. Existing accounts were not changed.

## Contact

PaperKite — [adithyakrishnan.vinod@gmail.com](mailto:adithyakrishnan.vinod@gmail.com)

To report a problem, ask a question about your data, or request deletion,
email us at that address.
