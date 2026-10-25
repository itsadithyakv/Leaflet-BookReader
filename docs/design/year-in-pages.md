# Your Year in Pages (plan, 2026-10-25)

## The owner's ask

> The last week of every year can we have something like Spotify Wrapped, on
> both mobile and laptop, for everyone to share and be proud of? It should
> not look cheap, it should be very visual with well made animations etc.
> Think it through. Allow to share on Instagram etc.

**Name:** "Wrapped" is Spotify's. Ours is **Your Year in Pages**: "Your 2026
in pages".

## What exists

`components/share/yearReview.ts` already sums a year from what Leaflet keeps:
- minutes, days read, the longest run and the best day;
- minutes by month and the busiest month;
- books finished and read, sessions, time of day;
- top author and genre;
- highlights and words looked up.

`YearReviewDialog.tsx` draws it as **one static card** (`yearCard.ts`, the
quote card's size), to copy or save. It is opened from Social → Stats.
Nothing new is recorded and nothing leaves the device.

**Keep the sums. Replace the one card with a story.**

## The moment

- **When:** from **24 December to 7 January**, so a reader away over the
  holidays still finds it.
- **Library:** a festive key in the Library's header, "Your 2026 in pages".
  It is the only standing entry.
- **Pip:** says it once, in her bubble.
- **Phone:** **one** notification on 24 December, only if the reader has
  reminders on. Never more than once a year.
- **Afterwards:** every past year stays in **Social → Stats**, as today.
- **Opened before the year ends:** the story says "so far", and the last
  days count when it is opened again.
- **The owner can preview it any time** from Admin, for this year so far or
  any past year.

## The story

Full-screen and vertical (9:16), like Stories.
- **Phone:** tap right or left to go on or back, hold to pause, swipe down to
  close.
- **Desktop:** the 9:16 stage is centred on a full-window backdrop in the
  scene's colours. Arrow keys and clicks move through it, and Esc closes it.

There are about ten scenes. **A scene with nothing to say is skipped**, and a
small year gets a short, warm story, never a thin one.

| # | Scene | Picture and motion |
|---|---|---|
| 1 | **Opening** | Pip opens a big book and pages lift out of it: "2026, in pages" |
| 2 | **Time** | Hours count up and an hourglass fills; a fun comparison ("as long as 9 trips round the world by train") |
| 3 | **Days** | The year's calendar lights up day by day as a heat map; the longest run traced in gold |
| 4 | **Books finished** | Covers drop onto a shelf one by one; the count climbs |
| 5 | **Your kind of reader** | From the top genre, an original reader type ("The Wanderer", "The Night Detective"…) with Pip dressed for it |
| 6 | **Faithful to** | Top author, or the book returned to most |
| 7 | **When you read** | The sun and moon arc across the scene: "62% of your reading was after dark" |
| 8 | **Your biggest month** | The months' bars rise in turn, the busiest last and tallest |
| 9 | **Lines you kept** | One highlight of the year, set beautifully (the reader can swap it), plus the hardest word they looked up |
| 10 | **The Hollow** (players only) | Chapters reached, strongholds taken, the King's banners |
| 11 | **Study** (if any cards) | Cards learnt |
| 12 | **The year, together** | A summary of the best figures: the card to share |

## Not cheap

- **Each scene has its own colour field** from a year palette, with a fine
  paper grain, so there are no flat white panels.
- **Type is big and confident.** Numbers count up with an ease-out, and words
  arrive in staggered lines.
- **Pip is the guide** in her pixel art: crisp, whole-number scale, never
  twitching. She is set against clean modern type, where the contrast is the
  look.
- **Motion:**
  - every scene has an entrance, a moment and a held end;
  - curves are springy but calm, built only from transforms and opacity;
  - **no blur** (Leaflet's look);
  - particles (pages, confetti at the end) are capped and drawn on one canvas.
- **Performance:** 60 fps on desktop, and smooth on the Adreno 619 phone.
  Under reduced motion, each scene is shown at its held end.
- **It must hold up as a screenshot at any frame.** Before it ships, every
  scene's held end is checked at phone and desktop size.

## Sharing

- **Every scene's held end can be shared**, plus the summary:
  - **1080×1920** for Stories;
  - **1080×1350** for feeds;
  - **1080×1080**.
- **How the images are made:** drawn by a canvas renderer per scene, not a
  DOM capture, so they are sharp and look the same on every device. They
  carry a small Leaflet mark.
- **Where they go:**
  - **Android:** the system share sheet, with Instagram, WhatsApp and the
    rest.
  - **Desktop:** Save and Copy.
- **"Hide book titles"** is a switch when sharing.
- **Nothing leaves the device** except the picture the reader chooses to
  share.
- **Later:** a short video (all scenes) for Stories, made with
  `MediaRecorder` where the WebView supports it. Not in the first version.

## Data to add to the sums (small)

- how many cards were learnt;
- the hardest word, the one looked up most or kept longest;
- a highlight of the year (with a note first, otherwise the longest);
- the Hollow's year: chapters reached in it, strongholds taken in it,
  banners.

All of it comes from what is already kept on the device.

## Build

- A new lazy chunk, `components/share/year/`: the scenes, their motion,
  the canvas share renderer, and the story shell.
- `YearReviewDialog` becomes the story, and the old single card is retired.
- Tests:
  - the sums;
  - which scenes are skipped;
  - the share renderer's sizes;
  - the moment's dates;
  - reduced motion.
- Screenshots of every scene's held end at phone and desktop size, reviewed
  before shipping.

## The span: a short year is a beginning (added 2026-10-25)

The owner: "if someone only read for 4 months say that instead of a year."

- **The rule:** the story speaks of the stretch from the reader's **first day
  with Leaflet** to the year's end (or to today, before 31 December). The
  first day is the ledger's first row of any kind, so a reader who set a goal
  in August and first read in September counts from August.
- **Only a late start shortens it.** A reader who was here before 1 January
  has the whole year, whatever gaps are in it: read in February, stopped,
  came back in September is still "2026, in pages". So a gap never makes a
  year look small, and a newcomer's months are never averaged over twelve.
- **How each span is said** (`framing` in `yearReview.ts`):

  | Span (from the first day) | Opening | In a sentence | On every picture |
  |---|---|---|---|
  | 10 months or more, or here before the year | "2026 / in pages" | "In 2026", "So far in 2026" | "2026 in pages" (· so far) |
  | 1 to 9 months | "4 months / in pages", over "Your first 4 months" | "In just 4 months" | "4 months in pages · 2026" |
  | under 4 weeks | "First weeks / in pages" ("First days" under a week) | "In just 3 weeks" | "First weeks in pages · 2026" |

  "Your first 4 months" rather than "your last": it is true (these are
  their first months), and it reads as a beginning.
- The calendar and the months' bars show only the months from the start.
- Per-time figures (hours a week, "of N days") use the span's days.

## As built (2026-10-25)

What the code settled, where it differs from or adds to the plan above:

- **The scenes:** Opening, Time, Days, Books finished, Your kind of reader,
  Faithful to, When you read, Biggest month, Lines you kept, The Hollow,
  Study, Summary (`components/share/year/scenes.ts`). A small year (under two
  hours on under five days, nothing finished) is Opening, Time, the books and
  lines if any, and the Summary. An empty year is one kind card.
- **One description, two drawings.** Each scene's words come from
  `sceneCopy`, and its picture from `draw.ts` with a motion fraction `t`.
  The screen plays `t` from 0 to 1; the picture to share draws `t = 1`. So
  a shared picture is always the scene's held end, and the two cannot drift.
- **Motion:** each element's resting style is the held end, and its CSS
  animation runs from where it starts (rise, pop, drop), so reduced motion
  (or a paused stage) is simply the end. The pictures draw on their own
  canvas only while they move. Pip is drawn on her own canvas at a whole
  number of device pixels per pixel of hers, with a light rim on dark fields,
  and hops in a pixel of hers at a time (`steps()`), so she never sits between
  pixels. Particles (pages, confetti) on one canvas, capped at 22 and 56
  (fewer on a phone), for four seconds.
- **"Cards learnt"** is a card in its fourth box or past (right three times
  running, resting a week or more): the quiz's "known" (the last box) takes
  months, which no autumn's cards could show.
- **The hardest word** is the one looked up most; with none looked up twice,
  the longest. "Kept longest" was dropped: every word is kept until removed.
- **The highlight** with a note comes first (the reader said why), then the
  longest that sets well (12 to 420 characters); the reader swaps among up
  to twelve.
- **The Hollow's year:** the chapters come from the camp's minutes less what
  was read after the year (and the year's own minutes, for where it began).
  Strongholds keep no dates, so their count and stars are shown for the
  latest year only (the Magpie Lands began in 2026); banners are by month.
- **Kinds of reader** (original names, Pip in her own wardrobe): The Night
  Detective, The Candle-Keeper, The Star-Reader, The Map-Maker, The Open
  Heart, The Trailblazer, The Time-Walker, The Quiet Scholar, The Curious
  Mind, The Panel-Hopper, The Daydreamer; with no genre to go by, by the time
  of day: The Early Riser, The Wanderer, The Lamplighter, The Midnight Owl.
- **Time comparisons**, each the usual time it takes: a pot of tea (5 min), a
  film (2 h), London to New York (8 h), a whole day and night, the Moon as
  Apollo 11 went (76 h), the Trans-Siberian end to end (166 h). The longest
  the year holds twice is said, rounded to the half under three.
- **"When you read"** is by focus session time (the only reading with an
  hour to it), and says so: "of your session time was after five in the
  evening".
- **Covers:** the shelf uses the library's own cover pictures (data URLs,
  so a shared picture may draw them) and makes a cloth cover with the title
  where there is none. With titles hidden, covers are cloth and blank.
- **Fonts in the pictures:** the system's own serif (Georgia; Noto Serif on
  Android) and sans (Segoe UI; Roboto on Android). ZT Nature is not used:
  its licence does not cover making images.
- **Android sharing** reuses the share sheet the study cards' export and
  Pip's postcards already use (`share_target`, `diary_save_picture`,
  `share_file` with `image/png`), so Instagram, WhatsApp and the rest are
  offered. No new native code.
- **The notification** is a fourth reminder kind (`reminders::ReminderKind::
  Year`): 24 December from 10:00 until quiet hours, only with a reminder on,
  once a year (`FiredLog.year`), planned up to 14 days ahead so a phone left
  alone still gets it; tapping it opens Leaflet, not the last book.
- **Admin:** "Year in pages" opens this year so far, any year with reading,
  or any year typed in.
