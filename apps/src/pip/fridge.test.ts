import { describe, expect, it } from "vitest";
import * as pip from "./index";
import { freeSpot, fridgeBox, houseItems, houseLevels, levelDecor, levelFixtures, registerHouseArt, withLevelDecor, type HouseLevel } from "./home.js";
import { catalogue } from "./shop";
import {
  FRIDGE_LINGER_S,
  FRIDGE_OPEN_S,
  KINDS,
  fridgeFetch,
  fridgeHope,
  fridgeNothing,
  fridgeShutOnHer,
  fridgeShutsAt,
  fridgeStand,
  kindOf,
  parseRemembered
} from "./furnish";
import { seeded } from "./behaviour";

registerHouseArt(pip as unknown as Record<string, unknown>);

const level = (id: string) => houseLevels().find((entry) => entry.id === id) as HouseLevel;
const bedroom = () => level("bedroom");

describe("where the fridge stands", () => {
  it("takes the first place that is free, and the least crowded when none is", () => {
    expect(freeSpot([169, 115, 63], 12, [])).toBe(169);
    expect(freeSpot([169, 115, 63], 12, [{ x: 150, w: 25 }])).toBe(115);
    expect(freeSpot([169, 115, 63], 12, [{ x: 150, w: 25 }, { x: 100, w: 20 }])).toBe(63);
    // All three crowded: the one overlapped least, the earlier of two as bad.
    expect(freeSpot([169, 115, 63], 12, [{ x: 150, w: 25 }, { x: 100, w: 20 }, { x: 60, w: 5 }])).toBe(63);
    expect(freeSpot([169, 115], 12, [{ x: 160, w: 12 }, { x: 110, w: 8 }])).toBe(169);
    expect(freeSpot([], 12, [])).toBeNull();
  });

  it("is in the bedroom of a new house, on the floor, clear of the bed", () => {
    const room = bedroom();
    const box = fridgeBox(room, levelDecor({}, room));
    expect(box).toEqual({ x: 169, y: 92, w: 12, h: 20 });
    expect(levelFixtures(room, levelDecor({}, room))).toEqual([{ itemId: "minifridge", x: 169, y: 92 }]);
    expect(levelFixtures(room, levelDecor({}, room), true)).toEqual([{ itemId: "minifridge-open", x: 169, y: 92 }]);
  });

  it("is in a house saved before there was one, and the saved layout is as it was", () => {
    const room = bedroom();
    const saved = { "bedroom/floor-1": "bed", "bedroom/floor-3": "armchair", "bedroom/wall-1": "poster", "bedroom/@wallpaper": "cream" };
    const decor = levelDecor(saved, room);
    // Nothing of the fridge in what is placed, or in what would be saved again.
    expect(decor.placed.map((entry) => entry.itemId).sort()).toEqual(["armchair", "bed", "poster"]);
    expect(withLevelDecor(saved, room, decor)).toEqual(saved);
    expect(fridgeBox(room, decor)?.x).toBe(169);
  });

  it("stands aside for a wide piece put where it was, and overlaps nothing while there is room", () => {
    const room = bedroom();
    // The bed is wider than the third floor spot: it reaches into the fridge's first place.
    const wide = levelDecor({ "bedroom/floor-3": "bed", "bedroom/floor-4": "piano" }, room);
    expect(fridgeBox(room, wide)?.x).toBe(115);
    // Crowded everywhere (two pixels of the bed either way): back to its first place, the least in the way.
    const wider = levelDecor({ "bedroom/floor-2": "piano", "bedroom/floor-3": "bed", "bedroom/floor-4": "piano" }, room);
    expect(fridgeBox(room, wider)?.x).toBe(169);
    const lamps = levelDecor({ "bedroom/floor-2": "lamp", "bedroom/floor-3": "bed", "bedroom/floor-4": "lamp" }, room);
    expect(fridgeBox(room, lamps)?.x).toBe(115);
    // Things on the wall and the shelf are never in its way.
    const walls = levelDecor({ "bedroom/wall-2": "poster", "bedroom/top-1": "bookstack", "bedroom/rug-1": "rug" }, room);
    expect(fridgeBox(room, walls)?.x).toBe(169);
  });

  it("is only in the bedroom", () => {
    for (const floor of houseLevels()) {
      const box = fridgeBox(floor, levelDecor({}, floor));
      if (floor.id === "bedroom") expect(box).not.toBeNull();
      else expect(box).toBeNull();
    }
  });

  it("is not decor: not in the shop, the catalogue or any slot", () => {
    expect(houseItems().some((item) => item.id === "minifridge" || item.id === "minifridge-open")).toBe(false);
    expect(catalogue().some((item) => item.id === "minifridge" || item.id === "minifridge-open")).toBe(false);
    expect(pip.FIXTURES.map((item) => item.id)).toEqual(["minifridge", "minifridge-open", "phoneglow"]);
  });
});

describe("the fridge under the hand", () => {
  it("is a furnishing with a label and a key, and remembers nothing", () => {
    expect(kindOf("minifridge")).toBe("fridge");
    // The Kitchen's Retro Fridge is plain decor.
    expect(kindOf("fridge")).toBeNull();
    expect(KINDS.fridge.keys).toMatch(/Enter/);
    expect(KINDS.fridge.remembers).toEqual([]);
    expect(parseRemembered(JSON.stringify({ "bedroom/fixture:minifridge": { open: true, closed: 1 } }))).toEqual({});
  });

  it("shuts itself a few seconds after the reader opens it", () => {
    expect(fridgeShutsAt(100, null, false)).toBe(100 + FRIDGE_OPEN_S);
    expect(FRIDGE_OPEN_S).toBeGreaterThanOrEqual(4);
    expect(FRIDGE_OPEN_S).toBeLessThanOrEqual(12);
  });

  it("waits for Pip to have her look, and stays open while she holds it", () => {
    // She got there with a second to spare: it does not shut in her face.
    expect(fridgeShutsAt(100, 100 + FRIDGE_OPEN_S - 1, false)).toBe(100 + FRIDGE_OPEN_S - 1 + FRIDGE_LINGER_S);
    // She was beside it already: no longer than it would have been open anyway.
    expect(fridgeShutsAt(100, 100.5, false)).toBe(100 + FRIDGE_OPEN_S);
    expect(fridgeShutsAt(100, null, true)).toBe(Infinity);
  });

  it("has Pip stand at the handle, turned to it, and never in a wall", () => {
    expect(fridgeStand({ x: 169, w: 12 }, 240)).toEqual({ x: 159, face: 1 });
    expect(fridgeStand({ x: 63, w: 12 }, 240)).toEqual({ x: 53, face: 1 });
    const cornered = fridgeStand({ x: 4, w: 12 }, 240);
    expect(cornered.face).toBe(-1);
    expect(cornered.x).toBeGreaterThan(16);
    for (const x of bedroom().fridgeAt) expect(fridgeStand({ x, w: 12 }, 240).face).toBe(1);
  });

  it("gives Pip a few things to say, each short and in her own lower case", () => {
    for (const lines of [fridgeHope, fridgeShutOnHer, fridgeFetch, fridgeNothing]) {
      const rand = seeded(4);
      const said = new Set<string>();
      for (let index = 0; index < 60; index += 1) {
        const reaction = lines(rand);
        expect(reaction.line).toBeTruthy();
        expect(reaction.line).toBe(reaction.line?.toLowerCase());
        expect(reaction.line?.length).toBeLessThanOrEqual(44);
        expect(reaction.loops).toBeGreaterThanOrEqual(1);
        said.add(reaction.line as string);
      }
      expect(said.size).toBeGreaterThanOrEqual(3);
    }
  });
});
