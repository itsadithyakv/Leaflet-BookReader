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

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `MONGO_URI` | — (required) | Atlas `mongodb+srv://…` in production. `MONGODB_URI` is accepted too. |
| `MONGO_DB` | `leaflet` | Database name. |
| `HOST` | `127.0.0.1` | Keep on loopback; Caddy is the only thing that should reach it. |
| `PORT` | `8787` | |
| `CORS_ORIGIN` | empty (off) | Only for calling the API from a browser page. The app does not need it. |

A `.env` in the working directory is loaded if present (variables already set
win). Production uses systemd's `EnvironmentFile` instead, and deploys no `.env`.

The Mongo pool is capped at 5 connections (Atlas free tier), request bodies are
parsed per route with small limits, and memory stays well under 100 MB.

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
| `PATCH /v1/account` | ✓ | `{displayName?, avatar?}`. Only the fields sent change; `avatar: null` clears it. The avatar is copied onto the profile too. |
| `DELETE /v1/account` | ✓ | `{password}`. Deletes community data, account, profile, state and all sessions. |
| `GET /v1/state` | ✓ | `{version, state}` (base64 gzipped blob, or `null`). |
| `PUT /v1/state` | ✓ | `{version, state}`. `version` is the one last read (0 = none). `409` with the current document if another device wrote first. Up to 2 MB. |
| `DELETE /v1/state` | ✓ | Removes the stored state. |
| `GET /v1/profile/me` | ✓ | The reader's own profile, private fields included. |
| `PUT /v1/profile/me` | ✓ | `handle`, `displayName`, `visibility`, `weekKey` + `weekMinutes`, `streak`, `booksFinished`, `shelf`. |
| `DELETE /v1/profile/me` | ✓ | Removes the profile and all community data (follows both ways, kudos sent and received, duels, inbox events). |
| `GET /v1/leaderboard?week=2026-W39&scope=everyone` | optional | Top 100 public profiles for that ISO week (default: the server's). Rows: `{rank, handle, displayName, pipSeed, avatar, weekMinutes, streak, booksFinished, isYou}`. With a token, `you` is the reader's own row and rank even outside the top 100. |
| `GET /v1/leaderboard?week=…&scope=following` | ✓ | The reader plus the public readers they follow, zeros included. |
| `GET /v1/profile/:handle?week=&day=` | optional | A public profile plus `kudosThisWeek`, `followerCount`, `followingCount`; with a token also `isYou`, `isFollowing`, `followsYou`, `kudosSentToday` (for local `day`), `activeDuel`. `404` if private or absent. |
| `POST /v1/follows/:handle` | ✓ | Follow. Idempotent. The follower must be public (`403`), the target public (`404`), not yourself (`400`). Up to 500. |
| `DELETE /v1/follows/:handle` | ✓ | Unfollow (works whatever either side's visibility). |
| `GET /v1/follows` | ✓ | `{following: [{handle, displayName, pipSeed, avatar}], followerCount}` (public ones only). |
| `POST /v1/kudos/:handle` | ✓ | `{dayKey: "2026-09-27", weekKey: "2026-W39"}` (the reader's local day and week). Once per reader per day (`409`). `201 {sent, kudosThisWeek}`. |
| `POST /v1/duels` | ✓ | `{handle, weekKey}`. Challenge for that week. One duel per pair per week, at most 3 pending/accepted per reader (`409`), public on both sides. |
| `POST /v1/duels/:id/accept` · `/decline` | ✓ | Only the challenged reader, only while pending and the week is not over. |
| `GET /v1/duels` | ✓ | This week's pending/accepted duels and results settled in the last 8 days: `{id, weekKey, status, youChallenged, weekOver, you, them, result}`. Settles finished weeks first. |
| `GET /v1/inbox?since=ISO` | ✓ | Newest 50 events after `since`: `follow`, `kudos`, `duel_invite`, `duel_accepted`, `duel_result`, each `{id, type, createdAt, actor, duel?}`. Events from readers no longer public are omitted. |
| `GET /v1/search?q=ma` | | Up to 10 public profiles whose handle starts with `q`. |

Only public profiles appear anywhere in the community, and only a reader with a
public profile can follow, send kudos or duel. Everything else (the public
board, search, public profiles) works signed out. Duels are settled lazily —
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
- The desktop app keeps the token in the OS keychain (service
  `app.leaflet.account`), never in SQLite or the webview.

### Rate limits

In memory, per process (see `src/rateLimit.js`):

| | Limit |
| --- | --- |
| Signup + login requests per IP | 30 / 15 min |
| Failed password checks per email (or per account for password change / delete) | 10 / 15 min |
| New accounts per IP, and per email | 5 / hour |
| Community writes (follow, unfollow, kudos, duel, accept, decline) per account | 60 / 15 min |
| Searches per IP | 120 / 5 min |

Because they live in memory, **they assume a single instance** and reset on
restart. Running several instances would multiply the limits; move the counters
to a shared store (e.g. a Mongo collection with a TTL index) before scaling out.
`trust proxy` is set to `loopback`, so behind Caddy on the same machine the
limits see the real client IP from `X-Forwarded-For`, and a client cannot spoof
it by sending the header directly.

## Exactly what is stored per reader

For the privacy policy. Four core collections keyed by the account's
ObjectId, and four small community collections that reference it.

**`accounts`** — one per account
- `_id` — ObjectId
- `email` — normalised (trimmed, lower-case); unique
- `passwordHash` — scrypt string as above (never the password)
- `displayName` — optional, up to 40 characters, or `null`
- `avatar` — optional, one of the ids in `src/avatars.js`, or `null`
- `createdAt`, `passwordChangedAt` — dates

**`sessions`** — one per signed-in device
- `_id` — SHA-256 (hex) of the session token
- `userId` — the account's ObjectId
- `createdAt`, `lastUsedAt`, `expiresAt` — dates

**`profiles`** — only once the reader saves a profile (private by default)
- `_id` — the account's ObjectId
- `handle` — optional, 3–24 characters, unique
- `displayName` — optional, up to 40 characters (the public name; separate from the account's)
- `avatar` — a copy of the account's, refreshed on every profile save and avatar change
- `visibility` — `private` (default) or `public`
- `weekKey` — ISO week the minutes belong to, e.g. `2026-W39`
- `weekMinutes` — 0–10080; `streak` — 0–36500; `booksFinished` — 0–100000
- `shelf` — up to 12 of `{title (≤120), author (≤80) | null, styleSeed (≤64)}`
- `updatedAt` — date

**`states`** — only if the device syncs through this server
- `_id` — the account's ObjectId
- `state` — gzipped JSON of the reader's library entries and reading history
  (titles, authors, series, progress, reading-day minutes, focus sessions,
  highlights with their notes, bookmarks, collections) — opaque to the server,
  never book files
- `version` — integer counter; `updatedAt` — date

**`follows`** — one per follow, only between public profiles when created
- `followerId`, `followeeId` — account ObjectIds (unique pair)
- `createdAt` — date

**`kudos`** — one per sender, recipient and local day; **deleted automatically after 21 days**
- `fromId`, `toId` — account ObjectIds
- `dayKey` — the sender's local date, e.g. `2026-09-27`; `weekKey` — their local ISO week
- `createdAt` — date

**`duels`** — one per pair per week; **deleted automatically after 90 days**
- `challengerId`, `opponentId` — account ObjectIds; `pair` — the two ids sorted and joined
- `weekKey` — ISO week the duel is for
- `status` — `pending`, `accepted` or `declined`
- `challengerMinutes`, `opponentMinutes` — each side's latest weekly minutes (copied from the profile)
- `createdAt`, `respondedAt` (or `null`) — dates
- once settled: `resultAt` — date; `winnerId` — account ObjectId, or `null` for a tie

**`events`** — the inbox; **deleted automatically after 60 days**
- `userId` — whose inbox; `actorId` — who caused it (account ObjectIds)
- `type` — `follow`, `kudos`, `duel_invite`, `duel_accepted` or `duel_result`
- `refId` — the kudos or duel it refers to (ObjectId), or `null`
- `createdAt` — date

Avatars are not stored: the client picks a Pip skin from the handle
(`pipSeed`). Rank changes and "you were passed" are worked out on the device.

Nothing else is stored: no IP addresses (rate-limit counters are in memory
only), no request logs in the database, no Google identifiers or tokens.

Private profiles are not listed on the board and `404` by handle; the stats are
self-reported by the client (the server cannot read the state blob by design).

### Deletion

`DELETE /v1/account` (password required) deletes, in order, the reader's
community data (follows in both directions, kudos sent and received, duels
they are in, their inbox and the events they caused in others' inboxes), the
profile, the state, every session, then the account. `DELETE /v1/profile/me`
removes the same community data along with the profile. Sessions go before the account so a
failure part-way leaves an account the reader can still sign in to and delete
again. Nothing is kept afterwards (Atlas backups, if enabled on a paid tier,
age out on their own schedule). Signing out on a device only deletes that
device's session.

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
   `--max-old-space-size=160`, restarts on failure, and is sandboxed
   (`NoNewPrivileges`, `ProtectSystem=strict`, …). On `SIGTERM` the server stops
   accepting, finishes in-flight requests, closes Mongo and exits.

7. **Caddy.** Append the block from `deploy/Caddyfile.snippet` to
   `/etc/caddy/Caddyfile` as a **new** site block (do not edit the existing
   static-site block), with your subdomain in place of the placeholder. Then:
   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   curl https://api.example.com/health
   ```

8. **Point the app at it** at build time (see below), or per device in
   Settings → Leaderboards & Shared Shelves → Server address.

Logs: `journalctl -u leaflet-api -f`. Update: re-run `deploy.ps1`.

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

- Email verification (addresses are not confirmed).
- Password reset by email — a reader who forgets their password today cannot
  recover the account; their local library is unaffected.
- Shared rate-limit store for more than one instance.
