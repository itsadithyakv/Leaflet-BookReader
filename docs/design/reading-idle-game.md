# Pip's World: an idle game that runs on reading

A design proposal. Built so far: seeds, the shop, Pip's house with floors and
the Attic Arcade, and the garden (in a first form: reading waters plants that
are harvested for seeds, rather than a separate petal currency; see
[features.md](../features.md#seeds-and-the-pip-tab)). The rest is where they
could go.

## The one rule

**Reading is the only input.** Everything in Pip's world grows from minutes
read in focus and books finished. Tapping, idling with the app open, or
playing mini-games never produces the things that matter. The game is a
mirror that makes reading visible and rewarding; it must never become a
reason to open Leaflet *instead of* reading.

From that rule:

- No real money anywhere (the desktop app is free; the mobile app is paid
  up front). No loot boxes, no timers that charge you to skip.
- No punishment for being away. Things pause; nothing dies, rots or is
  taken away. A broken streak takes nothing (Pip catches a cold; it used to cost shelf spines); the game adds no
  second penalty.
- Offline progress is earned progress: the world "catches up" on what you
  read elsewhere (other device, paper books logged later), never on wall
  time alone.
- Everything is derived from the reading ledger (sessions, days, books), so
  it cannot be farmed by editing a number, and it survives reinstall through
  the existing backup.

## The loop

```
read in focus ──► seeds ──► spend in Pip's world ──► world grows & looks lived-in
     ▲                                                        │
     └──── Pip nudges: "the garden's thirsty", "chapter 3 of ──┘
           the expedition is waiting", a friend visited
```

The idle part is that the world keeps *working* between sessions on what you
already read: plants finish growing, Pip continues an expedition, critters
do their jobs. You come back to small, pleasant surprises, and the fastest
way to more is another chapter.

## Currencies (three, no more)

| | Earned by | Spent on | Feel |
| --- | --- | --- | --- |
| **Seeds** 🌱 | focus minutes (exists) | clothes, decor, floors, plants | everyday |
| **Petals** 🌸 | the garden, from seeds planted and watered by reading | wallpapers, critter homes, garden upgrades | the idle layer |
| **Stars** ⭐ | finishing books, expedition milestones, monthly chronicle | rare things: legendary variants, new floors | milestones |

Stars cannot be ground out: roughly one per book finished plus a few per
month. Legendary items cost stars, so the rarest things in the game say "this
reader finishes books", which is exactly the flex worth having on a profile.

## Pillar 1: the Garden (the idle engine)

Pip's rooftop garden has plots. Plant a seed packet (bought with seeds); a
plant grows **by minutes read**, not by clock time. Different plants have
different "reading lengths": a daisy blooms after 20 minutes of reading, an
oak after 10 hours.

- Grown plants produce **petals** on their own, a trickle that accrues while
  you are away, capped at what your last few days of reading "watered"
  (so a month away doesn't bank a month of petals).
- Some plants give **Pip food** (apples, berries, tea leaves), feeding the
  Talking-Tom side without buying food.
- **Genre plants**: reading a genre grows its plant faster (sci-fi grows a
  glowing moonflower, romance a rose bush, mystery a nightshade). The garden
  becomes a picture of what you read.
- **Weather is your week**: a goal met today is sunshine; a streak is a
  rainbow; a broken streak is just a grey day (plants pause, never wilt).

Why it works: planting is a small commitment ("I'll grow the oak this
week"), growth is visibly tied to reading, and the result is beautiful and
yours.

## Pillar 2: Expeditions (every book is a journey)

When you open a book, Pip packs a bag and sets off *into* it. The expedition
is a little map with four stops at 25/50/75/100% of the book. Your progress
through the book moves Pip along the path.

- Each stop gives loot: seeds, petals, and at the end a **souvenir**, a
  unique pixel keepsake from that book's world. For the 549 books and series Pip
  already has scenes for, souvenirs are specific (a dragon egg, an owl
  feather, a gold ring, a green light in a jar, a potato from Mars). Every
  other book gets a souvenir by genre (a map, a magnifying glass, a
  starship model).
- Souvenirs go on the **trophy wall** in Pip's house: the reading life,
  displayed. Hovering one says the book and the date you finished it.
- **Expedition postcards**: at each stop Pip "sends" a postcard (the book's
  scene plus a line), a gentle notification on the Pip tab that also works
  as a nudge to keep going.
- Abandoning a book is fine: Pip "comes home early" with the stops reached.

Why it works: it attaches the game to the thing people already want to do,
finishing the book, and gives the long middle of a book its own milestones.

## Pillar 3: Critters (the house comes alive)

Reading attracts little residents that move into Pip's house over time, each
tied to a habit:

| Critter | Moves in when | What it does |
| --- | --- | --- |
| Bookworm | 10 books finished | Nibbles "typos": +2% seeds from sessions |
| Owl | 7-day streak | Delivers a morning letter: a tip, a quote-free book fact, or a friend's kudos |
| Cat | 30 sessions | Naps on your book; sessions over 30 min earn a nap bonus |
| Firefly jar | 10 night sessions | Lights the house at night; unlocks the night wallpaper set |
| Snail | a 2-hour day | "Slow and steady": protects one missed day a month (a freeze) |
| Parrot | 5 different genres | Repeats your best line from the week's notes |

Critters need a home (bought with petals) and give small, capped bonuses.
They're what makes an idle game feel like a place instead of a
spreadsheet.

## Pillar 4: Upgrades (the idle tree, kept honest)

A short upgrade tree bought with petals: the **Reading Nook** (session bonus
+5%, +10%, +15%), the **Greenhouse** (more plots), the **Watering Can**
(plants grow 10% faster per minute read), the **Postbox** (expeditions give
one extra postcard). Every bonus multiplies *reading*, never replaces it; all
together they top out around +50% seeds, so a new reader and a veteran are
never an order of magnitude apart.

## Pillar 5: Seasons and the Chronicle (prestige that gives, not takes)

Idle games have "prestige": you reset for a permanent bonus. Resetting
someone's cosy house would feel awful, so here the reset is the garden
only, and it produces a keepsake:

- Each month is a **season**. At the end, Pip writes **Pip's Chronicle**, a
  one-page illustrated summary of the month: books, minutes, best streak, the
  souvenirs found, the garden in full bloom, and a line per book. It's
  shareable as an image (the social flex that isn't a leaderboard).
- Writing the chronicle **harvests** the garden: plants return seeds and
  petals, the plots clear for the next season, and you get stars plus a
  permanent **season badge** (spring leaf, summer sun…). The house, decor,
  critters and souvenirs all stay.
- Seasonal plants and decor (pumpkins in October, snowflakes in December)
  rotate in, giving a reason to plant again.

## Pillar 6: Friends (optional, account-based)

- **Visit a friend's house** (read-only), leave a petal as a gift (one a day).
- **Club garden**: a shared tree that grows from the minutes of everyone in
  a small group (like the Following board). Every weekly goal met adds a
  branch; the finished tree gives everyone a decor item.
- **Duels** (exist) award a trophy for the winner's wall.

All of this is opt-in, like the rest of the community features.

## Mini-games (the arcade, kept in its place)

The attic arcade games (Pip Dash, Leaf Catch, Page Flap) are for the two
minutes between chapters. They give mood and high scores, never seeds or
petals. One idea that fits: a **daily "Reading Run"** in Pip Dash whose
length equals yesterday's minutes read, so the game you play is literally
as long as the reading you did.

## Nudges (never nagging)

Pip speaks about the world only when there's something good to say:

- "the oak needs 12 more minutes. that's one chapter." (a concrete, tiny ask)
- "pip reached the halfway camp in *Dune*. there's a postcard!"
- "an owl moved in!"

At most one nudge a day, never at night, and none at all in Quiet mode.
Silence is the default.

## Balancing

Targets, for a reader doing a 20-minute goal most days:

| Horizon | They can afford |
| --- | --- |
| A goal day (60 to 95 seeds) | a treat, a small accessory, a seed packet |
| A week | a mid accessory or a common variant; one plant blooms |
| A month | a new floor or rare variant; a critter; the first chronicle |
| Six months | legendary variants (stars), most critters, a full house |

Guard rails already in place: minutes count only up to what the reading
heartbeat recorded (a timer left running earns nothing), and prices are
enforced in Rust.

## Architecture

- **Event-sourced**: everything is computed from the ledger (sessions, days,
  books, purchases, plantings). No stored "petal balance"; like seeds, it is
  recomputed, so it can't drift and syncs through the existing backup.
- **Deterministic growth**: a plant's state = f(planted_at, minutes read
  since, upgrades). Offline progress is just recomputing on open.
- **Content as data**: plants, critters, souvenirs, expedition maps are
  catalogues like the shop's, rendered by the same pixel engine, generated
  into Rust for price authority (the `pip-catalogue` script).
- **Server**: only for visits, gifts and the club garden; the game is fully
  playable offline and without an account.

## Roadmap

1. **Now (in progress):** seeds, shop, full-page house with floors, decor,
   mini-games.
2. **Expeditions + souvenirs.** The highest value: it ties the game to
   finishing books and reuses the 71 book scenes already drawn.
3. **Garden + petals.** The idle engine; seasonal content later.
4. **Critters + upgrades.** Depth for regular readers.
5. **Seasons + the Chronicle.** The monthly keepsake and share image.
6. **Friends' houses + club garden.** Once the community has people in it.

## Risks

- **Extrinsic motivation crowding out intrinsic.** Mitigated by making
  rewards reflect reading (souvenirs of *your* books, a garden shaped by
  *your* genres) rather than arbitrary points, and by keeping the game
  quiet.
- **Complexity.** Three currencies is the ceiling; each pillar ships alone
  and must be good on its own.
- **Art volume.** The pixel engine and the book scenes make this feasible:
  plants, critters and souvenirs are 32px sprites like everything else.
