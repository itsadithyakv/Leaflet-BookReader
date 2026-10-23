# Deploying 1.5.12's server — the run sheet

1.5.11's server ([deploy-1.5.11.md](deploy-1.5.11.md)) was deployed on
2026-10-23, from an export of the `v1.5.11` tag. This deploy goes on top of
it. The server is the `server/` folder of the `android` branch as it stands
for 1.5.12, deployed from an export of the `v1.5.12` tag, not from a working
tree.

Nothing here needs a new secret, an npm package or a migration. (The admin
work at the end adds two collections and an index, which the server creates
itself at start, and `ACTIVE_READERS`, on unless set to `off`.)
The one new environment value (`DORMANT_ACCOUNTS`) is **off unless set**,
and should stay off until the privacy policy says what it does (below).

Every app version works with this server, and 1.5.12's app works with the
server deployed now (1.5.10's). Still, **deploy the server first**: 1.5.12's
app re-sends a shared library every six hours, which this server answers
with one small read and the old one writes in full every time.

## What changed

### From 1.5.11 (carried over, unchanged)

| File | What | Audit |
| --- | --- | --- |
| `server/src/routes/social.js` | A profile save `$set`s only the parts that moved; routine saves no longer clear the board kept in memory. | C3, C8 |
| `server/src/boardCache.js` | Comments only. | C3 |
| `server/src/deletion.js` | `deleteAccount` ends the sessions first, and deletes the sync state again last. | D5 |
| `server/src/routes/state.js` | `PUT /v1/state` at version 0 refused (`401`) for an account that is gone. | D5, X3 |
| `server/src/routes/problems.js` | Waiting problem reports capped at 20 MB as well as 1,000. | C7 |

### New in 1.5.12

| File | What | Audit |
| --- | --- | --- |
| `server/src/routes/social.js` | A save that names **some** of the figures (what 1.5.12's app sends: usually the week's minutes alone) reads only those figures of the profile, sets the ones that moved, asks back only what another request may have changed (visibility, standing, kudos counts), and answers with those. A save naming every figure (apps before 1.5.12) or none (a new name, a switch) is read and answered in full, as before. | 3 |
| `server/src/routes/library.js` | Each shared library is kept with a hash of its books; the same list sent again is not written (`{count, unchanged: true}`). The profile is read for its visibility alone, not with its camp. | W5 |
| `server/src/dormant.js` (new), `src/auth.js`, `src/index.js` | Dormant accounts, **off by default**: see "Dormant accounts" below. While off, nothing is warned or removed. (Since another change made beside this one, the day an account was last used, with the app's version and platform, is recorded even while it is off, for the owner's count of active readers, unless `ACTIVE_READERS=off`: see "Privacy" below.) | C6 |
| `server/src/mail.js` | Comments: the fourth message. | C6 |
| `server/deploy/password-reset-mailer.gs` | A fourth email, `dormant`. Only needed when dormant accounts are switched on; the script deployed now refuses it (it has no `code`), and then nothing is removed. | C6 |
| `server/deploy/leaflet-api.env.example` | The `DORMANT_*` values, commented out. | C6 |
| `server/test/*.test.js`, `server/scripts/load.mjs` | Tests (`dormant`, `capacity`, `social2`), and `--app 1.5.10/1.5.11/1.5.12` for the load script. Not deployed (`deploy.ps1` ships `package.json`, the lock file, `src` and `deploy`). | |

What a reader may notice: nothing, except the public board up to half a
minute behind another reader's minutes (1.5.11's change).

**Also in `server/` now, and not covered here:** another piece of work being
done beside this one (`src/metrics.js`, `src/announcements.js`,
`src/errorKinds.js`, changes to `src/db.js`, `src/rateLimit.js` and the
`client` recorded by `noteSeen`). `deploy.ps1` ships the whole `src/`, so it
goes with this deploy unless it is held back: see "The admin page, error
reports and announcements" at the end of this sheet.

## Before

1. On this PC, in `server\`: `npm test` against the local MongoDB. It should
   end `fail 0` (312 tests on 2026-10-23, the other server work in the tree included).
2. Optional, to see the saving on this machine: `node scripts/load.mjs --app 1.5.10`
   and `node scripts/load.mjs --app 1.5.12`; compare "MB an hour an app".
3. Atlas → the cluster → **Metrics**: note **Network** (bytes in and out)
   and **Data Size** for the last 7 days.

## Deploy

As always ([deploy.md](deploy.md), step 5), from `server\deploy\`:

```powershell
.\deploy.ps1 -Host 129.154.40.208 -KeyPath "<your key>"
```

The unit, the Caddyfile and `/etc/leaflet-api.env` are unchanged. Do **not**
add `DORMANT_ACCOUNTS` now.

Then the app (1.5.12) as usual. Order matters only for cost, not for
correctness: either can go first.

## Check it

On the VM:

```bash
systemctl status leaflet-api            # active (running)
sudo journalctl -u leaflet-api -n 50    # "Leaflet API on http://127.0.0.1:8787", no Mongo errors,
                                        # and no "dormant accounts" line (it is off)
```

From anywhere:

- `https://leafletapp.duckdns.org/health` → `{"ok":true}`.
- In the app, signed in: **Sync now** says synced; the Board loads; read a
  minute: your own row moves at once, others' within half a minute.
- Profile → your card shows your camp, shelf and badges as before (they are
  kept when a save leaves them out).
- With "Share my library" on: open your own library page from a friend's
  account, or Atlas → Browse Collections → `libraries`: your document now has
  a `hash` field after the next upload.
- Settings → **Report a problem**: one goes through.
- Deletion (optional, throwaway account only): as in 1.5.11's sheet.

A week on, Atlas Metrics again: transfer **out** should be lower (each
minute's save no longer reads and returns the camp; the board is read twice
a minute at most), transfer **in** lower (the camp no longer in every
changed save; highlights held while a book is open, as readers update to
1.5.11+).

## If something is wrong

Deploy the previous server the same way: export `v1.5.11` (what runs now)
into a scratch folder (`git archive v1.5.11 server | tar -x -C <folder>`)
and run its `deploy.ps1`. There is no migration to undo: the `hash`
on a library is ignored by older code (and dropped at its next upload), and
the board and session caches live in memory. Apps of every version keep
working against either.

## Dormant accounts (later, the owner's decision)

Off. To switch on, all of these, in this order:

1. **The privacy policy first** (docs/legal/privacy-policy.md), published, with
   the text under "What the privacy policy would need to say" below. Leaflet's
   policy today says account information is kept "until you delete your
   account": removing a synced state for disuse is a new rule and must be
   announced before it applies.
2. **The mailer script**: paste `server/deploy/password-reset-mailer.gs` into
   the Apps Script project, then Deploy → Manage deployments → edit → New
   version → Deploy (the URL stays the same).
3. On the VM, add to `/etc/leaflet-api.env`:

   ```
   DORMANT_ACCOUNTS=on
   # DORMANT_MONTHS=12  DORMANT_GRACE_DAYS=60  DORMANT_MAIL_PER_DAY=20 (the defaults)
   ```

   `sudo systemctl restart leaflet-api`; the log says
   `dormant accounts: on (12 months, then 60 days after the email)`.
4. Ten minutes later, and then daily, the log has one line of counts:
   `dormant accounts: {"started":N,"removed":0,"warned":0,...}`. The first
   `started` is every account (their twelve months begin that day): **nothing
   is warned for twelve months after switching on.**

What it does, once on:

- When an account was last used (a sign-in, or any request of its app) is
  kept on the account, to the day (`accounts.lastSeenAt`).
- Unused for 12 months, and still holding a synced state or a shared library:
  **one email** (`dormant`), naming the day, 60 days on, when those two go.
  At most 20 such emails a day. If no email can be sent, nobody is warned,
  and so nothing is removed.
- Used again before that day (signing in on any device): nothing happens,
  and the twelve months start again.
- Unused on that day: the **sync state and shared library are deleted**;
  the account, profile, posts and follows stay. The reader can sign in again
  at any time; their devices send their reading up again at the next sync.

To switch off: remove the line and restart. What was recorded stays on the
accounts (two dates at most) and is ignored; to clear it,
`db.accounts.updateMany({}, {$unset: {lastSeenAt: "", dormantWarnedAt: "", dormantRemoveAfter: "", dormantClearedAt: ""}})`
in Atlas's shell.

Rollback: a removed state is only in the nightly backups (14 days at most),
and only the reader's devices can put it back after that.

### What the privacy policy would need to say

**Already at this deploy**, unless `ACTIVE_READERS=off` is set: the server
now keeps, on each account, the day it was last used and the version and
platform of the app it was used from (`accounts.lastSeenAt`, `accounts.client`;
added beside the dormant work for the owner's count of active readers,
`src/metrics.js`, which is not part of this sheet). The policy's "Sign-in
sessions" item lists only a token "with when it was created and last used",
per device. It needs: "We also keep, on your account, the day it was last
used and which version of Leaflet, on which kind of device, it was used
from." Either add that before deploying, or set `ACTIVE_READERS=off` in
`/etc/leaflet-api.env` until it is added.

The rest changes only when dormant accounts are switched on:

- **"Sign-in sessions"** (Leaflet accounts) — the line above, and: "…so that
  we can tell when it has not been used for a year."
- **"How long we keep it"** — "We keep your account information until you
  delete your account" becomes: "We keep your account information until you
  delete your account, except that **if your account has not been used for
  12 months**, we email you, and if you do not sign in within 60 days after
  that email, we delete the copy of your reading (your synced reading
  state) and your shared library from our server. Your account, profile,
  posts and follows stay. Your devices keep their own copy and send it again
  the next time you sign in on one. If we cannot email you, we do not delete
  them."
- **The short version** — the line "While you are signed in to one, your
  reading … is kept with your account on our server" gains: "(an account
  unused for a year is emailed, and its reading copy removed 60 days later
  if it stays unused)".
- **Email** — the policy describes emails for reset and confirmation codes
  only: add the one about an unused account.
- docs/legal/delete-account.md: no change (deletion on request is unchanged).
- server/README.md "Exactly what is stored per reader": `accounts.lastSeenAt`,
  `dormantWarnedAt`, `dormantRemoveAfter`, `dormantClearedAt`.
- The Play Store data-safety form: worth a look (a last-used date is
  collected; nothing new is shared). Not checked here.

## The admin page, error reports and announcements (in this deploy too)

Written by the work beside the sync changes above; it ships with them (the
whole of `src/` goes). The owner's admin page in the app, apps reporting
their errors by themselves, one-time announcements, and a note of the last
backup.

### What changed

| File | What |
| --- | --- |
| `server/src/routes/admin.js` (new) | `GET /v1/admin/overview` (readers, versions, platforms, open queues, errors, storage, collections, last backup, this server's requests); `GET /v1/admin/errors`, `POST /v1/admin/errors/:sig` (mark fixed in a version / reopen); the public `POST /v1/errors`. Every admin route is a plain 404 to anyone else. |
| `server/src/errorKinds.js` (new) | Scrubbing (again, after the app), one upsert per kind per version, platform and UTC day (`$inc`), at most 100 new kinds a day, the admin's list grouped by kind. |
| `server/src/metrics.js` (new) | Requests, 5xx and p50/p95 for the last 24 hours by hour, and by route, **in memory** (they start again at every restart; the page shows the uptime). `clientOf` reads `X-Leaflet-Client`. |
| `server/src/announcements.js` (new), `src/routes/moderation.js` | Announcements: `GET/POST /v1/admin/announcements`, `DELETE /v1/admin/announcements/:id`; they ride on `GET /v1/notice` (same one read a minute, now also `Cache-Control: public, max-age=60`). |
| `server/src/backup/note.js` (new), `src/backup/run.js` | After a backup that went through, one small document (`meta`, `_id: "lastBackup"`): one write a night. A failure to write it does not fail the backup. |
| `server/src/app.js` | The request counter (before the busy door), the new routes, and `X-Leaflet-Client` among the CORS headers (CORS is off unless `CORS_ORIGIN` is set). |
| `server/src/db.js` | New collections `errorKinds` (TTL 90 days), `errorFixes` (TTL 180 days), `meta`; new index `accounts.{lastSeenAt}` (sparse). Created by the server at start, as every index is. |
| `server/src/dormant.js`, `src/auth.js` | `noteSeen` also stores the app's `{version, platform}` on the same once-a-day write, and that write now happens even with dormant accounts off unless `ACTIVE_READERS=off`. "Once a day" is now once a **UTC day** (it was "24 hours since the last"), so "active today" counts everyone used today. |
| `server/src/rateLimit.js` | `errors`: 6 batches an hour per address. |
| `docs/legal/privacy-policy.md`, `server/README.md` | What is sent and stored, and the switch. |

The app side (1.5.12): every call to the server from Rust carries
`X-Leaflet-Client: <version>; <platform>`; the error batch goes once a session,
never signed in; announcements are read from the update notice the app
already asks for.

### Cost on the free cluster

- **Opening the admin page:** about 8 operations for the overview (an
  estimated count, a count on `_id`, one aggregation on the `lastSeenAt`
  index, two counts for the queues, one aggregation on `errorKinds`,
  `dbStats`, one `meta` read), kept a minute; plus one `$collStats` a
  collection (about 30) at most every 15 minutes. The errors list is one
  aggregation and one read.
- **An error batch:** one rate-limited request a session at most, one
  `bulkWrite` of at most 20 upserts (usually one or two), and one count the
  first time each UTC day.
- **Each reader, each day:** at most one write (the `lastSeenAt` and `client`
  update), on a request the app was making anyway. With dormant accounts off
  this write is new; `ACTIVE_READERS=off` stops it.
- **Announcements:** nothing per reader: the notice's one read a minute now
  fetches two documents instead of one.
- **The backup note:** one write a night.

### Before

1. `npm test` in `server\` (the admin tests are `test/admin.test.js`).
2. **The privacy policy must go live with this deploy**: rebuild the site
   (`node site/build.mjs`) from the updated `docs/legal/privacy-policy.md`
   (the "Sign-in sessions" item, "Error reports", "Messages from us in the
   app", the 90-day line and the change note) and publish it before or with
   the server and the 1.5.12 app. If it cannot go live yet, set
   `ACTIVE_READERS=off` in `/etc/leaflet-api.env` until it does (then the
   overview's active readers and versions stay at zero), and know that
   1.5.12 apps send error reports regardless of the server: an older server
   answers 404 and the app drops them quietly.
3. The Play Console's data-safety form likely needs "Crash logs" and
   "Diagnostics" (collected, not shared, not linked to the user, optional);
   the Microsoft Store listing's privacy link is the same page. Not checked here.

### Check it

- In the app, signed in as the owner: the profile menu shows **Admin**; the
  Overview loads (the backup tile is red until a backup has been noted; run
  `sudo systemctl start leaflet-backup.service` once to see it change).
- Another account's profile menu has no Admin, and
  `GET /v1/admin/overview` with its token is a 404.
- Announcements → publish one to yourself ("Android only", say), see it on
  the phone in the Library after about half a minute, then Withdraw.
- A day on: Overview → Versions in use shows 1.5.12.

### Rollback

As above. The new collections and the index are left behind harmlessly (the
TTLs empty `errorKinds` within 90 days); `accounts.client` is ignored by older
code.
