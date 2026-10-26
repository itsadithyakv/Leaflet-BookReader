# Owner's handbook: where everything is, and how to run it

The one page to read first, for the owner and for any future session. It says
where every piece of Leaflet lives, how each recurring job is done, what
happened recently, and what is still open. The detail lives in the run sheets
it links to. This repository is **public**: no email addresses, passwords,
keys or connection strings belong here.

Last brought up to date: **2026-10-23**.

---

## 1. Ground rules (for every session)

- **The owner deploys servers and handles Atlas, Google consoles, secrets and
  signing.**
  - A session prepares the run sheet, the commands and a clean export of the
    code. The owner runs them.
  - Never open or print `apps/src-tauri/msix/build.env`. The build scripts
    read it themselves.
  - Never create signing keys. Never type credentials anywhere.
- **Commit and push only when the owner asks.** Tag only what shipped: a tag
  must be exactly the commit a Store or Play package was built from.
- **Every command for the VM starts with the ssh line** (section 4.3), as its
  own block, then one command per block.
- **Never call `cloud::signup` or `store_session_token` in tests.** It
  overwrites the real sign-in in this PC's keychain. Test accounts go on the
  local e2e server only (`server/scripts/e2e-server.mjs`).
- **The owner's own app data** (`%APPDATA%\com.leaflet.app`) is for
  diagnosis only, from copies. Never modify it, and delete the copies after.
- **`D:\Books` is read-only.**
- **Look:**
  - "Smooth" (no blur) is the default everywhere. Liquid Glass is opt-in only.
  - The desktop keeps the leather sidebar.
  - No standing explanations on screen: hints go behind an (i) or a tooltip.
- **Speed floor:** the owner's OnePlus Nord CE4 Lite (Adreno 619) and an
  i5-13420H laptop.

## 2. The map

| Piece | Lives at |
| --- | --- |
| Code | GitHub `itsadithyakv/Leaflet-BookReader` (public) |
| Where work happens | the worktree `D:\Leaflet\.claude\worktrees\android`, branch `android` |
| `D:\Leaflet` itself | the old `release/1.3` checkout. Leave its git alone. It holds `brand/` (brand assets) and `apps/src-tauri/msix/build.env` (build secrets). |
| Builds handed to the owner | `D:\Leaflet\.claude\apk\` |
| Website, privacy policy, terms, signed `config.json` | GitHub Pages, `https://itsadithyakv.github.io/Leaflet-BookReader/` (source: `site/`) |
| API (accounts, sync, social, admin) | Oracle VM `129.154.40.208` (host name `unifloe-marketing`), `/opt/leaflet-api`, systemd service `leaflet-api`, behind Caddy at `https://leafletapp.duckdns.org` |
| Server settings | `/etc/leaflet-api.env` on the VM (root, `600`). Holds the Atlas string and `RESET_MAIL_URL`. |
| Database | MongoDB Atlas, free **M0**, database `leaflet`. Only the VM's IP is on the allowlist. |
| Nightly database backup | `leaflet-backup.timer` on the VM, at about 03:30 UTC, sent encrypted to an Apps Script in the owner's personal Google account. It lands in that account's Drive folder **Leaflet backups**. See [backups.md](backups.md). |
| Password-reset mailer | an Apps Script web app (`server/deploy/password-reset-mailer.gs`). Its URL is `RESET_MAIL_URL`. Which Google account owns it: **unknown, see section 7.** |
| Google Drive sign-in for the apps | Google Cloud project **"Leaflet new"** in the owner's personal Google account (since 2026-10-23). See section 5. |
| Windows app | Microsoft Store, `AdithyaKV.LeafletBookReader` |
| Android app | not on Play yet ([play-store.md](play-store.md)). Test APKs are debug-signed. |

**Shares the VM, never touched:** the Unifloe sites (`unifloe.app` blocks in
`/etc/caddy/Caddyfile`, `/var/www/unifloe`). Separate machine, also never
touched: the pilot server `go.unifloe.app` (`129.225.110.37`).

## 3. Secrets and keys

| Secret | Lives in | Copy kept | Never in |
| --- | --- | --- | --- |
| VM SSH key | `C:\Users\Adi\Documents\UnifloeMarketingKeys\unifloeMarketingPrivate.key` | (owner) | the repo, chat |
| Build secrets (Google client id + secret, feature flags, API base) | `D:\Leaflet\apps\src-tauri\msix\build.env`. Its shape is in `build.env.example`. | (owner) | the repo, chat |
| Atlas connection string | `/etc/leaflet-api.env` on the VM | Atlas itself | the repo, the app |
| Backup **private** key (opens backups) | `C:\Users\Adi\.leaflet\backup-private.pem` | owner's password manager (2026-10-23) | the VM, Drive, the repo |
| Backup public key | `/etc/leaflet-backup.pub` on the VM (not a secret) | | |
| Backup receiver secret | the script's `SECRET` property, and `/etc/leaflet-backup.env` on the VM (root, `600`) | | the repo |
| Config signing key | `C:\Users\Adi\.leaflet\config-signing-key.pem` | **check, see section 7** | the repo |

## 4. How to do each job

### 4.1 Version numbers

There are five places:
- `apps/package.json`
- `apps/package-lock.json` (both entries at the top)
- `apps/src-tauri/tauri.conf.json`
- `apps/src-tauri/Cargo.toml`
- the `leaflet` entry in `apps/src-tauri/Cargo.lock`

The Android version code is major·1,000,000 + minor·1,000 + patch, so 1.5.12
is 1005012. A version number that went to the Store is spent: the next
release must be higher.

### 4.2 Builds (PowerShell, from `apps\src-tauri\msix\` in the worktree)

| What | How |
| --- | --- |
| Store MSIX (unsigned; the Store signs it) | `.\build-msix.ps1`. Studio voice DLLs only with `LEAFLET_STUDIO_VOICE=1`, which waits for sherpa-onnx 2.0 (1.x carries GPL espeak). |
| Windows installer (NSIS) | in the **same** PowerShell window, after `build-msix.ps1` (so its environment carries over): `npm run tauri build -- --bundles nsis` from `apps\` |
| Phone test APK | `.\build-android.ps1 -Release -Target aarch64`, then `zipalign -P 16 -f 4` and sign with the debug keystore using `apksigner`. Check the version code with `aapt dump badging`. |
| Before handing a build over | Check that the exe carries the right Google client: its project number must match "Leaflet new". |

Every suite has to pass first: `npx tsc --noEmit` and `npx vitest run` in
`apps\`, `cargo test` and `cargo clippy --all-targets` in `apps\src-tauri\`,
and `npm test` in `server\` (against a local MongoDB). More detail in
[building.md](building.md), [release-msix.md](release-msix.md),
[android.md](android.md) and [testing.md](testing.md).

### 4.3 Deploying the server (the owner runs it)

1. Export **the tag**, never the working tree. The worktree's `server/` can
   hold unfinished work for the next version. From the worktree:
   ```bash
   D=/d/Leaflet/.claude/deploy-1.5.x && rm -rf "$D" && mkdir -p "$D" && git archive v1.5.x server | tar -x -C "$D"
   ```
2. Deploy, in PowerShell. `deploy.ps1` uploads the `server/` folder it sits
   in:
   ```powershell
   cd D:\Leaflet\.claude\deploy-1.5.x\server\deploy
   ```
   ```powershell
   .\deploy.ps1 -Host 129.154.40.208 -KeyPath "C:\Users\Adi\Documents\UnifloeMarketingKeys\unifloeMarketingPrivate.key"
   ```
   It copies the code to `/opt/leaflet-api`, runs `npm ci --omit=dev`, and
   installs and restarts `leaflet-api` and the backup units. It never touches
   Caddy, `/etc/*.env` or `/var/www`.
3. Check:
   - `curl.exe https://leafletapp.duckdns.org/health` should print `{"ok":true}`.
   - `https://unifloe.app` should still load.
4. Delete the export folder.
5. If the health check fails, connect and look:
   ```powershell
   ssh -i "C:\Users\Adi\Documents\UnifloeMarketingKeys\unifloeMarketingPrivate.key" ubuntu@129.154.40.208
   ```
   ```bash
   sudo systemctl status leaflet-api --no-pager
   ```
   ```bash
   sudo journalctl -u leaflet-api -n 50 --no-pager
   ```

Each version's run sheet says what changed and what to check:
[deploy-1.5.11.md](deploy-1.5.11.md), [deploy-1.5.12.md](deploy-1.5.12.md).
**Order:** server first, then the apps. Every app version works against
either server.

### 4.4 Backups

The full setup, restore drill and disaster steps are in
[backups.md](backups.md).

- **Is it running?** Connect (ssh line above), then:
  ```bash
  systemctl list-timers leaflet-backup
  ```
  ```bash
  sudo journalctl -u leaflet-backup -n 6 --no-pager -o cat | grep leaflet-backup
  ```
  A good run looks like
  `[leaflet-backup] leaflet-…Z: N collections, N documents, 1 part, … MB, sent to Drive in … s`.
- **If a night is missed**, the script emails `ALERT_EMAIL` after 36 hours.
- **Monthly drill:** download the newest backup folder from Drive, then run
  `node src/backup/restore.js --in <folder> --key C:\Users\Adi\.leaflet\backup-private.pem --list`
  from the worktree's `server\`.
- **Apps Script with several Google accounts in one browser:** the Triggers
  and Deployments pages open under the *default* account and say "unable to
  open the file". Use the script's own `installTrigger` function (Run), or a
  private window signed in to one account.

### 4.5 Admin

- **You become admin** with `role: "admin"` on your profile, set by hand in
  Atlas (`profiles`, by handle). The owner's handle `itsadithyakv` has it. No
  route can set it.
- **Up to 1.5.11:** Settings → Admin holds problem reports, moderation and the
  update notice.
- **From 1.5.12:** an **Admin** item in the profile menu opens one page:
  - Overview: readers, active readers, versions in use, server health,
    database size, last backup;
  - Errors (sent automatically, without personal details);
  - Problem reports, Moderation, Update notice;
  - Announcements: one-time pop-ups aimed at everyone, one platform, older
    versions, or Drive users.
- **Make someone else admin, or stop being one:** set or unset `role` in
  Atlas.

## 5. Google sign-in (Drive) after the 2026-10-22 switch-off

- **The old client was disabled.** The first Drive client lived in a project
  in the old Leaflet Gmail account ("leafletmail"), and Google disabled it on
  2026-10-22 (`disabled_client`). That account is stuck behind Google's
  security delay on a new recovery phone.
- **The new client is set up.** The owner created **"Leaflet new"** in their
  personal account (2026-10-23):
  - client type "Desktop app", used by both the Windows and Android apps
    (loopback plus PKCE);
  - scopes `drive.file`, `openid`, `email`;
  - consent screen named Leaflet, published "In production", with a Google
    Group as the support email;
  - the logo needs a domain verified in Search Console. That is optional and
    not done. The "home page not registered to you" warning does not stop
    sign-in.
  - The id and secret are in `build.env`. From 1.5.12, builds carry them.
- **What it means for readers.** `drive.file` only sees files the same project
  made, so 1.5.12 cannot see old backups:
  - Each device taps **Reconnect Google Drive** once. 1.5.12 recognises a
    sign-in from the old client and shows that button
    (`grant_from_another_client` in `sync/drive.rs`).
  - Books on a device upload again by themselves into a new `Leaflet` folder.
  - Reading kept with a Leaflet account is untouched, because it lives on the
    server.
  - A book whose only copy was in the old Drive folder must be downloaded
    from drive.google.com (`Leaflet/books/<sha256>.epub`) and added again.
    The import matches it by content.
  - Readers will see two `Leaflet` folders in Drive. The old one can go once
    the new one is full.
- **Announcement to publish** right after the 1.5.12 server deploy, from
  Admin → Announcements:
  - audience: *readers who have used Google Drive on this device*;
  - button: *Reconnect Google Drive*;
  - ends: in about 6 weeks;
  - title and text: the 2026-10-23 entry in section 6.

## 6. Log

### 2026-10-23

- **1.5.11 released.**
  - `main` and `android` were pushed to `6c55207` and tagged `v1.5.11`.
  - Store MSIX `Leaflet_1.5.11.0_x64-store.msix` and the test APK
    `Leaflet-1.5.11-test2-arm64.apk` (version code 1005011) were handed over,
    built from exactly that commit.
- **1.5.11 server deployed** by the owner, from an export of `v1.5.11`.
  Health `{"ok":true}`, and unifloe.app still up.
- **New Google client** "Leaflet new" (section 5).
- **The nightly database backup had never been switched on.** It was set up:
  - receiver in the owner's personal Google account;
  - key made and copied to the password manager;
  - `/etc/leaflet-backup.{pub,env}` on the VM, timer enabled;
  - first backup `leaflet-2026-10-23T1522Z`: 27 collections, 85 documents,
    0.08 MB, 17 s.
  - `backups.md` fixed: it pointed at `D:\Leaflet\server`, which has no backup
    code, and the account note was added.
- **1.5.12 committed and tagged `v1.5.12`**, and the Store MSIX and test APK
  were built from that commit (later the same day). Before the commit:
  - every suite passed: tsc; vitest 4368; cargo test 1123; clippy clean;
    server 313;
  - history trimming was checked on a copy of the owner's real library
    (`compacting_a_real_library_loses_nothing_that_counts`, ignored by
    default; the copy was deleted);
  - the "What's new" text is in [store-listing.md](store-listing.md).

  What it holds:
  - pinch-zoom for maps and pictures in books;
  - performance (Library kept mounted, startup split up, `npm run perf`
    budgets);
  - sync capacity:
    - history compaction (small, because Pip's economy is replayed from
      sessions);
    - "Start empty" deletions;
    - smaller profile saves;
    - dormant-account cleanup, built but **off**;
    - about 1,500 daily readers before M0 runs out, up from about 790;
  - admin metrics, automatic error reports, announcements;
  - the Drive reconnect fix, and a clearer "not in your backup yet" message.
- **Privacy:** from 1.5.12's server, the server keeps each account's
  last-used day, app version and device type, and the apps send anonymous
  error reports, which can be switched off in Settings. The privacy page must
  say both when that server goes out.
- **The Drive apology text** (for Admin → Announcements):
  > **Your backup needs one tap**
  > We moved Leaflet's Google sign-in to a new home, so your old backup can't
  > be reached from it. Reconnect once on each device, and your books back up
  > again on their own. Your reading progress is safe.
  >
  > Missing a book that was only in your backup? It's still in your Google
  > Drive, in the old "Leaflet" folder. Download it and add the files to
  > Leaflet. Sorry for the trouble!

### 2026-10-24

- **1.5.13 started**, uncommitted in the worktree: **read aloud for PDFs**.
  It was never built before; it existed only in the EPUB reader.
  - The new modules are in `apps/src/readers/readAloud/`: `pdfSource.ts`,
    `usePdfReadAloud.ts`, `useReadAloudCore.ts` (the part the EPUB and PDF
    readers share), and `ReadAloudMenuRow.tsx`.
  - Running headers and page numbers are skipped conservatively.
  - Scanned PDFs show a notice. Comics get no option.
  - Checked in the preview with a generated PDF. Not yet checked on a real
    phone, with real voices, or with multi-column PDFs.
- **Revise words, from the Library** (uncommitted, for the next build):
  - a "Revise words · N due" key on the desktop toolbar, and an icon with a
    badge on the phone, opening Pip's quiz over the Library;
  - a bin on each quiz card, with an Undo toast;
  - "Don't keep" on the lookup card now has Undo.
  
  Undo is a new Rust command, `words_restore`. It is dated after the removal,
  so it wins the merge between devices.
- **Raids redesign started.** The owner's complaints: raids look bad, show no
  progress, and have no challenge or strategy. The plan is
  [design/hollow/raids-plan.md](design/hollow/raids-plan.md):
  - the Magpie Lands map;
  - per-stronghold stars and replays;
  - approaches, quirks, squads, orders, and feats for the third star;
  - balance measured naive against good plans.
  
  - **Step 1 is done:** rules, quirks, orders and feats, events, and the sim.
    Every section 4 target is met (`raids-balance-results.md`).
  - **Step 2 is done:** the Magpie Lands map, best stars in the `rd:` mark
    with a Rust merge, and replay for stars.
  - **Road camps were taken off again:** they are not played.
- **Paused at the owner's "save and stop now"**, with step 3 of the raids
  part done.
  - **In the tree:** `RaidFlow`, `RaidScout`, `RaidPlan`, `RaidBattle`,
    `RaidField`, `RaidEndCard`, `raidPaint`, `raidFx` (+ test), `raidLayout`,
    `raidWords`, `raid.css` and `pip/raid-art.js`.
  - **Deleted:** `BattleScreen.tsx` and `RaidBoard.tsx`.
  - **State:** tsc is clean and vitest passes 4,456.
  - **Not done in step 3:**
    - the styles only the deleted screens used were being trimmed;
    - the tests the brief asked for, beyond `raidFx`;
    - the `pip.md` and `features.md` updates;
    - screenshots and the 4× throttle frame time.
  - **To resume:** check `RaidFlow` end to end (map → scout → plan → battle →
    end card, Send, friends) against raids-plan.md sections 2, 3 and 5, then
    finish that list.
  - **Also uncommitted, not built:** PDF read aloud and Revise words.

### 2026-10-25

- **Raids step 3 finished** (uncommitted, for 1.5.13; raids-plan.md section 5,
  "Built"):
  - the ground covers the whole window, the region's woods round the field, so
    a raid is never a framed box; the field is a size larger where its empty
    edges can lie under the bars (7× on a 1920×1080 desktop);
  - on a phone held upright the raid is the Hollow page's height, so the
    fight's orders are never under the bar along the foot;
  - Send opens on its end card over the field as that raid left it; a
    stronghold just taken stays the flow's for Try again (as a replay);
  - the plan's forecast runs a run at a time; scouts' health shows only after
    a hit; a crowd of scouts is drawn spread a little; groups named alike on
    chips and paths ("Ford", "Thorns").
- **Checked:** tsc, vitest 4,472, the raids sim (every target still met),
  screenshots at 1366×768, 1920×1080, 375×812 and 812×375 in headless Chrome.
- **Timing (production build, 4× CPU throttle):** a busy fight holds every
  frame (95th percentile 8.4 ms at 120 Hz, no long tasks); the forecast makes
  one task of 50 to 75 ms at most after a change.
- **`npm run perf` Hollow idle is over its 1.5.12 budgets.** v1.5.12 itself
  fails the same budgets today, in 13 runs out of 13, and CPU profiles show
  no new idle work. It is the machine's state, not a regression. The budgets
  were **not** raised. Re-run on a quiet, plugged-in machine; if v1.5.12
  still fails there, re-baseline with `--update` and say why.
- **Polish pass:**
  - the fight is framed on the stronghold (6× at 1366×768, 10× at
    1920×1080), with drag to pan and a calm camera;
  - four distinct scout sprites with outlines, shadows and group-coloured
    rings;
  - a pixel-paper HUD and planner, coloured group chips, and pixel keys;
  - calmer water;
  - the "second tap" on the Raid key was the turn-to-landscape veil in a
    phone emulation that never turns, so not a bug;
  - the old `.pip-base-result*` styles were removed.
- **Still weak**, for later:
  - on an upright phone the planner sheet leaves the field small;
  - scouts at the ford are out of view on an upright phone while the camera
    holds the stronghold;
  - second-gate strongholds stay zoomed out;
  - thorns are a dark block;
  - a pan made while scouting carries into the plan step.
- **1.5.13 committed and tagged `v1.5.13`**, and the Store MSIX and test APK
  were built from that commit.
  - It holds the raids redesign, PDF read aloud, and Revise words with
    remove and Undo.
  - Checked: tsc; vitest 4,494; cargo test 1,129; clippy clean; the raids sim
    (every target met).
  - No server change since 1.5.12, so no deploy is needed for it.
- **1.5.14 committed and tagged `v1.5.14`** (local, like `v1.5.13`), and the
  Store MSIX and test APK were built from that commit. It holds:
  - **Raids, the weak spots:** a folding planner on upright phones, edge
    markers for groups out of view, second-gate framing, bramble thorns, ford
    formations, and dark mode.
  - **Study cards** (`docs/design/study-plan.md`): fill-in, question and
    picture cards, kept as annotations rows of kind `card`; one Revise for
    words and cards; a book's cards with CSV export.
    - A picture card's box missed its label on phones, because the maker's bar
      grew. That was fixed before release, with a regression test.
  - **Smaller Drive backups** (`storage/smaller.rs`), on by default:
    - EPUB and CBZ pictures resized, covers down to 1000 px;
    - text bytes unchanged, and a `leaflet-source.json` marker keeps the
      original's identity;
    - PDFs are sent as they are;
    - measured 24% smaller on the owner's 63 books.
  - **Sync:**
    - leaving the app always syncs once the place has moved (the 30 s gap no
      longer holds it back);
    - **Sync now** in both readers' menus;
    - a red dot and "Not syncing since …" on a device that used to sync and
      now has nothing to sync through.
  - **Your Year in Pages** (`docs/design/year-in-pages.md`): shown from 24
    December to 7 January, with Admin → Year in pages as a preview. Its
    Android notification is new Kotlin, compiled first in this APK build.
  - **The streak panel's Calendar button**, laid out on one line.
  - Checked: tsc; vitest 4,624; cargo test 1,168; clippy clean; the raids sim
    (every target met). No server change.

### 2026-10-26

- **1.5.15 committed and tagged `v1.5.15`** (local), and the MSIX and APK
  were built from that commit. It holds **the People tab**:
  - search by the start of any word of a name or handle (`nameWords`,
    indexed);
  - browse public readers: active, most read, new, cursor-paged at 20;
  - suggestions with their reasons;
  - Followers and Following lists, with counts kept on the profile;
  - "Follows you", three follow states, and kudos this month with an (i);
  - "View my profile" in the profile menu;
  - "Friends" renamed "Following".
- **It needs a server deploy** ([deploy-1.5.15.md](deploy-1.5.15.md)). If
  1.5.12's server is still not deployed, this deploy carries it too.
  - Backfills run at start: `nameWords` each start; follow counts and the
    month's kudos once each, marked in `meta`.
  - The app degrades quietly on the old server.
- Checked: tsc; vitest 4,634; server 330; cargo test 1,169; clippy clean.
- **The owner deployed the `v1.5.15` server** the same day, from a tag
  export:
  - health `{"ok":true}`, and the People tab works;
  - this deploy also carried 1.5.12's server changes: active readers, error
    reports, announcements, the admin overview, and sync capacity;
  - the live server is now `v1.5.15`.

## 7. Open items

| # | What | Who |
| --- | --- | --- |
| 1 | Open the first backup once with `restore.js --list` (section 4.4), then delete the download | owner |
| 2 | Test the password-reset email: sign out → Forgot password. If nothing arrives, the mailer probably sits in the locked leafletmail account and moves the same way the backup receiver did. | owner |
| 3 | Atlas → Backup tab: turn on the free daily snapshots if offered (a second line) | owner |
| 4 | Back up `C:\Users\Adi\.leaflet\config-signing-key.pem` off this PC, like the backup key | owner |
| 5 | Upload the 1.5.11 MSIX to Partner Center, if not done yet | owner |
| 6 | 1.5.12 test builds: play them on the phone and the PC (pinch-zoom on a map, Library memory, Drive reconnect, the Admin page, an announcement), then upload the MSIX to Partner Center | owner |
| 7 | 1.5.12 server deploy ([deploy-1.5.12.md](deploy-1.5.12.md)) and privacy-page update, then publish the Drive announcement | owner |
| 8 | Done by reading the code: importing an old `Leaflet/books/<sha256>.epub` fills the listed book whose file was missing (`find_by_hash`, then the `!existing.available` branch in `commands/library.rs`). No test covers that branch yet. | Claude, add a test |
| 9 | Optional: Search Console domain check, for the consent-screen logo | owner |
| 10 | Later, the owner's call: dormant-account cleanup (needs the policy text first, see deploy-1.5.12.md); free/paid tiers (not until asked) | owner |
| 11 | Play the Hollow's Front and meadow on the real phone, upright and sideways, and time a night (bound 8 ms). Never done since they shipped in 1.5.11. | owner plays, Claude measures over USB |
| 12 | The Front's wall levels count for less than aimed on brute nights (levels 3–5 add 7–9 points, aimed 10). Small tuning. | Claude |
| 13 | **The ZT Nature font licence.** The app bundles five weights (`apps/src/assets/fonts/`) with no licence file. Check that it allows bundling in a distributed app; if not, replace it before Play. | owner checks, Claude replaces if needed |
| 14 | The Play data-safety form: add the anonymous error reports and the last-used day, version and device type (1.5.12) | owner, at the first Play upload |

## 8. Lessons that cost time

- **A disabled Google client and a sign-in from another client give the same
  error** (`unauthorized_client`). The app has to remember which client made a
  sign-in to tell them apart.
- **`deploy.ps1` switches backups on only if `/etc/leaflet-backup.env`
  exists**, and otherwise says `Backups: off`. That made it easy to never
  notice. From 1.5.12 the Admin overview shows the last backup.
- **Deploy from a tag export**, because the worktree's `server/` is often
  ahead.
- **`journalctl -o cat` prints the program's lines before systemd's own.** Ask
  for a few more lines than you need, or `grep` for the program's tag.
- **"Deactivated successfully" means the service exited 0.** A failed backup
  exits 1 and shows "Failed with result 'exit-code'".
