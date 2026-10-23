# Pip

Leaflet's reading companion: a 32×32 pixel sprout who lives in the app. This
page is how Pip works in the code. The character itself (personality, voice,
the full move and skin catalogue) is in the Pip Studio design page.

## One Pip

There is exactly one Pip on screen at any time. Its home is the **header logo**:

- Home: the logo *is* Pip, asleep if nothing has been read today.
- Out: Pip flips out of the logo and drops into the app; the logo shows a
  marching-ants outline of Pip's shape so the spot reads as "Pip's place".
- Selecting the logo calls Pip home or lets it out; a Pip thrown up into the
  logo goes home.
- With a book open, the free Pip steps aside and celebrations come through the
  **reader peek** (bottom-right corner). With a session wrap-up open, Pip
  performs in the wrap-up card instead.

## Where the code is

| File | Job |
| --- | --- |
| `src/pip/engine.js` | The 32×32 rig: body, face, leaf, hands and feet, each drawn and given its own 1px outline ("stamped"), so the sprite reads on parchment and leather. Plain JS, typed at the boundary by `index.d.ts`. |
| `src/pip/anims.js` | The move library (~75 moves). Each move is a pure function of the frame number, so frames can be cached. 12 fps. |
| `src/pip/skins.js` | The variants: the achievement skins (`earnedOnly`, never sold; since 1.5.10 earned by reading, by the rules in `src-tauri/src/pip/earned.rs`) and the shop's variants (robot, president, skater...), each with a `price` in seeds. |
| `src/pip/accessories.js` | The wardrobe: accessories by slot (head, face, neck, back, hand), and `dress(skin, ids)`, which makes a skin wear them. |
| `src/pip/room.js`, `src/pip/treats.js` | Pip's house (room styles and items, drawn by `renderRoom` / `renderRoomItem`) and its food and toys (each with its own move). |
| `src/pip/shop.js` | The shop's one list and the price authority: what is for sale and at what price (the art's prices rescaled to the garden economy), plants, plots, premium moves, free signatures, book-nod matching. Read by the Pip tab, and by the generator below. |
| `scripts/pip-catalogue.mjs` | Writes the shop's prices for Rust (`src-tauri/src/pip/catalogue.json`) and the avatar parts for the server (`server/src/pipParts.json`). The Vite build runs it. |
| `src/pip/door.js` | Scenery drawn by the same engine: the empty-home outline. |
| `src/pip/moments.ts` | Events → moves and lines. Each moment has a pool; the pick is seeded (by day, session, book) so every surface agrees on one move per event. |
| `src/pip/tour.ts` | The guided tour's stops. |
| `src/pip/ticker.ts` | One shared 12 fps clock for every sprite; stops when none is mounted. |
| `src/components/PipSprite.tsx` | Draws a move to a canvas at a whole number of device pixels per sprite pixel, so Pip stays crisp at 125% and 150% Windows scaling. |
| `src/components/PipWorld.tsx` | Pip living in the app: physics, walking, being thrown, the tour, the right-click menu. |
| `src/components/PipHome.tsx` | The header logo / Pip's home. |
| `src/components/PipSay.tsx` | The pixel speech bubble, with typed-out text and optional buttons. |
| `src/components/SessionWrapUp.tsx` | The end-of-session card, Pip's one big stage. |
| `src/components/PipReaderPeek.tsx` | Celebrations while a book is open. |
| `src/hooks/usePipReactions.ts` | Which reading events make Pip react. |
| `src/store/pipStore.ts` | Mode (Chatty / Quiet / Off), home, reaction queue, peek, tour, and `onStage` (the Pip tab is open). |
| `src/store/pipWardrobeStore.ts` | What Pip wears and owns, the seed wallet, the room: a view over the Rust side, loaded at startup. |
| `src/pages/PipPage.tsx`, `src/components/pip/` | The Pip tab: Pip's house (floors and the lift, decorating, the garden), the HUD (seeds, mood, a pinned goal, the tool rail), the shop, Pip's things, and the arcade. |
| `src/pip/house.js`, `house-nods.js`, `games-art.js` | The house's floors, decor, wallpapers and floors, the book-nod items, and the arcade's art. |
| `src/pip/home.js`, `src/pip/garden.js` | The house as the app sees it (normalised from the art), and the garden's plots and plants. |
| `src/pip/bookNods.ts`, `src/pip/books/*.js` | The table of book nods (`NODS`), `nodFor(book, seed)` returning `{ move, line, known }`, the genre fallback (`nodGenre`, `GENRE_NODS`) and how often a nod plays (`NOD_ODDS`); the 71 scenes (`fantasy`, `classics`, `classics2`, `modern`, `romance`, `popular`). Not shop items and not in the catalogue. |
| `src/pip/genre.ts`, `readingMoments.ts`, `src/pages/pip/usePipWorld.ts` | Pip knows your book: a book's genres to a mood, the reading moments, and the one `world` input the house scene is given. `worldStub.ts` sets it by hand in development. |
| `src/pip/bookSpines.ts`, `houseplant.ts`, `roomTime.ts`, `house-fixtures.js` | Her shelf (finished books, a cover's one colour, the ribbon's place), the plant's rule, what the calendar and clock show, and the bedroom's fixtures with a job. |
| `src/components/pip/roomThings.tsx`, `RoomCard.tsx` | What the room's things show that is the reader's own, what each offers Pip, and the card each opens. |
| `src/pip/diary/`, `src/components/pip/diary/` | Pip's diary: the day's facts, her lines, the week's postcard (`openPipDiary`). |
| `src/pip/expedition.ts`, `expedition-art.js`, `src/components/pip/album/` | Expeditions: what each focus session found (derived, never stored), the 44 sprites, the album, and `useExpedition` (she is out / back with a find). |
| `src/pip/cold.ts` | The cold's level for drawing and its words for the mood panel (the rule is Rust's, `habit::cold`). |
| `src/pip/visitors.ts`, `useVisitors.ts`, `src/components/pip/Visitors.tsx`, `VisitorPip.tsx` | Visitors: the pure rules and timeline, the store and driver, the layer mounted over the room. Sound `knock` in `pip/sound.ts`. |
| `src/components/pip/arcade/quiz/` | The Word Quiz, "Who is this?" and My words. |
| `src/ambience/` | The radio: `scenes.ts` (each scene as data), `schedule.ts` (seeded, pure), `grains.ts`, `engine.ts` (the Web Audio graph), `state.ts` (when it sounds), `ambience.ts` (the store), `ReaderAmbience.tsx`, `AmbiencePanel.tsx`, `measure.ts`. |
| `src/desktop-pip/`, `src-tauri/src/desktop_pip/` | Pip on the desktop: her page and brain (poses `sit` and `holdup` in `moves.js` load only in her window), and the window, its thread and the Win32 calls. |
| `src/pip/play.ts` | Playing with Pip, as pure rules: the poke ladder (shared with the desktop Pip), a high five (`tapAgain`), a cuddle (`pressOf`), strokes and where they fall (`strokeMove`, `zoneOf`, `rubOf`), a finger's rub or carry (`fingerLifts`), the swing in the hand, a whirl (`whirlMove`, `whirled`), flight, and what counts (`PLAYS`, kept in step with `pip/mod.rs`). |
| `src/pip/furnish.ts`, `src/components/pip/furnishings.tsx` | The room under the hand: what each kind of furnishing does (curtains, pictures, the bed, lights, the fridge, the things that open a card), the pieces that answer a tap and have Pip come over (`VISITS`), and the buttons laid over them. |
|  | Curtains are worked by a tap or by a pull anywhere on the window, any way (`curtainTug`, `curtainLetGo`): they used to want the hand to go towards the middle of the window, so a press on the glass could not draw them, and a tap with an unsteady hand did nothing. A picture knocked the same way once it is as crooked as it goes comes off its nail (`comesDown`, `fallStep`): it falls, bounces, lies on the floor and gives Pip a start; a press on it hangs it again, and so does Pip when she next goes to straighten it. Fallen is not remembered: reopened, it hangs crooked. |
| `src/pages/pip/common.ts` | What the shop's Decor shelf sells without the whole house: `STARTER_DECOR` and `MORE_DECOR` (`onShelf`). |

## The Pip tab: Pip's house

Pip's own place, and the reward for reading: all reading waters Pip's garden
(a focus session twice as fast, since 1.5.7), ripe plants give seeds, seeds
are spent on Pip. Economy rules, commands
and data are in [features.md](features.md#seeds-and-the-pip-tab); this is the
Pip side.

- **One Pip.** While the tab is open (`pipStore.onStage`) the roaming Pip steps
  aside, as it does for a book, and celebrations play in the house instead.
- **The house** is floors of 240 x 120 art pixels (`house.js`:
  `HOUSE_LEVELS`, `renderLevel`), one at a time, filling the page at a whole
  number of device pixels per pixel; Pip's sprite is drawn at the same scale,
  so it stands in the room. `pip/home.js` normalises the art (slots from their
  anchors, the garden free and second, the layout keys), and falls back to the
  single room from room.js if the house art is missing. The scene loops a few
  seconds of animation from the current hour's sky (`skyFrame`), so windows
  show the real time of day, and dims in the evening so lamps glow.
- **The room's own light, and who it falls on** (since 2026-10-13, the
  owner's asking: "Add light sources, maybe a toggle switch. Pip being bright
  randomly looks off"). Every bedroom has a ceiling light and a switch on the
  wall (`pip/house-fixtures.js`: `ceilinglight`, `lightswitch`; fixtures,
  like the fridge: in no shop, slot or saved layout). They are one light:
  either switches it, it is on in a new room, and off or on is remembered on
  this device. It pools over most of the room (reach 230 floor pixels) and
  moves to one side of whatever the reader hangs in the middle of the
  ceiling. Pip answers it as she does any lamp, and flicking it at her wears
  on her temper as before.
  What is laid over the room's picture is now lit by the room's lights too.
  By night Pip and her ball used to be drawn as bright as by day in a dark
  room. Now the scene asks for the floor's lights (`houseGlows`, the same
  list the night picture is pooled from), and each is as bright as the light
  where it stands (`lightOn`, `litBy`: 0.55 with none, 1 from a light of
  0.45 up, in steps of a twentieth). So she is dim in a dark room and lit
  under the lamp, by the open fridge, or by her phone in bed. She takes the
  light's colour as well (`litMatrix`): each has an SVG colour filter in the
  room whose twenty numbers the scene sets (`lightThings`). A light that is
  all colour shows on her up to seven times as strongly as on the wall
  (`COLOUR_SHOWS`), a white one hardly at all (`WHITE_SHOWS`), so a warm
  lamp only warms her and she is not washed out. The Disco Ball now throws a
  fainter wash of its colour down to the floor (reach 140 beside its old
  44), so in the arcade the room and Pip turn pink, blue, yellow and green
  with it, a second each. By day a light that is on glows softly round
  itself (`dayLight` in `house.js`: a little of its colour added, and up to
  8 in 100 brighter; it used to show only after dark, 2026-10-14). And drawn
  curtains no longer darken a room whose light is on: their shade loses nine
  tenths of itself when the room's lights reach its middle at half strength
  (`roomShade`, `LIGHT_LIFTS_SHADE`); before, with the curtains drawn,
  switching the light on did nothing to be seen. The clock, a
  picture off its nail and drawn curtains, which the furnishings layer draws
  itself, are darkened by the same rule as the wall behind them
  (`dimForNight` with the light on them) and drawn again when a light is
  switched. A frame of the lit room costs about 10 ms to paint the first
  time (3 ms dark, 2 by day) and is kept after that.
- **Pip in the house** (`components/pip/HouseScene.tsx`) strolls, fills free
  moments with its signature move or a hobby, can be dragged and dropped (it
  falls back to the floor), walks with the arrow keys when focused, and is
  poked by a click. One requestAnimationFrame loop on refs, stopped when the
  tab is hidden.
- **Playing with Pip.** What the hand does to her is worked out in
  `pip/play.ts` (pure, `play.test.ts`) and drawn by `HouseScene`. Every way
  has a pointer, a finger where a finger can do it, and a key; without motion
  each has a still answer (a pose and a line).

  | Way | Mouse | Finger | Keys | Counts as |
  | --- | --- | --- | --- | --- |
  | Poke (a ladder of five answers, then a surprise) | click | tap | Enter on Pip | nothing |
  | High five | two clicks within 320 ms | two taps | Enter twice; H on Pip; **High 5** on the Play rail | `pet` |
  | Cuddle | press and hold still for 0.55 s; it lasts until the button lifts | the same | C on Pip; **Cuddle** on the rail | `pet` |
  | Stroke | rub slowly across her, no button | rub across her, finger down | **Pet** on the rail | `pet` |
  | Tickle | rub fast across her belly | the same, finger down | **Tickle** on the rail | `tickle` |
  | Tickled leaf (a sneeze) | rub fast across her leaf, the top two fifths of her | the same | L on Pip | `tickle` |
  | Carry, drop, throw, catch | drag by more than 4 px | drag off her: up or down by a third of her height, or sideways by most of her width | arrows walk her, up arrow tosses her; **Toss** | `toss` |
  | Whirl (giddy when let go) | swing her round in a circle twice while she is held | the same | S on Pip; **Spin** on the rail | `toss` |
  | Ball, dance | the ball is thrown by hand too | the same | their keys on the rail | `fetch`, `dance` |

  **The ball is a game of catch** (`pip/catch.ts`, tests beside it; since
  2026-10-13, the owner's asking: it used to be fetch and nothing else, ten
  seconds a go). The ball that reaches her she throws back, in an arc that
  comes down where the pointer is (`lob`, `throwTarget`; the middle of the
  floor with no pointer in the room). A press on it in the air is a catch; a
  press let go without moving tosses it gently to her (`underarm`), and so
  does the rail's **Ball** key, a little differently each time; a drag let go
  throws it as fast as the hand was going over its last 80 ms (`flick`, at
  most 420 floor pixels a second). A press that is cancelled, or lost to
  another window, drops it where it is and never throws it. The press area is
  44 CSS pixels however small the ball is drawn (`GRAB_MIN`).

  | Rule | Value | Constant |
  | --- | --- | --- |
  | How she takes one | a catch mostly; 26 in 100 a header or a kick straight back; 9 in 100 it bonks her on the head; 11 in 100 she jumps and misses | `FLOURISH_CHANCE`, `BONK_CHANCE`, `MISS_CHANCE` |
  | A fumble | never her first of a game, never two running; it ends the rally | `receive` |
  | The rally | catches in a row, hers and the reader's; shown beside the ball from 2; she cheers at 5, 10, 20 and each ten after | `RALLY_SHOWS`, `RALLY_CHEERS` |
  | A rally that is a game | 4 catches: her temper takes it as `game` | `RALLY_IS_GAME` |
  | Her wind-up | 680 ms, down to 320 as the rally grows; 1,100 when she is sulking | `WINDUP_MS`, `WINDUP_HALF_MS` |
  | Nobody catches hers | she tries twice more, then waits | `TRIES` |
  | The wait | at 6 s she nudges the ball over, at 22 s lies down with her chin on it, at 55 s puts it away | `ASK_NUDGE_MS`, `ASK_CHIN_MS`, `ASK_AWAY_MS` |
  | A ball rolled gently to her feet in a huff | a peace offering: the huff is over and she pats it back | `peaceOffering`, `offerPeace` in `pip/temper.ts` |

  The ball itself has weight (`ballStep`: gravity 640, a bounce that keeps
  0.58, a roll that stops dead under 5 pixels a second), stepped 120 times a
  second whatever the frame rate, a frame of more than a tenth of a second
  cut short. It squashes on what it hits, stretches at speed and has a shadow
  that shrinks as it rises, all in whole pixels (`ballShape`, `shadowOf`).
  Nothing is won by a rally, kept from it or lost when it ends. With reduced
  motion there are no arcs: the ball is placed, she hands it back, the rally
  still counts.

  The second of two quick taps is a high five instead of a second poke, and
  the poke ladder goes back to where it was before the pair (`tapAgain`); a
  third quick tap pokes again, so hammering at her still climbs the ladder.
  A finger cannot hover, so a finger that stays on her rubs her and only one
  that leaves her picks her up (`fingerLifts`); a mouse still picks her up at
  the first 4 px. A whirl is the turn of the hand's heading added up
  (`whirlMove`): a shake to and fro adds up to nothing. No new kind of play
  was added: `PLAYS` is still the five that Rust knows, and each new way
  counts as the nearest of them, at most once every six seconds a kind.
- **Things that answer a tap.** A piece of decor of the furnishing kind
  `visit` (`pip/furnish.ts`: `KIND_OF`, and `VISITS` for what each one does)
  gets a button like the bed and the lamps (`components/pip/furnishings.tsx`:
  its own label and tooltip, Enter, a press area of at least 24 px, 44 under a
  finger). Chosen, the thing answers at once (a sound from `pip/sound.ts`,
  and notes, bubbles, hearts or sparks off it), and Pip, if she is free,
  walks over and does what one does with it; she also goes to most of them of
  her own accord now and then (`visitOffer`, the planner's `potter`). All of
  it is for show: no mood, no seeds, nothing told to the page. A dance at one
  is a dance she owns, or her little bop: never a move the shop sells.

  | Piece | What happens |
  | --- | --- |
  | Aquarium, Goldfish Bowl | she comes and peers in with her magnifying glass; bubbles |
  | Fireplace | she warms herself, and yawns |
  | Cuckoo Clock | the cuckoo; she jumps where she stands, then laughs |
  | Spinning Globe | she watches it go round and is dizzy |
  | Record Player, Disco Ball, Robot Buddy | a tune (a beep from the robot), and she dances (the disco or the robot if she owns it) |
  | Music Box | a tune, and her little bop |
  | Upright Piano | she plays it |
  | Cat & Cat Bed | she fusses the cat; a mew, a purr, hearts |
  | Cat Tower | she calls the cat down, and is ignored |
  | Potted Monstera, Tulip Planter, Tall Sunflowers, Bonsai Tree | she waters it |
  | Hanging Fern, Fairy Lights, Globe String Lights, Lava Lamp | she comes and looks up at it |
  | Mushroom Lamp | a lightbulb over her head |
  | Trophy Shelf, Trophy Wall | she holds a trophy up |
  | Reading Nook Tent | she plays ghosts in its doorway |
  | Beanbag, Hammock | she floats off to sleep on it |
  | Garden Gnome | she inspects him, then looks over her shoulder |
  | Lily Pond | she looks for the frog |
  | Neon READ Sign, Ceiling Fan, Game Controller | she reads it; cools off under it; has a go |
  | Trampoline | she bounces on it four times (thrown by the scene, as a toss is), then cheers |
  | Bubble Machine | bubbles, and she pops them on her toes |

  The Velvet Armchair and the Retro Fridge are not among them
  (`furnish.test.ts` and `fridge.test.ts` pin both); nor is the arcade's
  jukebox, which is one of its machines and plays a dance that counts.
- **What the shop sells for the house.** With `FEATURES.fullPipHouse` off the
  Decor shelf is the bedroom's own twenty pieces (`room.js`) and the 27 named
  in `MORE_DECOR` (`pages/pip/common.ts`): 24 of the house's pieces that were
  drawn and priced all along and go on any floor or in the garden, and three
  toys drawn for it (Trampoline, Music Box, Bubble Machine: the only new rows
  in `catalogue.json`). A piece is only offered where this house has a floor
  to put it (`placeable`), so the Bookshelf and the Writing Desk, which are
  the library's, still wait; the Spinning Globe, the Record Player and the
  Reading Nook Tent used to wait with them and now go on any floor
  (`LEVEL` in `room.js`). Not sold: other floors' pieces, any floor's starter
  piece, the book nods, and the Lily Pond (the garden's furrows are drawn
  across it). The Greenhouse set can now be finished without the whole
  house; no set, wish list, price or reward changed.
- **The fridge and the phone.** The Bedroom has a mini fridge (a fixture of
  the floor: `FIXTURES` in `house.js`, placed by `home.js`, used through
  `furnish.ts` like the other furnishings). Pip's night life is planned in
  `behaviour.ts` and walked by `HouseScene`: the midnight snack, the phone in
  bed (its light is a glow in the room's own picture), snooze in the morning.
  The moves are in `house-moves.js`: tiptoe, fridge-stare, nibble, caught,
  scroll-* / phone-* (the phone, in bed and standing), innocent, snooze;
  and for her book life and the rest: glance, quilt-hide, underbed, inspect,
  trail, knight, march, swordplay, hangover, dust, bring, show, cold-idle,
  sniffle, tissue, shuffle; and for her temper: stamp, sulk. A Pip
  the reader tucked in is left asleep for 20 minutes. The phone touches
  neither mood, seeds nor the shop. The fridge did not either, and this
  paragraph used to say so; that changed on 2026-10-13, at the owner's request
  (next two points).
- **What is in the fridge** (2026-10-13, the owner: "make Pip sad by not
  having food in the fridge if you don't buy"). Nothing is counted: Rust works
  out from the purchase ledger until when the fridge is stocked
  (`pip/fridge.rs`: each snack bought stocks it for `HOURS_PER_SNACK`, 24, on
  top of what is still in hand, never more than `MAX_HOURS`, 72, from the
  moment it is bought) and sends that with the overview (`fridge.stockedUntil`).
  The open fridge is drawn stocked or bare (`minifridge-open`, `data.bare`),
  its label and tooltip say which, and the mood panel says how long the food
  will last. Bare, a Pip who looks in (of her own accord, or because the
  reader opened it) droops and says so, with no nibble: a couple of times a
  day at the very most and not twice in three hours (`bareMinds` in
  `furnish.ts`, kept in localStorage), after which a look is only a look. The
  first look of a local day takes `BARE_MOOD`, 3, off her mood
  (`pip_fridge_bare`; the day is a device setting, `pip.bareFridge`), never
  below the floor the drift stops at (`mood_minus`, 40), and it is the one
  thing in the mood log with a gain below zero. Nothing is worked out for
  time the app was shut: she has to be up, at home and looking. One snack
  mends it, and the first time she finds food in a fridge that was bare she
  cheers and is in a good mood for a quarter of an hour.
- **Her temper, and the mood she is in** (2026-10-13, the owner: "let her
  throw tantrums", then "let it stay for a bit"). Rules in `pip/temper.ts`
  (pure, `temper.test.ts`), played by `HouseScene`, kept in localStorage
  (`leaflet.pip.temper`) and worked out from the clock, so it survives leaving
  the room or the app and is simply gone past its time. Never sent to Rust:
  the page lays it over the hearts (`onTemper`, `heartsOff`).

  | What | Number | Where |
  | --- | --- | --- |
  | Patience | 0 to 100; comes back at 15 a minute | `PATIENCE_PER_MIN` |
  | What wears on it | poked at or past the last rung 20, woken 30, dropped from a height 15, tossed 8, whirled giddy 25, a sneeze 20, the light flicked at her 12, a picture knocked off the wall 25, the ball taken mid-fetch 12, the fridge found bare 35 | `ANNOYS` |
  | What gives it back | cuddle 30, stroke 15, tickle 5, high five 10, fetch 8, dance 20, a game 10, put to bed 15, a snack 40, food found in a bare fridge 25 | `SOOTHES` |
  | A tantrum | when patience is at 10 or under; at most one in 8 minutes | `PATIENCE_GONE`, `TANTRUM_EVERY_MS` |
  | The sulk after | 15 to 25 minutes by cause (a second within the hour 1.25 times as long, 30 at most): 2 minutes of huff (will not be picked up or played with), then sulking, then cool, easing evenly | `SULK_MS`, `HUFF_MS`, `SPELL_MAX_MS` |
  | Making up | a cuddle or a snack, even in the huff: 4 tender minutes at two fifths strength; a stroke or a dance after the huff takes a quarter off what is left | `TENDER_MS`, `TENDER_FROM`, `KINDNESS_SHORTENS` |
  | A good mood | snack 20 minutes, food found 15, dance 12, game 12, a cuddle of 2.5 s or more 10: full for the first half, then easing | `GLAD_MS` |
  | On the hearts | a sulk up to 30 points down, a good mood up to 20 up, thin patience up to 20 down (a heart is 20) | `SULK_POINTS`, `GLAD_POINTS`, `CROSS_POINTS` |

  Each cause has its own tantrum (`tantrumPlan`): woken is a yawn, a glare and
  back to bed; dropped, tossed or whirled is indignant (steamed, then the new
  `stamp`); a bare fridge is theatre (`faint`, `sob`); the rest stamp and
  steam. All end with her back turned at the nearer wall (the new `sulk`
  move), which is also how she stands for the huff; sulking she stands in
  `mope`, answers a poke with a "hmph", keeps to the window and her book, and
  glances over her shoulder; glad she hums, dances more and plays more.
  Coming round is a sniff, a look over her shoulder and a word (`comeRound`).
  With motion reduced a tantrum is one line and the pose. The house only: the
  reader, the roaming Pip and the desktop Pip are untouched.
- **Decorating** snaps items into each floor's slots (`fits`: ceiling, wall,
  window, top, stand, rug); an item goes where its `fits` includes the slot's,
  on its own floor (`level`) or anywhere (`"any"`).
- **The garden** draws its plots and plants itself (`pip/garden.js`, with the
  room Painter): soil, a seed, a sprout, a young plant, grown, and ripe with a
  glint.
- **Mood** (0 to 100) shows as five hearts. At under 20 Pip mopes (`mope`: a
  droopy leaf and a sigh). That is all: no reminders, no guilt.
- **What Pip wears everywhere.** The equipped variant and outfit show on the
  roaming Pip, the reader peek, the session wrap-up and the arcade games. The
  header logo stays the classic green Pip: it is the brand.
- **Moves.** Fifteen of the showier moves are sold (see `PREMIUM_MOVES`).
  Owning one makes it a possible **signature** (Pip's idle flourish and the
  profile picture's move) and adds it to Pip's free-time hobbies. Celebrations
  and book scenes use any move, free.
- **The Attic Arcade** (`components/pip/arcade/`): Pip Dash, Leaf Catch and
  Page Flap, drawn from `games-art.js`. Games cheer Pip up a little a day and
  never pay seeds.
- **Profile picture.** "Use my Pip" sets the account avatar to
  `variant.signature`, plus `.acc+acc` for the accessories that show (see
  `pip/avatars.ts`). Boards and reader cards draw it with the outfit.

`PipSprite` takes an `outfit` (accessory ids) and dresses the skin with
`dress()`; the outfit is part of the frame-cache key.

**Earned skins** (1.5.10). The achievement skins used to be shown and never
given. `src-tauri/src/pip/earned.rs` now holds a rule for each, read from the
reader's own records (the day ledger and the streak walked from it, books
finished, focus sessions): Maple for a 7-day streak, Sakura for 30, Golden
Pip for 365, Bookworm for 5 books finished, and so on (the full list is in
[features.md](features.md#price-authority)). A skin found earned is written
as a price-0 purchase, so it reaches every device and is never taken back.
Pip shows a new one off once in her house. Pages a month and league results
are not on record, so their skins cannot be earned yet.

## The Hollow

Pip's camp in the wood: the arcade's building game, and since 1.4 what Pip's
tab opens on. Reading runs it; it is for showing off that you read, never a
daily chore, and losses are small and seen. The rules and their history are
in [features.md](features.md#the-hollow-pips-camp-the-arcades-building-game);
this is the map and the state of it.

| File | Job |
| --- | --- |
| `src/pip/base/rules.ts` | The camp's rules as plain functions: settling the reading in, the oak, parcels, building, prowlers, raids, friends' raids, the save (`readBase`, `keptForm`) |
| `src/pip/base/chapters.ts` | Chapters by hours read, their chests and goals, the burrow following the chapter (1.5.10). Its header lists the whole 1.5.10 rules API |
| `src/pip/base/battle.ts`, `ladder.ts`, `heroes.ts`, `guards.ts`, `trophies.ts` | Raids and strongholds, heroes from books finished, guardians, the trophies books raise |
| `src/pip/base/front.ts` | The Front (in progress, below) |
| `src/store/baseStore.ts` | The camp's store: the save, and the actions the screens call |
| `src/components/pip/arcade/base/BaseScreen.tsx`, `scene.ts` | The camp's screen and its picture, painted by `runScene` (`../frameGate.ts`) only when the art turns or something is being done to it |
| `…/base/HollowTop.tsx`, `ChapterCard.tsx`, `HollowDock.tsx`, `HollowGuide.tsx`, `HollowMenu.tsx` | The chapter bar, the chapter card, the Build panel's tabs, the guide, the menu |
| `…/base/RaidBoard.tsx`, `FriendNews.tsx`, `BattleScreen.tsx` | The raid board with forecasts, friends' raids as news, a raid fought |
| `…/base/siteSheet.ts`, `camera.ts`, `mapCoach.ts`, `collect.tsx`, `currency.ts` | A building's sheet, the phone's camera, the first-time pointers, acorns flying to the count, what the chips say |
| `src-tauri/src/commands/pip_shop.rs` (`camp_summary`), `server/src/routes/raids.js` | A friend's card of the camp, and raids between friends |

**What 1.5.10 is** (features.md, "The Hollow by chapters"): acorns as the one
money; ten chapters reached by hours read, then a volume every 15 hours;
nothing expires; a raid board with plain forecasts and free supplies;
friends' raids shown as news, with Put them back; and being raidable by
friends off until the reader says yes. That last needs the server change in
`server/src/routes/raids.js` and `social.js` deployed by the owner.

### The Front (shipped in 1.5.11)

The code: `src/pip/base/front.ts`, `components/pip/arcade/base/wave.ts`,
`NightCard.tsx`, and its parts of `scene.ts`, `BaseScreen.tsx`,
`siteSheet.ts` and `ChapterCard.tsx`. The plan is
[design/hollow/front-plan.md](design/hollow/front-plan.md), and the last
balance run is [design/hollow/front-balance-results.md](design/hollow/front-balance-results.md).

The owner's ask: walls that make sense because enemies come one way, enemies
that can break walls, real choices, and a map that looks different.

- **One lane.** The Dark Wood stands along the left of the clearing (at least
  14 art pixels of it never clears), and the prowlers have trodden one trail
  through it. Everything that attacks comes down that trail. The trail
  appears at chapter 3, when prowlers begin.
- **A wall across it.** The fence becomes a wall across the trail with a gate
  where the trail meets it; its level sets how long and how tough it is
  (`sectionsAt`, `SECTION_TOUGH`). In Edit the whole line slides left or right
  (x 44 to 104), and that is the only placement choice for it. Traps lie on
  spots on the trail in front of it, towers stand on pads behind it, and
  both open with chapters (`spotsOpen`, `padsOpen`: up to three of each).
- **Six enemy roles** (`ROLES`), each good at one thing and, past the
  creeper, each beaten by one construct (`COUNTER`):

  | Role | Comes from chapter | Does | Beaten by |
  | --- | --- | --- | --- |
  | Creeper | 3 | Walks the trail and batters the wall | The wall, and everything that throws |
  | Runner | 4 | Fast and frail, over the wall in a bound | Thorn strip |
  | Flier | 5 | Flies straight over wall and traps | Archer's nest |
  | Brute | 6 | Very sturdy, batters the gate hard | Pitfall |
  | Digger | 7 | Tunnels under the wall | Thumper |
  | Bomber | 8 | Blows a wall section away | Stone thrower |

  Twelve constructs become seven, each with one job; a construct a camp
  owns that is retired or merged is refunded or re-seated, and nothing a
  camp owns is lost (`becomes`, `seatOld`).
- **Nights are seen, never fought out of sight.** The night's wave is drawn
  from the camp and the night (`waveKinds`), so the chip at dusk says exactly
  who is coming, and the night card shows each face beside its counter.
  The night is fought out together, ahead, in `wave.ts`, so a bomber's gap
  lets the creepers behind him through. The first night held after reading
  pays a small bounty (`nightBounty`: 5 + 2 × the chapter acorns).
- **Raids the other way round** (planned): strongholds with a trail and a
  wall facing it, a drop strip along the left edge, lanes for the forecast.
- **Older devices**: the old fields are still written in their old shapes,
  and the front rides in one short line of `taught` (`FRONT_MARK`), which
  every build keeps, so a camp saved by a 1.5.10 device and read again by
  1.5.11 still has its constructs where they were and its nights held.

**Where it stands (2026-10-23).**
- **The balance meets its main targets** in the last run (500 nights a
  chapter): every counter raises the held rate on its role's nights by 21 to
  31 points (aimed for: at least 20).
- **Raids the other way round** are built: strongholds with a trail, the drop
  strip, and Puffcaps that blow a wall open.

**Still open:**
- **No real-phone playtest** of the Front or the meadow. Nobody has played a
  night on the Nord CE4 Lite yet, held upright or sideways.
- **A night's planning time on that phone** is not measured. It takes 0.4 to
  1.9 ms on the desktop simulation, and the bound is 8 ms.
- **The wall's levels count for less than aimed** on brute nights. Levels 2,
  3 and 4 add 24, 7 and 9 points against 10 aimed for, and level 5 adds 7.
  Small tuning in `SECTION_TOUGH`.
- **No screenshots** on a phone held sideways or on a desktop.

### Your reading, made visible (shipped in 1.5.11)

All four parts are built:
- pages up the path: `components/pip/arcade/base/arrival.ts`;
- book blooms: `pip/base/trophies.ts`;
- Reading Stones: `pip/base/stones.ts`;
- animal fondness: `pip/base/fondness.ts`.

The plan is [design/hollow/meadow-plan.md](design/hollow/meadow-plan.md).
The design as agreed, with no server or Rust change, and nothing new stored
but two small fields, which ride in a taught mark so older builds keep them:

1. **Pages up the path.** Opening the camp after reading, pages (one, plus
   one for each 15 minutes read since, six at most; three on Smooth, none on
   minimal or with reduced motion) flutter up the parcel path into the oak,
   and one goes on to the chapter bar, which steps to its new fill. A tap
   skips it. The figures are behind a tap, in a "Since you were last here"
   block on the chapter card. About two seconds, played once.
2. **Book blooms on a Reading Path.** A worn path through the meadow, with a
   bloom for each book the camp raised a trophy for, its kind by the book's
   genre (eleven original flowers: pagewort, lamplily, star thistle and the
   rest), the newest nearest. 48 on the path, older ones growing wild beyond.
   A bud is the next bloom, opening as the reading towards it goes up. All of
   it is derived from the trophies and the library.
3. **Reading Stones** for the long arc after chapter 10: a ring of stones at
   the back of the meadow, a low one carved for each of chapters 7 to 10 and
   a tall one carved with the hours for each volume, and Pip setting out each
   volume's set by them. Derived from the minutes read alone.
4. **Animal fondness.** Each meadow animal grows fonder with the hours read
   since it arrived (hearts at 3, 10 and 25 hours, never lost): a home of its
   own at one heart, and its gift doubled at three. The hen lays on a day you
   read, not on every calendar day.

The meadow's one purpose in this: it holds the record of your reading and is
the animals' home. It is never attacked.

## PipWorld in brief

- A fixed layer over the window, below the sidebar and header while Pip is at
  rest (so the sidebar opens over Pip), raised above everything while Pip is
  carried, flying or touring.
- Standing on a card, Pip moves into a layer **inside the page's scroll area**
  (`data-pip-scroll-layer` in `<main>`), so it scrolls with the card on the
  compositor. Positioned from script it trailed every scroll by a frame.
- Surfaces: the bottom of the window, and the top edge of any `.paper-surface`
  card in the page (or anything marked `data-pip-ledge`). The header is the
  ceiling; the collapsed sidebar is the left wall.
- Physics and placement run in one `requestAnimationFrame` loop over refs and
  write transforms directly. React state changes only when Pip changes what it
  is doing.
- Drags follow the pointer on `window`, not with pointer capture, because Pip
  can move between layers mid-drag and a remount would drop the capture.
- **Held, Pip is a pendulum** hanging from the cursor by the leaf
  (`swingHeld`): the cursor's acceleration drives it, so a flick swings it and
  a circle loops it over. Let go, and the swing's spin carries into the throw,
  turning the whole body, then damps out; standing again, it settles upright.
  The body rotates about the leaf while hanging and about its middle
  otherwise; `setOrigin` moves between the two without the sprite jumping.
- **Webs** (`startWeb`, `swingWeb`): Pip shoots a line to the nearest corner of
  a card above and reels itself up, the swing pumped by the shortening rope,
  then hops onto the card. With no card in reach it webs the header, swings,
  and lets go on the upswing to fly across the window. The line is an SVG in
  the world layer (`.pip-web`), pale with a dark edge for both themes.
- **The sidebar** opens over the app on hover. If it opens over Pip, Pip is
  flung across the window, once per opening.

### A free moment

Resting, Pip keeps busy every few seconds (`pastime`): a stroll (about a
third of the time), a one-loop fidget (look, stretch, tap, idea, hydrate,
yawn), a hobby for two loops (jogging, skipping rope, tree pose, reading,
speed-reading, plus any moves the reader bought on the Pip tab and their
signature move), or a web up to a card. Quiet mode only strolls and glances
around. During a session Pip reads along and stays put.

**Dizzy.** Spinning Pip while holding it, or in a throw, and shaking it hard
fill a meter (about three full turns, or a second or two of hard shaking).
Once back on its feet with the meter full, Pip staggers about for a few seconds
(`dizzywalk`: spiral eyes, stars, lurching this way and that), longer the
dizzier it got. The meter drains while Pip is left alone.

Pip **sleeps when you do**: after 4 minutes with no pointer, key or wheel input
(1 minute after 11 pm), and wakes at the first touch. It used to sleep whenever
nothing had been read that day, which meant asleep most mornings and never
wandering.

## What makes Pip move

| Event | What happens |
| --- | --- |
| Goal met | Boxing (most often), fist pump, air guitar, tap dance, pom-poms, floss |
| Streak milestone (3, 7, 10, 14, 21, 30…) | Toe-stand kick, on fire, fireworks, level-up |
| New longest streak | Backflip, kickflip, leaf spin |
| 25+ minute session | Deep dive, book press |
| Book finished | The End, champion, fireworks |
| Session starts | Countdown, jog, whistle |
| Books imported | Magic trick |
| Dusty book (30+ days) | Sneeze, in the reader |
| Manual backup | Backup beam |
| Back after 3+ days | Welcome wave |
| Streak lost | Comeback arc; with a cold to follow, a sneeze ("achoo. streak ended. i'm fine. read to me?") |
| A streak of 3+ days breaks | A cold for up to three days; reading to the daily goal cures it |
| A focus session | She is out on an expedition; back with a find held up |
| A reader you follow read today, as you did | Their Pip visits; she greets them and reads beside them |
| Clicked | One of 14 poke reactions |
| Back from another app mid-session (30 s+) | Steamed, lock-in, alarm |
| Reaching for the exit under focus lock | Swat (a rolled-up newspaper), whistle |

## Interaction

- **Click** Pip: a poke reaction. **Drag** by the leaf and **throw**: tumble,
  bounce, wall cling, splat on a hard landing.
- **The perch.** Set Pip down anywhere over the logo, the "Leaflet" wordmark or
  just right of it, and he hops back onto his own spot in the logo (the outline
  he jumped out of) and stays there, still and silent. The spot glows while he
  is held over that corner, so you can see a drop will land. A drop counts even if you let go
  while still moving; only a real throw (over 1,600 px/s) flies past, and a
  hard throw up into the logo still sends him home. The perch is remembered
  across launches; picking him up, "Hop down" or calling him home forgets it.
- **Right-click** (or the context-menu key): shortcuts. Continue the last book,
  start or end a focus session, back up now, take the tour, sit by the logo (or
  hop down), go home.
- **The tour** runs once after the welcome screen and from Settings → Pip →
  Show Me Around, or Pip's menu. Pip jumps to each stop, stands on it, points,
  and the rest of the app dims around a spotlight.

## Modes

Settings → Pip: **Chatty** (lives out in the app, wanders), **Quiet** (stays in
the logo and comes out only for celebrations), **Off** (a still logo; session
summaries still appear). Reduced motion swaps every move for its still pose.

## Assets

The logo is Pip sitting with an open book, on a transparent background
(`apps/scripts/pip-logo.mjs` draws it with the engine). Its files are in
`apps/src/assets/pip/` (PNG at every 32-multiple, SVG, a cream tile for places
that need a square badge, and sticker poses); see the README there. The Windows
app icons in `src-tauri/icons` are a green book (since 1.4: Pip's face,
which they were from 1.3, filled the square and said nothing of what the app
is for, and the owner thought it was costing clicks in the Store), drawn in
`src-tauri/msix/windows-icons.py` twice, 16 and 18 pixels square, so that it
is sharp at the sizes Windows shows most.
