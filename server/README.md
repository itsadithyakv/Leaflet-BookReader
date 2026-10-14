# Leaflet server

The only part of Leaflet with a backend. It exists for things the app cannot do
alone:

1. **Optional accounts** (email + password), so a reader is the same reader on
   every device and can join the leaderboard.
2. **Compare readers to each other.** A leaderboard is not a peer-to-peer problem.
3. **Hold the Mongo credentials.** The app must never have them — a connection
   string in a desktop binary lets any reader read every other reader's data.

Everything else — the library, reading positions, streaks, and the book files
themselves — works with no server and no account. **Book files never come
here**, and the server never receives a Google or Drive token.

## Running it locally

```bash
cd server
cp .env.example .env      # MONGO_URI=mongodb://127.0.0.1:27017 is fine locally
npm install
npm start                 # http://127.0.0.1:8787
npm test                  # needs MongoDB on 127.0.0.1:27017; uses and drops a throwaway DB
```

`npm test` reads `TEST_MONGO_URI` (default `mongodb://127.0.0.1:27017`) and
creates a `leaflet_test_<random>` database that it drops at the end.

`node scripts/e2e-server.mjs` serves the real routes on `127.0.0.1:18787`
from a throwaway `leaflet_e2e_<random>` database, for the app's own test of
its requests against a real server (`apps/src-tauri/src/commands/e2e.rs`,
which says how to run it). A second port, `18788`, does what only the
database can: `POST /age {email}` (a month old, email confirmed),
`POST /admin {handle}`, `POST /reset` (every document gone) and `POST /stop`
(the database dropped). It refuses to start against a database that is not on
this machine.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `MONGO_URI` | — (required) | Atlas `mongodb+srv://…` in production. `MONGODB_URI` is accepted too. |
| `MONGO_DB` | `leaflet` | Database name. |
| `MONGO_MAX_POOL` | `10` | The most connections the server's one pool opens to the database (1 to 50): how many operations can be at the database at once. See [Capacity](#capacity). |
| `MONGO_WAIT_QUEUE_MS` | `2000` | How long an operation waits for a free connection when all are busy, before its request is answered `503` (100 to 60000). |
| `MAX_REQUESTS_AT_ONCE` | `40` | How many requests are worked on at once; one that arrives with that many unanswered is answered `503` with `Retry-After` at once (1 to 10000). `/health` is always answered. |
| `MONGO_MAX_IDLE_MS` | `60000` | How long an idle connection is kept before it is closed (1000 to 3600000). |
| `MONGO_SERVER_SELECTION_MS` | `10000` | How long a request waits for a cluster that cannot be reached, before `503` (1000 to 60000). |
| `HOST` | `127.0.0.1` | Keep on loopback; Caddy is the only thing that should reach it. |
| `PORT` | `8787` | |
| `CORS_ORIGIN` | empty (off) | Only for calling the API from a browser page. The app does not need it. |
| `RESET_MAIL_URL` | empty (reset off) | The Apps Script web app that sends reset emails (`deploy/password-reset-mailer.gs`). |
| `RESET_MAIL_SECRET` | empty | The shared secret, equal to the script's `SECRET` property. |

A `.env` in the working directory is loaded if present (variables already set
win). Production uses systemd's `EnvironmentFile` instead, and deploys no `.env`.

Neither the four `MONGO_…` numbers nor `MAX_REQUESTS_AT_ONCE` needs setting: the defaults are the ones
the server is meant to run with, and a value that is not a whole number in
range is ignored in favour of the default. The process holds one
`MongoClient` and nothing opens another; request bodies are parsed per route
with small limits. What that adds up to on the VM and a free cluster is under
[Capacity](#capacity).

## Endpoints

Authenticated routes take `Authorization: Bearer <token>`. Errors are
`{ "error": "…" }` with a message fit to show a reader.

| | Auth | |
| --- | --- | --- |
| `GET /health` | | Liveness. |
| `POST /v1/auth/signup` | | `{email, password, displayName?, avatar?}` → `201 {token, account}`. `409` if the email exists; `400` for an avatar not in the catalogue. |
| `POST /v1/auth/login` | | `{email, password}` → `{token, account}`. `401` "Email or password is incorrect." whether or not the email exists. |
| `POST /v1/auth/logout` | ✓ | Ends this session. |
| `GET /v1/auth/me` | ✓ | `{account}`. |
| `POST /v1/auth/password` | ✓ | `{current, next}`. Signs out every other session. `403` if `current` is wrong. |
| `POST /v1/auth/reset/request` | | `{email}` → `{ok, minutes}`, the same whether or not the address has an account; emails a code if it does (or, after 3 resets in 365 days, an email saying when it can be reset again). `429` past 3 per address or 10 per IP an hour; `503` if no mailer is configured. |
| `POST /v1/auth/reset/confirm` | | `{email, code, password}` → `{token, account}`. Sets the password, ends every session, signs in. `400` "That code is wrong or has expired." |
| `PATCH /v1/account` | ✓ | `{displayName?, avatar?}`. Only the fields sent change; `avatar: null` clears it. The avatar is copied onto the profile too. |
| `POST /v1/account/email/code` | ✓ | Emails a new confirmation code → `{sent, minutes, account}` (`sent: false` when already confirmed). `429` past 5 an hour per account or 3 per address; `503` if no mailer is configured. |
| `POST /v1/account/email/confirm` | ✓ | `{code}` → `{account}` with `emailConfirmed: true`. `400` for a wrong or expired code; five wrong tries delete it. |
| `POST /v1/account/email` | ✓ | `{password, email}` → `{sent, minutes, account}`. Changes the address, keeps every session, starts it unconfirmed and mails it a code. `403` wrong password, `409` address taken. |
| `DELETE /v1/account` | ✓ | `{password}` → `{deleted: true}`. Deletes community data (see Deletion), account, profile, state and all sessions. `403` if the password is wrong. |
| `GET /v1/state` | ✓ | `{version, state}` (base64 gzipped blob, or `null`). |
| `PUT /v1/state` | ✓ | `{version, state}`. `version` is the one last read (0 = none). `409` with the current document if another device wrote first. Up to 2 MB. |
| `DELETE /v1/state` | ✓ | Removes the stored state. |
| `GET /v1/profile/me` | ✓ | The reader's own profile: `{handle, displayName, visibility, weekKey, weekMinutes, streak, booksFinished, shelf, reading, level, badges, arcade, camp, sharesLibrary, raidable, rulesAccepted, isAdmin, suspendedUntil}`. `raidable` says friends may raid the camp (`POST /v1/raids`), and is `true` until the reader turns it off. `reading`, `level`, `arcade` and `camp` are `null` and `badges` is `[]` until sent; with no profile yet, `visibility` is `private` and the rest empty. `rulesAccepted` says the guidelines were accepted (`POST /v1/rules/accept`); `isAdmin` is `role: "admin"` on the profile, which no route can set; `suspendedUntil` is an ISO time while an admin's suspension lasts, else `null`. |
| `PUT /v1/profile/me` | ✓ | `handle`, `displayName`, `visibility` (`public`, `followers` or `private`; anything else is taken as `private`), `shareLibrary` (boolean), `raidable` (boolean: whether friends may raid the camp; on until turned off), `weekKey` + `weekMinutes`, `streak`, `booksFinished`, `shelf`, `readDay` (the reader's local date on which they last read, like `2026-09-27`; a date no clock could be in is a `400`, `null` clears it), `reading` (`null`, or `{title (1–120), author (≤80) or null, percent (whole, 0–100)}`), `level` (whole, 0–999), `badges` (at most 80 ids matching `^[a-z0-9][a-z0-9-]{0,39}$`; repeats are dropped, order kept), `arcade` (`{dash, catch, flap}`, each whole, 0–10000000, a missing one is 0), `camp` (`null` clears it; otherwise `{levels, yard, camps, banners, trophies}`, Pip's camp in the arcade's building game as the reader shows it: `levels` is `{burrow, oak, store, fence, tower, hut}`, each whole, 0–5; `yard` is at most 2 of `{kind, level}`, `kind` one of `workshop`, `hive`, `well`, `stall` or `null` and `level` whole, 0–3; `camps`, `banners` and `trophies` are whole, 0–100000. Every one of those parts has to be there. Seven more may come with them, and say where things stand in the 240 by 120 scene: `spots` (`{burrow, oak, store, tower, hut, yard0, yard1}`, each `[x, y]`), `walls` (at most 32 of `[x, y]`, the pieces of fence), `decor` (at most 24 of `{kind, x, y}`, `kind` whole, 0–17), `land` (at most 30 of `{kind, x, y}`, the landscape, `kind` whole, 0–9) and `works` (at most 12 of `{kind, x, y}`, the defences, `kind` whole, 0–11), with `x` whole, 0–240 and `y` whole, 0–120; `guards` (a list of 7 whole numbers, 0–3, the rank of the guardian at each post, 0 for none); and `posts` (a list of exactly 7, each `[x, y]` or `null`, where each guardian's signpost was carried to, `null` for one not moved). These seven are never a `400`: one that is not the right shape is left out, an entry that cannot be read is dropped, a place outside the scene is brought to its edge, and a list that is too long is cut. `guards` is kept as 7 ranks or not at all: a shorter list is filled out with 0, a longer one is cut to its first 7, a rank that cannot be read is 0, one above 3 is 3, and a list with no rank above 0 is left out. `posts` is kept as 7 entries or not at all: a list that is not 7 long is left out, an entry that cannot be read is `null`, the fifth (the dragon, who has no post) and one whose guardian's rank is 0 are always `null`, and a list of nothing but `null` is left out. Anything sent beside all these is dropped, not stored). Each is optional and only what is sent changes; a malformed value is a `400` and nothing is saved. The reading figures (everything from `weekKey` on, `shareLibrary` and `raidable` apart) are kept only for a shared profile (`public` or `followers`): sent for a private one they are checked, answered `200` and not stored, and `visibility: "private"` removes the ones held, along with the uploaded library and the requests to follow that were waiting. `visibility: "public"` turns the requests waiting on a followers-only profile into follows. The answer is the profile as `GET` gives it, so a client can see from `visibility` that its figures were not kept. Names, titles and authors are stored as one line of visible text (no control characters, right-to-left overrides or zero-width spaces), cut to their length; `displayName: ""` clears the name. `409` if the handle is taken. |
| `DELETE /v1/profile/me` | ✓ | `{deleted: true}`. Removes the profile and all community data (see Deletion). |
| `GET /v1/leaderboard?week=2026-W39&scope=everyone` | optional | Top 100 public profiles for that ISO week (default: the server's). Rows: `{rank, handle, displayName, pipSeed, avatar, weekMinutes, streak, booksFinished, reading, level, isYou}` (`reading` and `level` as on the profile, or `null`). With a token, `you` is the reader's own row and rank even outside the top 100 (public profiles only: a private or followers-only reader gets `null`, and the app draws their own row from the minutes on their device). `sharedReaders` counts the public profiles there are, read this week or not, so an empty board can say why it is empty; followers-only profiles are not on this board and not counted. |
| `GET /v1/leaderboard?week=…&scope=following` | ✓ | The reader plus the readers they follow who share a profile (public, or followers-only: a follow of those exists only once accepted), zeros included. Same rows. |
| `GET /v1/profile/:handle?week=&day=` | optional | A shared profile. **In full** (a public one to anyone; a followers-only one to its owner and to readers whose follow it accepted): `{handle, displayName, pipSeed, avatar, visibility, locked: false, weekKey, weekMinutes, streak, booksFinished, shelf, reading, level, badges, arcade, camp, sharesLibrary, kudosThisWeek, followerCount, followingCount}`; with a token also `isYou`, `isFollowing`, `followsYou`, `kudosSentToday` (for local `day`), `activeDuel`, `youBlocked` (the caller has blocked this reader). **Locked** (a followers-only one to anyone else, signed in or not): `200` with `{handle, displayName, pipSeed, avatar, visibility: "followers", locked: true, requested, isYou: false, following: false}`, where `requested` says the caller has a request waiting, and the figures of a full card as empties (`isFollowing: false, weekKey, weekMinutes: 0, streak: 0, booksFinished: 0, shelf: [], kudosThisWeek: 0, followerCount: 0, followingCount: 0`) so an app from before `locked` can still draw it; and `youBlocked: true`, only when the caller has blocked them (left out otherwise). `404` if private or absent, and to a signed-in reader this one has blocked. |
| `POST /v1/follows/:handle` | ✓ | Follow, or ask to. Idempotent. A public target is followed at once → `{following: true, requested: false}`. A followers-only target gets a request → `{following: false, requested: true}`, and is told once (`follow_request`). Already following → `{following: true, requested: false}`. The caller must share a profile (`403`), the target too (`404`), not yourself (`400`). Up to 500 follows (`409`). `403` "You can't interact with this reader." while either has blocked the other. |
| `DELETE /v1/follows/:handle` | ✓ | Unfollow, and take back a request that is still waiting → `{following: false, requested: false}` (works whatever either side's visibility). |
| `GET /v1/follows` | ✓ | `{following: [{handle, displayName, pipSeed, avatar}], followerCount}` (the ones who still share a profile; accepted follows only). |
| `GET /v1/follow-requests` | ✓ | The requests waiting for the caller, newest first, at most 100: `{requests: [{handle, displayName, pipSeed, avatar, createdAt}]}`. Askers who no longer share a profile are left out. |
| `POST /v1/follow-requests/:handle/accept` | ✓ | Makes the follow, deletes the request, tells the asker (`follow_accept`) → `{accepted: true}`. `404` if that reader has no request waiting (or no longer shares a profile); `409` if they already follow 500 (the request is kept). |
| `POST /v1/follow-requests/:handle/decline` | ✓ | Deletes the request, tells nobody → `{declined: true}`. `404` as for accept. |
| `GET /v1/visitors?day=2026-09-27&week=2026-W39` | ✓ | Whose Pip could come by today: `{day, visitors: [{handle, displayName, pipSeed, avatar, weekMinutes, streak}]}`, at most 5 of the readers the caller follows, who follow the caller back, who share a profile and whose `readDay` is `day` (the caller's own local date; `400` if no clock could be in it). Never the caller. Which five is a hash of the day, the caller and each friend, so it is the same handful all day and nobody is favoured. A caller whose own profile is not shared gets an empty list. `readDay` itself is never returned by any route. Kept 30 s per caller; any profile change, and the caller's own follow or unfollow, clears it. |
| `POST /v1/kudos/:handle` | ✓ | `{dayKey: "2026-09-27", weekKey: "2026-W39"}` (the reader's local day and week). Once per reader per day (`409`). `201 {sent, kudosThisWeek}`. The sender must share a profile (`403`); the target must be one they can see in full (`404` private or absent, `403` followers-only and not followed). `403` in the same neutral words while either has blocked the other. |
| `POST /v1/duels` | ✓ | `{handle, weekKey, stake?}` → `201` with the duel as below. Challenge for that week. `stake` is a whole number 0–50 (0 when left out, `400` otherwise): kept on the duel and shown to both sides, nothing more; the server holds nobody's seeds and the two apps settle it. One duel per pair per week, at most 3 pending/accepted per reader (`409`). The challenger must share a profile (`403`) and be able to see the other in full (`404` / `403` as for kudos). `403` in the neutral words while either has blocked the other. |
| `POST /v1/duels/:id/accept` · `/decline` | ✓ | Only the challenged reader, only while pending and the week is not over. Accepting needs both to share a profile still. |
| `GET /v1/duels` | ✓ | `{duels: […]}`: this week's pending/accepted duels and results settled in the last 8 days, each `{id, weekKey, status, youChallenged, weekOver, you, them, stake, result}` (`stake` is 0 on a duel from before stakes). Settles finished weeks first. |
| `GET /v1/inbox?since=ISO` | ✓ | `{events, now}`: the newest 50 events after `since`. Types: `follow`, `follow_request`, `follow_accept`, `kudos`, `gift`, `duel_invite`, `duel_accepted`, `duel_result`, each `{id, type, createdAt, actor}`; a `duel_*` event also carries `duel`, and a `follow_request` carries `pending` (whether it is still waiting: the event is written once per pair and stays as history after it is answered or taken back). A `gift` event is the actor only; the gift itself is in `GET /v1/gifts`. Events from readers who no longer share a profile are omitted. So are events from a reader on either side of a block with the caller. |
| `GET /v1/search?q=ma` | optional | Up to 10 shared profiles whose handle starts with `q`: `{results: [{handle, displayName, pipSeed, avatar, visibility, locked, weekMinutes, streak}]}`. A followers-only reader is `locked: true` with `weekMinutes: 0, streak: 0`, except to themself and, with a token, to readers whose follow they accepted. A reader who has blocked the caller is not among the results. |
| `PUT /v1/library/me` | ✓ | `{books: [{key, title, author, state, percent}]}` → `{count}`. Replaces the reader's uploaded library. At most 3000 books; `key` 1–160 characters (trimmed and lower-cased; sent twice, the later one is kept); `title` 1–160; `author` ≤80 or `null`; `state` one of `reading`, `finished`, `unread`; `percent` whole, 0–100. `400` for anything else, `403` unless the reader shares a profile, `413` over 2 MB, `429` past the library limit. |
| `DELETE /v1/library/me` | ✓ | `{deleted: true}`. |
| `GET /v1/profile/:handle/library` | ✓ | `{books, updatedAt}` (`{books: [], updatedAt: null}` when nothing was uploaded), to the owner and to readers who follow them, and only if the owner's `shareLibrary` is on. `404` if the reader is private or absent, is followers-only and has not accepted the caller, or does not share a library (the owner included); `403` for a public reader who does share one, to a caller who does not follow them. |
| `POST /v1/library/among` | ✓ | `{keys: [up to 500 keys]}` → `{books: [{key, finished, readers: [{handle, displayName, pipSeed, avatar, state: "reading", percent}]}]}`. Over the readers the caller follows who share a profile and a library: how many finished each book, and up to 5 who are reading it, furthest along first. Only keys somebody has finished or is reading, in the order asked. `400` for more than 500 keys or a malformed one; `413` over 256 KB. |
| `POST /v1/posts` | ✓ | `{kind?, title (1–160), author? (≤80), bookKey? (1–160, lower-cased), audience?, spoiler?, …}` → `201 {post, replaced: false}`. `kind` is `finished` (default), `review` or `quote`; `audience` is `followers` (default) or `everyone`; `spoiler` is a boolean (default `false`). By kind: `finished` takes `rating` (whole, 1–5, or null) and `line` (≤280 or null); `review` takes `rating` (whole, 1–5, required) and `body` (1–3000, line breaks kept, at most one blank line in a row); `quote` takes `quote` (1–500) and `note` (≤280 or null). A post is `{id, kind, person: {handle, displayName, pipSeed, avatar}, title, author, bookKey, rating, line, body, quote, note, spoiler, audience, likes, dislikes, myReaction (1, -1 or 0), hidden, createdAt, editedAt, isYou}`; the fields a kind does not have are `null`, and `hidden` is true only to its author, on a post hidden by reports. `followers` needs a shared profile (`403`); `everyone` needs good standing (the `403`s and the `503` under Moderation); a suspended reader posts neither. **One review of a book per reader:** a second one replaces the first where it stands → `200 {post, replaced: true}`, the same `id` and `createdAt`, `editedAt` set, its likes and dislikes back to 0, still hidden if it was. **30 quotes from one book per reader, ever** (`409`; deleting some does not make room). "The same book" is its `bookKey`, or its title and author as typed when there is none. `429` (with `Retry-After`) past 20 posts in a UTC day, of any kind, or past 10 quotes in one; a post deleted is still one of the day's. |
| `POST /v1/posts/:id/react` | ✓ | `{value: 1 \| -1 \| 0}` → `{likes, dislikes, myReaction}`. One reaction per reader per post; changing it moves both counts, `0` takes it back. The reader must share a profile, not be suspended, and have an account 3 days old at a confirmed email address (`403`, each with its own message; not the guidelines, and not a public profile), be able to see the post (`404`), and not be its author (`400`). |
| `GET /v1/discover?sort=new\|top&cursor=…&before=ISO&skip=n` | ✓ | `{posts, more, next}`: posts with audience `everyone` whose author is public and not suspended, not hidden, not the caller's own, and not from a reader on either side of a block with the caller. **At most 3 posts by one reader on a page**, in both orders; the rest of theirs are held over to later pages, never dropped. `new` (default): newest first, 30 a page. `next` is the cursor for the page after (send it back as `cursor`; `null` when there is no more): it is what carries the posts held over. `before` (a date) still starts a page from that moment, under the same rule, but knows nothing of what earlier pages held over. `400` for a `cursor` this server did not give out. `top`: the last 30 days by likes less dislikes, then newest, 30 a page by `skip` (at most 300; `next` is always `null`). |
| `GET /v1/books/posts?key=<bookKey>&before=ISO` | ✓ | `{posts, more, summary: {reviews, average}}`: the posts with that `bookKey`, newest first, 30 a page: those for everyone (under the discover rules), those of the readers the caller follows, and the caller's own. `summary` counts the book's public reviews and gives their average rating to one decimal (`null` with none), over its newest 1000. `400` without a usable `key`. |
| `GET /v1/feed?before=ISO` | ✓ | `{posts, more}`: posts of every kind and audience by the caller and by the readers they follow who share a profile, newest first, 30 a page. `before` is the `createdAt` of the last post of the page before. A private or suspended reader's posts are in no feed (a private reader's not even their own), nor are hidden ones except to their author. |
| `GET /v1/profile/:handle/posts` | optional | `{posts}`: that reader's latest 30. A reader who does not follow them (signed out included) sees only their `everyone` posts; the owner and their followers see all. A followers-only reader's are for the owner and accepted followers (`403` otherwise). `404` if private or absent, or if either has blocked the other. |
| `DELETE /v1/posts/:id` | ✓ | `{deleted: true}`. The caller's own only; anything else is a `404`. Its reactions go with it and its open reports are closed. |
| `POST /v1/clubs` | ✓ | `{name (1–60), goalMinutes? (whole, 0–10080, default 0)}` → `201 {club}`. A club is `{id, name, code, goalMinutes, books: [{title, author}], isOwner, members: [{handle, displayName, pipSeed, avatar, weekMinutes, isYou}]}`; `code` is 8 characters from `ABCDEFGHJKMNPQRSTWXYZ23456789`; members are ordered by minutes for `?week=`, then handle, and one who has gone private is left out. `403` unless the reader shares a profile; `409` past 10 clubs. |
| `GET /v1/clubs?week=` | ✓ | `{clubs: […]}`, oldest first. A reader who does not share a profile gets `{clubs: []}`. |
| `POST /v1/clubs/join?week=` | ✓ | `{code}` (any case, spaces and dashes ignored) → `{club}`. Idempotent. `404` unknown code; `403` unless the reader shares a profile; `409` if the club has 50 members or the reader is in 10 clubs. |
| `POST /v1/clubs/:id/leave` | ✓ | `{left: true}`. The owner leaving hands the club to the member who joined earliest; the last member leaving deletes it. `404` if not a member. |
| `PUT /v1/clubs/:id?week=` | ✓ | `{name?, goalMinutes?, books?}` (at most 50 of `{title (1–160), author (≤80) or null}`; a title repeated in another case is kept once) → `{club}`. The owner only: `403` for another member (or a reader who does not share a profile), `404` for anyone else. |
| `POST /v1/clubs/:id/books?week=` | ✓ | `{title, author?}` → `{club}`. Any member. `409` if that title (whatever its case) is already listed, the list has 50, or another member changed the list at the same moment; `403` unless the reader shares a profile; `404` if not a member. |
| `POST /v1/gifts` | ✓ | `{to: handle, kind, itemId}` → `201 {gift: {id}}`. `kind` is one of `accessory`, `room`, `wallpaper`, `flooring`, `skin`, `move`; `itemId` matches `^[a-z][a-z0-9_-]{0,31}$` (`400` otherwise, and for a gift to yourself). Both must share a profile (`403` the sender, `404` the receiver) and each follow the other (`403`). `429` (with `Retry-After`) past 5 sent in a UTC day; `409` while 20 unclaimed gifts wait for the receiver. Tells the receiver (`gift`). `403` in the neutral words while either has blocked the other. |
| `GET /v1/gifts` | ✓ | `{gifts: [{id, from: {handle, displayName, pipSeed, avatar}, kind, itemId, createdAt}]}`: the caller's unclaimed gifts, oldest first, at most 20. One from a reader who no longer shares a profile is left out. So is one from a reader on either side of a block. |
| `POST /v1/gifts/:id/claim` | ✓ | `{claimed: true}`. The receiver only (`404` otherwise); claiming twice is the same as once. |
| `GET /v1/raids/targets` | ✓ | `{targets: [{handle, name, camp, raidedToday}]}`: whose camp the caller could raid. The readers they follow who follow them back, who share a profile with a `camp` on it and have not turned `raidable` off, by handle, at most 50. `name` is the display name, or the handle where there is none; `camp` is the one on the profile; `raidedToday` says the caller has raided it this UTC day. A caller who does not share a profile gets `{targets: []}`. |
| `POST /v1/raids` | ✓ | `{to: handle, stars}` → `201 {raid: {id}}`. Records a raid the caller's app has just played against that reader's camp; `stars` is whole, 0–3 (`400` otherwise, and for a raid on yourself). Both must share a profile (`403` the raider, `404` the reader raided) and each follow the other (`403`); `403` if the reader raided has turned `raidable` off; `409` if they show no camp. `429` (with `Retry-After`) for a second raid by the same reader on the same camp in one UTC day. At most 20 wait for one reader: a newer one marks the oldest as seen. Nobody's inbox is told. `403` in the neutral words while either has blocked the other. |
| `GET /v1/raids` | ✓ | `{raids: [{id, by, name, stars, at}]}`: the raids on the caller's camp not yet acknowledged, oldest first, at most 20. `by` and `name` are the raider's handle and name as they were when they raided; `at` is an ISO time. One from a reader who no longer shares a profile is left out. So is one from a reader on either side of a block. |
| `POST /v1/raids/ack` | ✓ | `{ids}` (at most 100 raid ids; `400` for anything that is not a list of ids) → `{acknowledged: true}`. Marks those of them that are raids on the caller's own camp as seen, so they are not handed over again; an id that is another reader's, already seen or gone is passed over. |
| `POST /v1/rules/accept` | ✓ | `{accepted: true}`. Records, once, that the reader accepted the community guidelines (needed to post in public). Idempotent. `403` with no profile yet. |
| `POST /v1/communities` | ✓ | `{kind: "book" \| "series", key (1–160, lower-cased), title (1–120), author? (≤80)}` → `{community}`. There is one community per `(kind, key)`: if it exists the caller joins it (`200`, its own title kept); otherwise it is started with the caller as keeper and first member (`201`). A community is `{id, kind, key, title, author, memberCount, threadCount, isMember, isKeeper, listed, createdAt}`, where `listed` says it is in the directory: it has at some time had 3 established members (accounts 7 days old at a confirmed email) and has not been unlisted by reports or the admin; once listed it stays listed whoever leaves, and `memberCount` is always the real count. Both need good standing (the `403`s and `503` under Moderation). Starting one also needs an account 7 days old (`403`), none started already this UTC day (`429` with `Retry-After`; deleting it, or the profile, does not give the day back) and fewer than 5 kept (`409`). Joining: `403` if removed from it, `409` in 50 communities already. |
| `GET /v1/communities?q=<text>&mine=1` | ✓ | `{communities}`. `mine=1`: the caller's, any size, most recently active first. Otherwise the directory: listed communities whose title contains `q` (case-insensitive, matched as text not as a pattern), largest first, at most 30; with `q` under 2 characters, the 30 largest. An unlisted community is never here: one that has not yet had 3 established members, or that reports or the admin took out. |
| `GET /v1/communities/find?kind=&key=` | ✓ | `{community}`, listed or not: how the app gets from a book to its discussion. `404` if there is none; `400` for a bad `kind` or `key`. |
| `GET /v1/communities/:id` | ✓ | `{community}`, listed or not, for a reader who shares a profile and has not been removed from it; `404` otherwise. |
| `POST /v1/communities/:id/join` | ✓ | `{community}` as it is after joining. Idempotent. Good standing; `403` if removed from it; `409` in 50 already. A community with no keeper gives the place to the joiner if they could have started one (account 7 days old, keeping fewer than 5). |
| `POST /v1/communities/:id/leave` | ✓ | `{left: true}`. Always allowed. The keeper leaving hands on to the member who joined earliest; the last member leaving deletes a community with no threads, and leaves one with threads standing with no keeper. `404` if not a member. |
| `POST /v1/communities/:id/members/:handle/remove` | ✓ | `{removed: true}`: takes that reader out and keeps them out (they cannot rejoin, read its threads, or see it by id). The keeper, or an admin (`403` otherwise); `400` for yourself; `404` for an unknown handle. `429` (with `Retry-After`) past 10 removals by a keeper in a UTC day; an admin's are not counted. |
| `GET /v1/communities/:id/threads?before=ISO&at=n` | ✓ | `{community, threads, more}`: pinned threads first (first page only), then by `lastActivityAt`, 30 a page; `before` is the `lastActivityAt` of the last one. A thread here is `{id, communityId, title, titleHidden, excerpt, spoiler, pinned, replyCount, createdAt, lastActivityAt, author, isYou, likes, dislikes, myReaction, hidden, canRemove}`: no `body`, and `excerpt` (≤200 characters) only when `spoiler` is `null`, else `null`. A thread with a spoiler mark is sent with `title: null, titleHidden: true` to everyone but its author, since a title can give as much away; `at` is how far the reader is (percent of the book, or which book of the series), and a marked thread at or before that place is sent with its title. `author` is a person, or `null` for a reader whose account is gone. For any reader who shares a profile (`403`), member or not, unless removed from the community (`403`). |
| `POST /v1/communities/:id/threads` | ✓ | `{title (1–120), body (1–5000, line breaks kept), spoiler?}` → `201 {thread}` (with `body` and `title`, no `excerpt`). `spoiler` is `null`, or `{percent: 1–100}` in a book's community, or `{book: 1–99}` in a series' (`400` for the wrong one). Members (`403`) in good standing; `429` past 5 threads in a UTC day across all communities (a deleted one still counts). |
| `GET /v1/threads/:id?after=ISO` | ✓ | `{thread, community, replies, more}`: the thread with its `title` (always: opening it is the reader's choice) and `body`, and its replies oldest first, 100 a page (`after` is the `createdAt` of the last one). A reply is `{id, threadId, body, createdAt, author, isYou, likes, dislikes, myReaction, hidden, canRemove}`. `404` if the thread is hidden (to anyone but its author), or its author is no longer public, is suspended, or is on either side of a block with the caller. |
| `POST /v1/threads/:id/replies` | ✓ | `{body (1–3000, line breaks kept)}` → `201 {reply}`. Members (`403`) in good standing; `429` past 60 replies in a UTC day (a deleted one still counts); `409` to a thread hidden by reports. |
| `DELETE /v1/threads/:id` · `DELETE /v1/replies/:id` | ✓ | `{deleted: true}`. Its author, the community's keeper, or an admin (`403` otherwise). A thread goes with its replies. |
| `POST /v1/threads/:id/pin` | ✓ | `{pinned: boolean}` → `{pinned}`. The keeper or an admin (`403`); `409` with 3 pinned already. |
| `POST /v1/threads/:id/react` · `POST /v1/replies/:id/react` | ✓ | As for a post, with the same `403`s: `{value}` → `{likes, dislikes, myReaction}`. |
| `POST /v1/reports` | ✓ | `{target: "post" \| "thread" \| "reply" \| "community" \| "profile", id (or `handle` for a profile), reason: "spam" \| "harassment" \| "hate" \| "sexual" \| "spoiler" \| "other", note? (≤280)}` → `{reported: true}`. Once per reader per thing; again changes nothing. The reporter must share a profile, not be suspended, and have an account 3 days old (`403`); `400` for their own; `404` if it is not there; `429` past 20 in a UTC day. Every report is recorded and reaches the admin; whether it counts towards hiding the thing by itself depends on the reporter (under Moderation), and the answer is the same either way. |
| `POST /v1/blocks/:handle` | ✓ | `{blocked: true}`. Idempotent. Removes the follows and follow requests between the two, both ways. `404` unknown or private handle, `400` yourself, `409` past 1000 blocks. |
| `DELETE /v1/blocks/:handle` | ✓ | `{blocked: false}`. The follows do not come back. |
| `GET /v1/blocks` | ✓ | `{blocked: [{handle, displayName, pipSeed, avatar}]}`: the readers the caller blocked, newest first. Never who blocked the caller. |
| `GET /v1/admin/reports` | admin | `{reports: [{target, id, count, counting, reasons: {reason: n}, notes, firstAt, latestAt, content}]}` (`counting` is how many of the `count` count towards hiding it by themselves): the open reports, one entry per thing, most recently reported first, at most 100. `content` is the thing as it stands: `{person, kind, title, author, body, quote, note, line, spoiler, hidden, unlisted, createdAt}` (`person` is who wrote it, or a community's keeper; for a profile `{person, visibility, suspendedUntil}`). |
| `POST /v1/admin/resolve` | admin | `{target, id, action: "remove" \| "restore" \| "dismiss"}` → `{resolved: <reports closed>, action}`. See Moderation. For a profile, `id` may be the handle. |
| `POST /v1/admin/suspend` | admin | `{handle, days (whole, 0–3650)}` → `{handle, suspendedUntil}`. `0` lifts it. Remembered against the reader's email address, as a keyed hash, until it ends (see Moderation). |
| `POST /v1/admin/community` | admin | `{id, title? (1–120), author? (≤80 or null), keeper? (handle of a current member), unban? (handle), relist? (boolean)}` → `{community}` (the same view as everywhere). Only what is sent changes. `relist: true` clears what reports or the admin unlisted (it does not list a community that never had its 3 established members); `relist: false` unlists it. `404` unknown community or handle; `409` if `keeper` is not a member; `400` for a malformed value. |
| `GET /v1/notice` | — | `{version, note, at}`: the newest Leaflet as the owner has said (all `null` when nothing is said). No account needed: most readers have none. Kept in memory for a minute, so hundreds of apps asking cost at most one read a minute. Apps from 1.4.2 ask 20 s after opening and every 6 hours, and show a reader who is behind a card with Update (the Store's page). |
| `PUT /v1/admin/notice` | admin | `{version (two to four whole numbers with dots, or null), note? (≤160, spaces folded)}` → `{version, note, at}`. `version: null` takes the notice down. `400` for a malformed version or a note that is not text. Seen by every app at once (the kept copy is dropped). Stored as the `notice` document in `settings`. |
| `GET /v1/admin/settings` · `PUT /v1/admin/settings` | admin | `{publicPosting: boolean}` → `{publicPosting}`. |

A profile is shared one of three ways, and every route filters by it when it
answers, so a change of `visibility` takes effect everywhere at once and
nothing is rewritten. `public` is on the board and open to anyone. `followers`
is found by handle and in search as a locked card (who it is, nothing about
their reading) and is seen in full by its owner and by the readers whose
follow it accepted. `private` is in no answer at all and `404`s like a handle
that does not exist. Three checks do this (`src/community.js`):

- **Public only** (`isPublic`): the everyone board, its `you` row and
  `sharedReaders`. That board is open to anybody, signed in or not.
- **Shared, either way** (`isSocial`): who may act (follow, send kudos, duel,
  accept a duel, upload a library, post, make or join or change a club, give,
  raid a friend's camp),
  and who may be shown where the two readers already stand in a relation that
  allows it: a follow target, the following board and the follow list (a
  follow of a followers-only reader exists only once accepted), visitors (a
  follow each way), follow requests, inbox actors, both sides of a duel, the
  feed, fellow club members (joining is the consent, whatever the follows),
  library owners in `/library/among`, gift senders, raiders and the friends
  who can be raided (a follow each way), and search results.
- **Visible to this reader** (`canSee`: public, or followers-only and the
  owner or an accepted follower): the full profile, a kudos or duel target,
  and `/profile/:handle/posts`. `/profile/:handle/library` asks for more: an
  actual follow, even of a public reader.

On top of that sits the public layer (posts for everyone, book communities
and their threads), which strangers read, and so asks for more
(`src/standing.js`):

- **Good standing** to write there (a post with `audience: "everyone"`,
  starting or joining a community, a thread, a reply): a public profile, a
  confirmed email, an account 3 days old, the guidelines accepted, not
  suspended, and public posting not paused.
- **Shown at read time** only while its author is public and not suspended,
  and it is not hidden by reports. Going private or followers-only, or being
  suspended, takes a reader's public posts, threads and replies out of every
  answer without deleting them; they are back when that ends.
- **Blocks** cut both ways: neither reader is shown the other's posts,
  threads or replies anywhere, and neither can follow, send kudos, duel or
  give to the other. The blocked reader gets a `404` for the blocker's
  profile, as for a private one. One thing a block does not do: two readers
  in the same club still see each other on its board (leave the club to
  avoid that).

The "admin" routes answer anyone who is not an admin with the same `404` as a
route that does not exist.

The public board, search, public profiles and a public reader's posts for
everyone work signed out. Duels are settled lazily —
the first `GET /v1/duels` or `/v1/inbox` by either side after the week is over
in every time zone — and the result goes to both inboxes. Each duel keeps both
sides' latest minutes, copied on every `PUT /v1/profile/me`, so the result
survives the profile moving on to the next week.

`account` is `{id, email, displayName, avatar, createdAt}` — never the password hash.

**Avatars.** A reader's Pip is `skin.move` (e.g. `wizard.magic`), one of the
ids in `src/avatars.js` — a copy of the app's catalogue (`apps/src/pip/avatars.ts`);
`test/avatars.test.js` fails if the two drift. Anything else is a `400`, and the
earned-only skins (Champ, Golden, Prism) are never on the list. Every person in a
community payload (board rows, profiles, follows, search, inbox actors, both sides
of a duel) carries `avatar` beside `pipSeed`; it is `null` when the reader never
picked one (or holds an id this server no longer knows), and the app then picks a
skin from `pipSeed` as before.

### Passwords and sessions

- Emails are trimmed and lower-cased; passwords are 8–200 characters.
- Passwords are hashed with Node's built-in **scrypt** (N=2^15, r=8, p=1, 16-byte
  random salt, 64-byte key), stored as `scrypt$N$r$p$salt$hash` so parameters
  can be raised later. Compared with `timingSafeEqual`; a login for an unknown
  email still runs a hash so timing does not reveal whether it exists.
- A session token is 32 random bytes, returned **once**. Only its SHA-256 is
  stored. Sessions last 90 days from last use (refreshed at most hourly) and a
  TTL index removes expired ones.
- A session the server has just seen is remembered in memory for a minute, so
  a request does not begin with a query to ask who is calling. Signing out,
  changing or resetting the password and deleting the account end the
  sessions concerned in memory as they do in the database, at once. Only a
  session deleted from the database by hand goes on working for up to a
  minute. Like the rate limits, this assumes a single instance.
- At most two password hashes are worked out at a time (each holds 32 MiB
  while it is); the rest wait their turn. A burst of sign-ins is therefore
  64 MiB at its worst, not 128, in a process allowed 256.
- The desktop app keeps the token in the OS keychain (service
  `app.leaflet.account`), never in SQLite or the webview.

### Rate limits

In memory, per process (see `src/rateLimit.js`):

| | Limit |
| --- | --- |
| Signup + login requests per IP | 30 / 15 min |
| Failed password checks per email (or per account for password change / delete) | 10 / 15 min |
| New accounts per IP, and per email | 5 / hour |
| Community writes per account, counted separately for each of seven groups: follows (follow, unfollow, kudos, duel, accept or decline a duel, accept or decline a follow request) · posts (post, delete) · clubs (make, join, leave, change, add a book) · gifts (send, claim) · raids (record, acknowledge) · communities (start, join, leave, remove a member, thread, reply, delete, pin) · moderation (accept the guidelines, block, unblock, report) | 60 / 15 min each (all seven take their numbers from `social`) |
| Likes and dislikes per account, counted separately for posts and for threads and replies | 300 / 15 min each (`react`) |
| Community directory and lookup by key (`GET /v1/communities`, `/communities/find`) per account | 120 / 5 min (the `search` numbers, its own counter) |
| Library uploads (`PUT /v1/library/me`) per account, counted before the body is read | 20 / 15 min (`library`) |
| Searches per IP | 120 / 5 min |
| `POST /v1/library/among` per account | 120 / 5 min (the `search` numbers, its own counter) |
| Posts per reader, of any kind · of those, quotes · quotes from one book per reader | 20 / UTC day · 10 / UTC day (`tallies`) · 30 ever (`quoteTallies`) |
| Communities started per reader · kept at once · joined at once · members a keeper removes | 1 / UTC day (`tallies`) · 5 · 50 · 10 / UTC day (`tallies`) |
| Threads · replies per reader, across all communities | 5 / UTC day · 60 / UTC day (`tallies`) |
| Reports made per reader · blocks per reader | 20 / UTC day (`tallies`) · 1000 |
| Gifts sent per reader · unclaimed gifts waiting for one reader | 5 / UTC day · 20 (counted in `gifts`, not in memory) |
| Raids by one reader on one camp · unacknowledged raids waiting for one reader | 1 / UTC day (the unique index on `raids`) · 20 (a newer one pushes the oldest out) |
| Visitor lists (`GET /v1/visitors`) per account | 30 / 15 min |
| Saves of a reader's own profile (`PUT` and `DELETE /v1/profile/me`) per account, counted before the body is read | 300 / 15 min (`profile`) |
| Fetches of the sync document (`GET /v1/state`) per account · writes of it (`PUT` and `DELETE /v1/state`), counted before the body is read | 300 / 15 min each (`state`) |
| Password-reset emails per IP / per email address | 10 / hour · 3 / hour |
| Completed password resets per account | 3 / 365 days (stored on the account; past it the email explains when) |
| Wrong reset codes per email address | 10 / 15 min, and 5 per code |

The daily allowances are counted in `tallies`: a row per reader, kind and
UTC day that only goes up, so deleting a post, thread, reply or community
does not buy another, and neither does deleting the profile. (Gifts are
still counted from the gifts themselves, which cannot be deleted, and a
raid from the raids, which stay for their 30 days whether seen or not.) The rest
live in memory, and because they do, **they assume a single instance**
and reset on restart. Running several instances would multiply the limits; move the counters
to a shared store (e.g. a Mongo collection with a TTL index) before scaling out.
`trust proxy` is set to `loopback`, so behind Caddy on the same machine the
limits see the real client IP from `X-Forwarded-For`, and a client cannot spoof
it by sending the header directly.

## Capacity

What the server asks of a small VM and a free Atlas cluster, measured with
`node scripts/load.mjs` (below) on 2026-10-13. The cluster's own limits are
not in this repository: the figures used for them here are assumptions to
check against Atlas (500 connections, 512 MB of data and indexes, about 100
operations a second before it slows everyone down, 10 GB of transfer each
way in seven days).

**What one open app sends.** Every five minutes, on any tab: the inbox, its
own figures, the board of the readers followed, and gifts (four requests).
Every minute while a book is being read: its figures. Every minute while the
Board tab is open: its figures, the board, and duels. About 48 requests an
hour idle, 100 reading, 200 on the board. For 200 apps open at once, half of
them idle, a quarter reading, the rest on the board or in the camp: **about
320 requests a minute**, 5 a second.

**Connections.** One `MongoClient` for the process, a pool of 10
(`MONGO_MAX_POOL`), and the driver's own two per member of the cluster to
watch it: 16 at most on a three-member cluster, however many readers there
are. With all ten busy an operation waits up to 2 s (`MONGO_WAIT_QUEUE_MS`)
and its request is then answered `503` with `Retry-After`; and no more than
40 requests are worked on at once (`MAX_REQUESTS_AT_ONCE`), the next being
answered `503` on arrival, so that a slow database is met by turning some
requests away quickly and not by every request taking half a minute. Ten,
because each operation is a round trip: with 40 ms added to every trip, four
times the load above (800 apps' worth) was carried with ten connections
(half the requests answered in 0.2 s, 95 in 100 in 0.8 s, none refused), and
with five one request in seven was refused and the rest took 1 to 4 s.

**Operations.** A request is 1 to 10 operations (the inbox 7, a save of
figures with something new 5, with nothing new 2, a board 2 to 4, gifts 1 to
3), plus one a minute an account to look its session up. The 200 apps above
come to about **20 operations a second**, a tenth of an operation a second
an app. At 100 a second the cluster is the limit at about 1,000 apps open at
once in that mix, or about 550 if every one of them sat on the Board tab.

**Transfer.** What comes back from the database is about half a megabyte an
hour an open app: nearly half of it the reader's own profile read back when
their figures are saved, three tenths the public board (which is kept in memory
only until the next reader's figures change, and with a few hundred reading
that is all the time), the rest the inbox and the board of readers
followed. Ten gigabytes in seven days is some 2,700 app-hours a day: 200
readers with the app open eight hours a day use about six tenths of it.

**Storage.** A reader with a month or two of use behind them is about 37 KB
of data and indexes: a profile with a full camp 3.6 KB, follows, inbox
events, kudos, raids and gifts about 11 KB between them (all but follows
expire: see below), ten posts 7 KB, the sync document 15 KB for the two in
five who back their reading up here, and a shared library of 300 books 41 KB
for the one in five who share one. 200 readers are about 7 MB and 2,000
about 74 MB, of 512 (twice that if every one of them both backed up and
shared a library). What grows without end is what readers write (posts,
threads, replies: under 1 KB each) and the sync document (about 15 KB a year
of reading, 2 MB at most); everything else is capped a reader or expires
(sessions after 90 days unused, inbox events 60, raids 30, claimed gifts 30,
kudos 21, duels 90, daily counts 4, resolved reports 180).

**Memory.** With the heap the unit allows (`--max-old-space-size=128`), on a
development machine: about 100 MB at the pace of those 200 apps, flat over
ten minutes (35 MB of it heap in use); about 200 MB at four times that pace
and at thirty (the heap in use never past 80).
Two dozen sign-ins arriving together add 64 MB while they last (two
password hashes at a time, 32 MiB each). Against the unit's 256 MB that is
comfortable at 200 apps, and close at several times as many with a burst of
sign-ins on top. The VM's own figure is in `systemctl status leaflet-api`.

**What gives first** as readers are added, under those assumptions: the
cluster's weekly transfer (about 330 readers with the app open eight hours
every day, or 1,300 at two hours), then its operations a second (about 1,000
apps open at the same moment). The connections, the storage and the VM's
processor are all further off than either; its memory is the one to watch.

### Measuring it

```bash
node scripts/load.mjs                 # 200 readers; an hour of open apps in two minutes
node scripts/load.mjs --latency 40    # every trip to the database 40 ms longer
node scripts/load.mjs --plans         # the plan of every query each request makes
node scripts/load.mjs --latency 40 --span 10 --seconds 600   # ten minutes, at the apps' own pace
```

It needs a MongoDB on this machine (`TEST_MONGO_URI`, default
`mongodb://127.0.0.1:27017`) and talks to no other: it seeds a throwaway
database, runs the server as a child process with the real limits, replays
what open apps send, prints the operations and plan of each request (a
collection scan is marked), latency, the connections the server held, its
memory and what the seeded readers weigh, and drops the database. One run
at a time: the connections are counted by the server's name.

It is a measurement of this code on the machine it is run on. The
operations a request makes, the plans, the connections and the bytes stored
are the same wherever it runs. The milliseconds and the megabytes of memory
are not: the VM's one shared core is several times slower than a desktop's,
and a trip to Atlas is tens of milliseconds where a local one is a fraction
of one (`--latency` stands in for that, crudely). Whether a free cluster
slows down at the load measured here is not something a local database can
show.

## Exactly what is stored per reader

For the privacy policy. Four core collections keyed by the account's
ObjectId, a short-lived password-reset record, nine small community
collections that reference it (`libraries` is keyed by it too), and the
public layer's nine (`quoteTallies`, `tallies`, `reactions`, `communities`,
`threads`, `replies`, `reports`, `blocks`, `suspensions`) and one settings
document.

**`accounts`** — one per account
- `_id` — ObjectId
- `email` — normalised (trimmed, lower-case); unique
- `passwordHash` — scrypt string as above (never the password)
- `displayName` — optional, up to 40 characters, or `null`
- `avatar` — optional, one of the ids in `src/avatars.js`, or `null`
- `createdAt`, `passwordChangedAt` — dates
- `passwordResets` — when the password was reset with an emailed code, the last 365 days only (for the 3-a-year limit)
- `suspendedUntil` — only if an admin suspended the reader, or the account was made with (or changed to) an address whose suspension had not ended: a copy of the profile's, so that deleting the profile and making another does not end it early; `null` once lifted

**`sessions`** — one per signed-in device
- `_id` — SHA-256 (hex) of the session token
- `userId` — the account's ObjectId
- `createdAt`, `lastUsedAt`, `expiresAt` — dates

**`resets`** — only while a password reset is pending; **deleted after 15 minutes** (TTL), when used, or after 5 wrong tries
- `_id` — the account's ObjectId
- `codeHash` — SHA-256 (hex) of the emailed code (never the code)
- `attempts` — wrong tries so far
- `createdAt`, `expiresAt` — dates

**`profiles`** — only once the reader saves a profile. Private unless a save says `visibility: "public"` or `"followers"`; the app (1.2 and later) sends `public` straight after sign-up unless the reader turned "Share my profile" off on the form. The server never shares a profile by itself, so accounts from before 1.2 stay as they were
- `_id` — the account's ObjectId
- `handle` — optional, 3–24 characters, unique
- `displayName` — optional, up to 40 characters (the public name; separate from the account's)
- `avatar` — a copy of the account's, refreshed on every profile save and avatar change
- `visibility` — `private` (default), `followers` or `public`
- `shareLibrary` — optional boolean: whether followers may ask for the uploaded library. A setting, kept whatever the visibility (like the handle); absent means no
- `raidable` — optional boolean: whether friends may raid the camp. A setting, kept whatever the visibility; absent means yes
- `weekKey` — ISO week the minutes belong to, e.g. `2026-W39`
- `weekMinutes` — 0–10080; `streak` — 0–36500; `booksFinished` — 0–100000
- `shelf` — up to 12 of `{title (≤120), author (≤80) | null, styleSeed (≤64)}`
- `readDay` — optional: the reader's own local date on which they last read, e.g. `2026-09-27` (sent by apps that have Pip's visitors; absent on older profiles, which then never visit). Only ever compared with the day a follower asks `GET /v1/visitors` about; no route returns it
- `reading` — optional: the book being read, `{title (≤120), author (≤80) | null, percent (0–100)}`, or `null`
- `level` — optional, 0–999, or `null`; `badges` — optional, up to 80 short ids; `arcade` — optional, `{dash, catch, flap}` best scores (0–10000000 each), or `null`. All self-reported by the app, like the minutes
- `camp` — optional: Pip's camp in the arcade's building game as the reader shows it, `{levels, yard, camps, banners, trophies}`, or `null`. `levels` is the level (0–5) of each of its six buildings (`burrow`, `oak`, `store`, `fence`, `tower`, `hut`); `yard` is up to 2 of `{kind (workshop, hive, well, stall, or null for an empty plot), level (0–3)}`; `camps` is how many magpie camps were beaten, `banners` and `trophies` how many of each there are (0–100000 each). It may also carry the camp's layout, so a friend's card can draw the camp as it is: `spots` (where each of `burrow`, `oak`, `store`, `tower`, `hut`, `yard0`, `yard1` stands, `[x, y]`), `walls` (up to 32 pieces of fence, `[x, y]` each), `decor` (up to 24 decorations, `{kind (0–17), x, y}` each), `land` (up to 30 pieces of landscape, `{kind (0–9), x, y}` each) and `works` (up to 12 defences, `{kind (0–11), x, y}` each), with `x` 0–240 and `y` 0–120; `guards` (the rank of the guardian at each of seven posts: seven whole numbers, 0 for none, 3 at most); and `posts` (where each guardian's signpost was carried to: seven of `[x, y]` or `null`, `null` for one not moved, for the dragon and for a guardian not posted). Each of the seven is left out when it was not sent or could not be read, `guards` also when no guardian is posted, and `posts` when no signpost was moved. The app then draws that part as a camp begins. The whole camp stays under 3 KB. Levels, counts, places and ranks only: which books the trophies are for is never sent here (the camp itself is in the app, and in the `states` blob if the device syncs through this server, which the server cannot read). Self-reported like the rest
- `weekKey`, `weekMinutes`, `streak`, `booksFinished`, `shelf`, `readDay`, `reading`, `level`, `badges`, `arcade` and `camp` are held **only while the profile is shared** (`public` or `followers`): a private profile's are refused quietly, and going private clears them
- `rulesAcceptedAt` — when the reader accepted the community guidelines, if they have; kept through going private
- `suspendedUntil` — when an admin's suspension from posting ends, or `null`; `role` — `admin` on the owner's own profile only, set by hand in the database
- `updatedAt` — date

**`states`** — only if the device syncs through this server
- `_id` — the account's ObjectId
- `state` — gzipped JSON of the reader's library entries and reading history
  (titles, authors, series, progress, reading-day minutes, focus sessions,
  highlights with their notes, bookmarks, collections, and Pip's shop, garden
  and camp) — opaque to the server, never book files
- `version` — integer counter; `updatedAt` — date

**`follows`** — one per follow, only between shared profiles when created. A follow of a followers-only reader is written when they accept the request (or make their profile public), never before; kept until unfollowed or either account is deleted
- `followerId`, `followeeId` — account ObjectIds (unique pair)
- `createdAt` — date
- Indexes: `{followerId, followeeId}` unique; `{followeeId}`

**`followRequests`** — one per request to follow a followers-only reader, **only while it waits**: deleted when accepted (it becomes a `follows` row), declined, taken back, when the reader asked goes private, or when either account is deleted
- `fromId`, `toId` — account ObjectIds (unique pair)
- `createdAt` — date
- Indexes: `{fromId, toId}` unique; `{toId, createdAt: -1}`

**`libraries`** — only if the reader uploaded one (`PUT /v1/library/me`), which only a reader who shares a profile can. Replaced whole by each upload; kept until the reader deletes it, goes private, or deletes the profile or account
- `_id` — the account's ObjectId
- `books` — up to 3000 of `{key (≤160, lower-case), title (≤160), author (≤80) | null, state (reading, finished or unread), percent (0–100)}`. No files, covers, highlights or dates
- `updatedAt` — date
- Indexes: none beyond `_id`

**`posts`** — one per finished book, review or quote a reader posted; kept until the reader deletes it, an admin removes it, or the profile or account is deleted (hidden, not deleted, while its reader is private or suspended, and while reports have hidden it)
- `userId` — the account's ObjectId
- `kind` — `finished`, `review` or `quote`; `audience` — `followers` or `everyone` (absent on posts from before audiences: read as `followers`); `spoiler` — boolean
- `title` (≤160), `author` (≤80) or `null`; `bookKey` — the app's key for the book (≤160) or `null`; `bookRef` (reviews and quotes) — the `bookKey`, or the title and author lower-cased, to tell "the same book"
- `rating` (1–5) or `null`, `line` (≤280) or `null`; `body` (a review, ≤3000) or `null`; `quote` (≤500) and `note` (≤280) or `null`
- `likes`, `dislikes`, `score` (likes less dislikes) — totals of the reactions to it
- `hiddenAt`, `hiddenBy` (`reports`) — set while hidden; `spoilerBy` (`reports`) — if reports marked it a spoiler; `clearedAt` — when an admin looked at it and let it stand
- `createdAt` — date; `editedAt` — when a review was last replaced
- Indexes: `{userId, createdAt: -1}`; `{audience, createdAt: -1}`; `{audience, score: -1, createdAt: -1}`; `{bookKey, createdAt: -1}` (where there is a key); `{userId, bookRef}` unique among reviews

**`quoteTallies`** — one per reader per book they have quoted: how many quotes they have ever posted from it. Never counted down; kept when the profile is deleted (or that would refill it), deleted with the account
- `userId` — account ObjectId; `bookRef` — as on the post; `count` — 1–30
- Index: `{userId, bookRef}` unique

**`reactions`** — one per reader per post, thread or reply they liked or disliked; deleted when taken back, with the thing it is on, or with the reader's profile or account (the totals are then counted back down)
- `target` — `post`, `thread` or `reply`; `targetId` — its ObjectId; `userId` — account ObjectId
- `value` — 1 or -1; `createdAt` — date
- Indexes: `{target, targetId, userId}` unique; `{userId}`

**`communities`** — one per book or series anyone started a discussion of; kept until its last member has left and it has no threads, or an admin removes it
- `kind` — `book` or `series`; `key` — the app's key for it (≤160, lower-case); unique together
- `title` (≤120), `author` (≤80) or `null` — as its first member typed them
- `createdBy`, `keeperId` (or `null`) — account ObjectIds; `memberIds` — account ObjectIds in the order they joined (up to 50000); `memberCount`; `bannedIds` — readers the keeper removed
- `threadCount`; `reportCount` — open reports that count; `listedAt` — when it first had 3 established members (never unset); `unlistedAt` — set when reports or the admin took it out of the directory; `clearedAt` — as on a post
- `createdAt`, `lastActivityAt` — dates
- Indexes: `{kind, key}` unique; `{memberIds}`; `{keeperId}`; `{memberCount: -1}`

**`threads`** — one per thread; kept until its author, the keeper or an admin deletes it, or its community is removed. When its author's account is deleted it goes too, unless other readers replied: then it is kept with no author
- `communityId`; `authorId` — account ObjectId, or `null` for a reader who left
- `title` (≤120), `body` (≤5000); `spoiler` — `null`, `{percent}` or `{book}`; `pinned`
- `replyCount`, `likes`, `dislikes`, `score`; `hiddenAt`, `hiddenBy`, `spoilerBy`, `clearedAt` — as on a post
- `createdAt`, `lastActivityAt` — dates
- Indexes: `{communityId, pinned: -1, lastActivityAt: -1}`; `{authorId, createdAt: -1}`

**`replies`** — one per reply; kept until its author, the keeper or an admin deletes it, its thread or community goes, or its author's profile or account is deleted
- `threadId`, `communityId`; `authorId` — account ObjectId
- `body` (≤3000); `likes`, `dislikes`, `score`; `hiddenAt`, `hiddenBy`, `clearedAt`
- `createdAt` — date
- Indexes: `{threadId, createdAt}`; `{authorId, createdAt: -1}`; `{communityId}`

**`reports`** — one per reader per thing they reported. Open until an admin settles it or the thing is deleted; **a settled one is deleted automatically 180 days later**. A reader's own reports are deleted with their profile or account
- `target` — `post`, `thread`, `reply`, `community` or `profile`; `targetId`; `reporterId` — account ObjectId
- `reason` — `spam`, `harassment`, `hate`, `sexual`, `spoiler` or `other`; `note` (≤280) or `null`
- `counts` — whether it counts towards hiding the thing by itself, settled when it was made (the reporter's email was confirmed and their reports had not kept being dismissed)
- `createdAt`; `resolvedAt` (or `null`); `resolution` — `remove`, `restore`, `dismiss` or `deleted`
- Indexes: `{target, targetId, reporterId}` unique; `{reporterId, createdAt: -1}`; `{resolvedAt}` with a 180-day TTL (which skips the `null`s)

**`blocks`** — one per reader blocked by another; kept until unblocked or either profile or account is deleted
- `blockerId`, `blockedId` — account ObjectIds (unique pair); `createdAt` — date
- Indexes: `{blockerId, blockedId}` unique; `{blockedId}`

**`settings`** — one document, `_id: "site"`: `publicPosting` (boolean) and `updatedAt`. About no reader

**`tallies`** — one per reader, per kind (`post`, `quote`, `thread`, `reply`, `report`, `community`, `removal`), per UTC day on which they did any: the count behind the daily allowances. **Deleted automatically 3 days after its day**; kept when the profile is deleted, deleted with the account
- `userId` — account ObjectId; `kind`; `day` — like `2026-09-27`; `count`
- `expiresAt` — date
- Indexes: `{userId, kind, day}` unique; `{expiresAt}` with a TTL

**`suspensions`** — one per email address of a suspended reader, **only while the suspension lasts** (deleted automatically at `suspendedUntil`, or when the admin lifts it). **Kept when the account is deleted**: that is its purpose. The address itself is never stored
- `_id` — HMAC-SHA-256 of the normalised address, keyed with `RESET_MAIL_SECRET` (or, with no mailer configured, a constant in `src/standing.js`)
- `accountId` — the account it was last matched to (so lifting the suspension can find it); `suspendedUntil` — date
- Index: `{suspendedUntil}` with a TTL

**`clubs`** — one per book club; kept until its last member leaves or is deleted
- `name` (≤60); `code` — the 8-character join code (unique)
- `ownerId` — account ObjectId; `memberIds` — up to 50 account ObjectIds, in the order they joined
- `goalMinutes` — 0–10080
- `books` — up to 50 of `{title (≤160), author (≤80) | null}`
- `createdAt` — date
- Indexes: `{code}` unique; `{memberIds}`

**`gifts`** — one per gift sent: a note of what was given, never seeds or the item itself. An unclaimed gift is kept until claimed or until either account is deleted; **a claimed one is deleted automatically 30 days after it was claimed**
- `fromId`, `toId` — account ObjectIds
- `kind` — `accessory`, `room`, `wallpaper`, `flooring`, `skin` or `move`; `itemId` — the item's id (≤32)
- `createdAt` — date; `claimedAt` — date, or `null` while it waits
- Indexes: `{toId, claimedAt, createdAt}`; `{fromId, createdAt: -1}`; `{claimedAt}` with a 30-day TTL (which skips the `null`s)

**`raids`** — one per raid on a friend's camp: a note that it happened, never either camp, its layout or anything about reading. **Deleted automatically 30 days after it was made**, seen or not
- `fromId`, `toId` — account ObjectIds: the raider, and the reader whose camp it was
- `by`, `name` — the raider's handle and display name (or the handle again) as they were at the time
- `stars` — 0–3
- `day` — the UTC date of `createdAt`, e.g. `2026-10-12`: what "once a day" is counted by
- `createdAt` — date; `seenAt` — date, or `null` until the reader raided's app acknowledges it (or a newer raid pushes it out)
- Indexes: `{fromId, toId, day}` unique; `{toId, seenAt, createdAt}`; `{createdAt}` with a 30-day TTL

**`kudos`** — one per sender, recipient and local day; **deleted automatically after 21 days**
- `fromId`, `toId` — account ObjectIds
- `dayKey` — the sender's local date, e.g. `2026-09-27`; `weekKey` — their local ISO week
- `createdAt` — date

**`duels`** — one per pair per week; **deleted automatically after 90 days**
- `challengerId`, `opponentId` — account ObjectIds; `pair` — the two ids sorted and joined
- `weekKey` — ISO week the duel is for
- `status` — `pending`, `accepted` or `declined`
- `stake` — 0–50: what the two play for, as a number only (absent on duels from before stakes, read as 0)
- `challengerMinutes`, `opponentMinutes` — each side's latest weekly minutes (copied from the profile)
- `createdAt`, `respondedAt` (or `null`) — dates
- once settled: `resultAt` — date; `winnerId` — account ObjectId, or `null` for a tie

**`events`** — the inbox; **deleted automatically after 60 days**
- `userId` — whose inbox; `actorId` — who caused it (account ObjectIds)
- `type` — `follow`, `follow_request`, `follow_accept`, `kudos`, `gift`, `duel_invite`, `duel_accepted` or `duel_result` (likes, replies and reports make no event: nobody is notified of them)
- `refId` — the kudos, gift or duel it refers to (ObjectId), or `null`
- `createdAt` — date

Avatars are not stored: the client picks a Pip skin from the handle
(`pipSeed`). Rank changes and "you were passed" are worked out on the device.

Nothing else is stored: no IP addresses (rate-limit counters are in memory
only), no request logs in the database, no Google identifiers or tokens.

Private profiles are not listed on the board and `404` by handle;
followers-only ones are not on the public board and answer strangers with a
locked card. The stats, the library and what a profile says of level, badges,
scores and Pip's camp are self-reported by the client (the server cannot read the state
blob by design).

### Deletion

`DELETE /v1/account` (password required) deletes, in order, the reader's
community data, the profile, the state, every session, a pending reset, then
the account. The community data is everything above that names them, in both
directions (`deleteCommunityData` in `src/community.js`): follows and
requests to follow, made and received; kudos sent and received; duels they
are in; their uploaded library; their posts; gifts sent and received, claimed
or not; raids they made and raids on their camp; their inbox and the events they caused in others' inboxes; and their
place in every club. A club they owned goes to the member who joined
earliest, and one they were alone in is deleted.

Of the public layer it deletes: their posts, with the reactions and reports
on them, and the counts of what they posted (`quoteTallies`, `tallies`:
these two only with the account, not with the profile, or deleting a
profile would refill an allowance); every like and dislike they gave (each total
is counted back down by exactly that reaction, not recounted); the reports
they made and the reports about their profile; blocks in both directions;
their replies; their place in every community (a keeper's is handed to the
member who joined earliest, and they are taken off the lists of removed
readers); and their threads. **One thing is kept:** a thread of theirs that
other readers replied to stays, with `authorId: null` and its title and body
as written, shown as by a reader who left, because deleting it would delete
those other readers' replies. A thread nobody else replied to is deleted.
**And, for a reader who is suspended when they go:** the keyed hash of
their email address in `suspensions`, until the day the suspension would
have ended, so that signing up again with the same address does not end it.
The privacy policy should say both.

`DELETE /v1/profile/me` removes the same community data along with the
profile. Sessions go before the account so a failure part-way leaves an
account the reader can still sign in to and delete again. Nothing else is
kept afterwards (Atlas backups, if enabled on a paid tier, age out on their
own schedule). Signing out on a device only deletes that device's session.

**Going private** (`PUT /v1/profile/me` with `visibility: "private"`) deletes
less and hides the rest. Deleted at once: the reading figures on the profile
(minutes, streak, books finished, shelf, `readDay`, `reading`, `level`,
`badges`, `arcade`, `camp`), the uploaded library, and the requests to follow them
that were waiting. Kept but in no answer to anyone, their own feed included,
and back if they share again: their follows both ways, the requests they made,
kudos, duels, posts, gifts, raids and club memberships (they stay a member, are left
out of the member list, and are shown no clubs themselves). The handle, name
and the `shareLibrary` and `raidable` settings are kept. Going from `followers` to `public`
deletes nothing: the waiting requests become follows.

**No longer public** (private, or followers-only): the reader also leaves
every book community (a keeper's place is handed on), since those are public
rooms. Their posts for everyone, threads and replies are kept and in no
answer while they are not public, and are back if they are public again;
their place in a community is not, and they join again. Their likes,
dislikes, reports and blocks stay as they are. A suspended reader is hidden
the same way for as long as the suspension lasts.

## Moderation

The public layer (posts for everyone, book communities, threads, replies) is
optional for a reader and moderated by one person: the owner. What follows is
everything needed to run it.

**Becoming the admin.** An admin is a profile with `role: "admin"`. No route
sets it; do it once, by hand, in Atlas (Data Explorer, or `mongosh`), on your
own profile, found by your handle:

```js
db.profiles.updateOne({ handle: "your-handle" }, { $set: { role: "admin" } })
```

`GET /v1/profile/me` then says `isAdmin: true`, which is what the app shows
its admin screens on. To stop being one, `$unset` it. Deleting the profile
(`DELETE /v1/profile/me`) removes it too, and it has to be set again.

**Who may post in public.** A reader needs all of these, and is told which
one is missing:

| Refusal | |
| --- | --- |
| `403` "Make your profile public to post publicly." | The profile is private or followers-only. |
| `403` "Confirm your email address first (Settings, Account)." | `accounts.emailConfirmedAt` is not set. With no mailer configured (`RESET_MAIL_URL`) nobody can confirm, so nobody can post in public. |
| `403` "New accounts can post publicly after 3 days." | The account is under 3 days old. Starting a community: "…can start a community after 7 days." |
| `403` "Read and accept the community guidelines first." | `POST /v1/rules/accept` has not been called. The guidelines' text lives in the app. |
| `403` "Your account is suspended from posting until 12 March 2027." | You suspended them. |
| `503` "Public posting is paused for now." | You switched it off. |

Reading, and everything between followers (the feed, posts with
`audience: "followers"`, clubs, gifts, duels), needs none of it. Liking,
disliking and reporting need a shared profile, no suspension and an account
3 days old; liking and disliking also a confirmed email (`403` "Confirm
your email address first (Settings, Account)." or "New accounts can like and
dislike after 3 days."). A report from an unconfirmed address is taken, and
does not count (below).

**What happens by itself**, before you have looked (`src/reports.js`).
Every report reaches your queue. Only some count towards the numbers here:
those from a reader with a confirmed email address whose reports have not
kept being wrong. A reader with **5** or more reports dismissed (`dismiss`
or `restore`) in the last 90 days and none upheld (`remove`) stops counting,
until one is upheld or the old ones age out. Nobody is told whether theirs
count. The queue shows both numbers (`count`, `counting`).

- A post, thread or reply reported by **3** different readers is hidden from
  everyone but its author (who sees it marked `hidden`).
- A community reported by **5** different readers is taken out of the
  directory. It still works for its members and by its book's key.
- A thread or post reported as a `spoiler` by **2** readers is marked as
  spoiling the whole book (`{percent: 100}`, `{book: 99}`, or `spoiler: true`
  on a post) and is not hidden for it: those reports do not count towards
  the 3.
- Reports about a profile do nothing by themselves.
- A new community is in no directory or search until it has **3**
  established members: accounts 7 days old at a confirmed email address.
  Once listed it stays listed, whoever leaves.
- Once you `restore` or `dismiss` a thing, further reports of it are still
  queued for you but no longer act on their own.

**Reviewing.** `GET /v1/admin/reports` is the queue: one entry per thing
reported, with the thing as it stands, who wrote it, how many readers
reported it and why. Settle each with `POST /v1/admin/resolve`
`{target, id, action}`:

| `action` | |
| --- | --- |
| `remove` | Deletes it: a post; a thread with its replies; a reply; a community with all its threads and replies. A profile is not deleted by this (suspend the reader). |
| `restore` | Brings back what reports hid, or relists a community. A spoiler mark that reports set stays. |
| `dismiss` | Leaves it exactly as it is, hidden included. |

All three close the open reports on it; closed reports are kept 180 days and
then deleted.

**Suspending.** `POST /v1/admin/suspend` `{handle, days}` (`0` lifts it).
While it lasts the reader can read, cannot post (to anyone), like, report,
or start, join or write in a community, and what they wrote in public is
shown to nobody but themself. It survives them deleting their profile, and
it survives them deleting the account: for as long as it lasts, a keyed hash
of their email address is kept (`suspensions`; never the address), and an
account signed up with that address, or changed to it, starts out suspended
until the same day. Lifting it forgets the hash. A different address is a
different reader as far as this goes, though a new account waits 3 days and
needs a confirmed address before it can post. The hash is keyed with
`RESET_MAIL_SECRET`: **change that secret and the suspensions remembered
for deleted accounts are forgotten** (they no longer match); those on
accounts that still exist are unaffected.

**Pausing.** `PUT /v1/admin/settings` `{publicPosting: false}` makes every
public write a `503` (posts for everyone, starting or joining a community,
threads, replies) until you set it back to `true`. Reading goes on, and so
does everything between followers. Use it when something is going wrong
faster than you can review it.

**A keeper** (the first member of a community, or whoever it was handed to)
can pin up to 3 threads, delete any thread or reply in their community, and
remove a member, who then cannot rejoin or read it: at most 10 a day. There
is one community per book, so a bad keeper is the only keeper that book has;
what a keeper does, you can undo with `POST /v1/admin/community`:

| `{id, …}` | |
| --- | --- |
| `keeper: "handle"` | Gives the keeper's place to that member. |
| `unban: "handle"` | Lets a removed reader back in (they join again themselves). |
| `title`, `author` | Corrects what the first member typed, which is otherwise what the book's one community is called for good. |
| `relist: true` / `false` | Puts it back in the directory after reports took it out, or takes it out yourself. Either way reports stop acting on it by themselves. |

## Deploying to the Oracle VM

Target: Ubuntu 24.04 (x86_64, 1 OCPU, 1 GB RAM) already running Caddy for a
static site. The API runs as a systemd service bound to `127.0.0.1:8787`; Caddy
terminates HTTPS on a subdomain and proxies to it. Files are in `deploy/`.

1. **DNS.** Point an `A` record for the API subdomain (e.g. `api.example.com`)
   at the VM's static public IP. Ports 80/443 are already open for Caddy.

2. **Atlas.** Create a free M0 cluster, a database user with `readWrite` on the
   `leaflet` database only, and under **Network Access** allowlist the VM's
   **static public IP** (`/32`), not `0.0.0.0/0`. Copy the `mongodb+srv://` URI.

3. **Node 20 LTS** on the VM:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node -v   # v20.x
   ```

4. **Service user** (the deploy script also does this idempotently):
   ```bash
   sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin leaflet
   ```

5. **Environment file** — root-only, never in the repo:
   ```bash
   sudo install -m 600 -o root -g root /dev/null /etc/leaflet-api.env
   sudoedit /etc/leaflet-api.env      # contents: see deploy/leaflet-api.env.example
   ```

6. **Ship the code** from Windows (PowerShell, from the repo):
   ```powershell
   ./server/deploy/deploy.ps1 -Host <vm-ip> -KeyPath <path-to-ssh-key>   # -User defaults to ubuntu
   ```
   It packs `server/` without `node_modules`, `.env` or tests, copies it with
   `scp`, installs it into `/opt/leaflet-api` with `npm ci --omit=dev`, installs
   `leaflet-api.service`, and restarts it. It is safe to re-run for every
   release and never touches `/var/www` or the Caddyfile.

   The first time, or doing it by hand:
   ```bash
   sudo cp /opt/leaflet-api/deploy/leaflet-api.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now leaflet-api
   systemctl status leaflet-api
   curl http://127.0.0.1:8787/health
   ```
   The unit runs as `leaflet`, caps memory at `MemoryMax=256M` with
   `--max-old-space-size=128`, restarts on failure, and is sandboxed
   (`NoNewPrivileges`, `ProtectSystem=strict`, …). On `SIGTERM` the server stops
   accepting, finishes in-flight requests, closes Mongo and exits.

7. **Caddy.** Append the block from `deploy/Caddyfile.snippet` to
   `/etc/caddy/Caddyfile` as a **new** site block (do not edit the existing
   static-site block), with your subdomain in place of the placeholder. Then:
   ```bash
   sudo -u caddy caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   curl https://api.example.com/health
   ```

8. **Point the app at it** at build time (see below), or per device in
   Settings → Leaderboards & Shared Shelves → Server address.

Logs: `journalctl -u leaflet-api -f`. Update: re-run `deploy.ps1`.

### Deploying 1.4.2's server (after 1.4.0's)

One more thing to deploy, the same way (`deploy.ps1`, nothing else): the
update notice (`GET /v1/notice`, `PUT /v1/admin/notice`). No new collection
(it is one more document in `settings`), no index, no migration, no new
values. Older apps never ask for it. Until it is deployed, a 1.4.2 app finds
no notice and shows nothing.

### Deploying this version

The version that adds followers-only profiles, follow requests, libraries,
posts, clubs, gifts and duel stakes, and the public layer (reviews and
quotes, likes, discover, book communities, reports, blocks, the admin's
tools). Deploying it is the usual `deploy.ps1` and nothing else; afterwards,
make yourself the admin (see Moderation):

- **No new environment values or secrets**, and no new npm dependencies.
  One existing secret gained a second use: `RESET_MAIL_SECRET` also keys the
  hash a suspended reader's address is remembered under (see Moderation for
  what changing it does).
  `/etc/leaflet-api.env`, the Caddyfile and the systemd unit are unchanged.
- **The systemd unit changed in one number**: the heap is held to 128 MB
  (`--max-old-space-size`, was 160) inside the same 256 MB ceiling, to leave
  room for what is not heap (see [Capacity](#capacity)). `deploy.ps1`
  installs the unit and restarts the service as it always does, so there is
  nothing to do by hand; `systemctl show leaflet-api -p Environment` shows it
  took.
- **No migration.** No existing document is rewritten. Fields older documents
  lack read as their defaults (`level`, `reading`, `arcade` and `camp` as `null`,
  `badges` as `[]`, `shareLibrary` as off, a duel's `stake` as 0, a post's
  `audience` as `followers`, its likes as 0), and no profile's visibility
  changes. A `camp` held without a layout (`spots`, `walls`, `decor`, `land`,
  `works`, `guards`, `posts`), or with only part of one, stays
  as it is until its reader's app next saves the profile; a friend's card
  draws it as a camp begins. Nobody has accepted the guidelines, nobody is an admin, and
  public posting is on.
- **On first start** the server creates the new indexes before it listens
  (`ensureIndexes` in `src/db.js`), which also brings these collections into
  being, empty: `followRequests` (`pair` unique, `asked`), `posts`
  (`author`), `clubs` (`code` unique, `member`) and `gifts` (`waiting`,
  `sent`, `expiry`: the 30-day TTL on `claimedAt`). `libraries` has no index
  of its own and appears with the first upload. For the public layer:
  four more on `posts` (`discover_new`, `discover_top`, `book`,
  `one_review`), and `quoteTallies` (`reader_book` unique), `reactions`
  (`once` unique, `reader`), `communities` (`book` unique, `member`,
  `keeper`, `banned`, `directory`), `threads` (`community`, `author`), `replies` (`thread`,
  `author`, `community`), `reports` (`once` unique, `reporter`, `expiry`: the
  180-day TTL on `resolvedAt`) and `blocks` (`pair` unique, `blocked`).
  `tallies` (`reader_day` unique, `expiry`: a TTL on `expiresAt`) and
  `suspensions` (`expiry`: a TTL on `suspendedUntil`, and `account`) are made too.
  `settings` has none and appears the first time the switch is used. The
  indexes are on empty collections (or, for `posts`, a small one), so this
  takes a moment, and the Atlas user's `readWrite` role already allows it.
  Existing indexes are untouched, but for one: `size` on `communities`, if a
  server from before `directory` made it, is dropped at that start (it could
  not give the directory's order, and nothing else used it).
- **Memory.** One library upload is a body of up to 2 MB, parsed only after
  the token is checked and at most 20 times in 15 minutes per account;
  everything else new is a small body.
- **Older apps keep working.** Every request an app from before this version
  sends is answered as before; the answers it reads only gained fields
  (`requested` on follow and unfollow, `visibility` and `locked` on search,
  `reading` and `level` on board rows, `stake` on duels, more on profiles).
  The one sentence that changed is the `403` to a private reader who tries to
  follow, send kudos or duel. What an older app has no screen for can reach it
  only once somebody with a newer app chooses `followers`: that reader then
  turns up in its search (as 0 minutes), opening them answers with the locked
  card, which carries a full card's figures as empties so that app can draw
  it, and following them answers `following: false`. Likewise its inbox can
  receive the new event types (`follow_request`, `follow_accept`, `gift`),
  which it has no wording for. Check both against the last released app
  before a release goes out with `followers` switched on. The public layer
  adds nothing an older app can meet: it has no screen that asks for any of
  it, a block can only refuse it something with a `403` or `404` it already
  handles, and the two fields it gained on answers it reads (`youBlocked` on
  a profile; `rulesAccepted`, `isAdmin`, `suspendedUntil` on its own) are
  additions.
- **Raids** (the Hollow's raids on a friend's camp) came after the rest and
  deploy the same way. One more collection, `raids`, made empty on first
  start with its three indexes (`once_a_day` unique, `waiting`, `expiry`: the
  30-day TTL on `createdAt`). No migration: a profile without `raidable`
  reads as on. An older app never meets a raid: it asks for none of the four
  routes, a raid makes no inbox event, and `raidable` on its own profile is
  an addition. A newer app on a server from before raids gets empty lists
  (the two `GET`s answer `404`, which it reads as "no raids here").

## Pointing a release build at the server

The desktop app takes its default API base at **compile time**:

```powershell
$env:LEAFLET_API_BASE = "https://api.example.com"   # Rust: option_env!, rerun-if-env-changed
$env:VITE_ENABLE_ACCOUNTS = "true"                   # shows Settings → Account
$env:VITE_ENABLE_COMMUNITY = "true"                  # optional: leaderboards
npm run tauri build
```

The Account card appears only when `VITE_ENABLE_ACCOUNTS=true` **and** an API
base is configured. `https://` is required; plain `http://` is accepted only
for `localhost` / `127.0.0.1` / `[::1]`.

## Not built yet

- Shared rate-limit store for more than one instance.
