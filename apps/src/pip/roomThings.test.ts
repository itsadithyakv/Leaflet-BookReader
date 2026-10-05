import { describe, expect, it } from "vitest";
import * as pip from "./index";
import { fixtureBoxes, houseItems, houseLevels, levelDecor, levelFixtures, registerHouseArt, withLevelDecor, type HouseLevel } from "./home.js";
import { catalogue } from "./shop";
import { KINDS, MIN_TARGET, THING_NAMES, TOUCH_TARGET, kindOf, opensCard, pressAreas, type FurnishKind, type PressArea } from "./furnish";
import { PLANT, plantLines, plantNow, plantOf, plantReport, plantWants, type FreeDay } from "./houseplant";
import { FIND_ART_IDS } from "./expedition-art.js";
import { calendarArt, calendarLines, calendarWords, clockArt, clockLines, clockTime, clockWords, minutesLeft, sessionWords, wedge, type LedgerDay } from "./roomTime";

registerHouseArt(pip as unknown as Record<string, unknown>);

const bedroom = () => houseLevels().find((entry) => entry.id === "bedroom") as HouseLevel;
type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** A fixture drawn on a painter of its own, to look at its pixels. */
type Painted = { get: (x: number, y: number) => string | null };
const drawn = (id: string, data?: unknown, frame = 0) => {
  const item = pip.FIXTURES.find((entry) => entry.id === id) as unknown as { w: number; h: number; draw: (g: unknown, f: number, data?: unknown) => void; glow?: (f: number, data?: unknown) => unknown[] };
  const g = new pip.Painter(item.w, item.h, frame) as unknown as Painted;
  item.draw(g, frame, data);
  const pixels = Array.from({ length: item.w * item.h }, (_, i) => g.get(i % item.w, Math.floor(i / item.w))?.toLowerCase() ?? null);
  const count = (colour: string) => pixels.filter((c) => c === colour.toLowerCase()).length;
  return { g, pixels, count, item };
};

/** Her lines: lower case, short enough for the bubble. */
const inHerVoice = (lines: readonly string[]) => {
  expect(lines.length).toBeGreaterThanOrEqual(2);
  for (const line of lines) {
    expect(line).toBe(line.toLowerCase());
    expect(line.length).toBeLessThanOrEqual(44);
    expect(line.length).toBeGreaterThan(3);
  }
};

const ROOM = ["bookcase", "calendar", "wallclock", "corkboard", "radio", "plantpot"];

describe("the room's own things", () => {
  it("are every reader's: fixtures of the bedroom, in no shop, catalogue, slot or saved layout", () => {
    const ids = pip.FIXTURES.map((item) => item.id);
    for (const id of ROOM) {
      expect(ids).toContain(id);
      expect(houseItems().some((item) => item.id === id)).toBe(false);
      expect(catalogue().some((item) => item.id === id)).toBe(false);
      expect(pip.FIXTURES.find((item) => item.id === id)?.price).toBe(0);
    }
    const room = bedroom();
    const saved = { "bedroom/floor-1": "bed", "bedroom/wall-1": "poster" };
    const decor = levelDecor(saved, room);
    // A house saved before there were any has them all, and its layout is as it was.
    expect(Object.keys(fixtureBoxes(room, decor)).sort()).toEqual([...ROOM].sort());
    expect(withLevelDecor(saved, room, decor)).toEqual(saved);
    expect(levelFixtures(room, decor).map((entry) => entry.itemId).sort()).toEqual(["minifridge", ...ROOM].sort());
    for (const floor of houseLevels()) if (floor.id !== "bedroom") expect(fixtureBoxes(floor, levelDecor({}, floor))).toEqual({});
  });

  it("each have a place of their own in a new room: none over another, none over what the room comes with", () => {
    const room = bedroom();
    const decor = levelDecor({}, room);
    const boxes = fixtureBoxes(room, decor);
    const placed = decor.placed.flatMap(({ slot: slotId, itemId }) => {
      const slot = room.slots.find((entry) => entry.id === slotId);
      const item = houseItems().find((entry) => entry.id === itemId);
      // The rug lies under everything.
      return slot && item && slot.fits !== "rug" ? [{ id: itemId, box: pip.placeAt(item, { fits: slot.fits, x: slot.x + slot.w / 2, y: slot.fits === "wall" || slot.fits === "window" ? slot.y + slot.h / 2 : slot.fits === "ceiling" ? slot.y : slot.y + slot.h }) }] : [];
    });
    const things = Object.entries(boxes).map(([id, box]) => ({ id, box: box.hit }));
    for (const a of things) {
      expect(a.box.x).toBeGreaterThanOrEqual(0);
      expect(a.box.x + a.box.w).toBeLessThanOrEqual(room.w);
      expect(a.box.y).toBeGreaterThanOrEqual(0);
      expect(a.box.y + a.box.h).toBeLessThanOrEqual(112);
      for (const b of things) if (a !== b) expect(`${a.id}/${b.id}: ${overlap(a.box, b.box)}`).toBe(`${a.id}/${b.id}: 0`);
      for (const piece of placed) {
        const item = houseItems().find((entry) => entry.id === piece.id);
        expect(`${a.id}/${piece.id}: ${overlap(a.box, { ...piece.box, w: item?.w ?? 0, h: item?.h ?? 0 })}`).toBe(`${a.id}/${piece.id}: 0`);
      }
    }
    // Where each is: the wall over the bed, under the window, the gap by the bed, the top of the fridge.
    expect(boxes.calendar.hit).toEqual({ x: 18, y: 58, w: 11, h: 19 });
    expect(boxes.wallclock.hit).toEqual({ x: 40, y: 61, w: 13, h: 13 });
    expect(boxes.corkboard.hit).toEqual({ x: 108, y: 67, w: 24, h: 12 });
    expect(boxes.radio.hit).toEqual({ x: 63, y: 96, w: 12, h: 16 });
    expect(boxes.plantpot.hit).toEqual({ x: 170, y: 80, w: 10, h: 12 });
  });

  it("move aside for the reader's pieces, and the plant goes where the fridge goes", () => {
    const room = bedroom();
    // A cat tower in the first floor spot stands in front of the calendar's first place: it takes its second.
    const tower = fixtureBoxes(room, levelDecor({ "bedroom/floor-1": "cattower" }, room));
    expect(tower.calendar.x).toBe(48);
    expect(overlap(tower.calendar.hit, tower.wallclock.hit)).toBe(0);
    // The fridge pushed to the middle gap: the plant rides on it, and the radio keeps clear of both.
    const wide = levelDecor({ "bedroom/floor-3": "bed", "bedroom/floor-4": "piano" }, room);
    const moved = fixtureBoxes(room, wide);
    expect(moved.plantpot.x).toBe(116);
    expect(moved.plantpot.y + moved.plantpot.h).toBe(92);
    expect(moved.radio.x).toBe(63);
    // The gap by the bed taken by a wide bed: the radio stands in another, not on the fridge.
    const crowded = fixtureBoxes(room, levelDecor({ "bedroom/floor-1": "piano", "bedroom/floor-2": "piano" }, room));
    expect(crowded.radio.x).not.toBe(63);
    expect(overlap(crowded.radio.hit, { x: 169, y: 92, w: 12, h: 20 })).toBe(0);
  });

  it("can each be chosen: a name, a label saying what it does, a key, and a card", () => {
    const kinds: Record<string, FurnishKind> = { bookcase: "bookcase", calendar: "calendar", wallclock: "clock", plantpot: "plant", radio: "radio", corkboard: "album", diary: "diary", fridgenotes: "notes" };
    for (const [id, kind] of Object.entries(kinds)) {
      expect(kindOf(id)).toBe(kind);
      expect(THING_NAMES[id]).toBeTruthy();
      expect(KINDS[kind].how).toMatch(/[Ss]elect/);
      expect(KINDS[kind].keys).toMatch(/Enter/);
      expect(KINDS[kind].remembers).toEqual([]);
      expect(opensCard(kind)).toBe(true);
    }
    for (const kind of ["curtains", "picture", "bed", "window", "books", "lamp", "fridge"] as const) expect(opensCard(kind)).toBe(false);
    // The notes and the fridge say plainly which part is which.
    expect(KINDS.notes.how).toMatch(/lower door/);
    expect(KINDS.notes.how).toMatch(/top of the fridge opens the fridge/);
  });

  // The bedroom as it comes: its own things, and the decor a new house has out (the bed, the window, a poster, the book tower).
  const fixed = fixtureBoxes(bedroom(), levelDecor({}, bedroom()));
  const fridge = { x: 169, y: 92, w: 12, h: 20 };
  const room = { w: 240, h: 120 };
  /** What is pressed, in the order the room lays it out; with notes pinned the fridge is its freezer door, and the notes its lower one. */
  const pressed = (notes: boolean) => ({
    bed: { x: 13, y: 88, w: 42, h: 24 },
    curtains: { x: 102, y: 25, w: 36, h: 30 },
    picture: { x: 27, y: 23, w: 18, h: 22 },
    books: { x: 177, y: 50, w: 14, h: 18 },
    fridge: notes ? { ...fridge, h: pip.FRIDGE_DOOR.y } : fridge,
    ...(notes ? { notes: { x: fridge.x + pip.FRIDGE_DOOR.x, y: fridge.y + pip.FRIDGE_DOOR.y, w: pip.FRIDGE_DOOR.w, h: pip.FRIDGE_DOOR.h } } : {}),
    plant: fixed.plantpot.hit,
    bookcase: fixed.bookcase.hit,
    calendar: fixed.calendar.hit,
    clock: fixed.wallclock.hit,
    album: fixed.corkboard.hit,
    radio: fixed.radio.hit,
    diary: { x: fixed.bookcase.x + pip.BOOKCASE_DIARY.x, y: fixed.bookcase.y + pip.BOOKCASE_DIARY.y, w: pip.BOOKCASE_DIARY.w, h: pip.BOOKCASE_DIARY.h }
  });
  const shared = (a: PressArea, b: PressArea) =>
    Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  // Every scale the house is drawn at in a window: 0.8 (the smallest window at 125%) up.
  const SCALES = [0.8, 1, 1.5, 2, 2.5, 2.8, 3.5, 5.5];

  it("are each pressed where no other is, at every scale, with a pointer and under a finger", () => {
    for (const least of [MIN_TARGET, TOUCH_TARGET]) {
      for (const notes of [false, true]) {
        for (const scale of SCALES) {
          const boxes = pressed(notes);
          const names = Object.keys(boxes);
          const areas = pressAreas(Object.values(boxes), scale, least, room);
          for (let a = 0; a < areas.length; a += 1) {
            // In the room.
            expect(areas[a].left).toBeGreaterThanOrEqual(-1e-6);
            expect(areas[a].top).toBeGreaterThanOrEqual(-1e-6);
            expect(areas[a].left + areas[a].width).toBeLessThanOrEqual(room.w * scale + 1e-6);
            expect(areas[a].top + areas[a].height).toBeLessThanOrEqual(room.h * scale + 1e-6);
            for (let b = a + 1; b < areas.length; b += 1) {
              expect(shared(areas[a], areas[b]), `${names[a]} and ${names[b]} at ${scale}, least ${least}`).toBeLessThan(0.01);
            }
          }
        }
      }
    }
  });

  it("are pressed on themselves: each area holds its own art (the bookcase all but the row the diary lies over)", () => {
    for (const least of [MIN_TARGET, TOUCH_TARGET]) {
      for (const notes of [false, true]) {
        for (const scale of SCALES) {
          const boxes = pressed(notes);
          const areas = pressAreas(Object.values(boxes), scale, least, room);
          Object.entries(boxes).forEach(([name, box], index) => {
            const art: PressArea = { left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale };
            const held = shared(art, areas[index]) / (art.width * art.height);
            expect(held, `${name} at ${scale}, least ${least}`).toBeGreaterThanOrEqual(name === "bookcase" ? 0.97 : 0.999);
          });
        }
      }
    }
  });

  it("are never under 24 px a side with a pointer, from one pixel a pixel up", () => {
    for (const scale of SCALES.filter((entry) => entry >= 1)) {
      const boxes = pressed(false);
      const areas = pressAreas(Object.values(boxes), scale, MIN_TARGET, room);
      Object.keys(boxes).forEach((name, index) => {
        expect(areas[index].width, `${name} at ${scale}`).toBeGreaterThanOrEqual(MIN_TARGET - 1e-6);
        expect(areas[index].height, `${name} at ${scale}`).toBeGreaterThanOrEqual(MIN_TARGET - 1e-6);
      });
    }
    // The plant, hemmed in by the fridge it stands on, is given the ground under the book tower's shelf: the tower
    // stands back to its own art and grows upwards instead (at one pixel a pixel: 44 to 68, and the plant 68 to 92).
    const names = Object.keys(pressed(false));
    const small = pressAreas(Object.values(pressed(false)), 1, MIN_TARGET, room);
    expect(small[names.indexOf("books")]).toEqual({ left: 172, top: 44, width: 24, height: 24 });
    expect(small[names.indexOf("plant")]).toEqual({ left: 163, top: 68, width: 24, height: 24 });
    expect(small[names.indexOf("fridge")]).toEqual({ left: 163, top: 92, width: 24, height: 24 });
    // The diary and the bookcase it lies on: the line between them is the diary's foot.
    expect(small[names.indexOf("diary")].top + small[names.indexOf("diary")].height).toBe(39);
    expect(small[names.indexOf("bookcase")].top).toBe(39);
  });

  it("have what there is where there is not 24 px for each: the smallest window at 125%, and a fridge with notes on it", () => {
    // At 0.8 the plant and the fridge under it have 41.6 px between the book tower's foot and the floor: all of it, no more.
    const names = Object.keys(pressed(false));
    const tiny = pressAreas(Object.values(pressed(false)), 0.8, MIN_TARGET, room);
    const short = names.filter((_, index) => tiny[index].width < MIN_TARGET - 1e-6 || tiny[index].height < MIN_TARGET - 1e-6);
    expect(short.sort()).toEqual(["fridge", "plant"]);
    expect(tiny[names.indexOf("plant")].height + tiny[names.indexOf("fridge")].height).toBeCloseTo(41.6, 5);
    expect(tiny[names.indexOf("plant")].width).toBe(MIN_TARGET);
    // With notes pinned the fridge is three things one over another in 32 floor pixels. The freezer door between the
    // plant and the notes is as tall as it is drawn (7 floor pixels) and a full 24 px wide; the notes have the door and
    // the floor under it.
    const noted = pressed(true);
    const at = Object.keys(noted).indexOf("fridge");
    for (const scale of SCALES) {
      const areas = pressAreas(Object.values(noted), scale, MIN_TARGET, room);
      expect(areas[at].height).toBeCloseTo(7 * scale, 5);
      expect(areas[at].width).toBeGreaterThanOrEqual(MIN_TARGET - 1e-6);
      const notes = areas[Object.keys(noted).indexOf("notes")];
      expect(notes.top).toBeCloseTo(99 * scale, 5);
      expect(notes.height).toBeCloseTo(Math.max(12 * scale, Math.min(MIN_TARGET, 21 * scale)), 5);
    }
    expect(MIN_TARGET).toBe(24);
    expect(TOUCH_TARGET).toBe(44);
  });

  it("are a thumb's size under a finger where the room has it, and never less than a pointer's where it has not", () => {
    for (const scale of SCALES) {
      const boxes = pressed(false);
      const names = Object.keys(boxes);
      const pointer = pressAreas(Object.values(boxes), scale, MIN_TARGET, room);
      const finger = pressAreas(Object.values(boxes), scale, TOUCH_TARGET, room);
      names.forEach((name, index) => {
        // What a pointer has of 24 px, a finger has too (the clock, between the calendar and the bookcase, had 23).
        expect(finger[index].width, `${name} across at ${scale}`).toBeGreaterThanOrEqual(Math.min(MIN_TARGET, pointer[index].width) - 1e-6);
        expect(finger[index].height, `${name} down at ${scale}`).toBeGreaterThanOrEqual(Math.min(MIN_TARGET, pointer[index].height) - 1e-6);
        // From two pixels a pixel (a 480 px room) every one is 44 px a side.
        if (scale >= 2) {
          expect(finger[index].width, `${name} across at ${scale}`).toBeGreaterThanOrEqual(TOUCH_TARGET - 1e-6);
          expect(finger[index].height, `${name} down at ${scale}`).toBeGreaterThanOrEqual(TOUCH_TARGET - 1e-6);
        }
      });
    }
  });

  it("are exactly their art once that is big enough and nothing is in the way", () => {
    const boxes = pressed(false);
    const areas = pressAreas(Object.values(boxes), 5.5, MIN_TARGET, room);
    const bed = Object.keys(boxes).indexOf("bed");
    expect(areas[bed]).toEqual({ left: 13 * 5.5, top: 88 * 5.5, width: 42 * 5.5, height: 24 * 5.5 });
  });
});

describe("the wall calendar", () => {
  const day = (dateKey: string, minutes: number, extra: Partial<LedgerDay> = {}): LedgerDay => ({ dateKey, minutes, goalMinutes: 20, freezeUsed: false, graceUsed: false, ...extra });
  const now = new Date(2026, 9, 4, 15, 30);
  const days = [
    day("2026-09-30", 40),
    day("2026-10-01", 25),
    day("2026-10-02", 5),
    day("2026-10-03", 0, { freezeUsed: true }),
    day("2026-10-04", 20),
    day("2026-10-09", 30, { goalMinutes: 0 }),
    day("2025-10-02", 60)
  ];

  it("is this month: today's date, and each day the goal was met by reading", () => {
    const art = calendarArt(days, now);
    // October 2026 begins on a Thursday: three squares in, with weeks from Monday.
    expect(art).toEqual({ date: 4, lead: 3, length: 31, met: [1, 4], kept: [3] });
    expect(calendarArt([], new Date(2024, 1, 29))).toEqual({ date: 29, lead: 3, length: 29, met: [], kept: [] });
    expect(calendarWords(art, now)).toBe("Sunday 4 October, goal met on 2 days this month");
    expect(calendarWords(calendarArt([day("2026-10-01", 25)], now), now)).toMatch(/on 1 day this month/);
  });

  it("is drawn with the date in figures and a square a day, green where the goal was met", () => {
    const art = calendarArt(days, now);
    const picture = drawn("calendar", art);
    expect(picture.count("#1FA36A")).toBe(2);
    expect(picture.count("#8FD3C8")).toBe(1);
    // The 1st is the fourth square of the first row; the 4th, the last.
    expect(picture.g.get(2 + 3, 11)?.toLowerCase()).toBe("#1fa36a");
    expect(picture.g.get(2 + 6, 11)?.toLowerCase()).toBe("#1fa36a");
    // Past days not met, and the days to come, are there too: 31 squares in all.
    expect(picture.count("#1FA36A") + picture.count("#8FD3C8") + picture.count("#C9BC9C") + picture.count("#EADFC6")).toBe(31);
    // The figures change with the date.
    const tomorrow = drawn("calendar", calendarArt(days, new Date(2026, 9, 5)));
    expect(tomorrow.pixels).not.toEqual(picture.pixels);
    // Today, not yet met, is marked as today.
    expect(drawn("calendar", calendarArt([], now)).count("#E0393E")).toBeGreaterThan(picture.count("#E0393E"));
    // With nothing said it is still a calendar.
    expect(drawn("calendar").count("#FFF6DF")).toBeGreaterThan(40);
  });

  it("gives Pip something to say about it", () => {
    inHerVoice(calendarLines(calendarArt(days, now)));
    inHerVoice(calendarLines(calendarArt([], now)));
    expect(calendarLines(calendarArt(days, now))).toContain("2 days marked this month.");
    expect(calendarLines(calendarArt(days, now))).toContain("today's square is done.");
  });
});

describe("the wall clock", () => {
  it("tells the real time", () => {
    expect(clockArt(new Date(2026, 9, 4, 15, 30), null)).toEqual({ hour: 3.5, minute: 30, left: null });
    expect(clockArt(new Date(2026, 9, 4, 0, 5), null)).toEqual({ hour: 0.08, minute: 5, left: null });
    expect(clockTime(new Date(2026, 9, 4, 9, 5))).toBe("09:05");
    expect(clockWords(new Date(2026, 9, 4, 15, 30), null)).toBe("15:30");
  });

  it("shows how long a focus session has left, by the reading it has counted", () => {
    expect(minutesLeft({ durationMinutes: 25, elapsedMs: 0 })).toBe(25);
    expect(minutesLeft({ durationMinutes: 25, elapsedMs: 7 * 60_000 + 1 })).toBe(18);
    expect(minutesLeft({ durationMinutes: 25, elapsedMs: 24.5 * 60_000 })).toBe(1);
    expect(minutesLeft({ durationMinutes: 25, elapsedMs: 40 * 60_000 })).toBe(0);
    const now = new Date(2026, 9, 4, 15, 30);
    expect(clockArt(now, { durationMinutes: 25, elapsedMs: 7 * 60_000 }).left).toBe(18);
    expect(clockWords(now, 18)).toBe("15:30, 18 minutes left in your focus session");
    expect(clockWords(now, 1)).toBe("15:30, 1 minute left in your focus session");
    expect(sessionWords(0)).toBe("your focus session has run its time");
    expect(sessionWords(null)).toBeNull();
    // The wedge: the minutes left out of sixty, never more than the whole face.
    expect(wedge(null)).toBe(0);
    expect(wedge(15)).toBe(0.25);
    expect(wedge(90)).toBe(1);
  });

  it("is drawn with its hands at the time, and a wedge for the session's minutes left", () => {
    const three = drawn("wallclock", { hour: 3, minute: 0, left: null });
    // The minute hand up to twelve, the hour hand out to three.
    expect(three.g.get(6, 2)?.toLowerCase()).toBe("#1a1a22");
    expect(three.g.get(8, 6)?.toLowerCase()).toBe("#c8453b");
    expect(three.count("#F6B3A8")).toBe(0);
    const half = drawn("wallclock", { hour: 3.5, minute: 30, left: null });
    expect(half.g.get(6, 10)?.toLowerCase()).toBe("#1a1a22");
    expect(half.pixels).not.toEqual(three.pixels);
    // A session with a quarter of an hour left: about a quarter of the face, on the right above the middle.
    const face = three.count("#FFF6DF");
    const quarter = drawn("wallclock", { hour: 3, minute: 0, left: 15 });
    const whole = drawn("wallclock", { hour: 3, minute: 0, left: 60 });
    expect(quarter.count("#F6B3A8")).toBeGreaterThan(face * 0.15);
    expect(quarter.count("#F6B3A8")).toBeLessThan(face * 0.35);
    expect(quarter.g.get(8, 4)?.toLowerCase()).toBe("#f6b3a8");
    expect(quarter.g.get(4, 8)?.toLowerCase()).toBe("#fff6df");
    expect(whole.count("#FFF6DF")).toBe(0);
    expect(drawn("wallclock", { hour: 3, minute: 0, left: 0 }).count("#F6B3A8")).toBe(0);
  });

  it("gives Pip something to say about it", () => {
    inHerVoice(clockLines(new Date(2026, 9, 4, 15, 30), null));
    inHerVoice(clockLines(new Date(2026, 9, 4, 23, 30), null));
    inHerVoice(clockLines(new Date(2026, 9, 4, 15, 30), 18));
    expect(clockLines(new Date(2026, 9, 4, 15, 30), 18)).toContain("18 to go. you can do it.");
  });
});

describe("the houseplant", () => {
  const TODAY = "2026-10-04";
  const ago = (days: number) => new Date(Date.UTC(2026, 9, 4 - days)).toISOString().slice(0, 10);
  const read = (...entries: Array<[daysAgo: number, minutes: number]>): FreeDay[] => entries.map(([days, minutes]) => ({ dateKey: ago(days), minutes }));

  it("thrives on ten minutes of free reading today", () => {
    const plant = plantOf(read([0, 10]), TODAY);
    expect(plant).toMatchObject({ state: "thriving", resting: false, water: 10, today: 10, week: 10, wants: 0 });
    expect(plantOf(read([0, 45]), TODAY).state).toBe("thriving");
    expect(plantWants(plant)).toBe("It has all the water it wants today.");
  });

  it("says in plain numbers what it wants", () => {
    const plant = plantOf(read([0, 3]), TODAY);
    expect(plant).toMatchObject({ state: "fine", wants: 7 });
    expect(plantWants(plant)).toBe("It wants about 7 minutes more of reading outside a focus session today.");
    // Exactly that much more today and it thrives.
    expect(plantOf(read([0, 3 + plant.wants]), TODAY).state).toBe("thriving");
    expect(plantWants(plantOf(read([0, 9.5]), TODAY))).toMatch(/about 1 minute more/);
    for (const days of [read([0, 1]), read([1, 10]), read([3, 12]), read([5, 30]), []]) {
      const now = plantOf(days, TODAY);
      if (now.state === "thriving") continue;
      const more = [...days.filter((entry) => entry.dateKey !== TODAY), { dateKey: TODAY, minutes: (days.find((entry) => entry.dateKey === TODAY)?.minutes ?? 0) + now.wants }];
      expect(plantOf(more, TODAY).state).toBe("thriving");
    }
  });

  it("dries out over the days after, a little at a time, and then rests", () => {
    // Ten minutes, once: fine for two days, thirsty for two, drooping for two, and then at rest.
    const states = Array.from({ length: 9 }, (_, days) => plantOf(read([days, 10]), TODAY));
    expect(states.map((plant) => plant.state)).toEqual(["thriving", "fine", "fine", "thirsty", "thirsty", "drooping", "drooping", "fine", "fine"]);
    expect(states.map((plant) => plant.resting)).toEqual([false, false, false, false, false, false, false, true, true]);
    // Water only ever drains with time.
    for (let days = 1; days < 7; days += 1) expect(states[days].water).toBeLessThan(states[days - 1].water);
    expect(PLANT.keeps).toBeGreaterThan(0);
    expect(PLANT.keeps).toBeLessThan(1);
  });

  it("does not shame a reader who only ever reads in focus sessions: it rests, and looks fine", () => {
    const never = plantOf([], TODAY);
    expect(never).toMatchObject({ state: "fine", resting: true, water: 0, total: 0, leaves: 2, flowers: 0 });
    expect(plantNow(never)).toBe("fine, resting");
    expect(plantReport(never)[0]).toMatch(/resting; it comes to no harm/);
    // However long it goes on, and whatever was read long ago.
    for (const days of [8, 30, 365, 2000]) expect(plantOf(read([days, 120]), TODAY)).toMatchObject({ state: "fine", resting: true });
    // Drooping is only ever a passing thing: no history leaves it drooping for more than a few days.
    let drooping = 0;
    for (let days = 0; days < 40; days += 1) if (plantOf(read([days, 10], [days + 1, 25], [days + 9, 60]), TODAY).state === "drooping") drooping += 1;
    expect(drooping).toBeLessThanOrEqual(3);
    // Seconds of stray reading are not somebody watering it.
    expect(plantOf(read([2, 0.4]), TODAY)).toMatchObject({ state: "fine", resting: true });
  });

  it("never dies, whatever it is given", () => {
    const odd: FreeDay[] = [{ dateKey: "not a day", minutes: 50 }, { dateKey: ago(-3), minutes: 50 }, { dateKey: ago(1), minutes: Number.NaN }, { dateKey: ago(2), minutes: -20 }];
    const plant = plantOf(odd, TODAY);
    expect(["thriving", "fine", "thirsty", "drooping"]).toContain(plant.state);
    expect(plant).toMatchObject({ state: "fine", resting: true, total: 0 });
    expect(plant.leaves).toBeGreaterThanOrEqual(2);
  });

  it("grows a leaf for every hour of free reading there has ever been, and flowers every five", () => {
    expect(plantOf(read([100, 59]), TODAY)).toMatchObject({ leaves: 2, flowers: 0, nextLeaf: 1, nextFlower: 241 });
    expect(plantOf(read([100, 60]), TODAY)).toMatchObject({ leaves: 3, nextLeaf: 60 });
    expect(plantOf(read([100, 200], [50, 100]), TODAY)).toMatchObject({ leaves: 6, flowers: 1, nextLeaf: null, nextFlower: 300, total: 300 });
    expect(plantOf(read([100, 5000]), TODAY)).toMatchObject({ leaves: 6, flowers: 3, nextLeaf: null, nextFlower: null });
    // What it has grown it keeps: resting or drooping, the leaves and flowers are still there.
    expect(plantOf(read([5, 10], [100, 890]), TODAY)).toMatchObject({ state: "drooping", leaves: 6, flowers: 3 });
  });

  it("is told about in a few plain lines, and Pip talks to it", () => {
    for (const days of [[], read([0, 10]), read([1, 10]), read([3, 10]), read([5, 10]), read([0, 400])]) {
      const plant = plantOf(days, TODAY);
      const report = plantReport(plant);
      expect(report).toHaveLength(4);
      for (const line of report) expect(line.length).toBeGreaterThan(3);
      expect(report[2]).toBe(plantWants(plant));
      inHerVoice(plantLines(plant));
    }
    expect(plantReport(plantOf(read([0, 12], [2, 30]), TODAY))[1]).toBe("Watered by reading outside a focus session: 12 minutes today, 42 minutes this week.");
    expect(plantReport(plantOf(read([100, 100]), TODAY))[3]).toBe("3 leaves; the next after 20 minutes more. No flower yet; the next after 3 hours 20 minutes more.");
  });

  it("is drawn greener the better it is, with its leaves and its flowers", () => {
    const thriving = drawn("plantpot", { state: "thriving", leaves: 4, flowers: 0 });
    const thirsty = drawn("plantpot", { state: "thirsty", leaves: 4, flowers: 0 });
    const drooping = drawn("plantpot", { state: "drooping", leaves: 4, flowers: 0 });
    expect(thriving.count("#3FA35E")).toBeGreaterThan(6);
    expect(thirsty.count("#3FA35E")).toBe(0);
    expect(thirsty.count("#9CB86A")).toBeGreaterThan(6);
    expect(drooping.count("#8A9A5A")).toBeGreaterThan(6);
    // Drooping, its leaves hang lower than they stand.
    const top = (picture: ReturnType<typeof drawn>, colour: string) => Math.floor(picture.pixels.indexOf(colour) / 10);
    expect(top(drooping, "#8a9a5a")).toBeGreaterThan(top(thriving, "#3fa35e") + 2);
    // More leaves, more green; flowers on top once it has them. The pot is always there.
    expect(drawn("plantpot", { state: "fine", leaves: 6, flowers: 0 }).count("#3FA35E")).toBeGreaterThan(drawn("plantpot", { state: "fine", leaves: 2, flowers: 0 }).count("#3FA35E"));
    expect(drawn("plantpot", { state: "fine", leaves: 6, flowers: 2 }).count("#FFD23F")).toBe(2);
    expect(drawn("plantpot", { state: "fine", leaves: 6, flowers: 0 }).count("#FFD23F")).toBe(0);
    for (const picture of [thriving, thirsty, drooping, drawn("plantpot")]) expect(picture.count("#C8683C")).toBeGreaterThan(8);
    // Only a thriving one stirs; the rest are still from frame to frame.
    expect(drawn("plantpot", { state: "fine", leaves: 6, flowers: 1 }, 7).pixels).toEqual(drawn("plantpot", { state: "fine", leaves: 6, flowers: 1 }, 0).pixels);
  });
});

describe("the radio", () => {
  it("has its dial lit when it is on, and notes over it while it plays", () => {
    const off = drawn("radio", { on: false, playing: false });
    const on = drawn("radio", { on: true, playing: false });
    const playing = drawn("radio", { on: true, playing: true });
    expect(off.count("#FFE36B")).toBe(0);
    expect(on.count("#FFE36B")).toBeGreaterThan(0);
    // The notes are in the room its art keeps above the set, and only while it sounds.
    const above = (picture: ReturnType<typeof drawn>) => picture.pixels.slice(0, 12 * 8).filter((c) => c === "#ff4d6d" || c === "#8e5cff").length;
    expect(above(off)).toBe(0);
    expect(above(on)).toBe(0);
    expect(above(playing)).toBeGreaterThan(0);
    // They drift: another frame, another place. Still, a radio off is the same at every frame.
    expect(drawn("radio", { on: true, playing: true }, 12).pixels).not.toEqual(playing.pixels);
    expect(drawn("radio", { on: false, playing: false }, 12).pixels).toEqual(off.pixels);
    expect(drawn("radio").pixels).toEqual(off.pixels);
    // Lit, it glows a little after dark; off, not at all.
    expect(on.item.glow?.(0, { on: true })).toHaveLength(1);
    expect(on.item.glow?.(0, { on: false })).toEqual([]);
    expect(on.item.glow?.(0, undefined)).toEqual([]);
  });
});

describe("the album board", () => {
  it("has the newest finds pinned to it, and bare pins where there are none yet", () => {
    const bare = drawn("corkboard", { finds: [] });
    expect(bare.count("#8C7A5A")).toBe(3);
    expect(drawn("corkboard").pixels).toEqual(bare.pixels);
    // An id it does not know draws nothing, and breaks nothing.
    expect(drawn("corkboard", { finds: ["no-such-find"] }).count("#E0393E")).toBe(1);
    // Three finds: a coloured pin over each, and each drawn in its own six pixels square of the board.
    const finds = FIND_ART_IDS.slice(0, 3);
    const full = drawn("corkboard", { finds });
    expect(full.count("#8C7A5A")).toBe(0);
    for (let i = 0; i < 3; i += 1) {
      const alone = drawn("corkboard", { finds: finds.map((id, at) => (at === i ? id : "")) });
      const changed = alone.pixels.map((c, at) => (c !== bare.pixels[at] ? at : -1)).filter((at) => at >= 0);
      expect(changed.length).toBeGreaterThan(4);
      for (const at of changed) {
        expect(at % 24).toBeGreaterThanOrEqual(2 + i * 7);
        expect(at % 24).toBeLessThan(2 + i * 7 + 6);
        expect(Math.floor(at / 24)).toBeGreaterThanOrEqual(2);
        expect(Math.floor(at / 24)).toBeLessThan(9);
      }
    }
    expect(full.pixels).not.toEqual(drawn("corkboard", { finds: [...finds].reverse() }).pixels);
  });
});

describe("her diary", () => {
  it("lies on top of the bookcase, with a ribbon out of it once today's page is written", () => {
    const none = drawn("bookcase", { shelves: [], count: null });
    const blank = drawn("bookcase", { shelves: [], count: null, diary: { today: false } });
    const written = drawn("bookcase", { shelves: [], count: null, diary: { today: true } });
    expect(none.count("#7A4BB0")).toBe(0);
    expect(blank.count("#7A4BB0")).toBeGreaterThan(8);
    expect(blank.count("#E0393E")).toBe(0);
    expect(written.count("#E0393E")).toBe(2);
    // It is in the room above the case, inside the part it is chosen by.
    const at = blank.pixels.map((c, i) => (c === "#7a4bb0" ? i : -1)).filter((i) => i >= 0);
    for (const i of at) {
      expect(i % 26).toBeLessThan(pip.BOOKCASE_DIARY.x + pip.BOOKCASE_DIARY.w);
      expect(Math.floor(i / 26)).toBeLessThan(pip.BOOKCASE_DIARY.y + pip.BOOKCASE_DIARY.h);
    }
    // The tag, when there is one, is beside it and not over it.
    const both = drawn("bookcase", { shelves: [], count: 400, diary: { today: true } });
    expect(both.count("#7A4BB0")).toBe(blank.count("#7A4BB0"));
    expect(both.count("#E0393E")).toBe(2);
    expect(both.count("#FFF6DF")).toBeGreaterThan(40);
    // A number too long for the room beside the diary is said short.
    expect(drawn("bookcase", { shelves: [], count: 1200, diary: { today: false } }).count("#7A4BB0")).toBe(blank.count("#7A4BB0"));
  });
});
