import { beforeAll, describe, expect, it } from "vitest";
import {
  AWAY_NOTE,
  BACK_FOR_MS,
  CLEAN_REACH,
  FINDS,
  MIN_FIND_MINUTES,
  PLACES,
  RARITIES,
  buildAlbum,
  expeditionOf,
  findsOf,
  latestFinds,
  minutesToReach,
  nearestPlaceFor,
  outingOf,
  placeFor,
  rarityAt,
  reachOf,
  showLine,
  timesText,
  tripNow,
  type ExpeditionSession,
  type Rarity
} from "./expedition";
import {
  FIND_ART_IDS,
  FIND_MINI,
  FIND_MINIS,
  FIND_SIZE,
  FIND_SPRITES,
  renderFind,
  renderFindMini,
  renderFindSilhouette
} from "./expedition-art.js";

beforeAll(() => {
  // The art makes ImageData; outside a browser there is none.
  if (typeof globalThis.ImageData === "undefined") {
    (globalThis as { ImageData?: unknown }).ImageData = class {
      width: number;
      height: number;
      data: Uint8ClampedArray;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    };
  }
});

const session = (id: string, minutes: number, over: Partial<ExpeditionSession> = {}): ExpeditionSession => ({
  id,
  styleSeed: id,
  minutes,
  endedReason: "completed",
  clean: true,
  startedAt: "2026-10-01T18:00:00.000Z",
  endedAt: "2026-10-01T18:30:00.000Z",
  title: "Mistborn",
  bookId: "book-1",
  ...over
});

/** A session as Leaflet names them, `n` of a run. */
const idOf = (n: number) => `session-${1759581234567 + n * 86_400_000}-${(n * 37) % 1000}`;

describe("which sessions find something", () => {
  it("finds nothing in a session of under five minutes, however it ended", () => {
    expect(expeditionOf(session("a", 4.9))).toBeNull();
    expect(expeditionOf(session("a", 4.9, { endedReason: "manual_end", clean: false }))).toBeNull();
    expect(expeditionOf(session("a", 0))).toBeNull();
    expect(reachOf(session("a", 3))).toBe(0);
  });

  it("finds something in every session of five minutes or more, completed or ended early", () => {
    for (let n = 0; n < 200; n += 1) {
      expect(expeditionOf(session(idOf(n), MIN_FIND_MINUTES))).not.toBeNull();
      expect(expeditionOf(session(idOf(n), 12, { endedReason: "manual_end", clean: false }))).not.toBeNull();
    }
  });

  it("is not thrown by minutes that are not a number", () => {
    expect(expeditionOf(session("a", Number.NaN))).toBeNull();
    expect(expeditionOf(session("a", -20))).toBeNull();
    expect(expeditionOf(session("a", Number.POSITIVE_INFINITY))).toBeNull();
  });
});

describe("how far she gets", () => {
  it("is the minutes read, half as far again for a session completed without leaving the book", () => {
    expect(reachOf(session("a", 20))).toBe(20 * CLEAN_REACH);
    expect(reachOf(session("a", 20, { endedReason: "manual_end", clean: false }))).toBe(20);
    // Completed, but the book was left: no bonus.
    expect(reachOf(session("a", 20, { clean: false }))).toBe(20);
    // Marked clean, but ended early: no bonus either.
    expect(reachOf(session("a", 20, { endedReason: "manual_end" }))).toBe(20);
  });

  it("names a place for the session lengths on offer", () => {
    const at = (minutes: number, early = false) =>
      placeFor(reachOf(session("a", minutes, early ? { endedReason: "manual_end", clean: false } : {})))?.id ?? null;
    expect([10, 20, 30, 45, 60].map((minutes) => at(minutes))).toEqual(["lane", "woods", "hills", "shore", "edge"]);
    // Ended early she turns back where the minutes read got her.
    expect([5, 14, 15, 29, 30, 59, 60, 90].map((minutes) => at(minutes, true))).toEqual([
      "gate",
      "gate",
      "lane",
      "lane",
      "woods",
      "hills",
      "shore",
      "edge"
    ]);
    expect(placeFor(0)).toBeNull();
    expect(placeFor(4.99)).toBeNull();
  });

  it("has odds that add up, and get rarer with every place", () => {
    const rareShare = (odds: readonly number[]) => odds[2] + odds[3] + odds[4];
    PLACES.forEach((place, index) => {
      expect(place.odds.reduce((sum, value) => sum + value, 0)).toBe(100);
      if (index > 0) {
        expect(place.from).toBeGreaterThan(PLACES[index - 1].from);
        expect(rareShare(place.odds)).toBeGreaterThan(rareShare(PLACES[index - 1].odds));
        expect(place.odds[4]).toBeGreaterThanOrEqual(PLACES[index - 1].odds[4]);
        expect(place.odds[0]).toBeLessThan(PLACES[index - 1].odds[0]);
      }
    });
    // The first two places never find the rarest; the commonest never fall under 15 in 100.
    expect(PLACES[0].odds.slice(2)).toEqual([0, 0, 0]);
    expect(PLACES[1].odds.slice(3)).toEqual([0, 0]);
    expect(Math.min(...PLACES.map((place) => place.odds[0]))).toBeGreaterThanOrEqual(15);
  });

  it("turns a draw into a rarity by the place's odds", () => {
    const woods = PLACES[2];
    expect(rarityAt(woods, 0)).toBe("common");
    expect(rarityAt(woods, 0.399)).toBe("common");
    expect(rarityAt(woods, 0.4)).toBe("uncommon");
    expect(rarityAt(woods, 0.939)).toBe("rare");
    expect(rarityAt(woods, 0.985)).toBe("epic");
    expect(rarityAt(woods, 0.995)).toBe("legendary");
    expect(rarityAt(PLACES[0], 0.9999999)).toBe("uncommon");
  });
});

describe("what she finds", () => {
  it("is the same for the same session, whatever else is on the shelf", () => {
    const one = session(idOf(7), 30);
    const alone = expeditionOf(one);
    const again = expeditionOf({ ...one });
    expect(again).toEqual(alone);
    const among = buildAlbum([session(idOf(1), 30), one, session(idOf(9), 45)]);
    expect(among.finds.find((found) => found.sessionId === one.id)?.find.id).toBe(alone?.find.id);
  });

  it("is seeded by the shelf's seed, and by the id where there is none", () => {
    const seeded = expeditionOf(session("x", 30, { styleSeed: "the-seed" }));
    expect(expeditionOf(session("another-id", 30, { styleSeed: "the-seed" }))?.find).toEqual(seeded?.find);
    expect(expeditionOf(session("the-seed", 30, { styleSeed: "" }))?.find).toEqual(seeded?.find);
    expect(expeditionOf({ id: "the-seed", minutes: 30, endedReason: "completed", clean: true })?.find).toEqual(seeded?.find);
  });

  it("follows the place's odds over many sessions", () => {
    // 30 minutes completed: the hills, 27 / 32 / 27 / 12 / 2 in a hundred.
    const counts: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
    const total = 20_000;
    for (let n = 0; n < total; n += 1) {
      const trip = expeditionOf(session(idOf(n), 30));
      counts[trip!.find.rarity] += 1;
      expect(trip!.place.id).toBe("hills");
    }
    const hills = PLACES[3].odds;
    RARITIES.forEach((rarity, index) => {
      expect(Math.abs((counts[rarity] / total) * 100 - hills[index])).toBeLessThan(1.2);
    });
  });

  it("picks evenly among the things of a rarity", () => {
    const seen = new Map<string, number>();
    let commons = 0;
    for (let n = 0; n < 30_000; n += 1) {
      // Ended early at ten minutes: the gate, nine in ten common.
      const trip = expeditionOf(session(idOf(n), 10, { endedReason: "manual_end", clean: false }))!;
      if (trip.find.rarity === "common") {
        commons += 1;
        seen.set(trip.find.id, (seen.get(trip.find.id) ?? 0) + 1);
      }
    }
    const each = commons / findsOf("common").length;
    expect(seen.size).toBe(findsOf("common").length);
    for (const count of seen.values()) {
      expect(Math.abs(count - each) / each).toBeLessThan(0.12);
    }
  });

  it("finds rarer things in longer sessions", () => {
    const rareOrBetter = (minutes: number) => {
      let hits = 0;
      for (let n = 0; n < 5000; n += 1) {
        const rarity = expeditionOf(session(idOf(n), minutes))!.find.rarity;
        if (rarity !== "common" && rarity !== "uncommon") hits += 1;
      }
      return hits;
    };
    const [ten, twenty, thirty, fortyFive, sixty] = [10, 20, 30, 45, 60].map(rareOrBetter);
    expect(ten).toBeLessThan(twenty);
    expect(twenty).toBeLessThan(thirty);
    expect(thirty).toBeLessThan(fortyFive);
    expect(fortyFive).toBeLessThan(sixty);
  });

  // The lists are frozen once shipped: these sessions found these things, and
  // an edit that changes what past sessions found fails here.
  it("keeps finding what it found (the lists and the odds are frozen)", () => {
    expect(FINDS.map((find) => find.id).join(" ")).toBe(
      "pressed-leaf acorn smooth-stone bottle-cap feather button good-stick pine-cone dandelion paperclip snail-shell pencil-stub clover mushroom " +
        "ticket-stub lost-bookmark marble small-key jay-feather sea-glass conker library-card die postage-stamp thimble " +
        "tiny-fossil four-leaf-clover old-coin compass seashell magnifying-glass quill sealed-letter tiny-bell " +
        "message-bottle map-fragment pocket-watch geode spyglass tiny-book " +
        "star-jar golden-acorn dragon-scale moon-piece"
    );
    expect(RARITIES.map((rarity) => findsOf(rarity).length)).toEqual([14, 11, 9, 6, 4]);
    expect(PLACES.map((place) => [place.from, ...place.odds])).toEqual([
      [5, 90, 10, 0, 0, 0],
      [15, 62, 30, 8, 0, 0],
      [30, 40, 34, 20, 5, 1],
      [45, 27, 32, 27, 12, 2],
      [60, 19, 27, 29, 18, 7],
      [90, 18, 24, 27, 19, 12]
    ]);
    const found = (id: string, minutes: number) => expeditionOf(session(id, minutes))?.find.id;
    expect([
      found("session-1759581234567-123", 20),
      found("session-1759667634567-456", 30),
      found("session-1759754034567-789", 45),
      found("session-1759840434567-12", 60),
      found("legacy-import-0001", 10)
    ]).toMatchInlineSnapshot(`
      [
        "pressed-leaf",
        "postage-stamp",
        "jay-feather",
        "star-jar",
        "conker",
      ]
    `);
  });
});

describe("the album", () => {
  const sessions = Array.from({ length: 60 }, (_, n) =>
    session(idOf(n), [10, 20, 30, 45][n % 4], {
      startedAt: new Date(Date.UTC(2026, 6, 1 + n, 18)).toISOString(),
      endedAt: new Date(Date.UTC(2026, 6, 1 + n, 18, 30)).toISOString()
    })
  );

  it("lists everything there is, found or not, in the album's order", () => {
    const album = buildAlbum(sessions);
    expect(album.entries.map((entry) => entry.find.id)).toEqual(FINDS.map((find) => find.id));
    expect(album.total).toBe(44);
    expect(album.trips).toBe(60);
    expect(album.found).toBe(album.entries.filter((entry) => entry.count > 0).length);
    expect(album.entries.reduce((sum, entry) => sum + entry.count, 0)).toBe(60);
    for (const entry of album.entries) {
      expect(entry.first === null).toBe(entry.count === 0);
    }
  });

  it("counts duplicates up and keeps the first time each was found", () => {
    const album = buildAlbum(sessions);
    const repeated = album.entries.find((entry) => entry.count > 1)!;
    expect(repeated).toBeTruthy();
    expect(timesText(repeated.count)).toBe(`x${repeated.count}`);
    expect(timesText(1)).toBe("");
    expect(timesText(0)).toBe("");
    const all = album.finds.filter((found) => found.find.id === repeated.find.id);
    expect(all.length).toBe(repeated.count);
    const earliest = all.reduce((first, found) => (Date.parse(found.at) < Date.parse(first.at) ? found : first));
    expect(repeated.first).toEqual(earliest);
    expect(repeated.first?.title).toBe("Mistborn");
    expect(repeated.first?.place.name).toBeTruthy();
  });

  it("says how many of each rarity remain", () => {
    const album = buildAlbum(sessions);
    expect(album.byRarity.map((tally) => tally.rarity)).toEqual([...RARITIES]);
    for (const tally of album.byRarity) {
      expect(tally.total).toBe(findsOf(tally.rarity).length);
      expect(tally.found + tally.left).toBe(tally.total);
      expect(tally.found).toBe(album.entries.filter((entry) => entry.find.rarity === tally.rarity && entry.count > 0).length);
    }
    expect(album.byRarity.reduce((sum, tally) => sum + tally.found, 0)).toBe(album.found);
  });

  it("is the same album whatever order the sessions come in", () => {
    const album = buildAlbum(sessions);
    const shuffled = [...sessions].sort((a, b) => (a.id.slice(-2) < b.id.slice(-2) ? -1 : 1));
    expect(buildAlbum(shuffled)).toEqual(album);
    expect(buildAlbum([...sessions].reverse())).toEqual(album);
  });

  it("counts sessions from before this existed, and burned ones", () => {
    const old = session("session-1700000000000-1", 25, { endedAt: "2023-11-14T22:13:20.000Z" });
    const burned = session("session-1700086400000-2", 25, { endedAt: "2023-11-15T22:13:20.000Z", burnedAt: "2023-11-20T08:00:00.000Z" });
    const album = buildAlbum([old, burned]);
    expect(album.trips).toBe(2);
    expect(album.finds.map((found) => found.sessionId)).toEqual([burned.id, old.id]);
  });

  it("is empty for an empty shelf, and for one of sessions too short to find anything", () => {
    for (const shelf of [[], [session("a", 2), session("b", 4)]]) {
      const album = buildAlbum(shelf);
      expect(album.found).toBe(0);
      expect(album.trips).toBe(0);
      expect(album.entries.every((entry) => entry.count === 0 && entry.first === null)).toBe(true);
      expect(album.byRarity.map((tally) => tally.left)).toEqual([14, 11, 9, 6, 4]);
    }
  });

  it("gives the latest few, newest first", () => {
    const album = buildAlbum(sessions);
    const latest = latestFinds(album, 3);
    expect(latest.map((found) => found.sessionId)).toEqual([idOf(59), idOf(58), idOf(57)]);
    expect(latestFinds(buildAlbum([]), 3)).toEqual([]);
    expect(latestFinds(album, 0)).toEqual([]);
  });
});

describe("a long reading life still has things to find", () => {
  /** Days of one session a day until the album is whole, for a reader starting on `start`. */
  const daysToComplete = (minutes: number, start: number, limit = 6000) => {
    const found = new Set<string>();
    let half: number | null = null;
    for (let day = 1; day <= limit; day += 1) {
      found.add(expeditionOf(session(`reader-${start}-day-${day}`, minutes))!.find.id);
      if (half === null && found.size >= FINDS.length / 2) half = day;
      if (found.size === FINDS.length) return { days: day, half: half ?? day };
    }
    return { days: Number.POSITIVE_INFINITY, half: half ?? limit };
  };
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

  it("takes about a year at 30 minutes a day, and half of it comes in the first weeks", () => {
    const readers = Array.from({ length: 300 }, (_, start) => daysToComplete(30, start));
    const days = median(readers.map((reader) => reader.days));
    const half = median(readers.map((reader) => reader.half));
    expect(days).toBeGreaterThan(270);
    expect(days).toBeLessThan(480);
    expect(half).toBeGreaterThan(20);
    expect(half).toBeLessThan(45);
  });

  it("is quicker with longer sessions, and never whole on ten-minute ones", () => {
    const at = (minutes: number) => median(Array.from({ length: 120 }, (_, start) => daysToComplete(minutes, start).days));
    expect(at(45)).toBeLessThan(at(30));
    expect(at(30)).toBeLessThan(at(20));
    // Ten minutes is the lane: the far things are not found there at all.
    expect(daysToComplete(10, 1, 2000).days).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("while a session runs", () => {
  it("says how far she has got on the minutes read, and where she is heading", () => {
    const start = outingOf({ durationMinutes: 30 }, 0);
    expect(start.place).toBeNull();
    expect(start.heading?.id).toBe("hills");
    expect(outingOf({ durationMinutes: 30 }, 4 * 60_000).place).toBeNull();
    expect(outingOf({ durationMinutes: 30 }, 6 * 60_000).place?.id).toBe("gate");
    expect(outingOf({ durationMinutes: 30 }, 20 * 60_000).place?.id).toBe("lane");
    expect(outingOf({ durationMinutes: 45 }, 31 * 60_000).place?.id).toBe("woods");
    expect(outingOf({ durationMinutes: 3 }, 0).heading).toBeNull();
    expect(outingOf({ durationMinutes: 30 }, -5).minutesRead).toBe(0);
  });
});

describe("for the house: out, and back with something", () => {
  const ended = Date.parse("2026-10-01T18:30:00.000Z");
  const album = buildAlbum([
    session("older", 30, { endedAt: "2026-09-30T18:30:00.000Z" }),
    session("newest", 30, { endedAt: "2026-10-01T18:30:00.000Z" })
  ]);
  const idle = { running: null, readMs: 0, album, seen: null, now: ended + 60_000 };

  it("has her out for as long as a focus session runs, with nothing to show", () => {
    const trip = tripNow({ ...idle, running: { durationMinutes: 30 }, readMs: 16 * 60_000 });
    expect(trip.away?.place?.id).toBe("lane");
    expect(trip.away?.heading?.id).toBe("hills");
    expect(trip.back).toBeNull();
  });

  it("has her back with the newest find until the house has shown it", () => {
    const trip = tripNow(idle);
    expect(trip.away).toBeNull();
    expect(trip.back?.sessionId).toBe("newest");
    expect(tripNow({ ...idle, seen: "newest" }).back).toBeNull();
    // An older one having been shown does not hide the newest.
    expect(tripNow({ ...idle, seen: "older" }).back?.sessionId).toBe("newest");
  });

  it("does not act out old news: a find is hers to show for half a day", () => {
    expect(tripNow({ ...idle, now: ended + BACK_FOR_MS }).back?.sessionId).toBe("newest");
    expect(tripNow({ ...idle, now: ended + BACK_FOR_MS + 1 }).back).toBeNull();
    // A reader updating with years of sessions opens an album, not Pip at the door.
    expect(tripNow({ ...idle, now: ended + 400 * 86_400_000 }).back).toBeNull();
  });

  it("has nothing to show for an empty shelf, or a session too short to find anything", () => {
    expect(tripNow({ ...idle, album: buildAlbum([]) })).toEqual({ away: null, back: null });
    const short = buildAlbum([session("short", 3, { endedAt: "2026-10-01T18:30:00.000Z" })]);
    expect(tripNow({ ...idle, album: short }).back).toBeNull();
  });

  it("speaks in lines that fit her bubble", () => {
    expect(AWAY_NOTE.length).toBeLessThanOrEqual(44);
    for (const find of FINDS) {
      expect(showLine(find).length).toBeLessThanOrEqual(44);
      expect(showLine(find)).toBe(showLine(find).toLowerCase());
    }
  });
});

describe("where a rarity is found", () => {
  it("names the nearest place for each, and the shortest session that gets there", () => {
    expect(RARITIES.map((rarity) => nearestPlaceFor(rarity).id)).toEqual(["gate", "gate", "lane", "woods", "woods"]);
    expect(PLACES.map(minutesToReach)).toEqual([5, 10, 20, 30, 40, 60]);
    // A completed session of that length does reach it, and a minute less does not.
    for (const place of PLACES.slice(1)) {
      const minutes = minutesToReach(place);
      expect(placeFor(reachOf(session("a", minutes)))?.id).toBe(place.id);
      expect(placeFor(reachOf(session("a", minutes - 1)))?.id).not.toBe(place.id);
    }
  });
});

describe("the sprites", () => {
  const pixels = (image: ImageData) => {
    let count = 0;
    for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > 0) count += 1;
    return count;
  };

  it("draws every thing there is to find, and nothing else", () => {
    expect([...FIND_ART_IDS].sort()).toEqual(FINDS.map((find) => find.id).sort());
  });

  it("draws each at the size she can hold, with something in it", () => {
    for (const find of FINDS) {
      const image = renderFind(find.id, 0);
      expect([image.width, image.height]).toEqual([FIND_SIZE, FIND_SIZE]);
      expect(pixels(image)).toBeGreaterThan(20);
    }
    expect(FIND_SIZE).toBeLessThanOrEqual(12);
    expect(pixels(renderFind("no-such-thing"))).toBe(0);
  });

  it("draws no two alike", () => {
    const seen = new Set(FINDS.map((find) => Array.from(renderFind(find.id, 0).data).join(",")));
    expect(seen.size).toBe(FINDS.length);
  });

  it("is a pure function of the frame", () => {
    for (const find of FINDS) {
      for (const frame of [0, 7, 40]) {
        expect(Array.from(renderFind(find.id, frame).data)).toEqual(Array.from(renderFind(find.id, frame).data));
      }
    }
  });

  it("offers each in the house's item format, at full size and at half", () => {
    expect(FIND_SPRITES.map((item) => item.id)).toEqual(FIND_ART_IDS);
    expect(FIND_MINIS.map((item) => item.id)).toEqual(FIND_ART_IDS);
    expect(FIND_MINI).toBe(FIND_SIZE / 2);
    for (const item of FIND_MINIS) {
      expect([item.w, item.h]).toEqual([FIND_MINI, FIND_MINI]);
      const mini = renderFindMini(item.id, 0);
      expect([mini.width, mini.height]).toEqual([FIND_MINI, FIND_MINI]);
      expect(pixels(mini)).toBeGreaterThan(8);
    }
  });

  it("gives a thing not found yet its shape in one flat colour", () => {
    for (const find of FINDS) {
      const shape = renderFindSilhouette(find.id, "#11223380");
      const drawn = renderFind(find.id, 0);
      for (let i = 0; i < shape.data.length; i += 4) {
        expect(shape.data[i + 3] > 0).toBe(drawn.data[i + 3] > 0);
        if (shape.data[i + 3] > 0) {
          expect([shape.data[i], shape.data[i + 1], shape.data[i + 2], shape.data[i + 3]]).toEqual([0x11, 0x22, 0x33, 0x80]);
        }
      }
    }
  });
});

describe("her lines", () => {
  it("has a name with its article and a line in her voice for every thing", () => {
    for (const find of FINDS) {
      expect(find.name).toMatch(/^(a|an) [a-z' -]+$/);
      expect(find.line).toBe(find.line.toLowerCase());
      expect(find.line.length).toBeGreaterThan(10);
      expect(find.line.length).toBeLessThan(70);
      expect(find.line).not.toMatch(/[—–]/);
    }
    expect(new Set(FINDS.map((find) => find.name)).size).toBe(FINDS.length);
    expect(new Set(FINDS.map((find) => find.line)).size).toBe(FINDS.length);
  });
});
