# Your reading, made visible: meadow and arrival (design, agreed for 1.5.11 after The Front)

> **Kept 2026-10-23:** copied from a session's temporary notes, written
> 2026-10-21. **All four parts were built and shipped in 1.5.11:**
> - pages up the path: `arrival.ts`;
> - book blooms: `trophies.ts`, `base-art.js`;
> - Reading Stones: `stones.ts`;
> - fondness: `fondness.ts`.
>
> What is still open is in [pip.md](../../pip.md), "The Hollow".

Coordinator decisions: all four parts ship in 1.5.11, built after The Front in the order D, A, B, C. No server or Rust changes. Cite code by symbol: rules.ts has moved under The Front.

The meadow's one purpose: it holds the record of your reading (blooms, stones) and is the animals' home. It is never attacked and never part of the Front.

Dropped:
- Animals with jobs on the Front: it blurs scouts, heroes and guardians, and the planner would cost more.
- Genre or streak animals: heroes already come from genres, and streaks reward logging in daily.
- The meadow as a night shelter: nothing is attacked there.
- A live friend meadow: the server never stores books.
- Size by book length: there is no page count.
- Scaffold progress: buildings stand at once since 1.5.8.

## D. Arrival: pages up the path (build first)
- When you open the camp after reading, Δ = minutes − `seenAt`.
  - Δ < 5: no pages; the chapter bar just steps to its new fill.
  - Otherwise pages = min(6, 1 + ⌊Δ/15⌋), capped at 3 on lite and 0 on minimal or reduced motion.
- Pages are an 8×7 sprite with 2 flutter frames at 8 fps (a whole-sprite swap). They set off 75 ms apart from the back of the parcel path (the burrow's x, y 56) via `sceneToClient`. Each flies 700 ms on `trailPoint`'s arc, rounded to device px, to `oakAcornAt`, and becomes an acorn for 150 ms.
- The oak's waiting acorn stays hidden (`arriving` extra) until the first page lands.
- Peel-offs from 300 ms:
  - one page to the Raid key if `raidsReady` rose (`bumpCount`);
  - one to the meadow arrow if the meadow is open and the bud stage rose.
- About 1100 ms: one page goes from the oak to the chapter bar. The fill steps in whole px from `fillOf(before)` to `fillOf(after)` over 500 ms. If a chapter was crossed, the bar fills, resets, and then the chapter card opens: it waits for the arrival or its skip.
- Total about 2.0 s (2.6 s with a crossing). Sound: a soft `swish`, then `acornsSound`.
- It plays only when the camp area is showing, there is no tour, no sheet or battle is open, and the page is visible.
- `seenAt` = minutes is set when the arrival starts, so it never replays.
- Any pointerdown (capture listener) skips to the final state, and the tap still reaches its target.
- "Before" values come from `seenAt`:
  - `oakReady(state, max(seenAt, oakFrom))`;
  - `raidsReady(state, seenAt)`;
  - `chapterProgress(null, seenAt)`;
  - `budStage(trophyBudget(state, seenAt))`.
- Numbers only behind a tap: the chapter card gets a "Since you were last here" block with icon rows:
  - minutes read;
  - oak +N waiting;
  - scouts +N rested · next in m;
  - h m to the next chapter;
  - m to your next bloom.
  
  A screen-reader live line says the same.
- On lite, only transform and opacity animate on ≤ 5 DOM nodes; the canvas repaints only for the oak acorn.
- Data: `seenAt` (default `state.minutes`, clamped ≤ minutes), mirrored in the `md:` taught mark (see C).
- Files:
  - new `arrival.ts`, pure: `arrivalOf`, `pagesFor`, timings;
  - `collect.tsx`: a PageTrails sibling of AcornTrails;
  - `HollowTop.tsx` (`fillFrom`);
  - `ChapterCard.tsx`, `hollowRules.ts`;
  - `BaseScreen.tsx` (orchestration, skip, delayed card);
  - `scene.ts` (`arriving`);
  - `rules.ts` (`seenAt`, `seeArrival`);
  - `baseStore.ts`;
  - `base-art.js` (page sprite);
  - `hollow.css` (new `.pip-page-trail` block).
- Tests:
  - page counts per tier;
  - each peel-off only when its value rose;
  - chapter crossing, including into volumes;
  - `seeArrival` idempotent;
  - defaults;
  - the bar ends at `fillOf(to)`;
  - trail points land on whole px.

## A. Book blooms on the Reading Path
- A worn path winds through the meadow along (0,94) → (36,90) → (78,96) → (118,88) → (148,80) → (170,74). Spots every 7 px, ±6 px either side, give 48. The bud sits at (174,76).
- Each trophy (in `raised` order, looked up by `trophyKey` among finished books) is a 9×10 bloom by `trophyKind(genres)`. There are 11 original kinds:

  | Kind | Bloom |
  |---|---|
  | Books | pagewort |
  | Fantasy | wizard's foxglove |
  | Science fiction | star thistle |
  | Mystery | lamplily |
  | Romance | heartsease |
  | Horror | bonecup |
  | History | old rose |
  | Science | sundial daisy |
  | Classics | laurel sprig |
  | Adventure | compass bloom |
  | Young readers | kite flower |

  A book no longer in the library gets kind 0 and "A book you finished". The newest is nearest the stones. Older ones beyond 48 go wild: 3×4 flowers in 2 rows at y 57/61, x 8–160, at most 100 drawn.
- **The bud is your next bloom.** It has 4 whole-sprite stages by `trophyBudget` (<30 / <60 / <90 / ≥90 m). When the camp raises a trophy, the bud opens on the next meadow visit (a burst, session-local by `raised.length`).
- Taps:
  - a bloom shows the say line with its title, author and date;
  - the bud shows "Your next bloom · 48 m more reading";
  - the wild band shows "142 older books bloom wild here" and opens the list.
- New Blooms tile in the meadow dock (HollowDock), opening a list of 30 at a time. One-time tip `blooms`. A guide page "The meadow". The postcard takes `area`, so a meadow postcard is possible.
- There is no new stored data: blooms are derived from `raised` and the library.
- Drawn once into a cached offscreen layer (240×120). It is rebuilt only when the list, season or bud stage changes, then one drawImage per frame. Blooms are flat, under decorations, with no sway. The bud's ready glow brightens and fades on whole pixels.
- Files:
  - `trophies.ts` (`bloomsOf`, `BLOOM_NAMES`, `budStage`);
  - `scene.ts` (`paintMeadow` layer, `bloomAt`, `budAt`, `wildAt`, MEADOW_STOPS off the path);
  - `base-art.js`;
  - `BaseScreen.tsx`, `HollowDock.tsx`, `HollowGuide.tsx`, `tips.ts`, `hollow.css`.
- Tests:
  - order;
  - kind 0 for missing books;
  - 48 on the path, the rest wild, at most 100;
  - bud stages;
  - spots inside the meadow and y ≤ 102;
  - nearest wins, and animals win over blooms;
  - layer caching;
  - a bounded draw count.

## B. The Reading Stones (the long arc after chapter 10)
- A ring at the back-right: centre (200,68), radii 24×7, 12 positions, depth-sorted.
  - Positions 0–3: low stones carved 7, 8, 9, 10, one per chapter reached.
  - Positions 4–11: tall stones (12×18), one per volume (every 15 h after 45 h), carved with the hours (3×5 digit font).
  - From volume 9 the ring goes round again: round 2 adds moss, round 3 a gold cap, round 4 and on a lantern. The carving shows the latest hours.
- Volume sets are placed by Pip at fixed spots (no storage):

  | Volume | Set |
  |---|---|
  | 1 | Lanterns at the mouth, lit at night |
  | 2 | Pip reading, in stone, at the centre |
  | 3 | Bunting |
  | 4 | Book stall at (150,70) |
  | 5 | The reading tree at (226,58) |
  | 6 | Winter lights |

  Sets stop at 6.
- Tapping a stone says "Volume 3 · 90 h read".
- `VOLUME.says` becomes "A standing stone with your hours carved on it, and Pip sets out {set} by the stones". ChapterCard's `unlockPicture("volumes")` shows the stone.
- `stonesOf(minutes)` is fully derived: there is no data or migration.
- Tests: 20 h none; 21 h [7]; 45 h [7–10]; 60 h volume 1 + Lanterns; 165 h the full ring; 180 h round 2; sets capped at 6.

## C. Animal fondness; the hen on reading days
- 0–3 hearts at 3, 10 and 25 h read since that animal arrived. They never decay.
  - 1 heart: a home prop in the meadow (hen house, cat basket, goat's bell post, owl perch, fox den, sunning stone).
  - 3 hearts: a ribbon or bell, and its gift doubles:

  | Animal | Gift today | At 3 hearts |
  |---|---|---|
  | Hen | 1 egg | 2 eggs |
  | Cat | one prowler in ten stays in the wood | one in five (one in seven if the Front sim says so) |
  | Goat | 1.25 wall | 1.5 |
  | Owl | mending cheaper | mending at half |
  | Fox | ×1.1 loot | ×1.2 |
  | Tortoise | ×1.1 larder | ×1.2 |

- Petting shows that many hearts. The animals card shows hearts, a tooltip with "2 of 3 · 4 h 10 m more reading", and the doubled "does" line. Each heart adds a journal line.
- The hen lays on a day you read (`now.today ≥ 1`), not on every calendar day.
- Must keep the Front sim targets (the 20-point counter rule and the bare-camp band) with a 3-heart cat and goat.
- Data: `animalsFrom: number[6]` (minutes at arrival, −1 when absent), set in `settle`. Old saves start at the current minutes.
- Survives older builds via the taught mark `md:`: `seenAt` plus the six arrivals, base 36, `.`-joined, `-` for none, ≤ 80 characters. It is written in `keptForm` beside KEPT_MARK and FRONT_MARK and filtered in `readBase`. Fields win over the mark, the mark wins over defaults. Hearts use max(0, …).
- Tests:
  - arrival minutes recorded;
  - heart thresholds;
  - each gift doubles exactly at 3;
  - the hen lays only when today ≥ 1, once a day;
  - a round trip through `keptForm` → a simulated 1.5.9 save (unknown fields stripped, taught kept) → `readBase`.

## The meadow by chapter, and on phones
- **Ch 7** (21 h): the meadow opens with the path, blooms so far, the bud and stone 7. The hen comes at charm 8.
- **Ch 8–10:** a stone each.
- **Volumes 1–6:** tall stones and the sets.
- **Volume 8:** the full ring.
- **Phone landscape** (view about 192×89–93 art px): the meadow camera centres x 132. Blooms are at y ≤ 102, above the dock. Bloom spacing 7 art px ≈ 27–31 CSS px, nearest wins within 6 px, and the Blooms list is the accessible route.
- **Desktop:** everything is visible.

## Later
- Bloom kind counts on friends' camp cards (needs a server field, never titles).
- Series arches.
