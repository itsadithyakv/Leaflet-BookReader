import { afterEach, describe, expect, it, vi } from "vitest";
import { pathSpots } from "../../../../pip/base/trophies";
import type { GameArt } from "../gameArt";
import { animalSpots, bloomAt, meadowLayer, meadowTapAt, type CampLook } from "./scene";
import * as scene from "./scene";

const look = (blooms: number[], change: Partial<CampLook> = {}): Pick<CampLook, "animals" | "blooms" | "bud" | "read" | "season"> & Partial<CampLook> => ({ animals: [], blooms, bud: 1, read: 0, season: 0, ...change });

describe("a tap in the meadow", () => {
  it("finds the nearest bloom within six pixels, and none further off", () => {
    const blooms = Array.from({ length: 10 }, (_, index) => index % 11);
    const spots = pathSpots();
    // The newest (the last raised) stands at the first spot, nearest the stones.
    expect(bloomAt(look(blooms), spots[0][0], spots[0][1] - 3)).toBe(blooms.length - 1);
    expect(bloomAt(look(blooms), spots[1][0], spots[1][1] - 3)).toBe(blooms.length - 2);
    expect(bloomAt(look(blooms), spots[0][0], spots[0][1] - 30)).toBe(-1);
    expect(bloomAt(look([]), spots[0][0], spots[0][1] - 3)).toBe(-1);
  });

  it("pets an animal standing among the blooms, rather than saying the bloom", () => {
    const blooms = Array.from({ length: 48 }, (_, index) => index % 11);
    const all = [0, 1, 2, 3, 4, 5];
    let checked = 0;
    for (let time = 0; time < 400 && checked < 3; time += 0.5) {
      for (const spot of animalSpots(time, all)) {
        if (bloomAt(look(blooms), spot.x, spot.y - 2) < 0) continue;
        const tap = meadowTapAt(look(blooms, { animals: all }), time, spot.x, spot.y - 2);
        expect(tap?.kind).toBe("animal");
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("says a stone, the bud, and opens the list on the wild ones", () => {
    const read = 100 * 60;
    const stone = meadowTapAt(look([], { read }), null, 200, 75);
    expect(stone?.kind).toBe("stone");
    expect(meadowTapAt(look([], { bud: 2 }), null, 174, 73)?.kind).toBe("bud");
    expect(meadowTapAt(look([], { bud: null }), null, 174, 73)).toBeNull();
    expect(meadowTapAt(look(Array.from({ length: 60 }, () => 0)), null, 40, 58)?.kind).toBe("wild");
    expect(meadowTapAt(look(Array.from({ length: 30 }, () => 0)), null, 40, 58)).toBeNull();
  });
});

describe("the meadow's record, drawn", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is drawn once into a layer, again only when the blooms, the season or the bud change, and draws a bounded number of things", () => {
    let drawn = 0;
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : key === "drawImage" ? () => drawn++ : () => undefined),
      set: (target, key, value) => {
        target[key as string] = value;
        return true;
      }
    });
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
    const art = { sprite: () => ({ image: {}, w: 9, h: 10 }) } as unknown as GameArt;
    const on = { drawImage: () => undefined } as unknown as CanvasRenderingContext2D;
    const many = Array.from({ length: 500 }, (_, index) => index % 11);
    const before = scene.meadowLayersDrawn;
    meadowLayer(on, art, look(many) as CampLook, 3);
    expect(scene.meadowLayersDrawn).toBe(before + 1);
    // 48 along the path, 100 wild at most, and the bud.
    expect(drawn).toBeLessThanOrEqual(48 + 100 + 1);
    // Frame after frame: the same layer.
    for (let frame = 0; frame < 30; frame++) meadowLayer(on, art, look(many) as CampLook, 3);
    expect(scene.meadowLayersDrawn).toBe(before + 1);
    meadowLayer(on, art, look([...many, 3]) as CampLook, 3);
    meadowLayer(on, art, look(many, { bud: 3 }) as CampLook, 3);
    meadowLayer(on, art, look(many, { season: 2 }) as CampLook, 3);
    expect(scene.meadowLayersDrawn).toBe(before + 4);
  });
});

describe("the cat, on the front", () => {
  it("keeps some of the creepers in the wood, more once she is fond of the camp, and puts off no other kind", async () => {
    const { nightKinds } = await import("./scene");
    const { ROLE_OF } = await import("../../../../pip/base/front");
    const camp = (animals: number[], hearts: number[]) => ({ levels: { burrow: 5 }, prowlers: true, season: 0, wave: { seed: 5, chapter: 9 }, animals, hearts }) as unknown as CampLook;
    const count = (look: CampLook, creepers: boolean) =>
      Array.from({ length: 300 }, (_, night) => nightKinds(look, night).filter((kind) => (ROLE_OF[kind] === "creeper") === creepers).length).reduce((a, b) => a + b, 0);
    const none = camp([], []);
    const cat = camp([1], [0, 0, 0, 0, 0, 0]);
    const fond = camp([1], [0, 3, 0, 0, 0, 0]);
    expect(count(cat, true)).toBeLessThan(count(none, true));
    expect(count(fond, true)).toBeLessThan(count(cat, true));
    expect(count(fond, false)).toBe(count(none, false));
    // About one in ten, and one in five.
    expect(count(cat, true) / count(none, true)).toBeGreaterThan(0.84);
    expect(count(fond, true) / count(none, true)).toBeLessThan(0.86);
  });
});
