# The Hollow: One Front (design plan)

> **Kept 2026-10-23:** copied from a session's temporary notes, written
> 2026-10-21. It is the plan as agreed then. **Built and shipped in 1.5.11**
> (`src/pip/base/front.ts`, `components/pip/arcade/base/wave.ts`). The last
> balance run is in [front-balance-results.md](front-balance-results.md).
> What is still open is in [pip.md](../../pip.md), "The Hollow".

Status when written: planning only, with no code yet.

Owner's ask: walls that make sense because enemies come from one direction. Enemies that can break walls (bombers, diggers). Real strategy, and a map that looks different. Plan everything before building.

---

## 0. The idea in one paragraph

The Dark Wood is on the left of the clearing. Prowlers have trodden one **trail** through it, and **everything that attacks the camp comes down that trail**. The fence becomes a **wall across the trail**, with a **gate** where the trail meets it. **Towers** stand behind the wall and **traps** lie on the trail in front of it. The camp's precious things (the **Heart**: burrow, oak, larder) sit behind the wall. The **Back** (yard, decorations, the way to the meadow) is safe. Each kind of enemy has **one thing it is good at** and **one defence that beats it**. Every night you watch, Pip says who is coming ("4 creepers, 1 bomber"). You choose what to put on the front from a few slots, then watch the night play out. Reading unlocks new enemies and their counters chapter by chapter, and it pays for everything. Nothing happens while you are away.

It is tower-defence with one lane, built from what exists today. The 8 prowler looks, the guardians, the fence levels, the constructs, the gate, the chapters and the raids all stay. They are re-aimed at one front.

---

## 1. The map

### 1.1 What changes on screen

- **The Dark Wood (left).** A strip of dark, close trees along the left edge that never clears, at least 14 art px deep. This is different from the ordinary side woods (pines, birches, bushes in the season's colours). The Dark Wood is darker: blue-black greens, twisted trunks, brambles at its foot. As the chapters widen the clearing, the left wood draws back to this strip and stops. The right side still clears fully, as now.
- **The trailhead.** A dark arch in the Dark Wood at mid-height (centre about y 86): two leaning trunks meeting overhead, brambles on either side, the mouth a dark hollow. Next to it stands a crooked warning post (a carved acorn, crossed through). It is drawn in the existing pixel style.
- **The trail.** A trodden earth path, about 10 px wide, from the mouth to the gate, with one gentle bend so it reads as a path and not a corridor. From the gate a fainter worn track runs on to the burrow's door. The existing sandy **parcel path** from the back of the clearing stays as it is: that is the friendly road, and the trail is the hostile one. Two paths, two meanings.
- **The wall.** A palisade of tall pointed stakes runs *up the picture* across the trail (stone from fence level 4). Because it runs away from the viewer, each stake is drawn standing and overlapping the one behind it, stepping up the screen. A run of stakes reads well in this 3/4 view, where a flat strip would not. Where the trail crosses it there is a **gatehouse**: a squat timber tower drawn front-on (like a building), with its arch on its left, shadowed face, toward the trail. From fence level 2 the arch has doors. At level 1 there is no gate, only a short line of stakes across the trail mouth.
- **Front slots.** Three **trap spots** on the trail in front of the wall (worn flat stones in the path) and up to three **tower pads** just behind the wall (round timber platforms). They are shown only in Edit and in the Defence shelf, and the outline of an empty one is not drawn in the plain view.
- **Zones** (they are not fenced off, but the rules use them):
  - **Front** (from the wood edge to the wall): the trail, traps, the trailhead. Nothing else is built here. Decorations and landscape may go here but not on the trail itself.
  - **Heart** (the wall to about x 160): burrow, oak, larder, lookout, hut, tower pads. This is what prowlers come for.
  - **Back** (x 160 to the right edge): yard plots, decorations, the meadow arrow. Safe: nothing is attacked here unless the Heart is empty. Fliers can still reach a larder placed far back, but they fly the longest way to get there.

### 1.2 How it widens with the chapters

| Burrow level (chapters) | Left wood (art px) | Right wood | Front depth (wood edge to wall at x 64) | Trap spots usable |
|---|---|---|---|---|
| 1 (ch 1–2) | 38 | 38 | — (no prowlers yet, no trail drawn) | — |
| 2 (ch 3–4) | 26 | 26 | 38 | 1 (ch 4) |
| 3 (ch 5–6) | 14 | 14 | 50 | 2 (ch 6) |
| 4 (ch 7–8) | 14 (Dark Wood minimum) | 6 | 50 | 3 (ch 8) |
| 5 (ch 9–10) | 14 | 0 (ch 10) | 50 | 3 |

So the trail gets longer as the camp grows: more time under fire, and room for more traps. The **trail first appears at chapter 3**, when prowlers begin. That gives a story beat: "The prowlers found a way through the Dark Wood."

### 1.3 Sketches (each character is about 4 art px wide and 6 to 8 tall; the field is 240 × 120)

Early, chapter 4. Wall level 1: three stakes across the trail, no gate. One trap spot, the lookout, the hut.
```
   0    26        64                                   214  240
   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^   back trees
   ######|                  : (parcel path)        |######
   ######|          [Lk]    :      [Oak]           |######
   ##DARK|                  |                      |######
   ##)(==========T======    |      (Burrow)  [Lar] |######  ->
   ##WOOD|              |   ~~~~~~~~~>             |######
   ######|              |       [Hut]              |######
   ######|                                         |######
   )( trailhead   == trail   T trap spot   | wall   [Lk] lookout
```

Mid, chapter 7. Wall level 3: six sections, gatehouse at the trail. Two traps, one tower pad (archer's nest), guardians at the gate.
```
   0  14            64                                    234 240
   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
   ###|                 |                 :                 |#
   ###|                 |  (A)    [Lk]    :   [Oak]         |#   (A) archer's nest on pad
   ###|                 |                 :                 |#
   #)(=====T=====T====[GATE]~~~~~~~~~~~~>(Burrow)  [Lar]    |#  ->
   ###|        h        | b                                 |#   h Mossgather on the trail, b Berit inside the gate
   ###|                 |   [Hut]     [Yard0]   (decor)     |#
   ###|                 |                                   |#
```

Late, chapter 10. Stone wall level 5 spanning the approach. Three traps, three pads (two archer's nests and a stone thrower), the bell on the gatehouse, the whole clearing open.
```
   0  14            64                                         240
   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
   ###|                 #   (A)                 :              |
   ###|                 #          [Lk]  [Oak]  :   [Yard1]    |
   ###|                 #                       :     (pond)   |
   #)(==T=====T====T==[GATE*]  (S)  ~~~>(Burrow) [Lar]  [Yard0] ->
   ###|        h        # b                                     |
   ###|                 #   (A)     [Hut]        (decor)        |
   ###|                 #                                       |
   # stone wall   * watch bell   (S) stone thrower
```

### 1.4 On a phone held sideways (740×360, 844×390) and on desktop

- The phone shows 80 % of the clearing's width (`PHONE_ZOOM` 1.25: 192 of 240 art px), and the camera starts centred, so today the left 24 px would be off-screen. The plan changes two things. The phone's starting framing leans **16 px to the left** once the trail exists, so the trail mouth's right half and the whole wall are in view. When a night's wave begins, the camera **eases to the left edge** (x 0 to 192), unless the reader is dragging. The meadow arrow on the right is one drag away, as now.
- Vertically, the top bar covers sky only. The dock covers roughly art y 104 and below. The trail and gate (y about 84 to 90) sit in the middle of the screen. The lowest wall sections (y 104 to 114, levels 3 and up) can sit under the dock, which is acceptable because the fight is at the gate.
- On desktop (1280×800) the whole 240 px is visible, and nothing moves.

### 1.5 Day, night, season on the trail side

- **Day:** the mouth is dark but quiet, with a bird now and then. Prowlers by day are rare and come one at a time.
- **Dusk, before a wave:** two pairs of eyes blink in the mouth (whole pixels, no twitching), a low violet mist creeps about 10 px onto the trail, and the night chip appears (section 7).
- **Night:** the mouth is at its darkest. Prowlers step out with the leaves shaking, as they do now. Lantern light from the lookout and the gatehouse torches pools on the trail.
- **Dawn:** broken sections are mended (scaffold, then whole), and footprints stay on the trail as the night's tracks.
- **Seasons:** autumn leaves drift onto the trail; winter snow shows the prowlers' footprints, and Frostwights come; spring has mud puddles; summer has dust.

---

## 2. Enemies: six roles and a boss

Each role is one rule, one look and one counter. The 8 existing prowler looks are kept: two of them become **skins** of the creeper, so the book's genre still decides who comes.

| Role | Look (existing art unless marked new) | What it does | Goes for | Arrives (chapter) | Beaten by |
|---|---|---|---|---|---|
| **Creeper** | Mudtusk rabble (boar-folk with clubs). Skins: **the Stumbling** (horror books), **Frostwights** (winter, science books) | Walks the trail and batters whatever wall is in front of it. The basic enemy. | the larder | 3 | everything that throws; the wall holds them |
| **Runner** | Rattlenut the red squirrel | Very fast and frail, and over the wall in one bound | the oak (shakes acorns loose) | 4 | **Thorn strip** (cuts runners three times as fast) |
| **Flier** | Magpies | Flies straight from the mouth to its target, over the wall and the traps | the larder (steals) | 5 | **Archer's nest** (fliers first, double hits); Emberling |
| **Brute** | The Gilded (gold-armoured, slow) | Very sturdy, batters the gate three times as hard | the gate, then the lookout | 6 | **Pitfall** (takes him whole); Dame Berit at the gate |
| **Digger** | The Rootgnaw (mole; only a moving dirt ridge while under) | Tunnels from the mouth under the wall and surfaces near its target, where nothing throws at it while it is under | the larder | 7 | **Thumper** (brings him up early inside its ring, dazed) |
| **Bomber** | Fizzwick (square, mossy, with a fizzing sprout) | Walks to the wall beside the gate, hisses, and pops: that **wall section is gone** and its neighbours are hurt. Through a gap, a bomber goes for the nearest building and pops for two knocks. | a wall section | 8 | **Stone thrower** (a stone sets him off where he stands, out on the trail, harmlessly) |
| **Wood Lord** (boss, new art) | One per tier: **Gnarlhorn**, a huge tusked boar-chief (ch 6); **Mother Thistle**, a bramble-witch who throws seed-bombs (ch 8); the **Hollow King of the Wood**, an antlered shadow-stag (ch 10) | A "big night" once per tier, the first night after the chapter is reached. Very sturdy, batters hard, and a pitfall cannot hold him. | the gate, then the burrow | 6, 8, 10, then every volume | the whole front; beating one raises a banner |

Each role is **telegraphed by its silhouette** on the night chip. Its **behaviour shows on screen**: the digger's ridge, the bomber's hiss-and-flash, the brute leaning into the gate, the runner's bound, the flier's shadow on the grass.

Our raiding scouts get a matching new kind (section 6): the **Puffcap**, our own bomb-sprout (new art: a sprout carrying a lit acorn).

---

## 3. Defences that make sense

### 3.1 The wall and the gate

- The fence building becomes **the Wall**. It is raised automatically across the trail when bought; there are no pieces to lay. Its level sets its **length** and **sturdiness**:

| Fence level | Sections (10 px each, centred on the trail) | Look | Section toughness (creeper-seconds of battering) | Gate |
|---|---|---|---|---|
| 1 | 3 (y 74–94) | stakes | 5 | none (prowlers climb, as now) |
| 2 | 5 (y 64–104) | palisade | 7 | gatehouse, toughness × 1.5 |
| 3 | 6 (y 64–114) | palisade, braced | 9 | × 1.5 |
| 4 | 7 (y 54–114: the whole approach) | stone | 12 | × 1.5 |
| 5 | 7 | stone, walkway (Halvar stands on it) | 16 | × 1.5 |

- **A short wall can be walked round.** Walkers stay on the trail until they reach the wall, then use the existing "go round if not much further" rule (`DETOUR` 2.2). At levels 1 to 3 some will skirt an end. At level 4 the approach is sealed, so they must break through, climb or go under. That is why a longer wall matters.
- **Broken sections** are gaps until **dawn**, when they mend for free (scaffold for a moment, then whole). Nothing is lost while you are away. Corwin's ranks still multiply toughness (× 1.5, 2, 2.6). The goat now gives **+25 % wall toughness** in place of 2 extra pieces.
- **Where it stands:** the wall's line is at x 64 by default. In **Edit** the gate has a drag handle, and the whole line **slides left or right between x 44 and x 104**, never closer than 20 px to the wood edge. Towers and the gate move with it. That is the only placement choice for the wall, so it stays simple.

### 3.2 The lookout and the hut (buildings, placed anywhere in the Heart as now)

- **Lookout:** long reach, one target at a time, hits ground and air. This is the camp's backbone. Its sheet says **"Covers the trail"** (its reach ring overlaps the trail in front of the wall) or **"Too far from the trail"**. The lantern still adds reach. Halvar still adds reach.
- **Scouts' hut:** throws from its roof (reach 26), so it only matters near the gate. Its sheet says the same "Covers the trail" or "Too far".

### 3.3 Constructs: 12 become 7, each with one job

Towers stand on **pads** behind the wall. You may own **up to 2 of each tower**, but the number on the front is limited by the pads. Traps lie on **spots** on the trail, **one of each**. The bell is an upgrade of the gatehouse.

| New construct | Slot | Its one job | Beats | Chapter | Cost | Made from today's |
|---|---|---|---|---|---|---|
| **Thorn strip** | trap spot | Cuts every walker crossing it; cuts runners 3× | runners | 4 | 100 | Whip-thorn hedge + Caltrops |
| **Tanglefoot** | trap spot | Walkers cross at 45 % pace, so everything throws at them for longer | crowds; makes every tower better | 5 | 90 | Tanglefoot patch |
| **Pitfall** | trap spot | Swallows the first brute (or the first 2 others) each night; dug again at dawn | brutes | 6 | 200 | Pitfall |
| **Thumper** | trap spot (the one nearest the wall) | Diggers within 30 px are drummed up and dazed for 2 s | diggers | 7 | 220 | Thumper (its "draws walkers" job is dropped) |
| **Archer's nest** | tower pad | Quick, light, shoots fliers first and hits them double | fliers | 5 | 150 | Archer's nest + Hornet jar + Ward stone |
| **Stone thrower** | tower pad | Slow and heavy, hits a small area; a stone sets a bomber off where he stands | bombers, groups | 8 | 240 | Stone thrower |
| **Watch bell** | on the gatehouse (no slot) | While anyone is at the wall, everything throws a third faster | everything, a little | 9 | 280 | Watch bell |
| *(retired, refunded)* | | | | | | Smoke brazier (260), Dread totem (170) |

**Slots open with reading:**

| Chapter | Trap spots | Tower pads |
|---|---|---|
| 4 | 1 | 0 |
| 5 | 1 | 1 |
| 6 | 2 | 1 |
| 8 | 3 | 2 |
| 10 | 3 | 3 |

With four trap kinds for three spots, and two tower kinds for two or three pads, **you always choose**, and the choice follows the night's telegraph. **Swapping is free**: what you own and have not placed sits in **the shed** (a row in the Defence shelf). The point is to read the telegraph and swap, not to pay again.

*Later (not in the first version):* three levels per construct, each improving its one stat (archer rate; stone splash; thorn cut rate; tanglefoot slow; pitfall 1→2→3 brutes; thumper ring 30→38→46).

### 3.4 Guardians: each one posted on the front with a job

Their signposts **default to the front** (an unmoved guardian goes to the new default; one the reader moved stays put). A guardian whose post is far from the trail does nothing, and their card says "Too far from the trail".

| Guardian | Default post | Job on the front (kept from today unless marked) |
|---|---|---|
| Halvar (bow) | on the wall beside the gate | shoots anything on the trail within 34; the lookout reaches further |
| Corwin | the gate | wall sections stand longer (× 1.5, 2, 2.6) |
| Mossgather | on the trail in front of the wall | roots slow walkers **on the trail** (12, 22, 32 %) (was "everywhere") |
| Dame Berit | just inside the gate | meets whoever breaks through with her blade (**new emphasis**: her larder bonus moves to "whoever gets in meets her first") |
| Emberling | larder roof | scorches fliers first; fire does double to the Stumbling and Frostwights |
| Pim | the Back, by the larder | the larder hides more (economy, unchanged) |
| Ilsa | among the tower pads | everything throws faster (unchanged) |

---

## 4. The loop and the strategy

### 4.1 When attacks happen (never a daily chore)

- **Nights are seen, never simulated out of sight.** This keeps the 2026-10-15 decision. Nothing happens while you are away, and nothing piles up.
- **Reading brings the night.** When you open the Hollow and you have read since the last night you watched, the camp's clock starts so that **dusk falls about 30 seconds in**. That night's wave is the **rewarded** one: a bounty of acorns if it is held. After it, nights come round every 12 minutes of watching (the scene's day, `DAY_SECONDS` 720), unrewarded, for the show.
- **By day** a lone creeper or runner now and then (about one every two minutes) keeps the clearing alive. This also serves chapter 3's "See a prowler off".
- **Losses stay small and visible:**
  - Wall sections broken: a gap until dawn, mended for free.
  - Buildings knocked: at most 2 knocks a day, fixed with acorns, as now.
  - Acorns stolen: at most once a day, and never what the larder hides, as now.
- Closing the app mid-night loses nothing. The night is simply over.

### 4.2 How a player learns what to build

1. **The chapter card** for each chapter that brings an enemy shows a pair: its face and its counter ("Diggers come. A thumper brings them up."), one picture and one line.
2. **The night chip at dusk** shows tonight's enemy faces with counts. Tap it for the night card: each face with its counter's picture beside it. A **red mark** goes on any counter you have not placed. That is the "your front is weak against bombers" message, said with a picture.
3. **Pip's one-time lines** come the first time each kind gets through: "A bomber blew the wall! A stone thrower sets them off out on the trail." There is one per kind, never repeated, and no standing text.
4. **Sheets** say "Beats: bombers", "Covers the trail" or "Too far from the trail".

### 4.3 What success looks like

- **A night held** (no prowler reached the Heart): a shield pops over the gate at dawn, and **Nights held** goes up. It shows on your profile and camp card for showing off, with the longest run of held nights.
- **Bounty** for the first held night per reading day: 5 + 2 × chapter acorns (11 at chapter 3, 25 at chapter 10). That is small next to the oak (8 to 40 acorns every 10 minutes read), so reading stays the engine.
- **Wood Lords beaten** raise a banner (Phase 5).

### 4.4 Ties to reading

Chapters (hours read) bring each enemy, its counter, each slot and the wall's levels. The rewarded night needs reading since the last one. Acorns come from reading. Nothing can be unlocked by marking books as read.

---

## 5. Raids: the same model, the other way round

- **Strongholds have a trail too.** In `BattleScreen` the field shows the stronghold's trail coming in from the **left edge**. The **drop zone** is the strip along that edge (x 4 to 40, the full height), outlined with a dashed pale-yellow line and lit while a scout is selected. It replaces "anywhere outside the dashed ring".
- **Stronghold layouts** (`battle.ts` `layout`) are rebuilt to match. From stronghold 4 there is a straight palisade at x about 106, spanning y 30 to 100, with a gate at the trail (y about 64). The flanks are open at the top and bottom, so a raider who drops at the top or bottom of the strip can go round. That is the raider's choice: hit the gate or go round. Hoards and sentries sit in the right two-thirds (x 120 and beyond), with sentries placed to cover the trail. The King's roost has a stone wall that spans the whole field and two gates.
- **Choosing the party.** The tray (one tap each, as now) gets a fourth kind, the **Puffcap** (our bomber). The hut at level 3 trains 1 per raid, at level 5 trains 2. A Puffcap walks to the nearest wall section and blows it open, or does 40 damage to a building. Moles (our diggers) still go under to the hoards. Slingers throw from outside sentry reach.
- **Autopilot and forecasts** ("Send", `raidForecast`) try three lanes (top, middle, bottom of the strip) instead of four sides. The forecast's words gain one hint about the best counter, worked out by trying the lane with one more Puffcap or slinger: "Their wall is strong: bring a Puffcap", "Their sentries cover the trail: go round the top".
- **Friend raids on your camp** use your front. The raider's scouts drop in **your** trail strip and face your wall, gate, traps (traps act on scouts, as constructs do now with `works: true`), towers and guardians. The news card says "Maya's scouts broke 2 sections ★★☆ [Put them back]". Putting them back restores the sections.

---

## 6. UI (within the 1.5.10 screens: top bar, Build / Raid / Edit, chapter card, guide)

- **Top bar:** at dusk, a **night chip** with tonight's faces and counts (pixel heads), and nothing else. During the night it shows how many are left. At dawn: "Held" plus a shield, or the count that got through, for a few seconds, then it goes.
- **Build › Defence tab** becomes **The Front**, a picture of the trail with the wall, the gate (and bell), pads and spots drawn on it. Tap a pad or spot to choose what goes there; below it, **the shed** (owned, unplaced). Each card shows a picture, the face of the enemy it beats, and its price.
- **Edit:** buildings move as now, but not in front of the wall. Dragging the gate handle slides the wall. Traps snap to spots and towers to pads. The trail is highlighted, and reach rings are drawn over it (existing blue ovals). The trap and tower nearest to covering the trail glow.
- **Sheets:** throwers say "Covers the trail" or "Too far from the trail". The wall's sheet shows its sections (whole or broken) and **Put them back** after a friend's raid.
- **Guide (i) › Prowlers & defence:** one picture (trail → wall and gate → towers behind) and at most three lines: "Prowlers come down the trail from the Dark Wood." "A wall across it and towers behind it keep them out." "Each kind has one thing that beats it: see who's coming at dusk."
- **One-time Pip line** on the first visit after the change: "The prowlers found a trail through the Dark Wood. I put the fence across it!" (plus "…and moved our defences to the front" when constructs were moved).
- **Raid screen:** the drop strip outlined; the Puffcap in the tray; the forecast hint is one line.

---

## 7. Migration (existing camps lose nothing)

| What | Becomes |
|---|---|
| Fence level | the same wall level. The wall is complete at once, whatever the number or position of the pieces. |
| `walls` (piece positions) | ignored by 1.5.10's rules, but still **written** as the wall's section positions, so a 1.5.9 device shows a fence where the wall is. |
| `downed` (pieces friends knocked down) | that many broken sections (at most the wall's), restored by **Put them back** |
| `gate` | the gatehouse (fence ≥ 2), at the trail |
| Goat's +2 pieces | +25 % wall toughness |
| Constructs | Hedge and Caltrops → Thorn strip; Ward stone and Hornet jar → Archer's nest; the rest keep their kind. A duplicate created by merging, and the retired Smoke brazier and Dread totem, are **refunded in full** (acorns plus a journal line). All constructs are **re-seated** onto the front's pads and spots (nearest first); what does not fit goes to the shed, still owned. |
| `WORKS` indices | kept stable (retired entries stay in the array, marked `retired`), so older builds still read them |
| Buildings, decorations, landscape | **never move.** A building standing in front of the wall gets "Outside the wall" on its sheet and is attacked first. A building on the wall line counts as part of the wall. |
| Guardian posts | unmoved ones go to the front defaults; moved ones stay |
| Chapter 4 goal "Lay 3 pieces of fence" | "Raise the fence across the trail" (done when the fence is level 1 or higher); goals already ticked stay ticked |
| Tips `fence`, `gate`, `works`, `prowler` | rewritten for the front; a new one-time mark `front` for Pip's line |
| Strongholds | the ladder position (`camps`) is kept; layouts change (see Balance for difficulty) |
| New fields | `front: { v: 1, x, pads, spots, shed, broken }`, `stats.held`, `stats.heldRun`, `nightDue` (minutes read at the last rewarded night) |

---

## 8. Balance

### 8.1 Enemy numbers

Health is in **hits**, the scene's unit (one stone is one hit). T is the burrow level (1 to 5), and base health H = 1 + T, as `prowlHealth` is today.

| Role | Health | Speed (px/s) | Against the wall | Other |
|---|---|---|---|---|
| Creeper | H | 13 | 1 toughness/s | — |
| Runner | max(2, ⌈H/2⌉) | 22 | over in 0.3 s | steals from the oak (2 + T) |
| Flier | max(2, ⌈0.75 H⌉) | 18, in a straight line | flies over | steals from the larder (2 + T) |
| Brute | ⌈2.5 H⌉ | 9 | 3/s, gate first | — |
| Digger | ⌈1.2 H⌉ | 12 underground (cannot be hit) | goes under | surfaces 24 px short of its target, or inside a thumper's ring, dazed for 2 s |
| Bomber | H | 10 | 1.8 s fuse, then the section is gone and its neighbours lose 50 % | through a gap: a building, 2 knocks |
| Wood Lord | 8 H | 8 | 5/s | a pitfall cannot hold him |

### 8.2 Defence numbers

| Thing | Reach | Rate | Hits |
|---|---|---|---|
| Lookout | 30 + 4 × level (lit: +25 %) | every 1.35 s | 1 |
| Hut roof | 26 | every 1.35 s | 1 |
| Archer's nest | 30 | every 0.9 s | 1 (2 vs fliers; fliers first) |
| Stone thrower | 44 | every 2.6 s | 2, plus 1 to all within 8 px; sets a bomber off |
| Watch bell | — | all throwers × 0.7 interval while anyone is at the wall | — |
| Thorn strip | 14 px of trail | 1 hit per 1.2 s (runners: per 0.4 s) | — |
| Tanglefoot | 15 px | walkers at 45 % pace | — |
| Pitfall | 6 px | swallows the first brute, or the first 2 others | — |
| Thumper | 30 | diggers surface, dazed 2 s | — |

### 8.3 Waves

- **Size:** 3 at chapter 3, then +1 a chapter (10 at chapter 10), +1 every second volume, at most 12. Winter: × 1.25 (at most 12).
- **Mix:** specialists (any unlocked non-creeper role) make up at most half the wave. Each specialist role has 0 to 2 in a wave, and at most 1 in the chapter it first appears. The book's genre gives its favoured role +1 three nights in ten (`GENRE_FOE` kept). Creepers fill the rest. The draw is deterministic per (camp, night number), so the chip's promise is exactly what comes.
- **Big nights:** the first night after reaching chapter 6, 8 or 10, and each volume: the tier's Wood Lord plus a normal wave.

### 8.4 Targets (the simulation must show these before shipping)

- A camp **built for its chapter** (buildings at the chapter's top, the counters for that chapter's enemies placed sensibly) **holds at least 85 % of nights** and loses nothing on at least 95 %.
- **Counters matter.** On nights when an enemy role comes, placing its counter raises the held rate by **at least 20 points**, measured for every role/counter pair. Every wall level raises the held rate on brute nights by at least 10 points.
- **A bare camp** (wall and lookout only) holds 40 to 70 % from chapter 6. It never loses more than the daily caps (2 knocks and 1 theft, under 5 % of a day's oak).
- **Raids:** the forecast ladder for strongholds 0 to 40, with hut levels 1 to 5, is **monotonic** (stars never rise from one stronghold to the next for the same camp). The point where it turns to 0★ moves by no more than ±2 strongholds from today, compared with `raidForecast` before and after.
- **Friend raids:** scouts against a camp at their own level take about ★★ (today's `FRIEND_STURDY` tuning); against a camp two levels up with the counters placed, ★ or none.

### 8.5 Simulation plan

Extend `scratchpad\hollow-review\sim2.ts`, and add `waveSim.ts`, both run with vite-node from `apps/` and importing the pure rules:

1. **Progression:** the existing reader simulation, plus buying front constructs (the counter for each new role as it arrives) and swapping slots to match the telegraph. Report the chapter day, acorns spent on the front, and bounty earned (bounty must stay under 10 % of acorns earned).
2. **Waves:** chapters 3 to 12 × camp types {bare, built, built+counters, built+wrong counters} × 200 seeded nights. Report the held rate, prowlers through by role, sections broken and knocks. A role × counter matrix checks the 20-point rule.
3. **Raids:** strongholds 0 to 40 × hut 1 to 5 × {no hero, hero}, before and after. Report the stars curve and the first 0★.
4. **Timing:** the wave planner's time per night at sizes 3 to 12 (target under 8 ms on desktop Node; phone check in section 9).

---

## 9. Performance (mid phone: OnePlus Nord CE4 Lite, Snapdragon 695)

- **A fixed trail makes pathing cheap.** Walkers follow the trail polyline (with a ±3 px sideways offset each) until the wall. Only those going round an end or through a gap call `findWay`, at most once each and cached. Fliers and diggers move in a straight line.
- **The night is planned once at dusk**, together. A joint planner (`planWave`) steps all of the wave's prowlers in 0.1 s ticks, so a bomber's gap opens the way for the creepers behind him, and records each prowler's track, the shots and the section toughness over time. Scale: about 12 prowlers × 900 ticks × about 15 throwers/traps/sections, roughly 160k small operations (a few ms). If a phone profile shows more than 8 ms, it is split across idle frames during dusk, before anyone steps out.
- **Painting:** `runScene` and `frameGate` stay as the perf agent left them. The scene paints at 30 fps only while a prowler or shot is on screen, and otherwise only on change or art frames. At most 12 prowlers and about 20 stones in the air at once. Eyes and mist at dusk are art-frame (12 fps) things.
- The planner lives in **pure rules code** (`pip/base/front.ts`), not in the canvas file, so tests and the sim run the exact code the screen draws.

---

## 10. Phased implementation

Each phase ends with `npx tsc --noEmit -p .` and `npx vitest run` green, and screenshots at 844×390, 740×360 and 1280×800.

| Phase | What | Files (mine) | Rough size |
|---|---|---|---|
| **1. Rules core** | `front.ts`: trail geometry by clearing level, wall line and sections, gate, pads and spots, roles table, slot rules, constructs remap and refunds, migration in `readBase`/`keptForm`, chapter goal text, tip marks. Tests: migration (scattered pieces → full wall, `downed` → broken sections, duplicate and retired constructs refunded), sections per level, slots per chapter. | `pip/base/front.ts` (new), `rules.ts`, `chapters.ts`, `guards.ts`, `tips.ts`, tests | 1 day |
| **2. The scene** | Dark Wood strip, trailhead (day/dusk/night/season), trail, palisade run and gatehouse art (`base-art.js`), all spawns at the trailhead, `planWave` with section toughness, bombers/diggers/brutes/fliers by role, dawn mend, phone camera lean. Tests: every spawn at the trailhead; walkers stay on the trail until the wall; a bomber opens a section; a digger surfaces in a thumper ring; a planner timing bound. | `scene.ts`, `base-art.js`, `front.ts`, `scene.test.ts` | 2 days |
| **3. Screens** | Defence tab → The Front (pads, spots, shed), Edit wall slide and snapping, sheets ("Covers the trail"), guide page, chapter card enemy/counter pairs, night chip and card, dawn result, Pip's one-time line, bounty. | `BaseScreen.tsx`, `siteSheet.ts`, `HollowGuide.tsx`, `ChapterCard.tsx`, `HollowTop.tsx`, `hollowRules.ts`, `baseStore.ts`; CSS only in new blocks of `hollow.css` | 1.5 days |
| **4. Raids** | Drop strip, stronghold layouts facing the trail, lanes autopilot, Puffcap, forecast hint, friend raids from the trail. Tests: drop allowed only in the strip; forecasts monotonic; friend raids start in the strip. | `battle.ts`, `BattleScreen.tsx`, `rules.ts`, `ladder.ts`, tests | 1 day |
| **5. Balance and phone** | Run the simulations, tune to the targets, profile on the emulator (`leaflet_phone36`), final screenshots. | sim scripts (scratchpad) | 1 day |
| **Later (1.5.11+)** | Wood Lords and banners; construct levels; Nights-held badge on the profile card; any "night you missed" report (only if the owner wants it, see 11.3). | | |

**Must-have for the first version** (what makes "one front" understandable): phases 1 to 3, plus the drop strip and stronghold walls facing it from phase 4.
**Can follow:** Puffcap, forecast hints, Wood Lords, construct levels, badge.

### Risks

1. **Size against 1.5.10.** This is about 6 to 7 days of work, late in a release that is already full. Options: (a) 1.5.10 ships phases 1 to 3 plus the minimal phase 4; (b) 1.5.10 ships without it, and this becomes **1.5.11 "The Front"**. My recommendation is (b), unless 1.5.10 is not yet due.
2. **Re-seating constructs moves things players placed.** It is softened by Pip's line and by nothing being lost, but it breaks the "never moves" rule for constructs only. The alternative is to leave them in place, inactive, with "Not on the front" until moved, which is more confusing.
3. **Mixed versions on synced devices.** We keep writing `walls`, `gate` and `works` in their old shapes. A 1.5.9 device shows a vertical fence and the constructs at their pads. Tests cover a round trip through `keptForm`.
4. **Art load:** the palisade run and gatehouse for 5 levels, the trailhead in 4 seasons by day and night, the Thorn strip, the Puffcap, and later 3 Wood Lords. The worst case is placeholder art from existing sprites (a fence cut, the hut's door).
5. **Test churn:** `scene.test.ts` (946 lines), `rules.test.ts` and `battle.test.ts` assume pieces and four sides. Expect many rewrites, not just additions.
6. **Raid difficulty shift** when sides become lanes: covered by the before/after forecast check.
7. **Phone framing:** the camera lean must not fight the reader's own drag. It only eases when untouched for 2 s.
8. **Another agent's CSS:** new styles go in new, clearly separate blocks.

---

## 11. Decisions I made (and the owner can overturn)

1. **Nights only while watching**, with the first one after reading rewarded. No off-screen nights.
2. **Twelve constructs become seven**, with two retired and refunded.
3. **Slots:** 3 trap spots and up to 3 tower pads, opened by chapter, with free swapping from the shed.
4. **Creeper skins** keep the Stumbling and the Frostwights as looks rather than roles.
5. **The wall slides** in Edit (x 44 to 104) but is not drawn by hand.
6. **Ship as 1.5.11** (recommended).

Open for the owner:
- Should a missed night ever be reported (a "while you were reading" replay)? I recommend no.
- Wood Lords in the first version, or later? I recommend later.
- Should the hut's Puffcap come at hut level 3 (my plan) or 5?
