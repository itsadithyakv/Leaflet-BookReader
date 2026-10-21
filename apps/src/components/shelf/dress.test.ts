import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FocusSessionRecord } from "../../services/habitService";
import {
  COVER_RING_RATE,
  STICKER_TEXT,
  WEAR_RATE,
  bindingFor,
  coverDeco,
  stickerFor,
  wearFor,
  type Binding
} from "./dress";
import { buildRows, type WeekRow } from "./rows";
import { GILT, clothStyle, giltOr } from "./spine";
import { TipCard } from "../SessionShelf";

/** Saturday 3 October 2026: its week began on Monday 28 September. */
const TODAY = new Date(2026, 9, 3, 12, 0);

const session = (id: string, dateKey: string, hour: number, minutes: number, bookId = "book-1"): FocusSessionRecord => {
  const [y, m, d] = dateKey.split("-").map(Number);
  const startedAt = new Date(y, m - 1, d, hour, 0);
  return {
    id,
    startedAt: startedAt.toISOString(),
    endedAt: new Date(startedAt.getTime() + minutes * 60_000).toISOString(),
    dateKey,
    minutes,
    bookId,
    title: "Middlemarch",
    notes: null,
    endedReason: "completed",
    clean: true,
    styleSeed: `seed-${id}`,
    burnedAt: null
  };
};

const weeksOf = (rows: ReturnType<typeof buildRows>) => rows.filter((row): row is WeekRow => row.kind === "week");
const ids = Array.from({ length: 4000 }, (_, i) => `book-${i}`);

describe("a spine's binding", () => {
  it("is the book's own: the same key always gives the same binding", () => {
    for (const id of ids.slice(0, 200)) {
      expect(bindingFor(id)).toBe(bindingFor(id));
    }
    expect(bindingFor(null)).toBe("cloth");
  });

  it("spreads books over every binding, most of them in plain cloth", () => {
    const counts = new Map<Binding, number>();
    for (const id of ids) {
      const binding = bindingFor(id);
      counts.set(binding, (counts.get(binding) ?? 0) + 1);
    }
    const share = (binding: Binding) => (counts.get(binding) ?? 0) / ids.length;
    expect(share("cloth")).toBeGreaterThan(0.3);
    expect(share("cloth")).toBeLessThan(0.42);
    for (const binding of ["leather", "paperback", "label", "library"] as const) {
      expect(share(binding)).toBeGreaterThan(0.08);
      expect(share(binding)).toBeLessThan(0.24);
    }
  });

  it("letters leather in gilt only where the cloth carries it", () => {
    expect(giltOr("#24345a")).toBe(GILT); // navy
    expect(giltOr("#8da47e")).not.toBe(GILT); // sage: too light for gold
  });
});

describe("stickers", () => {
  it("mean the week's longest, a late night or an early morning", () => {
    expect(stickerFor(new Date(2026, 9, 1, 20, 0), true)).toBe("star");
    expect(stickerFor(new Date(2026, 9, 1, 23, 30), true)).toBe("star");
    expect(stickerFor(new Date(2026, 9, 1, 23, 0), false)).toBe("moon");
    expect(stickerFor(new Date(2026, 9, 1, 2, 15), false)).toBe("moon");
    expect(stickerFor(new Date(2026, 9, 1, 4, 0), false)).toBe("cup");
    expect(stickerFor(new Date(2026, 9, 1, 7, 59), false)).toBe("cup");
    expect(stickerFor(new Date(2026, 9, 1, 8, 0), false)).toBeNull();
    expect(stickerFor(new Date(2026, 9, 1, 22, 59), false)).toBeNull();
    expect(stickerFor(new Date(Number.NaN), false)).toBeNull();
  });

  it("go on the shelf by those rules, and say so in the spine's label", () => {
    const sessions = [
      session("a", "2026-09-28", 20, 20),
      session("b", "2026-09-29", 23, 15),
      session("c", "2026-09-30", 6, 25),
      session("d", "2026-10-01", 19, 45),
      session("e", "2026-10-02", 12, 10)
    ];
    const [week] = weeksOf(buildRows(sessions, [], new Map(), TODAY));
    const stickers = Object.fromEntries(week.spines.map((spine) => [spine.id, spine.look?.sticker ?? null]));
    expect(stickers).toEqual({ a: null, b: "moon", c: "cup", d: "star", e: null });
    const label = (id: string) => week.spines.find((spine) => spine.id === id)?.label ?? "";
    expect(label("d")).toContain("longest session of its week");
    expect(label("b")).toContain("a late-night read");
    expect(label("c")).toContain("an early-morning read");
    expect(label("a")).not.toMatch(/longest|late-night|early-morning/);
  });

  it("give no star to a short week, and none to a burned spine or loose pages", () => {
    const short = weeksOf(buildRows([session("a", "2026-09-28", 20, 20), session("b", "2026-09-29", 20, 50)], [], new Map(), TODAY));
    expect(short[0].spines.map((spine) => spine.look?.sticker)).toEqual([null, null]);

    const burned = { ...session("x", "2026-09-30", 23, 90), burnedAt: "2026-10-02T09:00:00.000Z" };
    const rows = weeksOf(
      buildRows(
        [session("a", "2026-09-28", 20, 20), session("b", "2026-09-29", 20, 30), session("c", "2026-09-30", 20, 25), session("d", "2026-10-01", 20, 15), burned],
        [],
        new Map(),
        TODAY,
        [{ dateKey: "2026-10-02", minutes: 200 }]
      )
    );
    const byId = new Map(rows[0].spines.map((spine) => [spine.id, spine]));
    expect(byId.get("x")?.look).toBeNull();
    expect(byId.get("free-2026-10-02")?.look).toBeNull();
    expect(byId.get("b")?.look?.sticker).toBe("star");
  });

  it("are named in the spine's tip", () => {
    const sessions = [session("a", "2026-09-29", 23, 15)];
    const [week] = weeksOf(buildRows(sessions, [], new Map(), TODAY));
    const spine = week.spines[0];
    const html = renderToStaticMarkup(createElement(TipCard, { tip: { kind: "spine", spine, x: 0, y: 0, below: false } }));
    expect(html).toContain(STICKER_TEXT.moon);
    const plain = { ...spine, look: spine.look && { ...spine.look, sticker: null } };
    const quiet = renderToStaticMarkup(createElement(TipCard, { tip: { kind: "spine", spine: plain, x: 0, y: 0, below: false } }));
    expect(quiet).not.toContain(STICKER_TEXT.moon);
  });
});

describe("wear", () => {
  it("shows only on spines two or more weeks old, on a few of them, the same every time", () => {
    const seeds = ids.map((id) => `seed-${id}`);
    expect(seeds.every((seed) => wearFor(seed, 0) === null && wearFor(seed, 1) === null)).toBe(true);
    const worn = seeds.filter((seed) => wearFor(seed, 3) !== null);
    const rate = worn.length / seeds.length;
    expect(rate).toBeGreaterThan(WEAR_RATE / 100 - 0.04);
    expect(rate).toBeLessThan(WEAR_RATE / 100 + 0.04);
    expect(new Set(worn.map((seed) => wearFor(seed, 3))).size).toBe(4);
    for (const seed of seeds.slice(0, 100)) {
      expect(wearFor(seed, 5)).toBe(wearFor(seed, 2));
    }
  });

  it("keeps a whole shelf to one detail in a few spines", () => {
    // Twelve weeks of a session a day at 20:00: no time stickers, a star a week, wear on some.
    const sessions: FocusSessionRecord[] = [];
    for (let d = 0; d < 84; d += 1) {
      const day = new Date(2026, 6, 13 + d);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      sessions.push(session(`s${d}`, key, 20, 15 + ((d * 7) % 30), `book-${d % 9}`));
    }
    const spines = weeksOf(buildRows(sessions, [], new Map(), TODAY)).flatMap((week) => week.spines);
    const detailed = spines.filter((spine) => spine.look?.sticker || spine.look?.wear);
    expect(spines.every((spine) => !(spine.look?.sticker && spine.look?.wear))).toBe(true);
    expect(detailed.length / spines.length).toBeGreaterThan(0.12);
    expect(detailed.length / spines.length).toBeLessThan(0.4);
    // Built again, the shelf is dressed the same.
    const again = weeksOf(buildRows(sessions, [], new Map(), TODAY)).flatMap((week) => week.spines);
    expect(again.map((spine) => spine.look)).toEqual(spines.map((spine) => spine.look));
  });
});

describe("a coverless book in the library", () => {
  it("is dressed the same for the same book, with a cup ring on only a few", () => {
    expect(clothStyle("book-7")).toEqual(clothStyle("book-7"));
    expect(clothStyle("book-7")["--cloth-deco"]).toBe(coverDeco("book-7"));
    const ringed = ids.filter((id) => coverDeco(id).includes("circle 22px")).length / ids.length;
    expect(ringed).toBeGreaterThan(COVER_RING_RATE / 100 - 0.04);
    expect(ringed).toBeLessThan(COVER_RING_RATE / 100 + 0.04);
  });
});
