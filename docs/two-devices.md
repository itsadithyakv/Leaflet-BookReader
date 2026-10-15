# Two devices: the design for stage 0

Written 2026-10-05 on the branch `phone/stage-0`; built on the branch
`android` on 2026-10-15 (ported by hand onto 1.4, see the end). It is the
first stage of [mobile.md](mobile.md): what has to be true before a phone and
a laptop share a library.

## What cannot be changed

Every version up to 1.4.2 is in readers' hands, and
what they do with the sync document is fixed for good:

1. **They never read its version.** `version: 1` has been written since 1.0
   and nothing has ever looked at it.
2. **They drop what they do not know.** The document is read into fixed
   shapes, merged, and written back whole. A field they have no name for,
   at the top or inside a day or a book, is gone from what they write.
3. **They replace what they cannot read.** A document that does not parse is
   treated as absent ("a corrupt document must not take the library down"),
   and the device publishes its own state over it. All three transports
   (`folder.rs`, `drive.rs`, `cloud.rs`) do this.

So a rule such as "an older app reads a newer document and does not write it"
can only bind apps that have the rule. Anything new has to be safe twice
over: among apps that know it, and when one of those three has rewritten the
document without it.

The test for every new field, now and later:

> If 1.1 rewrites the document without it, is anything lost for good? It is
> not, only if (a) every device can put its own part back from its own
> records, and (b) what old apps do understand is still true without it.

## Minutes per device

**The fault.** `merge_day` keeps the larger of the two devices' minutes.
Twenty minutes on the laptop and twenty on the phone, before either has
synced, is twenty: the goal is missed and the seeds are short. (Read one
after the other with a sync between, it already adds up: the second device
starts from the first's figure.)

**The rule.** A day gains one thing and loses nothing:

```json
{ "dateKey": "2026-10-05", "minutes": 40, "goalMinutes": 30,
  "byDevice": { "3f9a…": 20, "c41b…": 20 } }
```

- `minutes` keeps the meaning it has always had: the day's total as this
  device knows it. Each device adds its own reading to it, and two copies
  merge to the larger. Old apps go on reading and writing it as they do.
- `byDevice` is new: what each device itself recorded that day, by a random
  id made once per install. A device only ever raises its own figure. Two
  copies merge figure by figure, the larger of each.
- **Merged minutes are the largest of three: one side's `minutes`, the
  other's, and the sum of the merged `byDevice`.**
- Reading adds to both at once: the day's `minutes` and the device's own
  figure. So `minutes` is never below the sum.

Why it is right, and safe:

| Case | What happens |
| --- | --- |
| Two new devices read the same day, unsynced: 20 and 20 | `byDevice` {A: 20, B: 20}, sum 40. Minutes: the largest of 20, 20, 40. **40.** |
| Then A reads 5 more | A's copy: minutes 45, {A: 25, B: 20}. Sum 45. |
| An old app merges that day | It keeps the larger `minutes` (it knows no other way), adds its own reading to it, and writes the day without `byDevice`. The total it shows is the true one. |
| A new device then syncs | Its own copy still holds {A: 25, B: 20}; figure by figure the map is whole again. Minutes: the largest of its 45, the old app's figure, and the sum. Nothing went down. |
| A device is lost after an old app dropped its figure, and no other device had seen it | Its minutes are still inside `minutes`, which the old app kept. The day's total stands; only whose they were is gone. |
| Syncing twice, or in another order | Every part is "the larger of": the same answer whichever way and however often. |

It can never count a minute twice: `minutes` and the sum are each at most
what was truly read (by induction: a device adds only its own reading to
both), and the larger of two figures that do not overshoot does not
overshoot. It is never worse than today's rule, since today's result is one
of the three it takes the largest of.

Where it is only as good as today: a day an old app took part in, and the
day a device updates (what it had counted before the update is in `minutes`
with no name on it). On those days reading on two devices at the same moment
can still count once. Nothing can be done for the first without changing
what is already installed; the second is one day.

**What is not done, and why.** Minutes with no name on them are not put down
to "an unnamed device" in the map. Worked through, every way of doing that
counts some minutes twice when an old app has dropped a figure that its
device later puts back. The larger-of-three rule needs no such entry.

The goal a merged day is judged against keeps its rule (`merge_day`'s
comment), with one line of it now false on purpose: a day neither device met
alone can come out met, because together they met it. That is the fix.

One thing that rule cannot promise any more. With **different goals on
different devices** (the daily goal is a setting of the device, and a new
phone starts at the default), which goal a day is judged against can depend
on which two copies met first: three copies of 10 minutes with goals 20, 20
and 60 come out met at 20 one way round and unmet at 60 the other. The
devices still agree with each other, since each takes the document's word;
it is the answer that depends on the order. Where every copy has one goal,
or none carries figures, three copies reach the same day in any order, and
that is tested. The cure is not in the merge: it is one goal for every
device, which mobile.md already asks for ("one streak, one daily goal") and
which belongs with stage 3.

A copied database (a backup restored on a second computer) gives two devices
one id. Their figures then merge as one device's, the larger of the two:
the old rule, for those two, and never an overcount.

**Kept for ninety days.** `byDevice` is written for days in the last ninety
(the tombstones' figure, for the same reason: far past any real gap between
syncs). Older days carry `minutes` alone, as now, so the document does not
grow with a breakdown nobody will merge again.

**Locally.** A table `reading_day_devices (date_key, device_id, minutes)`
beside `reading_days`. `credit_minutes` adds to both in one statement pair;
applying a merge writes the merged map. The device's id is a random 128-bit
value in settings, made on first use. It is in the reader's own document and
nowhere else: not sent to the community server, not derived from hardware.

## The document's version

`DOC_VERSION` stays 1. Nothing above needs it raised: `byDevice` is safe
without a guard, by the test at the top.

What is added is the rule itself, so that a later change which does need it
has something to stand on:

- Before parsing, a transport reads the document's `version` alone.
- **Newer than this app knows:** the app takes what it understands from it
  (the merge is applied to this device), **writes nothing back**, and says
  so once: "This library was last saved by a newer Leaflet. Update Leaflet
  on this device to carry on syncing." What this device does meanwhile stays
  on it, and goes up after the update.
- **Newer and unreadable:** nothing is taken and nothing is written. The
  same message.
- **This version or older, and unreadable:** as now (this device's state is
  published; that is the truncated-file case the rule was written for).

When to raise the number: only for a change an app with the guard could
damage by rewriting. A field that passes the test at the top does not need
it, and should not use it, since raising it stops older guarded apps
syncing until they update.

What the guard cannot do is in the first section. If a later change cannot
pass the test, the way out is a new document under a new name, with the old
one kept as a copy for 1.0 to 1.2 to read. That was weighed for this change
and set aside: two documents on each of three transports (and a second slot
on the server) to solve what one rule in `merge_day` solves.

## Tokens on Android

Done in the first Android round, not here: `sync/device_secret.rs` keeps the
Leaflet session and the Drive refresh token in a file in the app's private
data folder on Android (the `keyring` crate has no Android store). The
Keystore comes later.

## When a sync runs

- **At launch**, and **1.5 s after a change settles** (a book closing is
  one). Existed.
- **Going to the background** (the page becomes hidden): a sync, unless one
  started in the last 30 s. Started at once, not on a timer: the page may be
  paused before a timer fires; the work is in Rust and finishes regardless.
- **Coming back** (the page becomes visible): a pull, unless one started in
  the last two minutes.
- **Opening a book**: a pull first (unless one started in the last minute),
  waited for five seconds at most, then the place rule below.

All in `services/syncTiming.ts` (`watchSyncMoments`, `pullBeforeOpen`); one
run at a time in Rust (`sync_lock`). On Android, every finished sync also
re-plans the phone's reminder alarms (`reminders::phone::request_sync`), so a
goal met on the laptop silences the phone at once.

## Two writes at once (Drive)

`sync/shared_doc.rs` owns the read-merge-write round for Drive:

1. Read `state.json` and its `headRevisionId`.
2. Merge this device in. Nothing new: nothing is written.
3. Write with `If-Match` on the revision read. A 412 (another device wrote
   since) starts the round again from the newer copy.
4. **Read back.** If what this device sent is not all in the copy now there
   (a writer that ignored the revision went over it), merge and write again.
   This covers Drive not honouring `If-Match`, which has never been seen
   either way against the real service.
5. Four rounds lost in a row: "Another device is syncing right now."

Two devices making the very first `state.json` at the same moment: both
re-list, the lowest id is everyone's, the other is deleted, and the round
runs again over the keeper (`DriveDoc::write`).

Whatever is lost from the document in a race is never lost from the device
that wrote it: each keeps its own records, and its next sync puts them back.

## Which place a book opens at

The book's row holds the place every device agrees on, and a sync moves it.
`places_here` (schema 7) keeps where this device itself last stood, written
by `update_progress` and never by a sync. On opening, after the pull:

- never read here: the agreed place, nothing offered;
- the same place, give or take a few lines: nothing offered;
- otherwise: **this device's place**, with the other offered —
  "Your other device is further on: Chapter 14 · 62%. Go there / Stay here"
  (`services/placeElsewhere.ts`, `components/sync/FurtherOnOffer.tsx`).

Opening at this device's place writes it as the newest place (as reading on
does); "Go there" moves the reader, which then saves the other.

## The test

**`cargo test --lib`**, `sync::shared_doc::tests`: two devices on one fake
Drive (no network) — read on both in one day (the sum, and syncing on never
inflates it); a highlight edited on both (the later edit on both); a book
deleted on one (gone from both, and stays gone); one offline for three days
(nothing lost either way); an older version meeting a newer document (takes
from it, writes nothing, `updateNeeded`); a write that loses a race (412,
re-merged over the winner); a write lost to a blind overwrite (caught by
reading back). Plus the folder transport's own two-device and old-version
tests, `merge.rs`'s per-device grid, and `db`'s device id and place-here
tests.

**By hand**: two real devices on one Google account; the owner's (see
android.md, "Google Drive between laptop and phone").

## Where it stands

Built on `android` (2026-10-15), ported by hand from `phone/stage-0`:
minutes per device (`merge.rs`, `reading_day_devices`, `device_id`), the
version rule (`merge::read_remote`, all three transports, `updateNeeded`),
sync on leaving and returning. New here: `shared_doc.rs` and its tests,
`places_here` and the offer, the pull before opening, Drive's sign-in on the
phone. `sync/secrets.rs` was not ported (`device_secret.rs` does its job).

**The desktop app needs this too**: a laptop on 1.4.2 merges days by the
larger figure and never reads the version. It loses nothing (the first
section), but a day read on both counts once until the laptop is updated.
Release the desktop app from this branch alongside the phone's.
