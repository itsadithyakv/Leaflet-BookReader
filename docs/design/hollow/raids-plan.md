# Raids, rethought: the Magpie Lands (plan, 2026-10-24)

## What the owner said

> The raid looks really bad, and there is no progress to see how raiding is
> working. If I am not raiding people, show me a map to show my progress.
> Raiding does not have any real challenge plus no strategy, just releasing
> the troops.

## Why it is like that today

- **No progress to show.** The save records how many strongholds have fallen
  (`camps`) and the King's banners, nothing per stronghold. There are no stars
  kept, so nothing to draw a map from.
  - The raid board lists cards (a rematch, the next stronghold, the King,
    three road camps).
  - The ladder runs on for ever under five names, so there is no sense of
    place or distance.
- **No strategy.** `battle.ts` drops scouts "anywhere outside" the camp (since
  1.5.11, along a left strip), and they then "look after themselves".
  - The only skill is where and in what order to drop them. The code's own
    header says it follows another game's raid.
  - Once dropped, nothing can be done, and the forecast says how it will go
    before it starts.
- **No challenge.** Supplies are free. A rematch is "a sure thing". Strongholds
  are tuned so scouts sent by themselves mostly win, so a raid is decided by
  levels, not choices.
- **It looks rough.** A 240×120 field with small sprites, health bars on
  everything, and an end card that says stars without saying what they were
  for.

## What raids become

Raids get mechanics of their own:
- **a map you travel across;**
- **strongholds that are each a small puzzle;**
- **a plan you make before** the battle;
- **a couple of orders you give during** it.

What stays from the Hollow's rules (memory: "What the Hollow is for"):
- Reading pays for raids: rest comes from 15 minutes read.
- Never a chore, and nothing expires.
- Losses are small: a lost raid costs only the rest.
- Upgrades must be measurably worth it.

### 1. The Magpie Lands: the map is the raid screen

The raid key opens a map instead of a list.

- **One path** runs from Pip's camp through **five regions**, using today's
  names: the Twig Nest woods, Bramble Roost, the Tin Hoard hills, Crow's
  Corner, the Old Rookery.
  - Each region has **three strongholds**. The third is a **lord's keep**,
    with today's champions.
  - The **Magpie King's roost** stands on the peak, lit in the months he can
    be fought. Each month's banner, once won, flies on the summit.
  - After stronghold 15 the path goes on into **the Far Rookeries**: one node
    at a time, numbered, so the endless ladder of today is kept.
- **Every stronghold node shows** its best stars (0 to 3), and a lord's
  pennant once his keep falls.
  - Taken strongholds can be **replayed for stars**. This replaces the
    "rematch", which was a sure thing with nothing to judge.
  - Loot goes to new stars only, plus a small share.
- **Fog reveals with reading.** Regions past the camp's current chapter lie
  under fog, which lifts as chapters are reached. The map is a picture of how
  far the reading has carried the camp: the Hollow's point.
- **No daily road camps.** They stopped being played on 2026-10-15, because
  three new camps a day is a daily chore. This plan first brought them back
  by mistake, and they were taken off again the same day. Replaying a
  stronghold for stars is what is always there to raid.
- **Friends' camps** sit behind a signpost at the map's edge, shown only when
  the reader has said yes to friends' raids.
- **One line at the top** says it all, for example
  "Stronghold 7 · 16★ of 21 · Next: Bramble Keep".
  - A tap shows the totals: strongholds taken, stars, keeps, banners.

### 2. A stronghold is a puzzle: scout, plan, then fight

Each raid has three steps, all short.

**Scout (free, before committing).** The stronghold is shown whole:
- walls and gate;
- perches with their reach drawn;
- hoards, the nest, and the champion if there is one;
- its one **quirk**.

Quirks come from a small set, and each stronghold always has the same one, so
it can be learned:

| Quirk | What it does | What beats it |
| --- | --- | --- |
| Thorn hedge | One approach is slow and hurts | Moles go under it |
| Watch-crow | At half strength it calls a second flight of defenders | Silence its perch first |
| Ford | One approach crosses water: slow for all but moles | Use it for moles, or avoid it |
| Fog | Perches see less far | Slingers walk right up |
| Second gate | Two weak points instead of one | Split the force |
| Pitfalls | Hidden holes on the main trail | Sprouts first to spring them |

**Plan.** A stronghold has **two or three approaches**, drawn as paths: for
example the trail (walled), the ridge (open, under perches) and the stream.
The reader:
- chooses the **squad** within the hut's capacity. Kinds cost different room:
  sprout 1, slinger 1, mole 2, Puffcap 3. So the mix is a real choice.
- puts each **group on an approach**;
- **holds one group back** as a second wave, if they like.

The forecast shows the plan's likely stars, honestly and coarsely, as it is
built. It says "Likely ★★" rather than an exact number, so planning is about
judgement, not reading off an answer.

**Fight, with orders.** The battle plays out as now, but the reader has
**orders**: three per raid, more with hut levels. An order is one tap, never a
timing test:
- **Rally:** a group turns to a chosen target.
- **Second wave:** release the held group.
- **Hero's move:** the hero's one big act, when the reader says. For example,
  the leaper vaults the wall, or the healer mends everyone once.

### 3. Stars that mean something

- ★ **Take the nest.**
- ★★ **Pull down most of it** (today's share).
- ★★★ **The stronghold's feat**, tied to its quirk:
  - "Silence the watch-crow before it calls";
  - "Lose no more than two scouts";
  - "Take it before the bell" (40 s);
  - "Leave the gate standing".

The end card says which stars were earned and **why the missing one was
missed**, in one line, and the node on the map fills in.

### 4. How it should feel (measured, as the Front was)

A simulation runs fixed seeds over every stronghold, at the upgrades a reader
would have reached by then ("par"). It compares two plans:
- a **naive plan**: everyone on the default approach, no second wave, no
  orders;
- a **good plan**: found by searching approaches × squad mixes × order
  timings.

Targets:
- The naive plan averages **about 1★** at par, and **loses** some strongholds
  from region 2 on.
- The good plan takes **★★★ on at least 90%** of strongholds at par.
- The gap between them is **at least 1.5★** on average: planning matters.
- **Every quirk** has a counter-plan worth **at least +1★** over the naive
  plan on that stronghold.
- **Each hut level** raises the naive plan's stars measurably on the next
  stronghold: upgrades matter.
- A **lord's keep** is not 3★-able by the naive plan at par.

### 5. The look

**Owner, 2026-10-24:** "the raids on laptop are … enclosed in a small little
screen. make the UI more like what hollow looks like … progress maps." So:
- The map, the scout and plan steps, and the battle **fill the window as the
  Hollow's camp does**, never a framed box.
- They use the camp's own chrome (`HollowTop`, `HollowDock`).
- The map reads as a level-select progress map, with Pip at the frontier node.

- **The field:**
  - drawn at whole-number scale and larger on screen;
  - stronghold pieces in the camp's 3/4 pixel art;
  - magpie defenders with clear tells: a perch winds up before it throws.
- **Health and hits:**
  - health shown only on what is hurt, as pips rather than bars;
  - a short hit flash and dust puffs. Nothing shakes, and small sprites never
    twitch.
- **Things falling** (owner, 2026-10-24: "the buildings too, once destroyed
  have animations and stuff"). Each kind of structure falls in its own short
  pixel animation, then leaves rubble that stays for the rest of the raid:
  - a wall section splinters and topples;
  - a perch tips over, with its magpie flapping off;
  - a hoard bursts, and acorns hop out toward the scouts;
  - the nest collapses in a puff of twigs and feathers.
  
  A hurt structure shows cracks before it falls. Animations run once, never
  loop, and never shake the field. Reduced motion shows the rubble straight
  away. The same pieces serve friends' camps and the Front's broken wall
  sections where they fit.
- **The bar along the top:** the bell (time), three star pips filling as they
  are earned, orders left, and each approach's group.
- **Speed and accessibility:**
  - Smooth by default: no blur, and `prefers-reduced-motion` respected;
  - painted at 30 fps only while something moves (`frameGate`);
  - within the Adreno 619 budget;
  - works on a phone upright and sideways.

## What does not change

- Rest comes from reading, and supplies stay free.
- Heroes (from books finished), blades, lords and champions, and the monthly
  King.
- Friends' raids keep working. They use the same battle, so a friend's camp
  gets approaches from its own layout.
- Nights on the Front (`front.ts`, `wave.ts`) are untouched.

**Saves stay compatible:**
- New fields (best stars per stronghold, and which have been scouted) ride in
  a short taught mark, as the Front's and the meadow's do. A camp saved by
  1.5.12 or older reads as "stars unknown" for strongholds taken before. Those
  are shown as taken, with stars filled in when replayed.
- Older builds keep the mark untouched.

## Work, in order

1. **Rules and simulation** (pure TS: `battle.ts`, new modules for
   approaches, quirks, orders and feats, and a sim script), tuned to section
   4.
2. **The map** (in parallel with 1):
   - the save's new fields and the mark;
   - the map model (regions, nodes, fog, road camps, King, friends);
   - the Lands screen replacing the raid board as the raid key's home;
   - replay for stars in place of the rematch.
3. **Plan and battle screens** (after 1): scout view, squad and approach
   planning, orders during the fight, the new HUD, the end card, and the look
   in section 5.
4. **Checks:**
   - every suite;
   - the sim's table against the targets;
   - screenshots at phone and desktop size;
   - timing on the emulator (`leaflet_phone36`), and on the real phone when
     it is connected;
   - `docs/pip.md` and `features.md` brought up to date.

It ships in a release after 1.5.12 has been tested: 1.5.13 with PDF read
aloud, or its own, depending on how long step 3 takes.
