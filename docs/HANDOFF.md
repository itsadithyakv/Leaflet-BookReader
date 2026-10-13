# Handoff — 2026-10-05

A snapshot for the next session, not permanent documentation. Delete it once
acted on. The durable reference is [docs/README.md](README.md); how to release
is in [deploy.md](deploy.md) (the checklist) and
[release-msix.md](release-msix.md) (the details).

## Read this first

**2026-10-07: 1.2 is released (the owner built and shipped it from
`release/1.2` at `8553264`). Work is now on the branch `release/1.3`, version
1.3.1, made off that commit (1.3.0 was never built: the owner asked for nine
more features and for the whole to go out as 1.3.1). It is committed and
pushed (`origin/release/1.3`), with what was built after `cb430c0` ("Four
gaps closed", below) in seven commits to `31384c2`; that later work is in no
package yet. The mail script and the server were deployed by the owner on
2026-10-07. A release build of it compiles and packages
(2026-10-07, 4 m 58 s), but that package was made without the two Google
values, so Drive backup is off in it: it is kept as
`target\msix\Leaflet_1.3.1.0_x64.NO-DRIVE-test-only.msix`, for trying the
features on this PC and never for upload. The one to upload is not yet built: the package needs the owner's two Google values, in the
owner's own PowerShell window (deploy.md, "Releasing an update"). What it
holds:**

- **Dotty comes back** (features.md, "Smart Read"). With Dotty below the
  page, Space reads from what is on screen; a drag held at the window's top
  or bottom scrolls the page.
- **A name's card on resting the pointer** (features.md, "Characters"). Any
  name the book uses, written down or not; the book's own line that best says
  what it is; no spoilers; on this device. "Characters" is now on unless
  switched off.
- **A fan wiki's summary** in that card, when asked: fandom.com, through a
  narrow Rust command (`wiki_ask`). It can spoil and says so. **The privacy
  policy draft has a new paragraph for it; publishing the legal pages is the
  owner's, and should go out with 1.3.**
- **The notes, redesigned**: a highlight opens in a card beside the page, and
  the list of notes is a panel of its own.
- **Highlights in PDFs** (features.md, "Highlights in a PDF"): select, colour,
  note, the same card and list as a book's; a place is a page and rectangles.
- **"Where was I?"** (features.md): a card on coming back to a book after
  three days, and in the ··· menu.
- **Pictures to share** (`components/share/`): a highlight as a quote card,
  and a year in review on Social, Stats.
- **Fewer words on screen**: the owner asked for standing explanations to go
  (features.md, "Fewer words on the page").
- **A pass over how it is built** (2026-10-07, the owner asked whether it is
  well built and optimised). Measured first: the bundle (lazy pages; 600 kB
  of script at startup, about 200 kB gzipped), the library with 2,000 books (about
  800 elements on the page, a keystroke in search 4 to 12 ms in a
  development build), the reader (0.2 ms a scroll event, no task over 50 ms
  in 240 steps; a name card three novels into the largest test book in
  0.85 s with no long task). Those were left alone. What was wrong was the
  database: see data-model.md, "How it writes". It now keeps a write-ahead
  log, and a sync is one transaction (18 s to 0.08 s for a year's reading).
  Also: `cargo clippy --all-targets` is clean (it gave 20 style notes), and
  Settings no longer redraws for every book a sync touches. Not done, on
  purpose: 54 commands still run on the window's thread (their writes are
  now cheap; making them `async` is a wide change for little); Pip's art is
  in the startup script (about 150 kB before minifying).
  `apps/node_modules/.leaflet-test/chunks.mjs` prints what each chunk is
  made of.
- **2026-10-12, not committed: the app was joined to a real server for the
  first time, and the arcade got its building game.**
  - **The join** (`apps/src-tauri/src/commands/e2e.rs`, an ignored test, and
    `server/scripts/e2e-server.mjs`, which serves the real routes on this
    machine from a throwaway local database and refuses any other). It sends
    what the app itself sends (the profile as `ProfileUpdate` serialises it,
    the library as `shared_library` lists it, every public-community request
    as `discuss::ask_for` builds it) and reads the answers with the app's own
    types. The top of `e2e.rs` says how to run it. It signs readers up by
    calling the server directly, never `cloud::signup`: that writes the
    session to the system keychain and would replace the owner's sign-in.
  - **It found one real bug, now fixed**: every *listed* post (feed,
    Discover, a book's posts, a reader's posts) answered the poster's profile
    as a list where the book's author should be, with the profile's database
    id and visibility in it. The lookup of the poster was written to
    `author`, over the post's own. The feed would have thrown on its first
    row. Both suites were green: the server's never looked at a listed
    post's author, and the app's used canned answers. `withAuthor` now takes
    the name to write to, posts use `poster`, and both sides test it
    (180 server tests).
  - **The Hollow** (features.md, "The Hollow: Pip's camp, the arcade's
    building game"), built twice: the first slice was played through by
    simulation and was a progress bar, so it was rebuilt as the owner
    steered it. Reading runs it (the oak, the scouts' rest, building, the
    lantern, the streak, Pip's wish); the camp is laid out by the reader and
    the night is fought on that layout; raids are small battles the reader
    sets going; heroes come from the books finished. In the backup, and its
    summary on a shared profile (both by a helper, with the server and Rust
    tests: 184 and 757). Tried in the preview: a camp arranged until the
    night held, the night watched, a stronghold raided with a hero.
  - **A book can be removed from any card's menu** (features.md, "A book can
    be removed from any card"), and its file goes from Google Drive on the
    next backup run. The Drive half was read, not run.
  - **A game no longer starts again the moment it ends** (features.md, "And
    it no longer starts again by itself"): the real cause of the owner's
    "resets abruptly", which the 0.9 s pause of 1.4 had not reached.
  - **Later the same day, the Hollow's own critique was answered and the
    arcade restyled** (features.md, "The Hollow after its first look" and
    "The arcade fills the window, in Pip's own hand"). Raids rebalanced
    (graded stars, champions that can be set on, the road and the King
    measured against the scouts, three stars skipping a stronghold, heroes
    trimmed); the camp page cut to Pip's words, the picture and one card,
    with the next to-do marked where it is done; sounds; tips for touch; the
    picture sized for narrow windows; the friend's card showing the real
    layout (Rust and server, by a helper). Then, on the owner's word: the
    arcade fills the window and is drawn Pip's way instead of the app's soft
    style, the front page shows each game playing on its own card, and a
    raid's pieces move between simulation steps. Tests: 2,689 app, 760 Rust,
    186 server. **The server changed again** (`sanitiseCamp` takes the
    layout): one more thing in the next deploy, no migration.
  - **Last that day: the camp is lived in and tied to the house, and the
    rest of the app was audited** (features.md, "The camp is lived in, and
    belongs to the house" and "The rest of the app, looked at with fresh
    eyes"). A Camp key on Pip's rail; her mood from the house speeds her
    building; heroes live in the camp with a want a day and a friendship
    that grows; Pip's walks (measured in minutes read) and their 36 tales;
    a first-gather bonus that brought the ten-minute reader back from 162
    days to 115; the raid's result moved under the field, because over it
    it hid the very animations it was meant to show. The audit's fifteen
    findings outside the arcade were fixed by two helpers (a book's place
    could be wiped with one click; a double-click deleted a book from the
    list view; a keeper could not remove a member; the owner's
    `admin/community` control; and the rest), and what that left was done
    after: the right-to-left dock, removed Kindle highlights staying
    removed, a PDF's subject and keywords as genres (**the library is read
    again once on first launch**: `SERIES_SCAN_VERSION` is 5), and the
    smaller ones. Tests: 2,719 app, 765 Rust, 186 server. No server change
    in this part.
  - **After that, still 2026-10-12 and not committed: the Hollow grew, and
    Pip's tab now opens on it** (features.md, "The Hollow grows up: one
    level, four shelves, and Pip's tab opens on it"). Guardians, five kinds
    of raider, four constructs, nine blades, landscape, the meadow and its
    animals; nights only after reading; a lost night costs a little. The
    camp has one level (the burrow's) and each level's list of what it
    brings is made from the gates and tested; a yard plot exists only once
    its level has come (second plot at level 3, was 2). Buying is sorted on
    four shelves: Camp, Defence, Heroes, Decorate. `PipPage` has a `place`:
    it opens on the Hollow (`HollowPlace.tsx`), the house is behind "Go
    inside", and the arcade no longer lists the Hollow. Tests: 2,757 app
    (1 skipped), 766 Rust; clippy clean; build passes. The server's tests
    were not re-run after this part (nothing in `server/` changed in it;
    188 passed when the friend's card last changed). **The server did
    change earlier that day** (the friend's card carries land, constructs
    and guardians): it is in the next deploy, no migration.
  - **Into 2026-10-13, not committed: the picture is the page**
    (features.md, "The Hollow is the page: the picture, and what goes on in
    it"). The clearing fills Pip's tab with everything laid over it;
    things stand at three quarters with shadows; a four-minute day and
    night with lights; walking that goes round things; drag to move;
    prowlers between raids that the camp's defences fight, and that knock
    a building about when they get through; and raids on friends' camps.
    **The server changed again** (`server/src/routes/raids.js`, collection
    `raids`, `profiles.raidable`; no migration): until it is deployed the
    app's raid lists are empty and nothing else is affected. Then:
    guardians on signposts that can be dragged (and that count in the
    night's fight), fighters who wear out and sleep three hours, prowlers
    with preferences and clubs, and real things for the camp's people to
    do. A helper tightened the raid routes for a small server, and the
    same faults in `GET /v1/visitors` and `GET /v1/gifts`. Tests: 2,793
    app (1 skipped), 770 Rust, 211 server.
    Last: four more constructs (tanglefoot patch, hornet jar, pitfall,
    watch bell), eight in all; the friend's card carries kinds 0 to 7,
    eight at most, in Rust and on the server (**in the same deploy**; an
    older server only drops the new four from a card).
    Open: the garden's floor, signposts on a friend's card,
    `POST /v1/gifts` (reads two whole profiles; the helper offered).
  - **Later on 2026-10-13, not committed: the Hollow defended**
    (features.md, "The Hollow defended: what there is to defend with, and
    against"). Things at 0.64 and a clearing that widens with the burrow;
    six pieces of fence a level, laid by dragging, that hold a prowler up;
    twelve constructs; eight kinds of prowler (a magpie on the wing, a
    squirrel after the oak, a mole under the fence, Fizzwick who pops);
    acorns taken from the larder or the oak by one who is not stopped;
    what each broken building stops doing; beds in the hut; the campfire;
    seasons that each do one thing; the sun and moon; reach drawn (blue)
    and measured as an oval, ground taken in red; guardians who look
    their rank and walk on real steps. **The card changed in Rust and on
    the server** (constructs 0 to 11, fence up to 32, signposts; widest
    card 2,588 bytes of 3,072): same deploy, no migration; an older
    server only drops what it does not know.
    Last on that day: a trophy (and so a hero) stands on ninety minutes of
    reading, not on a book marked finished (`claimed` in the camp's
    state; nothing on the server); scouts, heroes and guardians each do
    one thing, and the shelf is called People; guardians keep to their
    posts and heroes answer the alarm.
  - **The same day, not committed: the server was sized for 100 to 200
    people on the free database** (server/README.md, "Capacity"; the
    load script is `server/scripts/load.mjs`). One client, a pool of
    ten, a short wait and a 503 rather than a pile-up; at most forty
    requests in flight; a session remembered for a minute; a profile
    save that says nothing new writes nothing; projections on the
    lists; three new indexes and two partial ones that were never being
    used; rate limits on the profile and state routes; two password
    hashes at once. Measured locally with 200 open apps: about 320
    requests a minute, 25 database operations a second, 12 connections,
    97 MB, 7 MB stored. **Same deploy, no migration, no new environment
    values**; indexes are made at first start. The Atlas limits it was
    measured against (500 connections, 512 MB, about 100 operations a
    second, 10 GB of transfer a week) are from memory and want checking
    against the cluster's own page.
    Then, on the owner's word ("anything to upgrade performance"): the
    app publishes every five minutes while reading (it was one), pulses
    every ten (five), asks for presents only when the inbox says one
    was sent, refreshes the board every five minutes (one), and asks
    for nothing while another app is in front
    (`socialService.ts`, `useCommunityPulse.ts`, `SocialPanel.tsx`). A
    friend's "reading now" can so be five minutes behind. In Rust the
    sync no longer uploads a document that says nothing new
    (`sync/cloud.rs`, `has_news`) and its publish is throttled like the
    rest (`commands/social.rs`). On the server a changed save is five
    operations (seven), the inbox seven (nine), and the unit's heap is
    128 MB (160): about 20 operations a second for 200 open apps (24),
    p95 at four times that load 437 ms (788). Transfer, about 0.54 MB
    an app-hour as the server was measured, is what the free database
    runs out of first (about 330 people at eight hours a day by the
    assumed limit); the app's slower polling is not in that figure.
    Left alone because they change what a reader sees: the public
    board's cache, the size of what a profile save sends back, the
    library list re-sent as reading moves a percent.
    Tests: 2,840 app (1 skipped), 776 Rust, 228 server.
  - **After that, not committed: the book comes into the camp, the land
    and a gate matter, and the camp can be shown** (features.md, the
    end of "The Hollow defended"). A chapter read sends a parcel up the
    path (`storyFeed.ts`; eight minutes of reading behind each); the
    kind of book being read brings its own prowlers oftener; prowlers on
    foot go round water, knolls and buildings, and round a fence by its
    gate or open end where that is not far; a trophy tapped names its
    book; a postcard of the camp is saved or copied. App only: nothing
    on the server or in Rust. The reader's one new line is in
    `readers/text/useBookOpening.ts` (it says which chapter is on
    screen), and `libraryStore.updateBookProgress` tells the feed.
    Then a polish pass (figures that float up where something happened,
    a jolt, a "!", birds and fireflies), fences that join up the picture
    and on the slant, depth by shadow and haze, and a balance pass
    measured by `full-sim.ts`: prowlers' harm and theft are capped at two
    knocks and one theft a day and cost less to put right; everything
    else stood as it was (about three months to all of it at half an
    hour a day). Last: Pip's tips (`tips.ts`: thirteen, one at a time,
    each gone when the thing is done or dismissed) and the (i) panel
    rewritten. Then drag and drop for everything (fence pieces, buildings
    while arranging, new things off the shelves) and walls that run back
    drawn by their tops, flush at the corners. Tests: 2,886 app.
    In Pip's house (docs/pip.md), the same day and not committed: four
    more ways to play with her by hand (a cuddle, a high five, a
    tickled leaf that ends in a sneeze, a whirl), a finger that can rub
    her, thirty-odd pieces of furniture that answer a tap (`VISITS` in
    `pip/furnish.ts`; for show, no mood or seeds), and thirty more
    decorations in the shipped shop (`MORE_DECOR` in
    `pages/pip/common.ts`: 27 already drawn and three new toys, a
    trampoline, a music box and a bubble machine). `catalogue.json`
    gained the three toys, so Rust was re-tested (776 pass). **Two
    things to decide before release, because they cannot be taken back
    after:** the wider shelf and the toys; and that the Greenhouse set
    can now be completed (+50 seeds). Tests: 2,938 app.
    The shelf now stays put while a thing is carried off it (it used
    to give way at once, and the page moved under the pointer), and a
    finger carries a thing off a shelf by holding it first. The touch
    path was tried with made-up touch events, not with a finger.
    Later the same day in her house, at the owner's asking and not
    committed. Curtains are drawn by a pull anywhere on the window
    (`curtainTug`, `curtainLetGo` in `pip/furnish.ts`), and a picture
    knocked a third time the same way comes off its nail and lies on
    the floor until it is picked up (`comesDown`, `fallStep`). **The
    fridge is no longer for show:** each snack bought stocks it for a
    day (`pip/fridge.rs`, new: `HOURS_PER_SNACK` 24, `MAX_HOURS` 72),
    read back out of the ledger, not counted; found bare, it takes 3
    off her mood once a local day (`BARE_MOOD`, never under the floor
    of 40, and only when she is up and looks, never for time away).
    That is a new command, `pip_fridge_bare`, which takes no
    arguments. **She has a temper** (`pip/temper.ts`, new, this device
    only, kept in localStorage against the clock): patience that
    annoyances wear down and kindness mends, a tantrum when it is gone
    (one in 8 minutes at most), a huff of 2 minutes in which she will
    not be played with, a sulk of 15 to 30 minutes that eases, good
    moods of 10 to 20 minutes, and making up by a cuddle or a snack.
    It is laid over the hearts and never sent to Rust. Tests: 3,003
    app, 789 Rust, clippy clean. Seen in the preview; not in the
    installed app, not with a real purchase, not by ear, not under a
    finger. One thing to decide: a new reader's fridge is bare, so the
    first look costs 3 (70 to 67, which the hearts do not show).
    **The ball is a game of catch** (`pip/catch.ts`, new; pip.md has
    the rules): she throws it back to the pointer, a press on it in the
    air catches it, a rally is counted beside it, and left alone she
    nudges it over, lies down on it and at last puts it away. Played in
    the preview with made-up presses: a rally to 19 with her cheer at
    5, the wait through to her putting it away, a cancelled press and
    a lost window each dropping the ball where it was, a flick off the
    wall. Not seen: a bonk or a miss of hers (tests only), the making
    up by a rolled ball, reduced motion, a finger. Tests: 3,042 app.
    **A light of the room's own, and Pip lit by it** (pip.md has the
    rule): a ceiling light and a wall switch in every bedroom, on in a
    new room and remembered; and after dark Pip, her ball, the clock
    and whatever else is laid over the room's picture are as bright as
    the light on them, where they used to be as bright as by day in a
    dark room. Seen in the preview after dark: on and off from the
    switch, Pip at 0.55 in the dark and 0.95 to 1 under the light, the
    clock following, the state kept over a reload. Not seen: the
    always-dark floors (the arcade, where she is now dim away from
    its lights), a lamp of the shop's beside it, daytime (nothing
    should change by day). Tests: 3,046 app.
    **Then, and in the package (it was built again for it)** (the owner
    asked whether the disco ball's lights fall on Pip in the arcade;
    they did not): she takes the colour of the light on her as well as
    its strength (an SVG colour filter each for her and her ball,
    `litMatrix` in `pip/home.js`), and the Disco Ball's colour reaches
    the floor. Seen in the preview: Pip under the bedroom's light
    through the new filter; the arcade with a disco ball painted at
    each of its four colours, with a green stand-in under each
    matrix, not Pip herself in the arcade (the preview cannot buy the
    floor or the ball). Tests: 3,048 app.
  - Not checked: any of it in the installed app; the Hollow played by a
    person over days (its numbers are from two simulations kept beside it);
    the arcade's games and the raids by hand (the preview's pane was in the
    background, so a timer stood in for frames); the remove-book menu on a
    real card (the preview's library was empty); a camp arriving by backup
    on a second computer.
- **The public community was added last on 2026-10-11, not committed**
  (features.md, "Discover and book communities: the public, optional half";
  `docs/legal/community-guidelines.md` is new and is published with the
  privacy policy). Reviews and quotes for followers or for everyone, like
  and dislike, a Discover feed, one community a book or series with threads
  and replies, spoilers covered by the reader's own place, reports, blocks,
  and the owner's review. It needs the same server deploy as the rest.
  - **The owner's to do, besides deploying:** mark their own account as the
    admin in the database (`server/README.md`, "Moderation", says how) or
    nobody can review reports; and decide that they will look at reports,
    because three reports hide a thing until somebody does.
  - **Until the owner is ready to moderate,** the admin panel's "Pause
    public posting" turns every public write off and leaves reading on.
  - The released 1.3.2 cannot see any of it and is not affected by it.
- **Also added to 1.4.0 on 2026-10-11, not committed, and it needs a server
  deploy** (features.md: "Friends", "Badges, levels and the month's
  challenge", "More to do with seeds", "A series can change its covers").
  Three helpers built the server routes, the seed rules and the shop content
  in parallel and each was reviewed. 2,582 app tests, 738 Rust tests and 139
  server tests pass; `tsc` and clippy are clean; `vite build` succeeds. What
  is not known: none of it has been run in the installed app, and the app
  has not been joined to a server of this version by hand.
  - **The owner's to do, in this order:** deploy the server
    (`server/README.md`, "Deploying this version": five new collections made
    at start, no new secret or environment value), then release the app. An
    app of this version against the old server loses only the new things.
    The released 1.3.2 keeps working against the new server (a locked
    profile is sent as an empty card it can draw; three new inbox kinds show
    as lines with no words).
  - `server/src/pipParts.json` changed (six new accessories): until the
    server is deployed it refuses a profile picture wearing one.
  - The privacy policy is rewritten for all of it and wants the effective
    date set at release.
  - The base to build on the arcade floor ("like Clash of Clans") was only
    designed that day; its first slice was built the next (the entry above).
- **Added to 1.4.0 on 2026-10-11, not committed** (the owner asked for each;
  features.md has them under "1.4"): a PDF's first page as its cover without
  the book being opened; a file over 10 MB waits for the reader's word
  before it is backed up; every session and day of reading named after its
  book, on the reader's shelf and the shared one; genres as a wall of tiles
  in Collections; the Bharat Trilogy; the foot bar made small, and off
  Pip's page; the arcade on a CRT set with a big screen, a pause at game
  over, and Page Flap's background drawn once; Pip still in the logo; and the
  room on Pip's page painted far less often, and faster by night.
  2,520 app tests and 660 Rust tests passed with these in, `tsc` and clippy
  clean. Asked for and not built, each needing the server and the privacy
  policy: a followed reader's library, follow requests for a profile kept
  to followers, and badges and a show-off profile (the reply of that day
  has the design).
- **The next release is 1.4.0** (2026-10-10). The owner did not ship 1.3.3
  or 1.3.4, so what the two hold (the next entry, and "1.3.3" further
  down) goes out together as 1.4.0, the first release after `v1.3.2`.
  Committed and pushed on `release/1.3`, which keeps its name. **Built on
  2026-10-13 at the owner's word, from `adda2b0`, with everything below
  that was "not committed" now committed and pushed (ten commits,
  `0a8bb9d` to `adda2b0`; built twice that day, the second time for the
  colour of the light on Pip):** `target\msix\Leaflet_1.4.0.0_x64.msix`,
  13,114,313 bytes, unsigned, with all five values taken from `build.env`
  and no warning of a missing one (release compile 12 m 42 s). It has not
  been installed or opened. `Leaflet_1.4.0.0_x64.2026-10-10-old.msix`
  beside it is an earlier build from `1a47453`, never uploaded, kept only
  so that nothing was deleted: it is not for upload, and nor is
  `Leaflet_1.3.3.0_x64.msix` (Pip's face, and Space still presses the last
  button). **Still the owner's, in this order:** deploy the server (no
  migration, no new values), try the package installed, fast-forward
  `main` and tag `v1.4.0`, upload (deploy.md, "Releasing an update").
- **1.3.4, never released: the app icon is now a green book** (2026-10-10;
  committed and pushed): the owner thought the face was not getting clicks in the Store
  and asked for "a green book in a grid style". Drawn on Pip's pixel grid in
  the app's own green, with a leaf on the cover (`windows-icons.py`,
  `BOOKS`); every icon, the favicon and the Store logos were made again.
  Looked at as pictures at every size on a dark and a light bar; not seen on
  a real taskbar or in the Store. The Store logos in `brand/store-logos` are
  the owner's to upload. Also in 1.3.4: Space after a button was clicked
  pauses the reading and no longer presses that button again (features.md,
  "Space after a button was clicked"), and a release build reads its five
  values from `apps/src-tauri/msix/build.env`, which git ignores (deploy.md,
  step 7). What follows is the face it replaced.
- **The app icon is Pip's face** (the owner: "really small and
  indistinguishable" on the taskbar). The logo (Pip with a book) is kept for
  everything else; the Windows icons, the `.ico`, the Store logos in
  `brand/store-logos` and the favicon are the face, from two drawings
  (`pip-face-16.png`, `pip-face-18.png`; `apps/src/assets/pip/README.md`).
  Looked at as pictures at every size on a dark and a light bar, not on a
  real taskbar: that needs a build. Uploading the new Store logos to Partner
  Center is the owner's. macOS, iOS and Android icons are untouched.
- **Nine more, built 2026-10-07, which made it 1.3.1** (the owner: "build
  all of them", after a read through accounts and sync). Each is in
  features.md under the name given here.
  - *Finished, with a date*: `books.finished_at`, schema 5, a merge rule of
    its own (data-model.md); "Mark as finished" and "Mark as not started" in
    a book's menu. Counts go by `hasFinished`, shelves by `isFinished`.
  - *A goal of books for the year*: a card on Social, Stats.
  - *The name*: saving the profile sends the name to the account too.
  - *The screen stays on* while the page reads itself (`keep_awake`).
  - *Backing up to the Leaflet account alone*: a switch in Settings, Backup,
    off until chosen. **The owner's to decide: whether it should be on by
    default.** The privacy policy's paragraph on synced state was corrected
    in the repo (it said "we cannot read it"; it is compressed, not
    encrypted): publishing that is the owner's.
  - *A highlight from the past, once a day*: on the library page.
  - *Your own font*, *Highlights from a Kindle*, *Search inside books*:
    built by three engineers working beside this one; their code was read
    and their tests run, and two of the three were tried in the preview.
  - Checked in the preview: the book menu's two items, the goal card, the
    daily highlight, a Kindle import of an invented file, opening a book at
    a search match. Not checked, because they need the app itself: the
    screen staying on, the account backup switch and a backup with it on,
    the name reaching the sidebar, adding a font, the search dialog and its
    command, and the migration to schema 5 on a real library (it is tested
    on made-up ones; **copy `library.db` before 1.3 first opens it**).
  - Phone stage 0 will now also meet `finished_at` in `merge.rs` and
    `db/mod.rs` when it is brought onto 1.3.
  - Found then, and fixed since: removing a finished book lowered the count
    of books finished (features.md, "Finished, with a date").
- **Covers that went missing** (the owner: a famous novel, a PDF, at "No
  cover yet"; features.md, "Metadata enrichment" and "A PDF with no cover
  takes its first page"). The catalogue had the cover and the first page
  made a good stand-in, so a lookup had failed once and stuck. Fixed: a
  lookup with no answer is not stamped; a first page is a stand-in a real
  cover replaces; the reader goes by the live book; schema 6 gives coverless
  books another lookup, once. One lookup of that one title
  was made by hand to see the catalogue's answer (the owner named the book);
  no other title left this PC.
- **Four gaps closed, and Kindle books read without Calibre** (2026-10-07,
  after `cb430c0`; committed and pushed the same day). The owner
  named three gaps and said "fix these however you can, take decisions";
  then asked for `.mobi` without Calibre.
  - *A finished book that is removed still counts* (features.md, "Finished,
    with a date"; data-model.md, the tombstone exception). Removing dates a
    book at its end if it had no date; a removed book with a date is never
    collected from the sync document and is recorded on a device that never
    had it; importing the file again carries the date over. The count, the
    year's goal and the year in review read `useBooksRead()`
    (`library/finishedBooks.ts`).
  - *The email is confirmed* (features.md, "Confirming the address"). A code
    by email at sign-up, never required; a row in Settings, Account until it
    is done; the address can be changed with the password; a "Did you mean
    gmail.com?" under a slip. **It does nothing until the mail script and
    then the server are deployed, in that order** (deploy.md, 4b).
  - *Kindle highlights get their places* (features.md, "Kindle highlights,
    placed in the book"): found by their words when the book is opened.
  - *Search inside books covers PDFs* (features.md, same name): the text is
    read once by pdf.js and kept on the device.
  - *Kindle books without Calibre* (features.md, same name): `.mobi`, `.prc`
    and old `.azw`. `.azw3` (KF8) and Huffman files still need Calibre.
  - Found on the way: in the Scroll layout a PDF opened at a place landed on
    the saved page (`PdfScrollPages.tsx`); fixed.
  - Three of these were built by engineers working beside this one (email,
    Kindle placing, PDF search); their code was read, their tests run, and
    the last two tried in the preview.
  - Checked in the preview: the owner's one real `.mobi` as an EPUB (59
    chapters, contents, pictures, a link followed); a PDF opened at a match
    in both layouts (page 300 of 600, the find open on the words); two real
    passages placed and drawn in a test book, an invented one left alone.
  - Not checked, because they need the app, the server or a second device:
    the whole email flow on a screen and a real email arriving; the count
    after a removal on a real library and across two devices; the search
    dialog reading real PDFs through its commands; a `.mobi` imported and
    opened in the installed app; a real `My Clippings.txt`.
  - **The owner's, in this order:** (1) the new mail script and (2) the
    server: both done 2026-10-07; (3) publish the privacy policy (email
    confirmation; "account emails"): fast-forward `main` to `release/1.3`
    and push it, which runs the Website workflow. `origin/main` is still at
    `399f6c4`, from before 1.1, so the published policy predates 1.2 too;
    (4) build the package. Accounts from before are "not confirmed" and see
    one row in Settings; nothing is mailed to them unasked.
- **1.3.2: the owner's first evening with 1.3.1** (2026-10-09; 1.3.1 was
  built, tagged `v1.3.1` and sent to the Store by the owner; this is
  committed and pushed on `release/1.3` as 1.3.2, and no package of it has
  been built). Eight things the owner reported or asked for, each in features.md under the name
  given here.
  - *A series in parts, and the books beside it*: Mistborn's two eras headed,
    a novella marked optional; and two books that had not joined the series
    (a file that wrote its title where its author goes; `scan_series` is at
    version 4).
  - *No highlight on a highlight*, with "Remove highlight" in the selection
    bar; *A highlight's card is its colour* (no more thin bar).
  - *Hands-free reading reads on*: the five-minute "Still reading?" pause is
    a switch in Settings, Reading, off unless turned on. Time is then earned
    for an hour after the last touch.
  - *Kindle files under "Open with"*: the package had never declared them.
  - *Tidy a folder*: renames and sorts the book files of a folder, with a
    preview and an undo. Built by an engineer working beside this one; its
    code that moves files was read, and it was tried end to end on a copy of
    the owner's folder.
  - *Packing books smaller*: measured (1.5%), not built.
  - *A look-up that explains itself* (features.md, "Look up"): a word
    defined only by the word it is made from ("sagaciousness": "the state
    of being sagacious") now shows that word's meaning under it.
  - Checked in the preview: the highlight changes on a real book, the series
    page with a seeded Mistborn (headings, the optional novella, both books
    joined), the pause switch, that the Tidy card draws. Not checked, because
    they need the app: a `.mobi` under "Open with"; the Tidy card's folder
    picker and a run through it; the library's Highlights list in its new
    colours; the books already in the owner's library being read again
    (version 4) and the one with no author getting its lookup.
  - **The test aids are gone** (testing.md): the run sheet's `npm ci`
    cleaned `node_modules`, which is where they were kept.
- **1.3.3** (2026-10-10; 1.3.2 was built and tagged `v1.3.2` by the owner; this is
  committed and pushed on `release/1.3`, and no package of it has been built): the owner
  rested the pointer on "shelldry" in Mistborn and got no card. Two causes,
  both in features.md ("A word the book made up and writes small", "A
  series' own wiki"): the hover knew only capitalised names, and Leaflet
  asked only Fandom, whose Mistborn wiki has no such page. The Coppermind is
  now asked for those books, and the names of a wiki's pages say which small
  words are the book's own. Checked in the preview on the real passage: the
  card came up with the book's line and the Coppermind's summary; ordinary
  words beside it gave nothing. Only with wiki summaries set to "Straight
  away". The privacy policy's paragraph on fan wikis was rewritten for it
  (coppermind.net, and the list of page names): publishing it is the owner's.
  The owner then asked for a way that needs no wiki known beforehand and
  works for every book: **a double-click on a word looks it up**, and a word
  no dictionary has is answered by the book's own lines, with the fan wiki
  under them (features.md, "A double-click looks a word up"). On by default,
  with a switch; the policy's look-up paragraph says so. A Wiki of Ice and
  Fire and the Discworld's wiki were added beside the Coppermind.
- 2,503 app tests (392 new in 1.3), 649 Rust tests (100 new), 108 server
  tests, `tsc` clean, `cargo clippy --all-targets` clean, `vite build`
  succeeds (all but the server's run together 2026-10-10, after the work above; the server is unchanged since its 108 passed). The version is 1.4.0 in the five places deploy.md names.
- **Asked for and not built: read aloud.** The voices Windows gives an app
  are the old flat ones (this PC has David, Zira and Mark only); a natural
  voice means a paid cloud service or a speech model shipped in the app
  (about 100 MB, and its licence needs checking: the usual pronunciation
  part is GPL). The owner said "later". Start with a listening trial, not
  the feature. Also offered and not asked for: translating a selection, a
  dyslexia-friendly face, importing Kindle clippings, a shelf of free books.
- **Not seen on a screen**, any of it: measured in the preview. The look of
  the notes and the card, and how the drag's scrolling feels, are for eyes
  and a hand.
- Phone stage 0 is still uncommitted in its own checkout
  (`.claude/worktrees/stage-0`, branch `phone/stage-0`, off `release/1.2`).

What follows was written for 1.2 and is kept as it was.

**The version is 1.2.0. Everything is committed on `release/1.2` and
pushed to GitHub (2026-10-05; `main` is untouched): the first two days' work, "Pip round two", the reader bug pass and
"The third round", each described below. No 1.2.0 package has been built.
If you are a new session picking the work up, go to "Start here" next.**
**The split of `ReaderView.tsx` (item 1 of "Start here") was done later on
2026-10-05, and the owner chose to ship 1.2 with it: it is committed on
`release/1.2` and pushed, two commits after `8078ca2`.**
The owner tested
1.1.0 and sent a long list of bugs and wishes, then asked for a set of new
Pip features. The packages in `target\msix` are 1.1.0 and older.

| Branch | State |
| --- | --- |
| `main` | Pushed to GitHub at `399f6c4` |
| `release/1.1` | Two commits on `main`, not pushed as a branch of its own: `8eb6a1e` version 1.1.0, `51b0341` release docs without a fixed version |
| `release/1.2` | 26 commits on `release/1.1`, **pushed** as `origin/release/1.2` (which carries `release/1.1`'s two commits with it); five are the third round (backend, readers, Pip, app, docs), the last two the reader split (`apps/src/pages/ReaderView.tsx` from 9,137 lines to 148, `apps/src/readers/text/` new) and its docs |
| Working tree | Clean, bar the untracked `.claude/` (the preview's launch file) |

The commits are split by folder, not by change, because the big files
(`ReaderView.tsx`, `lib.rs`, `index.css`) carry several themes each. Only the
tip was checked: a commit in the middle of a round may not type-check alone.

Suggested next step: the owner looks at it (list below), builds the package,
redeploys the server, then fast-forwards `main` and pushes.

## Start here: what is left to build

Two different lists. The first is the owner's and no session can do it; the
second is the building that remains, in the order to do it.

**The owner's (do not attempt):** build the package, look at the app, redeploy
the server and publish the legal pages, push. All under "Waiting on the
owner". The 1.2 release does not wait on anything in the list below.

**To build, in order:**

1. **Split `apps/src/pages/ReaderView.tsx`: done 2026-10-05, in 1.2.**
   The file was one component of 9,000 lines (9,137, not "about 8,000"). It
   is now 148 lines: a list of hook calls round a frame of JSX. Its state and
   behaviour are in `apps/src/readers/text/`: 24 hook files, each with the
   refs it owns, 8 components for what is drawn, and `scope.ts`. The map of
   files and the three rules that hold them together are in
   [features.md](features.md), "Where its own code lives". **Read those rules
   before changing the reader**: the hooks share one object a render, the
   effects are called in a fixed order, and a hook reaches a later hook only
   through `reader.name` inside something that runs later.
   - *It is a move.* Every one of the 523 statements is in its new file token
     for token (checked with the TypeScript compiler), changed in one way
     only: 49 reads of something a later hook adds (25 names) are written
     `reader.name`.
     The effects run in their old order. Four comments that sat above the
     wrong statement were put above the right one, the one file's section
     rules (`// ---- reading pace ----`) went, and two notes on code no
     longer there were dropped ("flip mode removed", "no auto-advance
     listeners").
   - *It measures the same.* 106 readings over 14 stages, original against
     split: Mistborn in both layouts (at two display scales, 1.5 and 1), and
     a second walk over the chapter list, search, bookmarks, type size, page
     colours, switching layout, auto-scroll, SpeedRead, footnotes, a picture,
     a selection and a highlight. All the same. How, and what made two runs
     comparable, is in [testing.md](testing.md).
   - `tsc` clean, 2,111 app tests, `vite build` succeeds. No Rust changed.
   - *Not done:* nothing was seen on a screen (the pane was hidden, as
     before), and the installed app was not run. The book-opening effect is
     still one effect of 1,300 lines (`useBookOpening.ts`): taking it apart
     would be a change, not a move. Three functions nothing calls came across
     as they were: `applyContentFlowStyles` (`useReaderLook.ts`),
     `displayNextSpine` and `displayPrevSpine` (`useChapters.ts`).
2. **The phone, stage 0** ([mobile.md](mobile.md)): tokens kept on Android
   (the `keyring` crate has no Android store), minutes per device in a ledger
   day (`sync/merge.rs` takes the larger of two devices' minutes, not their
   sum), a document version so an older app does not write a newer document,
   sync when the app goes to the background, and a written two-device test
   run on two copies of the desktop app. This changes the sync document:
   design it so that 1.0, 1.1 and 1.2, which are in readers' hands and know
   none of it, cannot lose data when they meet it, and write that design down
   before coding. During this stage, run the one-hour Drive experiment in
   mobile.md ("Signing in"), which needs the owner's Google project.
3. **The phone, stages 1 to 6**, as mobile.md orders them. The owner can
   build for Android on this machine today (mobile.md, "Building it today":
   the SDK, NDK and JDK 21 are installed; three environment variables are
   not set). A measured list of what breaks at 360 x 800 with touch is in
   features.md, "The readers' chrome", last bullet.
4. **Small things left**, any time, none blocking:
   - a very large PDF page zoomed far in is soft: draw only the part in view
     (a second drawing mode in both PDF layouts; features.md has the numbers);
   - links on the two light page finishes are the browser's blue: give them a
     reader's accent as the dark finishes have (it recolours every book's
     links, so ask the owner first);
   - a PDF's subject and keywords are not read as genres;
   - bookmarks, search results and link tooltips in a PDF give the file's
     page count, not the printed number;
   - converting the owner's three Kindle files has never been tried: Calibre
     is not installed on this machine (do not install it; ask);
   - the Relations drawing with real people, the page reader's Back chip and
     the dock with a very long chapter name at 380 wide were never measured;
   - "Known gaps" and "Decide" below.

**How the owner works, learned the slow way:**

- **Decide, do not ask**, on judgement calls; say what was decided and how to
  undo it. Ask only where the choice is the owner's alone (money, the store,
  anything that recolours or re-lays every book).
- **Commit only when asked**, on `release/1.2` or a branch off it, in themed
  commits; push only when asked, and never to `main`.
- **The owner deploys and builds releases.** Never touch the server, the
  database, secrets, `.env` or the signing key; never run the MSIX build or
  launch the desktop app. Health checks by `curl` are fine.
- **`D:\Books` is the owner's library: read only**, never quoted beyond a few
  words. Copies for testing are in
  `apps/node_modules/.leaflet-test/library/`. No network calls made by hand
  with the books' titles, and the installed app's database is not to be read.
- **Reports in plain words, with numbers**, bugs first, and always what was
  not checked and what only eyes can judge. Nothing in this whole round was
  seen on a screen: the preview pane is hidden, so everything was measured by
  script ([testing.md](testing.md) says how).
- **Several engineers at once** worked well with: a written brief per
  engineer, one owner per file, a shared `CHANGES.md` line before touching a
  shared function, notes saved as they go, and the rule "small edits only,
  never a script that reads and rewrites a shared file", which was broken
  seven times and never cost work, by luck. Item 1 above removes the reason.

## Current state (all run together after the third round, 2026-10-05)

| | |
| --- | --- |
| `npx tsc --noEmit -p .` in `apps/` | clean |
| App tests (`npx vitest run` in `apps/`) | 135 files, 2111 passing (on `release/1.3`, 2026-10-07: 151 files, 2365) |
| Rust tests (`cargo test --lib`) | 549 passing, 3 ignored (one reads `D:\Books` and skips where it is absent); on `release/1.3`, 591 and 5 ignored (two of them print what a sync and a library search cost) |
| `LEAFLET_STORE_BUILD=1 cargo check` | clean |
| Server tests (`npm test` in `server/`) | 88 passing |
| `npm run build` | succeeds; it now emits two pages, `index.html` and `desktop-pip.html` |
| `node scripts/pip-catalogue.mjs --check` | up to date |
| Release build, MSIX | **not built.** The build was attempted from the assistant's session and refused by its permission rules; the owner runs it (commands below) |
| Seen on screen | **Nothing.** The browser pane was hidden throughout, so no screenshot was possible. The readers, Pip's house and the character tracker were checked by measuring in the preview (positions, pixels, timings); the rest by tests |
| Heard | **Nothing.** The radio's sounds were measured (level, peak, spectrum), never listened to |
| Desktop Pip's window | **Never opened.** Compiled, unit-tested, and its page driven against a stand-in |

To build the package (the Store one needs the Google client; see
[deploy.md](deploy.md)):

```powershell
$env:LEAFLET_GOOGLE_CLIENT_ID     = "…apps.googleusercontent.com"
$env:LEAFLET_GOOGLE_CLIENT_SECRET = "GOCSPX-…"
$env:VITE_ENABLE_ACCOUNTS         = "true"
$env:VITE_ENABLE_COMMUNITY        = "true"
$env:LEAFLET_API_BASE             = "https://leafletapp.duckdns.org"
cd D:\Leaflet\apps\src-tauri\msix
.\build-msix.ps1
```

## What changed since 1.1.0

Details for every item are in [features.md](features.md); this is the map.

**Text reader** (`pages/ReaderView.tsx`; since the split its state and
behaviour are in `src/readers/text/`, its helpers in `src/readers/`):

- Scrolling is one continuous book (epub.js `continuous` manager): no more
  jumping to the next chapter before its end is read. The chapter list and
  arrows jump within the one scroll.
- Green paragraphs on dark pages fixed (unclosed page-break anchors).
- Smart Read "on but not moving" fixed: the selection bar sat under its
  controls and a stale selection held it. Controls say "On hold" and why.
- Pages layout: the last page of a chapter was skipped on scaled displays and
  a held arrow key turned two; pages are counted, turns slide, a held key
  turns one page every 150 ms.
- Dotty is 7 px, flat and glides. The chapter list has an edge tab.
- New: type panel (faces, spacing, alignment), the book's own drop caps kept,
  time left in the chapter and book, Back / Forward after a jump (Alt+Left /
  Alt+Right), footnotes in a popup, pictures open large, a progress bar to go
  anywhere, a `?` shortcuts sheet, B to bookmark, Escape closing one thing at
  a time, front matter no longer resetting progress, the saved place no longer
  creeping back on reopen, long titles set smaller in the toolbar.
- **Look up** a selected word or phrase (Wiktionary and Wikipedia through
  Rust, `src-tauri/src/lookup/`), and "Search in this book" from a selection.
- **Characters** (`readers/people/`, off by default, Settings > Reading):
  who-is cards that show only what was learned up to the place being read,
  underlined names, a panel with suggestions and a relations drawing, export,
  import, carry-over within a series. Stored as new kinds of `annotations`
  rows ([data-model.md](data-model.md#annotations)).
- **SpeedRead**: the word sits across the middle instead of off to the right,
  long words are fitted, a name being introduced and new words are held
  longer, figures are kept whole, and it eases in after Play.

**Page reader** (`pages/PageReaderView.tsx`): dark and paper finishes reach the
PDF page; outline, go to page, search, text selection, drop caps mended, zoom,
bookmarks, comics right to left and two-up; **continuous scrolling** for PDFs
(the default for a PDF opened for the first time); a `?` shortcuts sheet.

**Highlights outside the reader** (`components/highlights/`).

**Habit**: free reading shows on the shelf (`habit::free_reads`); any reading
counts for Pip's mood and the mood's drift stops at 40; the sync merge keeps
the hardest goal a day was met against; lowering the goal applies today.

**Pip tab**: activities instead of clips, physics when carried and tossed, a
Play rail, a mood panel that says why, the garden as rows with a sky, the
Attic Arcade open to visit, room pieces that can be used (curtains, pictures,
bed, lights, books), a mini fridge, and night habits (midnight snack, phone in
bed, snooze). All of the night habits are for show: no seeds, no mood.

**Community and accounts**: your own row always shows on the board; a new
account's profile is public by default and can be set private; handles are
shown with `@`. **Settings** is tabbed and compact; the server address is
under Advanced; "Get Calibre"; an optional **Book copies** folder.

**Logo**: Pip sitting with an open book, transparent, no tile
(`apps/scripts/pip-logo.mjs`, `src-tauri/msix/windows-icons.py`). Windows
icons and Store logos regenerated; macOS, iOS and Android icons still show the
old logo.

## Pip round two

The owner asked "what other features can be added to Pip", then "build all of
them". Seven engineers built them at once; each is described in
[features.md](features.md) under the heading given.

| Feature | Where in features.md | State |
| --- | --- | --- |
| Genre moods, "you stopped *there*?", book hangover, dusting, the horror peek at night | "Pip knows your book" | Measured in the preview |
| Bookcase of finished books, the book in her hands, fridge notes | "Her bookcase, her book, the fridge door" | Measured; covers and highlights in the packaged app not exercised |
| Wall calendar, wall clock, houseplant (free reading waters it), radio in the room, album board, diary on the bookcase | same | Measured |
| Pip's diary and the weekly postcard | "Pip's diary" | Measured; the save dialog and Copy not exercised |
| Words looked up are kept; My words; Word Quiz; Who is this? | "Words looked up are kept", "The Attic Arcade" | Measured; the Tauri paths not run end to end |
| The radio: six synthesised scenes while reading | "The radio" | Controls measured; **never heard** |
| Expeditions and the album (44 finds, derived from focus sessions) | "Expeditions and the album" | Measured |
| Visitors (a friend's Pip: each follows the other) | "Visitors" | Server tests pass; the app has never called a server for it |
| The kinder streak: nothing burns, Pip catches a cold | "Focus mode, streaks and the shelf" | Rust tests pass; no real break exercised in the app |
| Pip on the desktop | "Pip on the desktop" | **Window never opened** |

All of it is for show (no seeds, no mood) except the streak change.

**Decisions, taken on the owner's instruction ("answer yourself"):**

1. **"A break is final" stays.** The old walk spent the grace a break
   refilled on the very gap that broke the streak, so a streak came back a
   minute after its end was announced; fixed. Streak numbers after a one-day
   miss with no grace in hand are honestly lower than older versions gave (the
   published streak, the board's tie-break, the streak bonus). To revert: the
   `broke_on` handling in `habit/mod.rs`; the cold then rarely lasts.
2. **Visitors are friends only: each must follow the other.** A follow one way
   tells nobody anything. One new published field, `readDay`. Server tests: 88.
3. **The fridge keeps its two targets** once a highlight is pinned: the lower
   door opens the notes, the freezer door (top third) the fridge; the keyboard
   and the Snack key open the fridge as before.
4. **The Diary and Album keys are off the Pip tab's rail.** Both open from
   their things in the Bedroom (the diary on the bookcase, weekly postcard
   included; the board under the window). `openPipDiary` and `AlbumDialog`
   remain for opening them from elsewhere and are unused today.
5. **Desktop Pip is not required and is out of a release unless the build asks
   for her** (`VITE_ENABLE_DESKTOP_PIP=true`, `FEATURES.desktopPip`): her
   window has never been opened on a real desktop. Without the flag the switch
   is not shown and Rust never makes the window. Leave the flag unset for the
   Store build until the checklist below has been run.

**A Mac build:** asked for, and not possible from this Windows machine. There
is now a manual workflow, `.github/workflows/macos.yml`, that builds an
unsigned universal `.dmg` on a GitHub Mac (deploy.md, 7b). It has never been
run, and the app has never been compiled for macOS.

**Server:** `server/src/routes/community.js`, `routes/social.js`,
`community.js`, `boardCache.js`, `rateLimit.js` gained `readDay` and
`GET /v1/visitors`. No migration, no index. The app is safe to ship first:
against today's server the route is a 404 and nothing is shown. The privacy
policy has the new lines and a 4 October entry; publish it with the redeploy.

**Desktop Pip: the owner's checklist**, most likely to be wrong first. Build
or run with `VITE_ENABLE_DESKTOP_PIP=true`, then switch on Settings > General >
Pip on the desktop.

1. She appears cleanly: no white, black or grey box, no border or shadow; 64
   px wide at 100%, not about 136; feet on the taskbar's top edge; no flash of
   an empty window or of the default Pip.
2. Focus: type in Notepad, then click, drag and right-click her; the caret
   stays in Notepad. She is not in Alt+Tab, Task View or the taskbar.
3. Nothing left behind: close Leaflet with her out (also mid-walk and
   mid-carry); no `leaflet.exe` and no orphaned `msedgewebview2.exe`. Then the
   switch, Send her home, Hide for today (back tomorrow), Delete All Data.
4. Carry and drop: she follows the pointer, a flick throws her, she lands on
   the taskbar, and never stays stuck to the pointer.
5. Clicks beside her reach what is underneath, taskbar icons included.
6. The walk: no flicker or tearing; she turns before the screen's end.
7. Menu and sign: the window grows upward with no flash; each item works.
8. Scaling 100 to 200%, and changing it while she is out.
9. Two monitors with different scaling; unplugging the one she is on.
10. Taskbar auto-hide, and top, left and right on Windows 10.
11. Full-screen apps (a game, a film, a slide show, Leaflet's focus lock):
    hidden during, back after.
12. The nudge: a reminder a few minutes ahead with the goal unmet; toast and
    sign together; click the sign; no second sign that day.
13. Her look follows the Pip tab's outfit.
14. Night (asleep after 23:00) and reduced motion (still, in the corner).
15. Task Manager: `leaflet.exe` near 0% standing; the extra
    `msedgewebview2.exe` renderer's memory (expected 40 to 80 MB, unmeasured).
16. The Store package: sideload and repeat 1 to 3 and 12.

**Also to look at and listen to:** the radio (above all whether the cafe's
voices sound like people; the five `talker` levels in `ambience/scenes.ts`
are the knob); the bedroom at the common scales (eight small things: 1 px
calendar squares, a 13 px clock, 2 px spines); the 44 expedition sprites (the
thimble is the weakest); the new moves (quilt-hide, underbed, trail, march,
hangover, bring, show, the cold's blanket); the visitor beside Pip; the quiz;
the postcard at thumbnail size.

## After round two: books, small fixes, and the reader bug pass

- **The books Pip knows**: 59 became 549 books and series (336 entries, 71
  scenes), with a fallback by genre for a book she has never heard of
  (features.md, "Book nods"). Sherlock Holmes had an entry all along but its
  author had to be written exactly "Arthur Conan Doyle"; and a nod plays only
  on first open and then one open in four (`NOD_ODDS`).
- **The tour's Next and Skip did nothing** and the click went to whatever was
  under the bubble: a later CSS rule switched off the pointer on Pip's
  bubble. Fixed (`.pip-say-world.pip-say-interactive`), which also fixed the
  buttons in her right-click menu.
- **The pace control** (auto-scroll, Smart Read) fades out completely when
  left alone and shows again briefly when the pace changes.
- **Previous chapter with pages**: chapter buttons either side of the page
  arrows in the dock; Ctrl+Left / Ctrl+Right in every layout.
- **The page-turn animation** exists and was measured (a 280 ms eased slide,
  0 to 678 px); it is a slide, not a page curl.
- **A Mac build** cannot be made on Windows: `.github/workflows/macos.yml`
  builds an unsigned universal `.dmg` on a GitHub Mac when run by hand
  (deploy.md, 7b). Never run; the app has never been compiled for macOS.
- **The reader bug pass** (three engineers: scrolling, pages, and the PDF
  reader in both its layouts; each thought through what a reader does, then
  reproduced before fixing). About thirty bugs fixed; each is listed with its
  cause in features.md under "What the bug pass of 1.2 settled". The ones a
  reader would have met most: arrow keys throwing the text a chapter's height
  on near a chapter's start; the saved place coming back one to six lines
  early; with pages, the place slipping back a page on every resize or type
  change, and the last line of four pages in ten hidden behind the dock; in
  the PDF reader, a wasted Space at the foot of every page, Space re-pressing
  a clicked button, and the line lost on a layout switch or a reopen.
- **Reading time changed** (decided by the assistant on the owner's standing
  instruction, both engineers having measured the loss): a page read slowly
  and then turned is credited the time it was up, to 240 s a page
  (features.md, "A page read slowly is reading"). To revert: the
  `pageTurned()` calls in `ReaderView.tsx` and `PageReaderView.tsx`.
- **Also decided there**: the wheel turns pages (one a gesture); "12 of 50" in
  the dock with pages; text stops 56 px above the foot of a page (about a line
  a page fewer); a new comic opens at fit page; Home / End are the chapter's
  start and end when scrolling (Ctrl for the book); a plain `<hr>` now shows
  as a hairline in every book.

## The third round (uncommitted)

Everything here is in features.md with its numbers; this is the map.

- **"Fix them all"**: what the bug pass had left. The scrollbar's runaway when
  its thumb is held (`readers/scrollbarHold.ts`); click zones, swipes and the
  wheel to turn pages, right-to-left books; links in a PDF, Back and Forward
  there, sharper zoom; Smart Read rests at a full-page picture; "finished"
  arrives at the story's last line; sentences followed by speech now pause.
- **Responsive**: every screen measured by script at thirteen window sizes
  from 380 x 480 to 3440 x 1440 (features.md, "Responsive layout"): the cover
  grid counts its own width, pages have a widest size, dialogs fit, the Pip
  tab's room no longer shrinks itself, the readers' popovers scroll and stay
  in the window. The readers' chrome was swept at all thirteen sizes in both
  readers and both layouts (78 runs). Settings gained a **Habit** tab (the
  daily goal, focus and reminders), because Reading's five cards fitted no
  1366 x 768 window.
- **The owner's real library** (`D:\Books`, 19 files; read only, copies under
  `apps/node_modules/.leaflet-test/library/`). Three engineers:
  - *Import*: 8 of 19 were named wrongly (site tags, "Last, First", a file
    name as the title); no book had ever had a genre (Open Library stopped
    sending subjects unasked); Kindle headers read without Calibre; chapters
    found for a PDF with no outline.
  - *The four-novel set*: half its contents were missing (a repeated id in
    the NCX), its last novel counted as back matter, search stopped at 200
    matches. The chapter list now groups by book.
  - *The other EPUBs*: nearly every real book lost its centring, its heading
    sizes and its scene breaks, because the one novel earlier passes used
    happens to mark them in the one way the reader spared
    (`readers/bookBlocks.ts`). A chapter list is made for a book without one
    (`readers/autoContents.ts`), and chapters that share a file are chapters
    for every purpose (`readers/chapterSpan.ts`).
- **The chapter list is findable**: the owner's demo readers could not tell it
  existed. A "Contents" handle on the left edge, the dock's chapter name as a
  button, the C key, a first showing once per device.
- **The phone plan**: [mobile.md](mobile.md). Not started. Its stage 0 names
  three faults that exist today and only show with two devices (the session
  token is not kept on Android; a day read on two devices counts once; an
  older version drops newer fields from the document).

- **The left-overs of all that** were then fixed too: a PDF's own title and
  author, its first page as a cover, printed page numbers, mail links, a
  summary after importing through the dialog; verse, hanging indents, ink
  pictures of any shape, the dock's chapter on a page two chapters share,
  highlights grouped by the chapter's place, search without accents; press
  areas for everything in Pip's room, the room following a change of display
  scaling, and the 77 kB table of book nods loaded on demand (the main chunk
  went from 365 to 290 kB).

**Left, most worth doing first:** converting the three Kindle files was never
tried (no Calibre on this machine); a very large PDF page zoomed far in is
soft (a second drawing mode: features.md has the numbers); links on the light
page finishes are the browser's blue; a PDF's subject is not read as a genre;
everything under "For the phone" in features.md and in [mobile.md](mobile.md).

**Deliberately not done in this round:** splitting `ReaderView.tsx` (no
reader-visible gain, real risk before a release: do it first thing after 1.2
ships; it has since been done, before 1.2 was built, and ships in it:
"Waiting on the owner", 0), and the two-device faults in the phone plan's stage 0 (they change
the sync document, which copies of 1.0 and 1.1 already installed would not
understand: they go out with the phone release).

**Process note:** engineers changed `ReaderView.tsx` (now about 8,000 lines)
or another shared file with a script that rewrote the whole file, instead of
small edits, twice in the bug pass and five more times in the third round,
each time against a written rule. Every time the result was checked and the
tests passed, but with several engineers in one file it is the thing most
likely to lose work silently. **Split the file before the next round**; the
phone plan says the same. (Done 2026-10-05: "Start here", item 1. The rule
still stands for the other shared files, `lib.rs` and `index.css`.)

## Waiting on the owner

0. **1.2 ships with the reader split** (the owner's choice, 2026-10-05; it
   had been planned for "first thing after 1.2 ships"). It changes nothing a
   reader can see, and was measured so ("Start here", item 1); what it has
   not had is a look in the installed app, so the text reader comes first in
   the list below: open a book in each layout, turn pages, start Smart Read,
   make a highlight, close and reopen at the line. To build 1.2 without it
   instead, build from `8078ca2`.
1. **Look at it.** In order of risk:
   - In the installed app (the preview has no backend): import through the
     dialog and read its summary; a PDF with no cover taking its first page;
     a mail link in a PDF; The J Curve gaining its colon and four books being
     renamed on the first launch; Pip's nod on opening a book she knows.
   - New in the third round: the "Contents" handle (is it a control or
     clutter) and the list grouped by book in the boxed set; a book whose
     chapters Leaflet found (does the list changing a second after opening
     read as a flicker); Red Rising, Dune and The Alchemist for centring,
     heading sizes, scene breaks and covers; chapter-number pictures on the
     dark finishes in Project Hail Mary; the four renamed books and genres
     after the first launch; any page at 125% and 150% scaling.
   - Text reader: scroll across several chapter ends both ways by wheel,
     scrollbar, auto-scroll and Smart Read; change the type near a chapter's
     end; reopen and check the line. Pages at 125% scaling: every page shows.
   - SpeedRead: does the word feel centred, are name holds and the run-in
     right. `RSVP_ANCHOR_EM` in `readers/rsvpWord.ts`, the holds in
     `readers/rsvpHold.ts`.
   - Characters (turn it on): the dotted underline on each page finish, the
     card and panel, the relations drawing, whether 220 ms before a click
     opens a card feels prompt.
   - PDF Scroll: real wheel and trackpad smoothness, a mouse drag selecting
     across two pages, zoom past 200% (drawn a little softer than in Pages).
   - Pip: tossing her about, the fridge's size and sounds (never heard), the
     night habits' pacing, whether the phone's glow is too bright
     (one number in `pip/house.js`).
   - Footnote popup, picture viewer, progress bar (it is invisible until the
     dock wakes), the type panel's faces, the logo at small sizes.
   - Settings in both themes at 1366×768; the leaderboard's own row.
2. **Build the package** (above) and test it installed: section sizes from
   Rust, the look-up through the release CSP, the character sheet's save
   dialog, Book copies on MSIX.
3. **Redeploy the server**: `server/src/routes/community.js`, `social.js`,
   `account.js`, `boardCache.js`, `http.js` changed (own row, public by
   default, handles). No schema, index, env or secret change. Publish the
   updated `docs/legal/privacy-policy.md` and `terms-of-use.md` with it.
   Optional one-off, to clear what private profiles had published before:
   `db.profiles.updateMany({visibility:{$ne:"public"}},{$set:{weekKey:null,weekMinutes:0,streak:0,booksFinished:0,shelf:[]}})`
4. **Decide:**
   - Read aloud (text to speech) for the text reader: not built.
   - Two pages side by side in the EPUB pages layout: not built.
   - Should a character card or panel hold the page-turn keys while open
     (today they still turn the page, as under the notes panel).
   - Free reading earns the goal and streak but waters no garden (focus
     sessions only). Say if it should also water.
   - More room interactions (a book off the shelf, the rug, a toy, a watering
     can), and whether the Arcade's games are priced or visit-only.
5. From before: upload from a network that is not college Wi-Fi, Google
   consent screen in production, Partner Center listing, back up
   `C:\Users\Adi\.leaflet\config-signing-key.pem`, delete the stale packages
   in `target\msix`, 1.2 release notes and store listing text.

## Not verified

- Everything visual, every sound, every real pointer gesture.
- Anything inside the Tauri app as opposed to the browser preview: the Rust
  commands are tested, but the new ones (`lookup_term`, `people_*`,
  `library_copy`) were not driven from the packaged app.
- Real scroll events with real scroll anchoring in the continuous reader (the
  preview sent them by hand).
- Sync of a character sheet between two devices (the merge is tested in Rust).
- The Rust publish path for a shared profile against the real server.
- Reading-time credit while scrolling a PDF (checked by reading the code).
- Comics in the shortcuts sheet (table tests only). An Android build.

## Known gaps

- **Round two, by design or by limit:** a device on an older version still
  burns books on a break, and that syncs and sticks; "restore my burned books"
  is not offered because a cleared tombstone would return at the next sync;
  the album's lists and odds are frozen once shipped (new things need a dated
  list); a word looked up on two devices while both are offline merges to one
  count; the diary cannot name the book for a past day read with no session,
  mark or progress stamp; the page reader leaves no "stopped mid-chapter"
  record; reading on inside a finished book restamps it and can bring the
  hangover back; the suggestion thinning and the cafe are English- and
  ear-dependent; the bedroom is full.

- **The API is on DuckDNS**, which schools and offices block.
- **Free reads have no book title or start time**, and the public shelf lists
  focus sessions only.
- **Scrolling by wheel or arrow keys for more than 90 seconds without input
  stops counting** (`IDLE_MS`); a page or a screen turned after a slow read is
  now credited (see the bug pass).
- **Characters**: underlined names cannot be reached by keyboard in the text
  (the selection bar and the panel can); name suggestions lean on English
  verbs; removing a book leaves its sheet rows, as it leaves its highlights.
- **SpeedRead's "first time"** is first in the chapters on the page, not in
  the whole book, so a name is held again briefly in a later chapter.
- **PDF Scroll** offers no two-page spread; the toolbar does not come back on
  scroll up in any reader (`hooks/useAutoHideChrome.ts`, by design so far).
- **Late-loading pictures in a chapter above the viewport** can move the text.
- From before: test signing signs the upload file; the Calibre installer is
  dormant, not absent, in the Store exe; `store-listing.md` and
  `release-notes-1.0.md` still say 1.0; the release-only CSP is not applied by
  `tauri dev`.

## Test aids left on disk

`apps/node_modules/.leaflet-test/` (inside `node_modules`, so git-ignored)
holds the harnesses and fixtures the measurements used, described in
[testing.md](testing.md). It includes copies of the owner's own files
(`mistborn.epub`, `test.pdf`, and 16 books under `library/`, with
`library/from-mobi.epub`, the owner's Kindle book as Leaflet's own reader
made it; **all of it went with `npm ci` on 2026-10-08, and only
`mistborn.epub` is back**), and
`shell-sweep.html`, which runs the app in frames of thirteen window sizes. Delete the folder whenever; nothing builds
from it. Development builds publish `window.__leafletRendition` and
`window.__leafletReader`, both behind `import.meta.env.DEV`.
