# Database backups — the run sheet

Since 1.5.3 the database holds signed-in readers' highlights, notes, places
and history, so the VM backs it up every night, encrypted, to the Google
Drive of the leafletmail Gmail account. Each step says **where** it happens
and how to check it worked.

Atlas's own: MongoDB's page on free clusters (read 2026-10-22, see
[the sync audit](sync-audit.md)) says a free cluster can have backups turned
on, a daily snapshot with up to four kept. This repository said for a long
time that the free tier keeps none; check the cluster's **Backup** tab. If it
is offered, turn it on as a second line: it is a few days deep, kept by
MongoDB, unencrypted to you and restored only through Atlas. The nightly
encrypted backup below stays the one this run sheet relies on (fourteen days
deep, in a Drive you hold, and what `restore.js --deletions-from` works with).

How it works:

1. At about 03:30 UTC `leaflet-backup.timer` starts `leaflet-backup.service`
   on the VM, which runs `node src/backup/run.js`.
2. That reads every collection of the `leaflet` database with the Node driver
   (no `mongodump`), gzips it and encrypts it to **your public key**
   (AES-256-GCM, the key wrapped with RSA-OAEP). The VM never has the private
   key: it can make a backup, never read one.
3. It cuts the result into parts of at most 8 MB and posts them, one at a
   time, to an **Apps Script web app** in the leafletmail account
   (`server/deploy/backup-receiver.gs`), which saves them in Drive under
   `Leaflet backups/leaflet-2026-10-17T0330Z/` and writes `manifest.json`
   when the last one is in. The VM holds only that web app's URL and a secret
   that can add a backup, never list, read or change one.
4. The script keeps 14 days of backups (and the 3 newest whatever their age,
   but nothing past 30 days) and, once a day, emails you if there has been no
   complete backup for 36 hours.

| Piece | Lives at |
| --- | --- |
| The backup code | `server/src/backup/` (shipped to `/opt/leaflet-api` by `deploy.ps1`) |
| Timer and service | `/etc/systemd/system/leaflet-backup.{timer,service}` (installed by `deploy.ps1`) |
| Receiver | Apps Script project **Leaflet backups** in the leafletmail account |
| The backups | leafletmail's Drive, folder `Leaflet backups` |

| Secret | Goes in | Never in |
| --- | --- | --- |
| Backup private key | `C:\Users\Adi\.leaflet\backup-private.pem`, **and a second copy off this PC** (password manager) | the VM, Drive, the repo |
| Receiver secret | the script's `SECRET` property, and `/etc/leaflet-backup.env` on the VM (root, `600`) | the repo |
| Backup public key | `/etc/leaflet-backup.pub` on the VM (`644`; not a secret) | |

---

## 1. The receiver, one time — *script.google.com, signed in as leafletmail*

1. **Make the secret.** In PowerShell, copy what this prints (a new one, not
   the mailer's):
   ```powershell
   $bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); [Convert]::ToBase64String($bytes)
   ```
2. **Create the project.** Sign in to the leafletmail Gmail, open
   <https://script.google.com>, **New project**. Click "Untitled project" at
   the top and name it **Leaflet backups**.
3. **Paste the script.** Select everything in `Code.gs`, delete it, and paste
   the whole of [`server/deploy/backup-receiver.gs`](../server/deploy/backup-receiver.gs).
   **Save** (Ctrl+S).
4. **Script Properties.** Left bar → **Project Settings** (gear) → scroll to
   **Script Properties** → **Add script property**, three times:
   - `SECRET` = the string from step 1
   - `ALERT_EMAIL` = the address that should hear about a missed backup (yours)
   - `KEEP_DAYS` = `14` (optional; 14 is the default, 30 the most it takes)

   **Save script properties.** (A fourth, `FOLDER_ID`, appears by itself
   after the first backup: the script's note of which folder is
   `Leaflet backups`. Leave it alone.)
5. **Authorise, and try the alert.** In the editor's toolbar pick
   **checkFresh** in the function list → **Run**. Google asks for permission
   (Drive, and sending email as leafletmail): **Review permissions** → the
   account → "Google hasn't verified this app" → **Advanced** → **Go to
   Leaflet backups (unsafe)** → **Allow**. With no backup yet it emails
   `ALERT_EMAIL` "Leaflet: no backup for 36 hours": that is the alert working.
6. **Deploy.** **Deploy → New deployment** → gear next to "Select type" →
   **Web app**. Description "v1"; **Execute as: Me**; **Who has access:
   Anyone** → **Deploy**. Copy the **Web app URL**,
   `https://script.google.com/macros/s/…/exec`.
7. **Check it.** Open the URL in a **private (InPrivate/Incognito) window**:
   `{"ok":true,"service":"leaflet-backups","deletes":"to the bin"}` (it says
   `"for good"` once step 9 is done). Nothing else is ever shown there.
8. **The daily check.** Left bar → **Triggers** (alarm clock) → **Add
   Trigger**: function **checkFresh**, deployment **Head**, event source
   **Time-driven**, type **Day timer**, a time such as **9am to 10am** →
   **Save**. (Or pick `installTrigger` in the function list and **Run** it
   once: it adds the same trigger.) The hour is in the project's time zone
   (Project Settings).
9. **Delete for good, not to the bin (needed).** The privacy policy
   promises that nothing is kept past 30 days, and Drive's bin would keep
   each old backup 30 days more. Left bar → **Services** → **+** →
   **Drive API** → **Add**, then deploy a new version (below). The check in
   step 7 then says `"deletes":"for good"`; `"to the bin"` means the service
   is missing and old backups only go to the bin.

After editing the script later (or pasting a newer `backup-receiver.gs`):
**Deploy → Manage deployments** → pencil → Version: **New version** →
Deploy. The URL stays the same; a new *deployment* would give a new URL.

## 2. The key, one time — *PowerShell on your PC*

```powershell
cd D:\Leaflet\server
node src/backup/keygen.js C:\Users\Adi\.leaflet\backup-private.pem
```

It writes the private key there and the public key beside it,
`C:\Users\Adi\.leaflet\backup-private.pub`, and prints the public one. It
refuses to overwrite either.

**Now keep a second copy of the private key somewhere that is not this PC**:
open `backup-private.pem` in Notepad and save the whole text (from
`-----BEGIN PRIVATE KEY-----` to `-----END PRIVATE KEY-----`) as a secure
note in your password manager. **Without the private key every backup is
useless**: nobody, Google included, can open them. Never put it on the VM or
in Drive.

## 3. The VM, one time — *ssh into the VM, then PowerShell on your PC*

From your PC, copy the public key up:

```powershell
scp -i "C:\Users\Adi\Documents\UnifloeMarketingKeys\unifloeMarketingPrivate.key" C:\Users\Adi\.leaflet\backup-private.pub ubuntu@129.154.40.208:/tmp/leaflet-backup.pub
```

On the VM:

```bash
sudo install -m 644 -o root -g root /tmp/leaflet-backup.pub /etc/leaflet-backup.pub && rm /tmp/leaflet-backup.pub
head -1 /etc/leaflet-backup.pub          # -----BEGIN PUBLIC KEY-----

sudo install -m 600 -o root -g root /dev/null /etc/leaflet-backup.env
sudo nano /etc/leaflet-backup.env
```

`/etc/leaflet-backup.env` (see [`leaflet-backup.env.example`](../server/deploy/leaflet-backup.env.example)):

```
BACKUP_URL=https://script.google.com/macros/s/…/exec
BACKUP_SECRET=<the string from step 1.1>
BACKUP_PUBLIC_KEY=/etc/leaflet-backup.pub
```

`MONGO_URI` and `MONGO_DB` come from `/etc/leaflet-api.env`, which the
backup reads too.

Then ship the server as usual, from your PC ([deploy.md](deploy.md), step 5):

```powershell
cd D:\Leaflet\server\deploy
.\deploy.ps1 -Host 129.154.40.208 -KeyPath "C:\Users\Adi\Documents\UnifloeMarketingKeys\unifloeMarketingPrivate.key"
```

It installs both units, and with `/etc/leaflet-backup.env` in place says
`Backups: on, next run …`. (Without it, `Backups: off`, and nothing runs.)

**Check it**, on the VM: run one now, rather than wait for the night.

```bash
sudo systemctl start leaflet-backup        # waits until it is done: seconds to a few minutes
sudo journalctl -u leaflet-backup -n 5 --no-pager -o cat
```

The last line is
`[leaflet-backup] leaflet-2026-10-17T1012Z: 27 collections, 1234 documents, 1 part, 0.84 MB, sent to Drive in 9 s`.
In leafletmail's Drive, `Leaflet backups/leaflet-…Z/` holds `part-000` (and
more for a larger database) and `manifest.json`. Then:

```bash
systemctl list-timers leaflet-backup       # NEXT: tomorrow about 03:30 UTC; LAST: the run above
```

If it says `failed:`, the rest of the line says why: `refused the secret`
(the two `SECRET`s differ), `gave up after 5 tries` (the URL, or the access
is not **Anyone**), `BACKUP_PUBLIC_KEY …` (the `.pub` file). Fix, then
`sudo systemctl start leaflet-backup` again.

## 4. A restore drill, monthly — *your PC, against the local MongoDB*

A backup nobody has restored is a hope. Once a month:

1. In leafletmail's Drive, open `Leaflet backups`, right-click the newest
   `leaflet-…Z` folder → **Download**. Drive zips it; **Extract all** in
   Downloads.
2. Check it opens and is whole (writes nothing):
   ```powershell
   cd D:\Leaflet\server
   node src/backup/restore.js --in "$env:USERPROFILE\Downloads\leaflet-2026-10-17T0330Z" --key C:\Users\Adi\.leaflet\backup-private.pem --list
   ```
   (`--in` takes the extracted folder or the one above it, or one file of
   the parts put together.) It prints when the backup was taken, each
   collection's count, and
   `checked: sha256 of every part and of the whole, encryption tag, document counts`.
3. Restore it into the local MongoDB, into a database of its own:
   ```powershell
   node src/backup/restore.js --in "$env:USERPROFILE\Downloads\leaflet-2026-10-17T0330Z" --key C:\Users\Adi\.leaflet\backup-private.pem --db leaflet_restore --replace
   ```
   (`--uri` defaults to `mongodb://127.0.0.1:27017`. `--replace` drops what
   last month's drill left in `leaflet_restore`; without it the tool refuses
   a database that has collections.) The table it prints must show the same
   numbers under **in backup** and **restored**.
4. Optional, to see it work for real: point a local server at it
   (`MONGO_DB=leaflet_restore` in `server/.env`, `npm start`) and sign in
   from a dev build with a test account you know is in it.

Once a year, do step 2 with the **copy** of the key from the password
manager (paste it into a temporary `.pem` file, then delete that file), to
know the copy works.

## 5. A real disaster — *your PC, and the VM*

Restore runs on your PC, because only your PC has the private key. Your PC's
address must be on the Atlas allowlist while you do it ([deploy.md](deploy.md),
step 3b; take it off afterwards).

**Always pass `--deletions-from` when the live database can still be
reached**: every account deleted since the backup was taken is then deleted
again from what is restored (the live database remembers deleted accounts'
ids for 45 days, in `deletions`), so nobody who deleted their account comes
back. The tool reads that list before it drops anything, so it is safe to
name the same database you are replacing.

**The data in the live database is wrong** (deleted by mistake, damaged),
but the cluster is fine:

1. On the VM, stop everything that writes:
   ```bash
   sudo systemctl stop leaflet-api leaflet-backup.timer
   ```
2. On your PC, the backup from just before the damage (step 4.1 to download
   it, step 4.2 to check it), then:
   ```powershell
   node src/backup/restore.js --in <folder> --key C:\Users\Adi\.leaflet\backup-private.pem `
     --uri "<the Atlas string>" --db leaflet --replace --yes-production `
     --deletions-from "<the Atlas string>"
   ```
   (`--db leaflet` is refused without `--yes-production`.) It prints the
   counts and `deleted again N accounts deleted since the backup`.
3. On the VM, start it again. The API makes its indexes when it starts (the
   backup does not keep them; `ensureIndexes` in `src/db.js` makes every
   one):
   ```bash
   sudo systemctl start leaflet-api leaflet-backup.timer
   sudo journalctl -u leaflet-api -n 20 --no-pager
   ```
   and `https://leafletapp.duckdns.org/health` → `{"ok":true}`.

**The cluster is gone**: make a new one ([deploy.md](deploy.md), step 3),
restore into its empty `leaflet` database (`--uri "<the new string>" --db
leaflet --yes-production`, no `--replace` needed; `--deletions-from "<the
old string>"` if the old one still answers), put the new string in
`/etc/leaflet-api.env`, and `sudo systemctl restart leaflet-api`.

Anything readers did after the backup was taken is not in it.

## 6. Sizes and limits

| | |
| --- | --- |
| Database | M0 holds at most 512 MB, data and indexes. Much of it (`states`, the sync documents: about 30 KB a typical reader, 0.5 MB a heavy one) is gzipped already, so a backup is somewhat smaller than the database, not many times smaller. |
| Parts | 8 MB each (`BACKUP_PART_MB`, 1 to 8), at most 500 a backup (4 GB). An 8 MB part is an 11 MB request (base64 in JSON). |
| Apps Script | Each part is one call, which must finish within Apps Script's 6 minutes; the receiver takes at most 12 MB a part and 6 new backups in any 24 hours. Google does not document the largest request a web app accepts (50 MB is the figure usually given); if large parts ever fail, set `BACKUP_PART_MB=4` in `/etc/leaflet-backup.env`. |
| The alert | One email a day at most, out of MailApp's 100 a day for the account (shared with the reset mailer if that script is in the same account). |
| Drive | 15 GB, shared with leafletmail's Gmail and Photos. Kept: 14 days of backups (`KEEP_DAYS`), the 3 newest always, nothing past 30 days. Backups moved to the bin still count against the 15 GB for the 30 days the bin keeps them (only if step 1.9 was skipped), so plan for about 44 backups' worth: 44 × 20 MB is under 1 GB. |
| Atlas transfer | Each backup reads the whole database once: the M0's weekly 10 GB **out** is shared with the API (the 10 GB **in** is the API's alone: mostly the sync documents apps send up). A 50 MB database is 350 MB a week; at 200 MB, 1.4 GB, a seventh of the week's allowance. |
| The VM | The service is capped at 256 MB (`MemoryMax`), runs at `Nice=10` and a fifth of the CPU weight, and writes nothing to disk. |
| Consistency | Collections are read one after another while the API runs, so a backup is not one instant across the database: a reader's activity during the minute it takes can be in one collection and not yet in another. |

Deleted accounts: a deleted reader's data stays in the backups made before
the deletion until those backups go (30 days at most; Drive's bin
keeps them 30 more only if step 1.9 was skipped), and a restore deletes it again (`--deletions-from`).
