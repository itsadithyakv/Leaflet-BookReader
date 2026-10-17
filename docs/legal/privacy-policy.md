# Leaflet Privacy Policy

**Effective date:** [OWNER: the date Leaflet 1.5.3 is published]

**Who we are:** Leaflet is made by PaperKite ("we", "us"). Contact: [adithyakrishnan.vinod@gmail.com](mailto:adithyakrishnan.vinod@gmail.com)

Leaflet is a reading app. Your books live on your own device, and so does your
reading history unless you sign in to a Leaflet account, which keeps it in
step across your devices. We built it so that we do not need to see either,
and we never see your books.

## The short version

- Leaflet has no ads, no analytics and no tracking.
- Your books never leave your device unless you turn on backup to **your own**
  Google Drive (or, on a computer, a sync folder of your own). We cannot see
  what is in your Drive.
- An account is optional. While you are signed in to one, your reading (your
  places, reading days, highlights, notes, bookmarks, collections and Pip) is
  kept with your account on our server so your devices agree. It is stored
  compressed, as your app sends it, and we do not read it. Your book files
  are never sent to us.
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

Your book files and the covers Leaflet finds for them, and your settings, are
stored only on your device (your computer, your phone or your tablet) and are
never sent to us.

While you are not signed in to a Leaflet account, the rest is stored only on
your device too, and never sent to us: your library (titles and authors), your
reading position and progress, your reading time, streaks and session history,
your reading pace (how fast you read, book by book, so Smart Read can keep up
with you), your highlights, notes and bookmarks, and your collections.

While you are signed in, there are two exceptions:

- **Your synced reading state:** that list (never the book files or covers) is
  kept in step with your account through our server. See "Synced reading
  state" under Leaflet accounts below.
- **A shared profile:** while your profile is public or kept to followers, the
  few figures shown on it (this week's minutes, your streak, how many books
  you have finished, and the titles on your shelf) are sent to our server so
  other readers can see them. See "Your profile" below.

## Google Drive backup (optional)

If you connect Google Drive, Leaflet copies your book files into a folder called
"Leaflet" in **your** Google Drive. A book file larger than 10 MB is copied
only if you say yes when Leaflet asks.

- **Signed out,** Leaflet also keeps a small file of your reading progress and
  history there (including your highlights, notes, bookmarks, collections and
  reading pace), and that file is how your devices stay in step.
- **Signed in to a Leaflet account,** your reading is kept with the account
  instead (see "Synced reading state" below), and Drive carries your book
  files. Leaflet also keeps that small file up to date there for now, for a
  device of yours that is signed out or runs an older Leaflet.
- **One library, one account.** The first Leaflet account to sync a "Leaflet"
  folder adopts it: Leaflet marks the progress file with a one-way scrambled
  tag made from that account's identifier (not your email address, and not
  readable back into the account). Signed in as a different account, Leaflet
  puts only your book files there and leaves the other account's reading as
  it is; signed out, it will not sync with a folder another account has
  adopted. The same goes for a sync folder on a computer, where the tag is
  kept in a small file beside the progress file.

- Leaflet asks Google only for the `drive.file` permission. It can see only the
  files it created itself, and nothing else in your Drive.
- It also asks for your basic Google profile (your email address) so the app
  can show which account is connected. That email address stays on your device.
- The sign-in key Google gives Leaflet is stored in your operating system's
  secure credential store (the Windows Credential Manager) on a computer. On
  an Android phone or tablet it is kept in Leaflet's own private storage,
  which no other app can read, encrypted with a key held in the Android
  Keystore where the phone offers one.
- **Using Leaflet on more than one device.** Connect the same Google account
  on each, and they share that one "Leaflet" folder: the same library, places
  and reading history on your computer and your phone (signed in, the same
  Leaflet account on each keeps the reading in step, and the folder brings
  the book files). So that a day read on
  both adds up, each device's reading minutes are kept apart in the progress
  file under a random identifier Leaflet makes for that installation. It is
  not your phone's or computer's hardware identifier, it is not sent to us,
  and it is used for nothing else.
- These files travel directly between your device and Google. They do not pass
  through our servers, and we cannot access them.

Your use of Google Drive is also covered by Google's own privacy policy. You can
disconnect Drive in Settings, and remove Leaflet's access from your Google
account's security settings at any time. Disconnecting does not delete the
backup from your Drive; delete the "Leaflet" folder there if you want it gone.

## Leaflet accounts (optional)

You can use every feature of the app, on a computer or on a phone, without an account. If you create
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
  and whether the profile is public, kept to followers, or private. While it
  is public or kept to followers we also store what it shows: this week's
  reading minutes, your streak, how many books you have finished, a shelf of
  up to twelve titles from your recent reading (the books you read lately,
  with or without a focus session), the book you have open now (its title,
  author and how far through it you are), your level and the badges your
  reading has earned, your best scores in Pip's three arcade games, and the
  date of the last day you read on, which is used
  only to tell a friend (a reader you follow who also follows you) that you
  have read today; the date itself is never shown to anyone. It also shows
  the levels of the buildings in Pip's camp (the arcade's building game), how
  many magpie camps you have beaten, how many banners and trophies the camp
  has, where its buildings, fence, decorations, landscape and defences
  stand, and the rank of the guardian at each of its posts, never the books
  behind the trophies. See "Your profile" below.
- **Your library, if you share it** (off unless you turn on "Readers who
  follow me can see my library"): for each book in your library, its title,
  its author, whether you are reading it, have finished it or have not
  started, and how far through it you are. Never the files, their names or
  where they are. See "Your library, for the readers you accept" below.
- **What you post:** when you post about a book (that you finished it, a
  review, or a quote), the book's title and author, the stars you gave it
  and the words you wrote or quoted, whether it is for your followers or for
  everyone, and whether you marked it as a spoiler. A quote is text you
  chose to send from your highlights; your other highlights and notes are
  not sent.
- **Likes and dislikes:** which posts, threads and replies you liked or
  disliked. Other readers see the totals, not who gave them.
- **Book communities:** which communities you joined or started, and the
  threads and replies you wrote in them.
- **Reports and blocks:** if you report something, that you did, what it
  was, the reason you chose and anything you added; if you block a reader,
  that you did. The reader you report or block is not told.
- **The community guidelines:** the date you accepted them, and, if we have
  suspended your account from posting, until when. So that a suspension is
  not escaped by deleting the account and making another, we keep a keyed
  hash of a suspended account's email address (not the address) until the
  suspension ends, and it is then deleted.
- **Book clubs you make or join:** the club's name, its weekly goal, the
  titles added to it, and who its members are.
- **Presents:** when you send a friend's Pip a thing from the shop, or are
  sent one: who sent it, to whom, which thing, and when. Seeds themselves are
  never on our server: each reader's are worked out on their own device.
- **Raids:** when you raid a friend's camp (a reader you follow who also
  follows you), we keep who raided whom, how many stars the raid won and
  when, and show it to that friend. It is kept for up to 30 days, and
  deleted sooner if either of you deletes your account. Nothing about
  either camp is added to what the profile already shows. You can switch
  raids on your own camp off (in Pip's camp, under Raids, beside "Friends'
  camps"), and we keep that choice with your profile.
- **Synced reading state** (always, while you are signed in on a device, from
  Leaflet 1.5.3; there is no switch for it): a compressed copy of your library
  list, progress and reading history, so your devices agree. It includes your
  places, reading days and streak, your highlights, notes, bookmarks and
  collections if you have any, the words you looked up, and Pip's things, and
  never your book files or covers. We do not read it: it is stored as you send
  it and used only to give it back to your devices. It is compressed, not
  encrypted. It also holds each device's own reading minutes for the last
  ninety days, under the random identifier described under Google Drive
  above, and the scrambled account tag described there. Signing out leaves it
  with your account, so signing in again brings it back; deleting your
  account deletes it. A device whose library already belongs to another
  Leaflet account sends nothing of that library to yours.

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
  reading, with or without a focus session). You appear on the weekly leaderboard and can be found by
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

- **Kept to followers** (the middle choice, under Social → You): other
  readers can find you by your handle and see your Pip, name and handle, and
  nothing else, until you accept their request to follow you. You are not on
  the public leaderboard. The readers you accept see what a public profile
  shows. A request you have not answered is stored (who asked, and when)
  until you accept or decline it, or they take it back.

### Your library, for the readers you accept

Sharing your library is a separate switch, off unless you turn it on, and it
needs a profile that is public or kept to followers. While it is on, the
readers who follow you (for a profile kept to followers, the ones you
accepted) can see the list described above, and Leaflet can tell them and you
which books you have in common, who among the readers you follow is reading
one of your books and how far along they are, and how many of them finished
it. Turning the switch off, or making your profile private, deletes the list
from our server. To find what two libraries share, your app sends us short
keys made from the titles and authors of up to 500 of your books; they are
used to answer that one request and are not stored.

### Posting for everyone, and book communities

Nothing is public unless you make it so. A post goes to the readers who
follow you unless you choose "Everyone" for that post, and you are in no
community you did not join. To post for everyone, or to join or write in a
community, your profile must be public, your email address confirmed, your
account a few days old, and you must have accepted the
[community guidelines](community-guidelines.md).

- **A post for everyone** is shown, with your Pip, name and handle, to any
  signed-in reader with a shared profile: on the Discover feed, on the page
  of the book it is about, and on your profile.
- **A thread or a reply in a community** is shown, with your Pip, name and
  handle, to any signed-in reader with a shared profile who opens that
  community.
- **Spoilers are kept from a reader by their own app**, which compares how
  far a thread says it goes with that reader's place in the book on their
  own device. Your place in a book is not sent to us for this.
- **If you report something, or something of yours is reported,** we look at
  the thing reported, as it was posted, and who posted it, to decide whether
  to remove it. A post, thread or reply that several readers report is
  hidden from other readers until we have looked. We can remove content,
  remove a community, and suspend an account from posting.
- **If you block a reader,** you stop being shown each other's posts,
  threads and replies, and neither can follow, challenge or send the other
  anything.
- **Making your profile private or kept to followers** hides what you posted
  for everyone and your threads and replies, and takes you out of your
  communities. **Deleting your account** deletes your posts, likes, replies,
  reports and blocks. A thread you started that other readers replied to is
  kept, so their conversation is not lost, with your name removed from it.

**Readers you interact with.** If your profile is public or kept to
followers, other signed-in readers can follow you (or ask to), send you kudos
and challenge you to a weekly reading duel, and we store those interactions
(who, to whom, and when; for kudos sent for one of your posts, which post
and the title of its book; for a duel, the number of seeds each side agreed
to put on it) so they can be shown. For the two kudos badges, your profile
also keeps a list of up to ten readers who have sent you kudos and up to ten
you have sent kudos to; only the number in each list is ever shown, to you
on your badges. What you post for your followers is shown
to the readers who follow you. The members of a
book club see each other's Pip, name, handle and this week's reading minutes,
whether or not they follow each other: joining a club is agreeing to that.
Readers with a private profile cannot be followed, sent kudos or challenged,
and cannot post, join a club or send presents.

## Other services Leaflet talks to

- **Open Library and Wikipedia.** To fill in missing titles, authors and
  covers, Leaflet sends the book's title and author to these public catalogues.
  When you press **Covers** on a series, it asks Open Library the same way for
  the editions of each of its books, and fetches the cover pictures you are
  shown from it.
  No account or identifier of yours is included. You can see their privacy
  policies on their websites.
- **Wiktionary and Wikipedia (looking a word up).** When you select a word or
  a short phrase in a book and press **Look up**, or double-click a word,
  Leaflet sends those selected words, and nothing else (not the book, not the
  sentence around them, no account or identifier of yours), to Wiktionary and
  Wikipedia to fetch a meaning and a short summary. Nothing is sent until you
  do one or the other, you can turn the double-click off in Settings, and what
  you looked up is not sent anywhere else. "Search the web", offered when nothing is
  found, opens a DuckDuckGo search for those words in your browser.
- **A fan wiki (its summary of a name).** When a name in a book has its
  card open and you press **Wiki** (or have chosen, in Settings, to have wiki
  summaries fetched straight away), Leaflet asks the book's fan wiki for the
  opening of that name's page. The wiki is one on fandom.com, or, for the
  books they cover, coppermind.net, awoiaf.westeros.org or wiki.lspace.org. It sends the name, and, to find which wiki
  the book has, the book's series or title and its author's name. If you
  have chosen "straight away", Leaflet also fetches the list of the wiki's
  page names when you open the book, so that it can recognise the book's own
  invented words; that request says nothing about what you read or where you
  are in it. Nothing else is sent (not the book, not the page you are on, no
  account or identifier of yours), nothing is sent until you ask, and you can
  turn wiki summaries off in Settings. The wiki receives the usual web
  request information, such as your IP address, under its own privacy policy.
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
- **Google Play.** On Android, Google Play handles downloads and updates of
  the app, and, when you choose to rate Leaflet, shows Google's own rating
  sheet, under Google's privacy terms. Leaflet is not told what you rated.
- **Reminders on a phone.** Reading reminders on Android are made and
  scheduled on the phone itself, by its alarm clock. No server sends them,
  and nothing about them leaves the phone.

## Keeping it secure

Connections to our server use HTTPS. Passwords are hashed, and sign-in tokens
are stored hashed on the server, and on your device in your operating
system's credential store (on Android, in Leaflet's private storage,
encrypted with a key held in the Android Keystore where the phone offers
one). No system is perfectly secure, but we keep what we hold
to the minimum the features need.

## How long we keep it

We keep your account information until you delete your account. Sign-in
sessions expire after 90 days without use, an email confirmation code after 30 minutes, and a password reset code after 15
minutes. Community data is kept only as long
as it is useful: kudos for 21 days (the two lists of up to ten readers kept
for the kudos badges stay with your profile until you delete your account),
your inbox of notifications for 60 days,
weekly duels for 90 days, and a follow until either reader removes it. A
present is kept until it is unwrapped and for 30 days after; a request to
follow until it is answered or withdrawn; a post, a thread or a reply until
you remove it (or we do); a like, a block and your community memberships
until you take them back; a report until it has been dealt with and for 180
days after; a book
club until its last member leaves. Making
your profile private hides you from boards, inboxes, duels, feeds and clubs
straight away, removes the reading figures, shelf, badges and scores stored
for it, and deletes your shared library and the requests waiting on you;
your posts are kept, unseen, and show again if you share your profile again.
When you delete your account from
Settings, we delete your account, profile, synced reading state, all sign-in
sessions, your shared library, your posts and your club memberships, and
every follow, request, kudos, duel, present and notification that involves
you, straight away. Where you appear in another reader's kudos lists, what
is left is an internal number that no longer leads to anyone, so the badge
they earned stays theirs.

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

- **Leaflet 1.5.3:** while you are signed in to a Leaflet account, your
  reading state (places, reading days, highlights, notes, bookmarks,
  collections and Pip) is always kept with the account on our server, compressed
  and not read by us; the "Back up reading to my Leaflet account" switch is
  gone. Your book files are still never sent to us: signed in, Google Drive
  (or a sync folder) carries the book files, and a copy of the reading file
  for devices that are signed out or run an older Leaflet. A library belongs to
  the first account that syncs it, marked with a one-way scrambled tag of
  that account; another account signed in on the same device or Drive never
  has that library's reading mixed into its own. Signed out, nothing changed.
- **Leaflet 1.5:** Leaflet for Android phones and tablets. What it keeps and
  sends is what the computer app keeps and sends, as described above; on the
  phone, sign-in keys are kept in Leaflet's private storage, encrypted with a
  key in the Android Keystore, and reading reminders are made on the phone
  itself. Using more than one device with the same Google Drive or Leaflet
  account now keeps each device's reading minutes apart, under a random
  identifier made for that installation, so a day read on both adds up.
- **Leaflet 1.4:** new and optional, each off until you use it: posting a
  review or a quote, for your followers or for everyone; liking and
  disliking posts; book communities with threads and replies; reporting and
  blocking; and [community guidelines](community-guidelines.md) that are
  accepted before anything is posted for everyone. A profile can be kept to
  followers, with requests you
  accept or decline. A shared profile now also shows the book you have open,
  your level, badges and arcade scores. New and optional, each off until you
  use it: sharing your library with the readers who follow you; posting a
  book you finished; book clubs; presents between readers who follow each
  other. The shelf on a shared profile names the books you read
  lately whether or not a focus session was running (it used to show only
  focus sessions, and "Untitled" for one started without a book). A book file
  larger than 10 MB is copied to your Drive or sync folder only when you say
  so. Existing profiles were not changed: a private profile stays private.
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
