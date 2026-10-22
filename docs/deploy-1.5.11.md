# Deploying 1.5.11's server — the run sheet

Four small changes from [the sync audit](sync-audit.md), one deploy. None of
them needs a new secret, an environment value, an npm package, an index or
a migration, and none changes what the app sends or reads: 1.5.10's app and
1.5.11's work with this server, and 1.5.11's app works with the old one. So
the server can go before or after the app.

## What changed

| File | What | Audit |
| --- | --- | --- |
| `server/src/routes/social.js` | A profile save `$set`s only the parts that moved (`changedParts`): the camp (about 3 KB) no longer goes in with every changed minute. Routine saves no longer clear the board and visitors kept in memory; only a save that names a visibility (and a profile deleted) does. | C3, C8 |
| `server/src/boardCache.js` | Comments only: the board is kept its 30 s whatever the saves. | C3 |
| `server/src/deletion.js` | `deleteAccount` ends the sessions **first**, and deletes the sync state once more as its last step. | D5 |
| `server/src/routes/state.js` | `PUT /v1/state` at version 0 (a first copy) is refused, `401`, for an account that no longer exists. A comment about `?have=` corrected. | D5, X3 |
| `server/src/routes/problems.js` | Waiting (open) problem reports may take 20 MB together (`OPEN_BYTES_MAX`), as well as at most 1,000; past either, a new one is turned away with the usual "can't take more problem reports" `503`. | C7 |
| `server/test/*.test.js` | Tests for the above (`capacity`, `deletion`, `problems`, `visitors`). Not deployed. | |
| `server/README.md`, `docs/backups.md`, `docs/deploy.md` | Capacity notes (both directions of transfer, realistic sync-document sizes), Atlas's own free-tier snapshot. | X4, X5, X7 |

What a reader may notice: the public board can be up to half a minute
behind another reader's minutes (their own row is drawn by the app, from
the device). A reader who goes private still leaves the board at once.

## Before

1. On this PC, in `server\`: `npm test` against the local MongoDB. It
   should end `fail 0` (286 tests on 2026-10-22).
2. Atlas → the cluster → **Metrics**: note **Network** (bytes in and out)
   and **Data Size** for the last 7 days, to compare with in a week.

## Deploy

As always ([deploy.md](deploy.md), step 5), from `server\deploy\`:

```powershell
.\deploy.ps1 -Host 129.154.40.208 -KeyPath "<your key>"
```

Nothing else: the unit, the Caddyfile and `/etc/leaflet-api.env` are
unchanged.

## Check it

On the VM:

```bash
systemctl status leaflet-api            # active (running)
sudo journalctl -u leaflet-api -n 50    # "Leaflet API on http://127.0.0.1:8787", no Mongo errors
```

From anywhere:

- `https://leafletapp.duckdns.org/health` → `{"ok":true}`.
- In the app, signed in: **Sync now** says synced; open the Board: it loads;
  read a minute and publish (or wait five): your own row moves at once, other
  readers' within half a minute.
- Settings → **Report a problem**: one goes through (`201`); it is in the
  admin's list.
- Deletion (optional, with a throwaway account only, never a real one):
  sign up a test account in a test build pointed at the server, sync once,
  delete the account in Settings. Atlas → Browse Collections → `states`:
  no document with that account's `_id`; `sessions`: none with its `userId`.

A week on, Atlas Metrics again: transfer **out** should be lower for the same
number of readers (the board is read from the database about twice a minute
at most, instead of after nearly every save), and transfer **in** a little
lower (saves without the camp). The larger fall in transfer in comes with
1.5.11's **app** (highlights held back while a book is open), as readers
update.

While you are in Atlas: the cluster's **Backup** tab. MongoDB's page now says
a free cluster can turn on a daily snapshot (up to four kept). If it is
offered, turn it on as a second line beside the nightly backup
([backups.md](backups.md)).

## If something is wrong

Deploy the previous commit's `server/` the same way: there is no migration
to undo. The board and visitors caches live in memory and start empty on
every restart.
