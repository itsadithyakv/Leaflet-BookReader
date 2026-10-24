# The Magpie Lands: raid balance (step 1, 2026-10-24)

The battle rules for planned raids ([raids-plan.md](raids-plan.md), sections 2
to 4), measured as the Front was ([front-balance-results.md](front-balance-results.md)).

Run from `apps/`: `npx vite-node scripts/raids/sim.ts` (about 70 s; `--quick` for
a smaller search, `--naive` for the naive plan alone, `ONLY=0,1,2` for some
strongholds, `TUNE='{"planned":{"keep":[…]}}'` to try other figures). It plays
the code the game plays (`src/pip/base/battle.ts` with a squad), every
stronghold 0 to 17 and the King, five shaken runs each (`Setup.jitter` 0 to 4;
jitter 0 is the raid as fought).

## Par

A stronghold's region is its place on the ladder over three: the Lands' five
regions of three, then the Far Rookeries. The map's fog lifts with the
chapters, two chapters to a region, as the burrow's levels go
(`chapters.ts` `burrowOfChapter`: level 1 at chapters 1 and 2, 2 at 3 and 4, and
so on). Nothing can be built higher than the burrow, and the hut is cheap
beside a chapter, so a reader in region r has the hut at r + 1: **par is hut
level min(5, region + 1)**, with its room (`scoutsOf`: 5 + 2 a level), its
kinds (slingers at 2, Puffcaps at 3, moles at 4) and its Puffcaps (one at 3,
two at 5). No fork, no tip, and **no hero**: a hero comes from books finished,
at no fixed time, so par is without one and a hero is a bonus on top. The King
is fought at hut 5 (he comes with chapter 10), at `theKing`'s size for it (13).

The two plans:
- **naive**: everyone in one group down the trail, nobody held back, no
  orders; the plain mix (`squad.ts` `plainMix`: one Puffcap if trained, a
  third of the rest slingers, a mole or so, sprouts for the rest);
- **good**: the best found by searching squad mixes (Puffcaps, moles and
  slingers in three amounts each), splits across approaches (one group,
  a third to another way, one kind to another way, held second waves,
  three sprouts first and the rest held), then up to two orders at a time
  (rallies to every building and releases, at 0, 3, 7 and 12 s).

## The table

| Stronghold | Quirk | Par hut | Naive ★ (5 runs) | Good ★ (5 runs) | Gap | Naive by hut 1 / 2 / 3 / 4 / 5 | Good plan |
|---|---|---|---|---|---|---|---|
| 1 | ford | 1 | 2.00 (22222) | 3.00 (33333) | 1.00 | 2.0 / 2.8 / 3.0 / 3.0 / 3.0 | 7sp@ridge |
| 2 | crow | 1 | 1.40 (13111) | 3.00 (33333) | 1.60 | 1.4 / 3.0 / 3.0 / 2.8 / 3.0 | 5sp@trail / 2sp@ridge |
| 3 (keep) | gate | 1 | 2.00 (22222) | 3.00 (33333) | 1.00 | 2.0 / 2.0 / 2.0 / 2.0 / 2.0 | 7sp@hollow |
| 4 | fog | 2 | 1.00 (11111) | 3.00 (33333) | 2.00 | 0.0 / 1.0 / 3.0 / 3.0 / 3.0 | 9sp@ridge |
| 5 | gate | 2 | 2.00 (22222) | 3.00 (33333) | 1.00 | 0.0 / 2.0 / 2.0 / 2.0 / 2.0 | 9sp@ridge |
| 6 (keep) | pits | 2 | 0.20 (10000) | 3.00 (33333) | 2.80 | 0.0 / 0.2 / 1.0 / 2.0 / 2.0 | 9sp@ridge |
| 7 | crow | 3 | 2.00 (22222) | 3.00 (33333) | 1.00 | 0.0 / 1.0 / 2.0 / 2.0 / 2.0 | 11sp@trail; rally g0->hoard@0s |
| 8 | ford | 3 | 1.00 (11111) | 3.00 (33333) | 2.00 | 0.0 / 0.0 / 1.0 / 2.0 / 2.0 | 11sp@trail; rally g0->nest@0s |
| 9 (keep) | pits | 3 | 0.00 (00000) | 3.00 (33333) | 3.00 | 0.0 / 0.0 / 0.0 / 1.6 / 2.0 | 11sp@ridge |
| 10 | hedge | 4 | 1.00 (11111) | 3.00 (33333) | 2.00 | 0.0 / 0.0 / 0.0 / 1.0 / 2.0 | 13sp@ridge |
| 11 | fog | 4 | 1.00 (11111) | 3.00 (33333) | 2.00 | 0.0 / 0.0 / 0.0 / 1.0 / 1.0 | 13sp@trail; rally g0->nest@12s |
| 12 (keep) | crow | 4 | 1.00 (11111) | 3.00 (33333) | 2.00 | 0.0 / 0.0 / 0.0 / 1.0 / 2.0 | 13sp@trail; rally g0->hoard@0s |
| 13 | hedge | 5 | 1.00 (11111) | 3.00 (33333) | 2.00 | 0.0 / 0.0 / 0.0 / 0.0 / 1.0 | 10sp@trail / 5sp@ridge |
| 14 | pits | 5 | 0.00 (00000) | 3.00 (33333) | 3.00 | 0.0 / 0.0 / 0.0 / 0.0 / 0.0 | 15sp@ridge |
| 15 (keep) | ford | 5 | 1.60 (12122) | 3.00 (33333) | 1.40 | 0.0 / 0.0 / 0.0 / 0.0 / 1.6 | 10sp+5sl@hollow |
| 16 | gate | 5 | 2.00 (22222) | 3.00 (33333) | 1.00 | 0.0 / 0.0 / 0.0 / 0.2 / 2.0 | 15sp@ridge |
| 17 | hedge | 5 | 1.00 (11111) | 3.00 (33333) | 2.00 | 0.0 / 0.0 / 0.0 / 0.0 / 1.0 | 15sp@ridge |
| 18 (keep) | crow | 5 | 1.40 (11122) | 3.00 (33333) | 1.60 | 0.0 / 0.0 / 0.0 / 0.0 / 1.4 | 8sp+2mo@ridge / 3sp@hollow |
| King | gate | 5 | 1.00 (11111) | 2.80 (33233) | 1.80 | 0.0 / 0.0 / 0.0 / 0.0 / 1.0 | 15sp@trail; rally g0->nest@12s, rally g0->perch@0s |

`sp` sprouts, `sl` slingers, `mo` moles, `pc` Puffcaps; `@` the approach;
`rally g0->nest@12s` is a rally order given 12 s in. The runs column shows
each run's stars.

## Quirk by quirk

"The named counter, by rule" is the counter the scout view names ("What beats
it"), made into a plan with no search, so the table shows whether the counter
the game teaches is worth its stars in itself:
- ford: moles down the ford (from hut 4), everyone else round, a rally to
  the nest at 3 s;
- crow: a rally at its perch at once, then at the nest at 15 s;
- pits: three sprouts down the trail first, the rest held and released at
  5 s, a rally to the nest at 15 s;
- fog: seven in ten of the room in slingers, down the trail, a rally to the
  nest at 10 s;
- second gate: everyone round to the weak gate, a rally to the nest at 20 s;
- hedge: half the room in moles down the thorn trail, the rest round, a
  rally to the nest at 10 s.

| Quirk | Strongholds | Naive ★ | Good ★ | Counter worth (good − naive) | The named counter, by rule ★ | Named counter − naive |
|---|---|---|---|---|---|---|
| ford | 1, 8, 15 | 1.53 | 3.00 | 1.00 least, 1.47 mean | 3.00 (33333), 3.00 (33333), 3.00 (33333) | 1.47 mean |
| crow | 2, 7, 12, 18 | 1.45 | 3.00 | 1.00 least, 1.55 mean | 0.00 (00000), 3.00 (33333), 3.00 (33333), 3.00 (33333) | 0.80 mean |
| pits | 6, 9, 14 | 0.07 | 3.00 | 2.80 least, 2.93 mean | 0.00 (00000), 0.00 (00000), 3.00 (33333) | 0.93 mean |
| fog | 4, 11 | 1.00 | 3.00 | 2.00 least, 2.00 mean | 3.00 (33333), 3.00 (33333) | 2.00 mean |
| gate | 3, 5, 16, King | 1.75 | 2.95 | 1.00 least, 1.20 mean | 3.00 (33333), 3.00 (33333), 3.00 (33333), 0.80 (01111) | 0.70 mean |
| hedge | 10, 13, 17 | 1.00 | 3.00 | 2.00 least, 2.00 mean | 3.00 (33333), 3.00 (33333), 3.00 (33333) | 2.00 mean |

It holds for the ford, the fog and the hedge everywhere, and for the crow,
the pits and the gate from region 2 or 3 on. Where it does not (the first
crow, the first two pits, the King), the counter is right but these plans made
by rule are too plain for a keep at a small hut: the search's plans take them.

## The targets

| Target | Aimed | Measured | Met |
|---|---|---|---|
| Naive plan's mean at par | about 1★ | 1.19 | yes |
| Naive loses some from region 2 on | some 0★ | 3 strongholds with a 0★ run (6, 9, 14) | yes |
| Good plan ★★★ | ≥ 90% | 99% of runs | yes |
| Gap, good − naive | ≥ 1.5★ | 1.80 | yes |
| Every quirk's counter worth | ≥ +1★ | ford 1.00, crow 1.00, pits 2.80, fog 2.00, gate 1.00, hedge 2.00 (least each) | yes |
| A hut level up raises the naive plan on the next strongholds | +0.25★ or more, every level | hut 1→2 +0.80, 2→3 +0.93, 3→4 +0.87, 4→5 +0.67 (region means); stronghold by stronghold +0.82 on average, 4 of 12 flat, 0 lower | yes |
| Lords' keeps not ★★★ by the naive plan | none | none | yes |

**"A hut level up"** is measured on each region's three strongholds: their
naive stars at the par hut against one level higher. Stronghold by
stronghold, four do not move with the level: 3, 5 and 7, where a plain raid
already takes the nest and most of it at par and a level more cannot give it
the feat (only a plan does), and 11, a fog that only slingers beat. None goes
down.

## How the rules came to this

Measured, then changed, until the targets held (each step was a sim run):
- **The camps are set per region, against the par hut, not by the ladder's
  own growth** (`RAID_FIGURES.planned.sturdy`, `hits`, `keep`). Against one
  figure for all, the early strongholds were a walk (a hut-1 squad took
  stronghold 1 in 16 s) and from stronghold 13 on nobody took anything (six
  perches each throwing 6 a pebble). Strongholds have one perch more than by
  hand, and region 1's first stronghold, which had none, now has one.
- **A scout left to itself leaves the nest till last.** Without that, the
  first two stars came and went together: the nest, big and in the middle,
  was the nearest thing by its edge, so a plain raid took all of it or
  nothing (2★ or 0★ and never 1★). Now the nest is what a rally is for. The
  nest is sturdier (×1.8) and always throws (at half below stronghold 10).
- **The watch-crow calls when a third of its camp is down**, not half, and
  its perch is the one furthest from the trail: at half, a plain raid often
  pulled the perch down first by chance.
- **The bell rings at 30 s**, not 40: at 40 the first ford's camp fell first
  however slowly it was waded.
- **Pitfalls take whoever is on them when they give (two at most), and a
  sprout scrambles out hurt**; a group comes out throwers and moles first,
  sprouts last, and walks its approach at its slowest scout's pace, so it
  keeps together. The feat is "lose nobody to the pits". Before, two pits
  that took anyone emptied a hut-1 squad, and sprouts (the fastest) led any
  group, so "sprouts first" was the plain plan already and no counter. Pits
  moved out of region 1 (sprouts only) for that reason; its keep has the
  second gate.
- **A Puffcap takes two places, not three.** At three, the hut's third level
  (which brings it) sent fewer scouts than its second and was not worth
  having.
- **A planned mole is stouter (×1.6 health, ×1.5 harm)**: at two places it
  was a worse buy than two sprouts, and "moles go under the hedge" lost.
- **A hut level makes a scout a quarter stronger in a planned raid** (0.15 by
  hand), so a level shows on the next stronghold.
- The thorn hedge's feat counts **those who went through the thorns and
  fell**, there or later. Counting only those who fell in the thorns let a
  plain raid that walked through and died beyond them have it.

What did not move: the stars a raid by hand takes, the night's fight
(`wave.ts`), friends' raids (their camps get approaches from their own layout
and no quirk; their third star is "pull all of it down", as the old one was).

## Speed

On this desktop (Node 24, 2026-10-24): a planned raid takes **2.4 ms**, about
2.4 µs a step over some 1,000 steps (a raid by hand: 2.0 ms). A forecast of
three runs takes **4.7 ms on average and 6.8 ms at most**, once warm; the very
first, cold, about 16 ms. A phone of the owner's (Adreno 619 class) runs
JavaScript some 4 to 5 times slower, so about **20 to 30 ms** a forecast: at
the budget. The same plan is not forecast twice (`forecastPlan` keeps its last
twelve). To be measured on `leaflet_phone36` with the plan screen (step 3).

To get there, `step` makes no new arrays (the night's constructs are listed
once; the sentries' search is one pass; pebbles are moved on in place), and
distance is a square root and not `Math.hypot`, several times slower. That
last changes a raid by hand in its last decimal: where a slinger stands
exactly at the nest's reach the two disagree, so a hand raid can go a
fraction differently. All the existing tests pass; nights are not fought in
`battle.ts` any more and are not touched.

## Open

- **No real play yet**: these are plans by rule and by search. The orders a
  reader gives with their own timing are not in it.
- **Heroes are not in par.** Each hero's move is tested to do what it says,
  not measured for how many stars it is worth.
- **Road camps** have a quirk from their seed but were not run.
- The good plans the search finds are mostly sprouts on a flank with a
  rally. The kinds are each worth having (the named counters above), but
  a plain all-sprout party is strong; worth watching once people play.
