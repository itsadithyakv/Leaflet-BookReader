# Two devices: the design for stage 0

Written 2026-10-05, before the code, as [HANDOFF.md](HANDOFF.md) asks. It is
the first stage of [mobile.md](mobile.md): what has to be true before a phone
and a laptop share a library. Where it says "exists", that is in the code
today; the rest is what stage 0 builds.

## What cannot be changed

Three versions are in readers' hands (1.0, 1.1, and 1.2 once it is out), and
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

Sign-in does not survive a restart on Android: the session token and the
Drive refresh token go through the `keyring` crate, which has no Android
store and keeps them in memory there.

- One small module, `sync/secrets.rs`: `get`, `set`, `clear` by name. The
  two call sites in `cloud.rs` and `drive.rs` use it and lose their own
  keyring code.
- Windows, macOS, Linux: the keyring, under the same service and user names
  as now, so nobody is signed out by the change.
- Android (and iOS until it has its own): a file in the app's private data
  folder, which other apps cannot read. **Stage 0 stops there.** Wrapping
  that file's key in the Android Keystore, as mobile.md asks, needs Kotlin
  and a device to try it on, and belongs to stage 1 with the rest of the
  Android shell. The private file already fixes "signed out at every
  launch"; the Keystore adds protection on a rooted or backed-up phone.

## When a sync runs

Exists: at launch, and 1.5 s after a change settles (a book closing is one).

Added, for a phone that is stopped without warning and a reader who moves
between devices:

- **Going to the background** (the page becomes hidden): a sync, if anything
  changed since the last one. Reading time counts as a change.
- **Coming back** (the page becomes visible): a sync, if the last one was
  more than two minutes ago.
- **Opening a book**: unchanged here. "Your laptop is further on" is stage
  3, and will pull first.

One run at a time, as now (`sync_lock`); a trigger that arrives during a run
waits and then finds nothing to do.

Known and left: `run_sync` refuses to start without Drive or a folder, even
when the reader is signed in to a Leaflet account. A phone with an account
and no Drive needs that changed. It is stage 3 ("without Drive the phone
still gets the shelf"), not this stage.

## The test

Two parts.

**In `cargo test`**, through the folder transport, which already has
`two_devices_converge_through_a_folder`:

- both devices read on one day, unsynced: the sum, on both, in either order
  of syncing;
- the same with a third party that behaves as 1.1 does (reads the document
  into 1.1's shapes and writes it back): the total never goes down, and the
  breakdown is whole again after the new devices' next syncs;
- merge stays the same whichever side is which, and merging twice changes
  nothing, with the new field;
- a document from a later version: applied, not written, and reported;
- a later version that does not parse: left exactly as it was.

**By hand, on two Windows accounts** (the stage's "done when"), a script in
[testing.md](testing.md): read on both in one day, edit a highlight on both,
delete on one, go offline on one, and the Drive conflict (`If-Match`) that
has never been seen to happen. It needs the installed app twice and is the
owner's to run.

## Also in this stage, and the owner's

The one-hour Drive experiment in mobile.md ("Signing in"): whether an
Android OAuth client and the Desktop one, in the same Google project, see
the same Leaflet folder under `drive.file`. It needs the owner's Google
project. Stage 3's shape depends on the answer; nothing in stage 0 does.

## Order, and where it stands

On the branch `phone/stage-0` (off `release/1.2`), 2026-10-05:

1. **Minutes per device: built.** `merge.rs` (`merge_day`, `byDevice`),
   `reading_day_devices` and `device_id` in `db/mod.rs` (schema version 5),
   `store.rs`. Ten tests, among them an old version rewriting the document
   between two newer devices.
2. **The version rule: built.** `merge::read_remote`, the three transports,
   `updateNeeded` in the report, the message in the app.
3. **`sync/secrets.rs`: built** for the desktop and the private file; the
   Android branch has never been compiled (it needs the NDK set up, which a
   phone build does). The Keystore is stage 1.
4. **Sync on leaving and returning: built** (`services/syncTiming.ts`,
   `syncOnVisibility`).
5. **The two-device script: written**, in testing.md. Not run: it is the
   owner's, on two Windows accounts.

A desktop release carries 1 to 4 (it goes out with the phone's, as mobile.md
says). None of it is in 1.2.
