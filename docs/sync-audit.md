# Sync audit: account (MongoDB) and Drive / folder

Read-only audit of the `android` worktree (1.5.11, uncommitted), 2026-10-22.
Nothing was changed except this file. `cargo test --lib sync` (200 passed)
and `npm test` in `server/` against a throwaway local MongoDB (282 passed)
were run. The real server, the owner's account and `%APPDATA%` were not
touched.

`sync/cloud.rs`, `commands/social.rs` and `db/mod.rs` were being edited by
another agent during the audit, so their line numbers move. Each citation
names the function as well as the line.

**Since then:** the top items were fixed in 1.5.11 and the deferred ones in
1.5.12 (2026-10-23). What each finding came to, and the capacity worked out
again with both, are in [section 4](#4-after-1511-and-1512) at the end; the
sections before it are the audit as it was written.

## The four earlier fixes, checked

| Fix | Holds? | Where |
| --- | --- | --- |
| Float round-trip broke Drive read-back and made every account sync re-upload | Yes. `serde_json` has `float_roundtrip` (Cargo.toml:65). Drive compares the read-back against the body as it re-parses (`shared_doc::exchange`, `sent`). Cloud `has_news` passes through compress and decode in `a_sync_that_finds_nothing_new_sends_nothing`. | |
| Opening a book counted as a move | Yes. A move must be a move from the row and from `places_here` too. | `db::update_progress` (db/mod.rs:477) |
| UI did not re-read the library after a failed run | Yes. The `catch` in `syncNow` re-reads the books and the status. | `store/libraryStore.ts` `syncNow` |
| A disabled Google client counts as "Drive unavailable" | Yes. When signed in it is not an error; when signed out it is. Automatic runs leave Drive alone for six hours. | `commands/backup.rs` `settle`, `drive_left_alone` |

## 1. Findings, ranked

Severity order: **data loss > wrong data shown > wasted capacity > cosmetic/doc**.
Effort: S under a day, M a few days, L a week or more. "Deploy" means a
server deploy is needed.

### Data loss

| # | Finding | Scenario | Evidence | Suggested fix | Effort | Deploy |
|---|---|---|---|---|---|---|
| D1 | **Applying a sync overwrites local writes made while the run was at the network.** The run takes a snapshot, then talks to the network (the account push, or Drive's read, write and read-back), then `store::apply` writes the merged document over the rows unconditionally. Only the camp and the reading profile are re-merged with what is stored now. | Reading on the phone, the reader highlights a line. `requestBackup` starts a sync 1.5 s later. During the 1 to 10 s round trip, the heartbeat flushes up to 60 s of minutes, or a page turn saves progress. `apply` then puts the day back to the snapshot's value. `put_day` and `put_day_devices` replace the day and this device's own figure, so **those minutes are gone for good**. In the same window: a note edited is reverted; **a highlight deleted is resurrected**, because `retire_annotation_tombstones` drops the tombstone, which is not in the doc, and the next sync brings the highlight back from the server; **a book deleted is resurrected at once**: `upsert_book` writes the snapshot's live row over the new tombstone (`deleted_at = NULL`), so the book is back, with its file already gone. This contradicts two-devices.md: "never lost from the device that wrote it". | `sync/store.rs:146-256` (`write`). `db::upsert_book` :284, `put_day` :740 and `put_day_devices` :703 overwrite. `put_annotation` :987, `retire_annotation_tombstones` :1003, `purge_tombstones` :438. Snapshot then network then apply: `cloud::sync_with` (snapshot before `push`, `store::apply` after), `shared_doc::exchange` :176 → `sync` :275. Flush cadence: `hooks/useReadingHeartbeat.ts:16` (60 s). Highlight sync: `readers/useAnnotations.ts` → `scheduleSync` (1.5 s). | Inside `apply`'s transaction, re-snapshot and apply `merge(current, doc)` rather than `doc`. The merge is commutative and idempotent, so this is safe. If the result differs from `doc`, schedule another sync. Never delete a tombstone newer than the run's start. Add a test that writes between `exchange` and `apply`. | S–M | No |
| D2 | **Account over the 2 MB cap: account sync fails on every run, with no warning beforehand.** | A heavy highlighter, such as a Kindle import of thousands of clippings, passes 2 MB gzipped. Every sync then pulls, merges, uploads up to ~2.7 MB of base64, and gets 413 "Your library is too large for cloud sync", for good. The account stops carrying their reading; only Drive's bridge, if connected, still does. Simulated sizes: 10,000 highlights ≈ 1.4 MB gzip for annotations alone. A 3,000-book, 10-year, 10k-highlight library ≈ 2.7 MB. | `server/src/routes/state.js:18,101`; `http.js` `stateJson` 3 MB; `cloud::describe_failure` 413; no client pre-check in `cloud::compress`/`sync_with` | Check the size before pushing and warn from ~1.5 MB. Cap or compact the history arrays (C5). Long term, split the document into sections (C1). | S (check), M (trim) | No (S), Yes (split) |
| D3 | **Clock skew between devices decides every last-writer-wins rule.** There is no bound on device clocks anywhere. | The laptop's clock runs 20 min fast. It stamps progress, notes, Pip, the camp and collections 20 min ahead, so for 20 min the phone's genuinely later reading loses the merge: it opens at the laptop's place, and its note edits revert. **Delete vs edit:** the phone deletes a book; the laptop's earlier read, stamped "later" by its fast clock, wins `touched_at > deleted_at` and the book is undeleted everywhere. A clock far ahead also prunes tombstones early (`cutoff` from local `now`), and the server refuses the weekKey ("must be the current ISO week"), so the whole profile save fails. | `sync/merge.rs:402` (progress), :422-439 (delete vs edit), :642 (`merge_edited`), :558/:590 (pip/camp), :699 (cutoff); `db::now_iso` stamps; server `routes/social.js` weekKey check | Learn the offset from the server's `Date` header, which already arrives on every response. Stamp with corrected time, and treat stamps more than ~5 min in the future as "now" when merging. | M | No |
| D4 | **Automatic metadata lookups undo deletions.** A book's `touched_at` includes `metadata_updated_at`, and `update_metadata` stamps it `now` on every lookup. | The book is deleted on the phone. The laptop opens (`loadBooks` → `refreshMissingMetadata`, before or beside the launch sync) and looks up that book, which lacks a cover or author. Its stamp is now later than `deleted_at`, so the merge undeletes it on every device. By then the phone has deleted its file, and Drive's copy too (`may_delete`). `retitle` (`scanSeries` at load) does the same. | `merge.rs:87` (`touched_at`), :424-437; `db::update_metadata` :333-344; `store/libraryStore.ts` `loadBooks` → `refreshMissingMetadata` | Let only a reader's act undo a deletion: re-import (stamp `created_at`/an `imported_at`), progress, series edit. A lookup must not; or keep a separate `edited_at` for the deletion test. | S | No |
| D5 | **Server: deleting an account can leave its sync document behind.** `deleteAccount` deletes `states` before it ends the sessions. `requireAccount` never checks that the account exists, and a `PUT /state` with version 0 inserts a document. | Device B's sync is in flight while the reader deletes the account on device A. B's push loses (409, version 0). Its retry lands after `states.deleteOne` but before `endSessionsOf`, and inserts a fresh `states` doc. The reading history then outlives the deletion, which matters for privacy. The window is narrow (ms), but `deleteCommunityData` runs first and can be slow. | `server/src/deletion.js:41-61`; `routes/state.js:108-118`; `auth.js:109-131` | End the sessions first, or delete `states` again as the last step, or refuse an insert for an account that is gone. | S | Yes |

### Wrong data shown

| # | Finding | Scenario | Evidence | Suggested fix | Effort | Deploy |
|---|---|---|---|---|---|---|
| W1 | **Drive or folder "Claim" silently merges an unowned `state.json`, while the account path asks first.** For the account, a fresh library asks "Use it / Start empty" before taking an unowned copy (`asks_before_taking`). For Drive or a folder, a signed-in device with an unowned store just claims and merges it. | A new account, a fresh library, and a Google account shared with a family member whose pre-1.5.3 Leaflet wrote `state.json`. Their books, minutes and highlights merge into this library. Step (c) pushes them to the account, and the store is stamped as this account's. | `sync/owner.rs:215` (`store_mode`: signed in, remote `None` → `Claim`); `commands/backup.rs` `execute` (b) and (c); compare `cloud::asks_before_taking` | Use the same question for a fresh library meeting an unowned store with books or days in it; or treat it as `FilesOnly` until the reader answers. | M | No |
| W2 | **"Start empty" does not stick.** It writes an empty document with no tombstones, and the merge is a union. | The reader picks "Start empty". Any other device of the account that still holds the old library merges it all back at its next sync. That includes an old Leaflet on Drive through the bridge, which is exactly the case the question exists for. The UI says it "cannot be undone"; in fact it is undone. | `cloud::replace_with_empty_on`; `commands/backup.rs:734` (`library_fresh_answer`) | Write tombstones for every live book, highlight and collection of the replaced copy, or a reset stamp (as `ReadingProfile.resetAt` does) that drops entries from before it. | M | No |
| W3 | **After an account is deleted, the library is re-claimed by the dead account.** `delete_account` releases the owner on this device only. Drive's `state.json` and its mark, and the folder's `.leaflet-owner`, still carry the old tag. | The account is deleted on the laptop. The next sync, now signed out, is an `Exchange`: local owner `None`, store `T`. `apply` → `claim_if_unowned(T)`, and the library belongs to a deleted account again. Signing up a new account then gives `Standing::Other`: sync paused, nothing published, "start a fresh library?". Other devices get a 401, sign out, and keep the owner `T`, so the same follows. | `cloud::delete_account`; `owner.rs:86` (`release_if`); `store.rs:258-262`; `owner::store_mode` | On deletion, rewrite the Drive and folder mark and the doc owner, or keep a list of released tags that a new account may claim over. Have the other devices learn of it on their 401. | M | No |
| W4 | **Profile figures (for the agent fixing them).** Root causes found: (a) every device writes the one profile and the server keeps the last save, so an unsynced device publishes stale figures (the fix under way: `figures_current` / `AccountMerged`); (b) `weekMinutes` is summed over the publishing device's **local** ledger and **local** ISO week, so a wrong clock or time zone shifts it, and D1 loses minutes from it; (c) "Finished" counts `progress >= 0.99` as finished, and `delete_book` back-dates `finished_at` for any book at ≥ 0.99, so two devices count differently until their rows agree (a book on its last page on one, at 98 % on the other); (d) the 6 h resend window means a profile overwritten by another device is not corrected while this device's figures stay unchanged. | 89 % vs 99 %, wrong "This week", Finished 2 vs 1 | `commands/social.rs` `build_profile_update`, `has_finished`; `db::delete_book` :418; `constants/books.ts:22` | Owned by the other agent. | — | — |
| W5 | **Shared-library fingerprint is not per account and never expires.** | Restore the server from a backup, or sign a new account into the same library: the library is not re-sent until it changes. The profile has a 6 h resend; the library has none. | `commands/friends.rs:204-228` | Key it by account and add the same 6 h resend. | S | No |
| W6 | **A partial failure ends the run early.** A Drive or folder state error returns at once (`?`), so the files half, step (c) (pushing what the stores brought to the account) and the adoption claim are all skipped, and a failing folder stops Drive from running. | The folder brings news, then Drive's state half fails: the news reaches the account only at the next run. | `commands/backup.rs:481,538` | Collect the error as `cloud_error` is collected and carry on to the next carrier. | S | No |
| W7 | **Unverified: Drive's `If-Match`.** If Drive v3 ignores `If-Match` on media uploads, a write over another device's write is caught only by *that* device's read-back. Ours passes. Nothing is lost for good (each device re-merges its own records next time), but a gap of one sync is possible. | — | `drive.rs:1006-1062`; `shared_doc.rs:214-233` | Test it against real Drive once (two writes with the same revision). | S | No |

### Wasted capacity (MongoDB free tier)

| # | Finding | Evidence | Suggested fix | Effort | Deploy |
|---|---|---|---|---|---|
| C1 | **The whole document goes up on every change.** One highlight, one book closed, or one trip to the background sends the full gzip blob: 30 KB typical, 520 KB heavy (§2). For heavy readers this is the first free-tier limit (transfer **into** Atlas). | `cloud::sync_with` → `compress(&merged)` → `PUT /state`; `routes/state.js:120` | (1) Push less often: while a book is open, highlights and notes wait for close or hide, or ≥ 5 min (keep the pull before opening). (2) Split the document into sections (books, days, annotations by book, sessions, pip/camp), each with its own version and `?have=`, and push only the sections that changed. | S (1); L (2) | No (1); Yes (2) |
| C2 | **The 409 body is thrown away.** The server answers a conflict with the whole current document. The client ignores it, forgets its copy, and fetches the whole document again. | `routes/state.js:127-133`; `cloud::Server::push` (returns `Conflict` without reading the body); the `Pushed::Conflict` branch in `sync_with` | Parse the 409 body as a `Pulled` and merge over it. That halves the cost of a conflict. Or send only `{version}` in the 409 and keep the refetch. | S | No (or Yes for the server-side version) |
| C3 | **The public board's cache is cleared on every profile save that changes anything,** and each reload counts every public profile. The count's filter includes `handle: {$type: "string"}`, which the `leaderboard` index cannot answer alone, so it probably fetches every public profile (each up to ~4 KB with a camp). With a few hundred readers publishing every 5 min the cache never survives. The README already measures the board at a third of the transfer out. | `routes/social.js` `forgetBoards()` in the save; `routes/community.js:148-170`; `boardCache.js` | Keep the board on its 30–60 s TTL only, without clearing it per save (a reader's own row is already patched in). Cache `sharedReaders` for 10 min. Check the count with `explain()` (`scripts/load.mjs --plans`). | S | Yes |
| C4 | **Unbounded arrays.** `sessions`, `annotations` (with their text), `purchases`, `plantings`, `harvests`, `days` and finished-book tombstones are kept for good. The document only grows, about 25–30 KB a year for a modest reader and far more for a heavy one, so both storage and every push grow with it. | `sync/merge.rs:683-780` (only unfinished-book, annotation and collection tombstones are pruned, at 90 days) | Compact old history: sessions older than a year folded into day totals; purchases and harvests folded into a seed-balance checkpoint. Check against the old-app rule in two-devices.md, since an old app would re-add what was folded. | M | No |
| C5 | **Every device fetches the whole document once a day** (`STATE_COPY_TRUSTED_SECS`), and after every write by another device. Small next to C1. | `cloud.rs` `STATE_COPY_TRUSTED_SECS` | Keep a content hash with the version (server-side), so a server restore cannot alias the version, and drop the daily refetch. | S | Yes |
| C6 | **No TTL for dormant readers.** The `states`, `profiles` and `libraries` of an account unused for years count against 512 MB for good. | `server/src/db.js` (no TTL on those three) | Product decision. For example, after 18 months with no session, email the reader, then delete. | M | Yes |
| C7 | **Problem reports** can hold 1,000 open reports × ~66 KB ≈ 66 MB (13 % of the cluster), plus closed ones for 90 days. | `routes/problems.js:33-37,170` | Cap open reports by total bytes as well (e.g. 20 MB), or keep the diagnostics for 30 days. | S | Yes |
| C8 | **Profile save `$set`s the whole camp layout** (~3 KB) whenever any figure moved, though the server has just read the held camp. | `routes/social.js` `findOneAndUpdate` with `changes` | Drop from `changes` every field equal to `held`. | S | Yes |
| C9 | **No client backoff on 429/503 for account calls.** `Retry-After` is ignored, and sync is event-driven, so the next trigger simply tries again. Three conflict retries run back to back, each a full GET and PUT. | `cloud::describe_failure`; `sync_with` retry loop | Honour `Retry-After`; add 0.5–2 s of jitter between conflict retries. | S | No |

### Cosmetic / docs that contradict the code

| # | Says | Code does | Where |
|---|---|---|---|
| X1 | two-devices.md: what is lost in a race "is never lost from the device that wrote it" | Not while D1 stands | docs/two-devices.md, "Two writes at once" |
| X2 | two-devices.md: "Coming back … a pull" | A full run: pull, push and publish (`syncFor` → `syncNow`) | `services/syncTiming.ts:113` |
| X3 | state.js: with `?have=` "the document itself is not even read from the database" | mongod still loads the whole document to evaluate the `$cond` projection. Only the transfer (and the VM's memory) is saved, which is still the point for the free tier. | `routes/state.js:55-63` |
| X4 | server README "Storage": the sync document is "15 KB for the two in five who back their reading up", "about 15 KB a year" | Since 1.5.3 **every** signed-in reader's state goes to the account. A modest year simulates at ~30 KB; heavy use at ~0.5 MB. The load script uses random 15 KB blobs. | server/README.md "Capacity"; `scripts/load.mjs:247,360` |
| X5 | server README "Transfer": only data **out** of Atlas is counted | State uploads (data **in**, its own 10 GB a week) are the larger direction for heavy readers (§2) | server/README.md |
| X6 | README and HANDOFF: the Atlas limits are "from memory and want checking" | Now checked: they match MongoDB's page (§2) | docs/HANDOFF.md ~line 310 |
| X7 | backups.md, deploy.md: "Atlas's free tier keeps none of its own [backups]" | MongoDB's page now says free clusters can enable backups: a daily snapshot, up to four kept | docs/backups.md:3, docs/deploy.md:272 |

## 2. MongoDB Atlas free tier: limits and what Leaflet uses

### The limits

Source: MongoDB's own page, <https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/>,
read 2026-10-22 ("Free clusters, formerly M0"), and
<https://www.mongodb.com/docs/manual/reference/limits/>.

| Limit | Value |
|---|---|
| Storage | **0.5 GB**, counted as *uncompressed BSON* of all documents **plus indexes**. Not expandable. |
| Operations | **100 reads and writes a second** |
| Connections | **500** |
| Transfer | **10 GB in and 10 GB out per rolling 7 days** (≈ 1.43 GB a day each way) |
| When exceeded (ops or transfer) | Network throttled; a 1-second cooldown per connection; operations queue and can wait over a second |
| Query time | Running queries must take under 100 % of any 5-minute window |
| Document size | 16 MiB (all MongoDB); Leaflet's own cap is 2 MB |
| Other | 100 databases, 500 collections, 64 indexes a collection, 32 MB in-memory sort, `allowDiskUse` ignored, paused after 30 days with no connections |

### What each reader stores

Sizes come from the code's own shapes, simulated with realistic fields: SHA-256
ids, RFC 3339 timestamps with nanoseconds, CFIs and highlight text, gzip -9
as `cloud::compress` does. Profile, library and community figures are from
the README's own measurements.

| Document | New (5 books, 1 month) | Typical (50 books, 1 yr, 2 devices, 60 sessions, 30 highlights) | Heavy (500 books, 3 yrs, 3 devices, 800 sessions, 2,000 highlights) |
|---|---|---|---|
| `states` (gzip blob; BSON counts its bytes) | 3.6 KB | **30 KB** | **520 KB** (annotations 275, sessions 91, books 66) |
| `profiles` (with camp) | 1 KB | 3.6 KB | 4–5 KB |
| `libraries` (if shared) | 1 KB | 7 KB | 70 KB |
| `accounts` + `sessions` | 0.6 KB | 0.9 KB | 1.2 KB |
| Community (events, kudos, raids, gifts; mostly TTL) | 2 KB | 11 KB | 15 KB |
| Index entries | 0.3 KB | 0.5 KB | 1 KB |
| **Total** | ~9 KB | **~53 KB** | **~610 KB** |

Base64 adds a third on the wire between the app and the VM. Between the VM
and Atlas it is stored and sent as BSON `Binary`, the gzip bytes alone.
Atlas's zlib wire compression does nothing for an already-gzipped blob.

### What a sync costs

| Step | Atlas operations | Bytes between the VM and Atlas |
|---|---|---|
| `GET /state?have=N`, unchanged | 1 read (+1 session lookup a minute, +1 write an hour) | ~0.2 KB out |
| `GET /state`, changed (another device wrote, or the daily refetch) | 1 read | the document, out |
| `PUT /state` (only when `has_news`) | 1 write | the document, **in** |
| 409 conflict | 1 write attempt + 1 full read, then the client's own full GET | the document, out, **twice** (C2) |
| Publish after the sync (≥ 5 min apart, skipped when the fingerprint is unchanged and < 6 h old) | 2 reads + 1 `findOneAndUpdate` (+2 `updateMany` on duels if minutes moved) | ~4 KB out, ~3 KB in |

**How often a sync runs:**

- at launch;
- 1.5 s after any change settles: a book closed, each highlight or note, imports, deletes, a series edit, a metadata refresh;
- when the app is hidden, if 30 s have passed since the last;
- when it comes back, after 2 min;
- before a book opens, after 1 min.

Publishes run every 5 min while reading, at the end of a session, and on the
pulse (10 min), each only when something moved. The pulse also asks for the
inbox (7 ops), the board of readers followed, and gifts.

**Assumed day:**

- **Typical:** 30 min reading a day, the app open ~1.5 h, ~15 syncs of which ~8 push, ~3 full pulls.
- **Heavy:** 2 h reading, the app open ~4 h, 3 devices, ~20 highlights a day, ~30 pushes, ~8 full pulls.

### Bytes and operations per reader per day

| | Typical | Heavy |
|---|---|---|
| State **in** (pushes × doc) | 8 × 30 KB ≈ **0.24 MB** | 30 × 520 KB ≈ **15.6 MB** |
| State **out** (full pulls × doc) | 3 × 30 KB ≈ 0.09 MB | 8 × 520 KB ≈ 4.2 MB |
| Profile, board, inbox, pulse out (README: 0.48 MB per open app-hour) | ≈ 0.72 MB | ≈ 1.9 MB |
| Profile and other in | ≈ 0.04 MB | ≈ 0.1 MB |
| **Total in / out** | **≈ 0.28 / 0.81 MB** | **≈ 15.7 / 6.1 MB** |
| Atlas operations | ≈ 200 (pulses ~150, syncs ~25, publishes ~25) | ≈ 600–800 |

### How many readers fit, and which limit hits first

| Limit | All typical | All heavy | 90 % typical + 10 % heavy |
|---|---|---|---|
| **Transfer in** (1.43 GB/day) | ~5,100 daily readers | **~90** | **~790** |
| **Transfer out** (1.43 GB/day) | **~1,800** | ~235 | ~1,075 |
| **Operations** (100/s; README: ~0.1 op/s per open app → ~1,000 apps open at once; at ~0.19 × daily readers open at the evening peak) | ~5,300 | ~2,000 | ~4,800 |
| **Storage** (512 MB, every account, active or not) | ~9,600 accounts | ~840 accounts | ~4,700 accounts |
| Connections (16 per server process) | not a limit | not a limit | not a limit |
| Document size (16 MiB) | not a limit; Leaflet's 2 MB cap hits first (D2) | | |

**What gives first:**

- With only light readers, the weekly **transfer out**: the board, own-profile reads and the inbox polling the README measured. That comes at ~1,800 daily readers.
- With even 1 in 10 readers heavy, the weekly **transfer in** comes first, at ~800 daily readers, almost all of it whole-document uploads from the heavy tenth.
- **Storage** is next, and it shrinks over time: every document only grows (C4), and dormant accounts stay (C6).
- Operations and connections are further off.

The README's "~380 readers at eight hours a day" counts only the out
direction with 15 KB states, so it is right for light readers and optimistic
for a mix.

### What wastes the most, largest first

1. **Whole-document pushes (C1):** ~95 % of a heavy reader's transfer in, and one highlight costs the whole document.
2. **The board's cache cleared on every save, and the public count (C3):** about a third of transfer out (README), plus a scan of the public profiles.
3. **Unbounded history (C4) and no dormant TTL (C6):** storage, and they make C1 worse every month.
4. **A 409 transfers the document twice (C2)**, and every device refetches once a day (C5).
5. Small ones: the camp re-sent in every changed save (C8), problem reports (C7).

### Optimisations ranked by capacity gained for the effort

| Rank | Change | Gain | Effort | Deploy |
|---|---|---|---|---|
| 1 | **Coalesce pushes while reading** (highlights and notes wait for close, hide or ≥ 5 min; the pull before opening stays) | Heavy readers' transfer in ÷3 to ÷5; the mixed-population ceiling ~790 → ~2,500 daily readers | S | No |
| 2 | **Board cache on TTL only, `sharedReaders` cached** (C3) | Up to a third of transfer out, and the count scan | S | Yes |
| 3 | **Use the 409 body** (C2), honour `Retry-After` and jitter (C9) | Conflicts at half price; no lockstep retries | S | No |
| 4 | **Size check and warning at 1.5 MB** (D2) | No reader silently stops syncing | S | No |
| 5 | **Drop unchanged fields from the profile `$set`** (C8); cap problem-report bytes (C7) | Small transfer in; up to 66 MB storage | S | Yes |
| 6 | **Compact history** (C4) | Docs stop growing ~linearly; heavy docs −30 to −50 % | M | No |
| 7 | **Sectioned state with per-section versions** (C1(2)) | A push becomes the changed section: typical 30 → ~5 KB, heavy 520 → 10–70 KB. Transfer in ÷5 to ÷10 | L | Yes |
| 8 | **Dormant-account TTL** (C6) | Storage back from readers who left | M | Yes |
| 9 | **Drop the daily refetch, using a content hash** (C5) | A full pull per device per day | S | Yes |

## 3. Do these five first

1. **D1, re-merge inside `apply`.** It is the one real data-loss bug that happens in normal use: minutes, note edits, and deleted highlights or books coming back, whenever a sync overlaps reading. Small, client only, with a clear test.
2. **Coalesce pushes while a book is open (C1 step 1).** The largest capacity gain for the least work, and a shorter apply window as a side effect.
3. **D4 and D3: stop automatic stamps from undoing deletions, and clamp future stamps** using the server's `Date` header. Together they end the "deleted book came back" class.
4. **W1 and W3: owner edge cases.** Ask before Claim merges an unowned Drive or folder, and clear the dead tag after an account is deleted. Both put the wrong library in front of a reader, or lock them out of sync.
5. **The server batch, one deploy:**
   - the board cache on TTL only (C3);
   - deletion ends sessions or re-deletes `states` (D5);
   - drop unchanged profile fields (C8);
   - cap problem-report bytes (C7).

   Then the client's size warning (D2).

## 4. After 1.5.11 and 1.5.12

### What each finding came to

| # | Status | Where |
|---|---|---|
| D1 | Fixed in 1.5.11: `apply` merges with the rows as they are now, inside its transaction. | `sync/store.rs` `apply` |
| D2 | Warned in 1.5.11 (from 1.6 MB, not sent past 2 MB). The document still grows (C4 below). | `cloud::sync_with` |
| D3 | Fixed in 1.5.11: stamps bounded to the server's (or Google's) clock. | `sync/clock.rs`, `merge::bounded` |
| D4 | Fixed in 1.5.11: only the reader's acts undo a removal. | `BookEntry::revived_at` |
| D5 | Fixed in 1.5.11 (server). | `deletion.js`, `routes/state.js` |
| W1, W3 | Fixed in 1.5.11. | `owner.rs`, `shared_doc.rs` |
| **W2** | **1.5.12**: "Start empty" writes a removal, stamped now, of every book, bookmark, highlight and collection the account held that this library does not have (`cloud::emptied`); removals carry no titles or words, and a book removed so is not counted as finished. A device that still holds the old library loses it at its next sync instead of merging it back. Not covered: reading days, focus sessions, Pip's purchases, plantings and harvests (union or larger-of merges, with no removal in the document), and Pip's look, camp and pace (newest wins); and a device offline longer than the removals are kept (90 days). | `sync/cloud.rs` `emptied`, `replace_with_empty_on` |
| W4 | The other agent's (1.5.11). | |
| **W5** | **1.5.12**: the library sent is remembered per account and sent again six hours on, as the figures are; the server keeps a hash and does not write the same list again. | `commands/friends.rs` `library_due_at`, `library_current`; `server/src/routes/library.js` |
| **W6** | **1.5.12**: a store whose state or files fail is noted and the run goes on: the next store runs, what it brought reaches the account, the claim is made, the others' files move; the run then reports the account's error, else the first store's. | `commands/backup.rs` `execute` |
| **W7** | **1.5.12**, as far as it goes without a real Drive: a test that the write names the revision read (`If-Match`) as a media upload; and a guard in case Drive ignores it: after a write, the revisions between the one read and the one there now are fetched from the file's history, and merged in and written again if they hold anything the write lacked (`DocStore::written_between`). Whether Drive honours `If-Match`, and whether its revision list shows every write a few seconds apart, are still untried on real Drive; a history that cannot be read is passed over, leaving the gap of one sync the audit found. | `sync/drive.rs` `write_over`, `written_between`, `revisions_between`; `sync/shared_doc.rs` `exchange` |
| C1 (1) | Done in 1.5.11: highlights and notes wait while a book is open. (2), sectioned documents: not done. | `services/pushHold.ts` |
| C2, C5, C9 | Not done. | |
| C3, C7, C8 | Done in 1.5.11 (server). | |
| **C4** | **1.5.12**, in part (below). | `merge::compact` |
| **C6** | **1.5.12**: built, off by default. | `server/src/dormant.js`, [deploy-1.5.12.md](deploy-1.5.12.md) |
| **Profile saves** | **1.5.12**: the app sends only the figures that moved since it last sent them to this account (the week's minutes with their week), and all of them six hours after the last whole send, when forced, or for another account. The server reads only the figures a save names, and asks back only what another request may have changed. A minute's save: 4,362 bytes from the database before, 617 after (`node scripts/load.mjs`). Server and app agree: every server since before 1.5.10 takes any figure alone; a 1.5.12 server answers a save naming all figures, or none, in full, as older apps expect. | `commands/social.rs` `profile_to_send`; `server/src/routes/social.js` `heldViewFor` |

### C4: what could be trimmed, and what could not

All the trimming rules are now one function, `merge::compact`, which every
merge ends with, and `has_news` holds the store's copy to it. So a copy that
differs only by detail the merge let go is no news: trimming alone never
sends a whole document, and an older app that has not trimmed cannot set two
devices sending it back and forth. Each rule looks at one entry and the day,
so a device that has trimmed and one that has not merge to the same document
(tested both ways, with news on each side).

| Detail | Rule | Since |
|---|---|---|
| Per-device minutes of a day (`by_device`) | folded into the day's total after 90 days | 1.5.7 (moved into `compact`) |
| A removed book (not finished), bookmark, highlight, collection | gone after 90 days | before 1.5 (moved) |
| A removed highlight's words | not kept in the removal | 1.5.11 (at deletion) |
| A removed, finished book | kept for good (the finished count goes by it), now without its place in the book after 90 days | 1.5.12 |

That is all that could go without dropping meaning. Measured on a simulated
heavy document (`what_compacting_saves_on_a_heavy_document`, ignored test):
the places of 300 old finished books are about 1.7 KB of gzip. The rest of
what grows is what the app reads:

- **Reading days**: the streak, the calendar, the stats and the goal bonuses
  are worked out from them. A day is about 15 bytes of gzip; kept.
- **Focus sessions, purchases, plantings, harvests**: Pip's seeds, garden and
  rewards are replayed from every one of them on every device
  (`habit::seeds::count_minutes` orders sessions by their end, takes their
  minutes from each day's pool, and pours water at their end time), and the
  badges and earned skins (`pip::earned`, sittings per book), the shelf and
  the diaries read them session by session. Folded into daily totals, a new
  device would grow a different garden and a different seed balance from the
  same reading. Folding them needs a checkpoint in the economy itself (the
  seeds, water and rewards a device has replayed up to a day, kept in the
  document and agreed between devices), which is Pip's code, outside this
  work. Proposal for later: a `ledgerCheckpoint {before: date, seeds, water,
  sessionsDone, longestFocus, sittingsByBook}` written once a session is more
  than a year old, with `ledger_from` starting from it; sessions before it
  then fold into daily totals, purchases into owned items and a balance.
- **Live highlights and notes**: the reader's own words.

So the document still grows at about 25 to 30 KB a year for a modest reader,
and mostly with highlights for a heavy one. Dormant accounts (C6, when the
owner switches it on) are what take storage back.

### Capacity, worked out again

What changed in the model, and from where:

| | Typical | Heavy | Source |
|---|---|---|---|
| Pushes a day | 8 → **7** | 30 → **~8** | 1.5.11 holds highlights and notes while a book is open (the audit's ÷3 to ÷5; ÷4 taken). Not measured on a real library. |
| Full pulls a day | 3 | 8 → **~5** | fewer pushes by the other devices |
| Document | 30 KB | 520 KB (−2 KB) | `compact`: next to nothing |
| Out, besides the state, an open app-hour | 0.48 → **0.34 MB** | same | `scripts/load.mjs`, 200 apps, this machine: 0.47 (1.5.10's app), 0.41 (1.5.11's), 0.34 (1.5.12's). The board's half-minute cache is not counted in it (the script prices each kind of request once), so this is the high side. |
| In, besides the state | 0.04 MB | 0.10 MB | the camp no longer in every save (1.5.11); a library resent unchanged is not written (1.5.12) |

Per reader per day:

| | Typical | Heavy |
|---|---|---|
| State in | 7 × 30 KB ≈ 0.21 MB | 8 × 515 KB ≈ 4.1 MB |
| State out | 3 × 30 KB ≈ 0.09 MB | 5 × 515 KB ≈ 2.6 MB |
| Other out | 1.5 h × 0.34 ≈ 0.51 MB | 4 h × 0.34 ≈ 1.4 MB |
| Other in | ≈ 0.03 MB | ≈ 0.1 MB |
| **Total in / out** | **≈ 0.24 / 0.60 MB** (was 0.28 / 0.81) | **≈ 4.2 / 4.0 MB** (was 15.7 / 6.1) |

How many daily readers fit:

| Limit | All typical | All heavy | 90 % typical + 10 % heavy |
|---|---|---|---|
| **Transfer in** (1.43 GB/day) | ~6,000 (was 5,100) | ~340 (was 90) | ~2,200 (was **790**) |
| **Transfer out** (1.43 GB/day) | **~2,400** (was 1,800) | ~360 (was 235) | **~1,500** (was 1,075) |
| **Operations** (100/s) | ~6,600 (was 5,300) | ~2,500 (was 2,000) | ~6,000 (was 4,800) |
| **Storage** (512 MB) | ~9,600 accounts | ~840 accounts | ~4,700 accounts |
| Storage, dormant accounts on | ~9,600 used in the last 14 months, plus ~5 KB for each one cleared | ~840 likewise | ~4,700 likewise |

Operations: the load script's 1.5.12 run made 16 a second for 200 open apps
(0.08 an app, against the README's 0.1), with no request at all for a
publish with nothing new.

**What gives first now:**

- With one reader in ten heavy, the weekly **transfer out**, at about 1,500
  daily readers (was transfer in, at about 800): the pulse, the inbox and
  the board, and the heavy tenth's full pulls. Then transfer in at about
  2,200.
- With only light readers, still transfer out, at about 2,400.
- With only heavy readers, transfer in and out together, at about 350: the
  whole-document pushes and pulls. Sectioned documents (C1 (2)) are what
  moves that.
- Then storage, which still only grows unless dormant accounts are switched
  on; then operations.

Not counted, and each would move the out figures further: the board's
half-minute cache (one board read per half minute for the whole server
instead of per request), C2 (a 409 still fetches the document twice), C5
(every device still fetches the whole document once a day).

## What could not be verified

- **Whether Atlas counts wire-compressed bytes** against the 10 GB a week. It does not matter for the gzipped state blob, but it could halve the profile and board figures. Only the cluster's Network chart can tell (the README says the same).
- **The traffic figures are a model, not a measurement.** Real document sizes and sync counts were not read from the live server or any real library, by the rules of this audit. The document sizes are simulated from the code's shapes; real prose highlights may compress a little better or worse. Syncs and pushes a day are estimated from the triggers in the code. The ops and transfer-out per open app are the README's 2026-10-13 and 2026-10-17 local measurements, not Atlas's.
- **Whether Drive v3 honours `If-Match` on media uploads** (W7). The code's own docs say the same.
- **Whether the public-profile `countDocuments` really fetches every document** (C3). `explain()` was not run; `scripts/load.mjs --plans` would show it.
- **D1 has not been reproduced** on a device. It follows from the code (apply writes rows unconditionally after an await), and no test covers a write between the network step and `apply`.
- **The D5 orphan-state race** is from reading the code; there is no reproduction.
- **Folder sync on a cloud-synced folder** (Dropbox, OneDrive): the lock file does not lock across devices, and conflict copies were not examined.
- **Profile figures (W4)** were only traced to likely causes; the fix belongs to the other agent.
