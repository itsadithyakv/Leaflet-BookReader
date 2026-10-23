# The Front: wave simulation (final rerun, 2026-10-21)

Run from `apps/`: `ANIMALS=<none|here|fond> NIGHTS=500 npx vite-node <scratchpad>/hollow-front/waveSim.ts`. It runs the code the
picture draws from (`scene.ts` `nightPlanOf` -> `wave.ts` `planNight`), 500 nights a row.

Camps: **Bare** = wall and lookout at the chapter's top level (other buildings at 1), the lookout where its sheet says it covers
the trail, no constructs. **Built** = every building at the chapter's top, no constructs. **Counters** = built plus exactly the
night's counters. **Wrong** = built plus the constructs that are not the night's counters. A night is **held** when nobody gets
to what he came for and no section is blown open.

Animals: **none**; **here** = the cat and the goat newly come (no hearts); **fond** = both at three hearts (the cat keeps one
creeper in five in the wood, the goat's lean is 1.5, half of it at the gate). Animals come from chapter 7 and three hearts take
25 h of reading after that, so "here" before chapter 7 and "fond" before chapter 10 cannot happen in play; they are shown anyway.

Role x counter, two ways (chapter 9, nights the role comes): "all vs all but this" = the night's counters, against the same
without this one; "this alone vs none" = the built camp with only this construct, against none.

Why the first file showed counters *lowering* the held rate: it was made before three fixes (the pitfall swallowed creepers
first; the default oak and hut blocked the tower pads; the lookout was not moved to cover the trail), and its "counters" camp
always filled both tower pads, so taking a counter away left that tower in place.


## ANIMALS=none

## Held rate by chapter (500 nights each)

| Chapter | Wave | Bare (wall + lookout) | Built (all buildings, no constructs) | Built + the night's counters | Built + wrong constructs | Through a night (built+counters) | Plan ms/night |
|---|---|---|---|---|---|---|---|
| 3 | 2 | 100% | 100% | 100% | 100% | 0.00 | 1.15 | 
| 4 | 3 | 95% | 100% | 100% | 100% | 0.00 | 0.57 | 
| 5 | 3 | 87% | 87% | 100% | 87% | 0.00 | 0.94 | 
| 6 | 4 | 61% | 61% | 100% | 80% | 0.00 | 1.87 | 
| 7 | 4 | 52% | 53% | 100% | 76% | 0.00 | 0.98 | 
| 8 | 5 | 52% | 53% | 100% | 79% | 0.00 | 1.54 | 
| 9 | 5 | 45% | 48% | 100% | 80% | 0.00 | 1.83 | 
| 10 | 5 | 42% | 44% | 100% | 78% | 0.00 | 1.94 | 
| 11 | 5 | 45% | 48% | 100% | 79% | 0.00 | 1.79 | 
| 12 | 5 | 40% | 43% | 100% | 75% | 0.00 | 1.73 | 

## Role x counter (chapter 9, nights the role comes)

| Role | Counter | Held, all counters | Held, all but this | Points | Held, this alone | Held, none | Points | Of that role through, all | all but this | this alone | none |
|---|---|---|---|---|---|---|---|---|---|---|---|
| runner | Thorn strip | 100% | 76% | 24 | 96% | 59% | 38 | 0% | 20% | 0% | 22% |
| flier | Archer's nest | 100% | 77% | 23 | 98% | 52% | 46 | 0% | 21% | 0% | 30% |
| brute | Pitfall | 100% | 71% | 29 | 89% | 52% | 36 | 0% | 28% | 0% | 34% |
| digger | Thumper | 100% | 73% | 27 | 77% | 49% | 28 | 0% | 22% | 0% | 32% |
| bomber | Stone thrower | 100% | 67% | 33 | 96% | 43% | 52 | 0% | 0% | 0% | 0% |

## Wall level on brute nights (chapter 9, the night's other counters, no pitfall)

| Fence level | Held | Brutes through | Held, bare camp | Brutes through, bare |
|---|---|---|---|---|
| 1 | 24% | 77% | 0% | 99% | 
| 2 | 48% | 60% | 0% | 98% | 
| 3 | 55% | 53% | 7% | 91% | 
| 4 | 59% | 44% | 22% | 69% | 
| 5 | 71% | 26% | 48% | 35% | 

## ANIMALS=here

## Held rate by chapter (500 nights each)

| Chapter | Wave | Bare (wall + lookout) | Built (all buildings, no constructs) | Built + the night's counters | Built + wrong constructs | Through a night (built+counters) | Plan ms/night |
|---|---|---|---|---|---|---|---|
| 3 | 2 | 100% | 100% | 100% | 100% | 0.00 | 1.09 | 
| 4 | 3 | 96% | 100% | 100% | 100% | 0.00 | 0.46 | 
| 5 | 3 | 89% | 89% | 100% | 89% | 0.00 | 0.81 | 
| 6 | 4 | 66% | 66% | 100% | 80% | 0.00 | 1.71 | 
| 7 | 4 | 57% | 57% | 100% | 78% | 0.00 | 0.92 | 
| 8 | 5 | 57% | 58% | 100% | 80% | 0.00 | 2.22 | 
| 9 | 5 | 47% | 51% | 100% | 81% | 0.00 | 1.51 | 
| 10 | 5 | 47% | 49% | 100% | 79% | 0.00 | 1.57 | 
| 11 | 5 | 47% | 50% | 100% | 78% | 0.00 | 2.28 | 
| 12 | 5 | 44% | 48% | 100% | 76% | 0.00 | 1.62 | 

## Role x counter (chapter 9, nights the role comes)

| Role | Counter | Held, all counters | Held, all but this | Points | Held, this alone | Held, none | Points | Of that role through, all | all but this | this alone | none |
|---|---|---|---|---|---|---|---|---|---|---|---|
| runner | Thorn strip | 100% | 76% | 24 | 97% | 59% | 38 | 0% | 19% | 0% | 22% |
| flier | Archer's nest | 100% | 78% | 22 | 98% | 55% | 42 | 0% | 19% | 0% | 27% |
| brute | Pitfall | 100% | 78% | 22 | 88% | 59% | 29 | 0% | 22% | 0% | 27% |
| digger | Thumper | 100% | 75% | 25 | 81% | 48% | 33 | 0% | 20% | 0% | 34% |
| bomber | Stone thrower | 100% | 67% | 33 | 96% | 45% | 51 | 0% | 0% | 0% | 0% |

## Wall level on brute nights (chapter 9, the night's other counters, no pitfall)

| Fence level | Held | Brutes through | Held, bare camp | Brutes through, bare |
|---|---|---|---|---|
| 1 | 27% | 75% | 0% | 99% | 
| 2 | 50% | 56% | 2% | 95% | 
| 3 | 57% | 49% | 14% | 82% | 
| 4 | 64% | 39% | 33% | 57% | 
| 5 | 76% | 22% | 56% | 28% | 

## ANIMALS=fond

## Held rate by chapter (500 nights each)

| Chapter | Wave | Bare (wall + lookout) | Built (all buildings, no constructs) | Built + the night's counters | Built + wrong constructs | Through a night (built+counters) | Plan ms/night |
|---|---|---|---|---|---|---|---|
| 3 | 2 | 100% | 100% | 100% | 100% | 0.00 | 1.08 | 
| 4 | 3 | 97% | 100% | 100% | 100% | 0.00 | 0.43 | 
| 5 | 3 | 91% | 91% | 100% | 91% | 0.00 | 0.41 | 
| 6 | 4 | 71% | 71% | 100% | 79% | 0.00 | 0.64 | 
| 7 | 4 | 59% | 59% | 100% | 80% | 0.00 | 0.64 | 
| 8 | 5 | 61% | 62% | 100% | 80% | 0.00 | 0.79 | 
| 9 | 5 | 47% | 52% | 100% | 80% | 0.00 | 1.04 | 
| 10 | 5 | 47% | 51% | 100% | 80% | 0.00 | 0.73 | 
| 11 | 5 | 48% | 52% | 100% | 77% | 0.00 | 0.83 | 
| 12 | 5 | 47% | 51% | 100% | 77% | 0.00 | 1.90 | 

## Role x counter (chapter 9, nights the role comes)

| Role | Counter | Held, all counters | Held, all but this | Points | Held, this alone | Held, none | Points | Of that role through, all | all but this | this alone | none |
|---|---|---|---|---|---|---|---|---|---|---|---|
| runner | Thorn strip | 100% | 79% | 21 | 98% | 63% | 35 | 0% | 17% | 0% | 20% |
| flier | Archer's nest | 100% | 79% | 21 | 98% | 57% | 41 | 0% | 17% | 0% | 24% |
| brute | Pitfall | 100% | 78% | 22 | 88% | 58% | 30 | 0% | 18% | 0% | 22% |
| digger | Thumper | 100% | 76% | 24 | 84% | 50% | 34 | 0% | 19% | 0% | 35% |
| bomber | Stone thrower | 100% | 69% | 31 | 97% | 48% | 49 | 0% | 0% | 0% | 0% |

## Wall level on brute nights (chapter 9, the night's other counters, no pitfall)

| Fence level | Held | Brutes through | Held, bare camp | Brutes through, bare |
|---|---|---|---|---|
| 1 | 30% | 73% | 0% | 98% | 
| 2 | 54% | 52% | 6% | 91% | 
| 3 | 61% | 45% | 23% | 71% | 
| 4 | 70% | 32% | 43% | 44% | 
| 5 | 77% | 19% | 57% | 24% | 
