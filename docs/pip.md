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
| `src/pip/skins.js` | The variants: the original achievement skins (`earnedOnly`, not yet unlockable in the app) and the shop's variants (robot, president, skater...), each with a `price` in seeds. |
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

## The Pip tab: Pip's house

Pip's own place, and the reward for focus mode: reading in focus waters Pip's
garden, ripe plants give seeds, seeds are spent on Pip. Economy rules, commands
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
- **Pip in the house** (`components/pip/HouseScene.tsx`) strolls, fills free
  moments with its signature move or a hobby, can be dragged and dropped (it
  falls back to the floor), walks with the arrow keys when focused, and is
  poked by a click. One requestAnimationFrame loop on refs, stopped when the
  tab is hidden.
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
| Streak lost | Comeback arc |
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

Logo files rendered from the engine are in `apps/src/assets/pip/` (PNG at every
32-multiple, SVG, a cream tile, and sticker poses); see the README there. The
Windows app icons in `src-tauri/icons` come from `pip-1024.png`.
