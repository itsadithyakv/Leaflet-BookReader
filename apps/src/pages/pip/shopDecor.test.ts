import { describe, expect, it } from "vitest";
import { SKINS } from "../../pip";
import "../../pip/houseArt";
import { STARTER_PIECES, WISH, catalogueItem, comesWith, roomItems, type ShopKind } from "../../pip/shop";
import { fitsSlot, houseLevels, type LevelDecor } from "../../pip/home.js";
import { kindOf } from "../../pip/furnish";
import { FEATURES } from "../../constants/features";
import { shopEntries } from "./shopEntries";
import { MORE_DECOR, STARTER_DECOR, onShelf } from "./common";

/**
 * The decor the shop sells in a house of a bedroom and a garden: the
 * bedroom's own pieces, and the chosen others (./common.ts, `MORE_DECOR`).
 */

const items = new Map(roomItems().map((item) => [item.id, item]));
const levels = houseLevels();
const bedroom = levels[0];
const garden = levels.find((level) => level.garden);
/** The floors a reader has without the whole house, to put a piece on. */
const homes = garden ? [bedroom, garden] : [bedroom];
const fitsSomewhere = (id: string) => {
  const item = items.get(id);
  return item !== undefined && homes.some((level) => level.slots.some((slot) => fitsSlot(item, slot, level.id)));
};

/** The Decor shelf for a reader who owns `owned`, in a house whose floors are these two. */
const decorShelf = (owned: string[] = []) => {
  const never = () => undefined;
  const { shopCategories } = shopEntries({
    owns: (kind: ShopKind, id: string) => owned.includes(`${kind}:${id}`),
    variant: "sprout",
    outfit: [],
    skin: SKINS.find((skin) => skin.id === "sprout"),
    signature: "read",
    wearing: () => false,
    withAccessory: (id) => [id],
    spendable: 100000,
    books: [],
    where: new Map(),
    level: bedroom,
    levels: homes,
    decor: { wallpaper: null, floor: null, placed: [] } as LevelDecor,
    house: true,
    // As the page has it (usePipHouse): a piece for a floor this house does not have is not for sale.
    placeable: (item) => !item.level || item.level === "any" || homes.some((level) => level.id === item.level || (level.garden && ["garden", "greenhouse"].includes(item.level ?? ""))),
    unlocked: () => true,
    lockReason: () => null,
    change: async () => undefined,
    setFinish: async () => undefined,
    closeShop: never,
    startDecorating: never,
    placeFromShop: never,
    goToFloor: never,
    give: async () => undefined,
    readerLevel: 1
  });
  return shopCategories.find((category) => category.id === "decor")?.entries ?? [];
};

describe("the house's other pieces on the shelf", () => {
  it("are twenty-seven, named one by one: two dozen that were drawn all along, and the three toys", () => {
    expect(MORE_DECOR.size).toBe(27);
    for (const toy of ["trampoline", "musicbox", "bubblemachine"]) expect(MORE_DECOR.has(toy), toy).toBe(true);
    expect([...MORE_DECOR].filter((id) => STARTER_DECOR.has(id))).toEqual([]);
  });

  it("are each a piece of the house's art, not a book nod, with a price Rust already holds", () => {
    for (const id of MORE_DECOR) {
      const item = items.get(id);
      expect(item, id).toBeDefined();
      expect(item?.nod, `${id} is a book nod`).toBeUndefined();
      expect(catalogueItem("room", id)?.price, id).toBeGreaterThan(0);
    }
  });

  it("are none of them a floor's starter piece, which comes with its floor and is never sold on its own", () => {
    const starters = Object.values(STARTER_PIECES).flat();
    for (const id of MORE_DECOR) {
      expect(starters, id).not.toContain(id);
      expect(comesWith(id), id).toBeNull();
      expect(catalogueItem("room", id)?.freeWith, id).toBeUndefined();
    }
    // Nor does the bedroom's own list sell one: what is on the shelf and comes with a floor is owned already.
    expect(catalogueItem("room", "wateringcan")?.freeWith).toBe("greenhouse");
    expect(onShelf("wateringcan")).toBe(false);
  });

  it("each go somewhere in a bedroom or a garden", () => {
    for (const id of MORE_DECOR) {
      expect(["any", "greenhouse", "garden", "bedroom"], id).toContain(items.get(id)?.level);
      expect(fitsSomewhere(id), id).toBe(true);
    }
  });

  it("leave the other floors' pieces, and the pond the furrows cross, for the whole house", () => {
    for (const id of ["stove", "kettle", "tallshelf", "ladder", "arcadecabinet", "jukebox", "discoball", "workbench", "robotbuddy", "telescope", "orrery", "pond"]) {
      expect(items.has(id), id).toBe(true);
      expect(onShelf(id), id).toBe(false);
    }
  });

  it("keep what Pip may wish for on the shelf", () => {
    for (const era of WISH.eras) for (const id of era.room) expect(onShelf(id), id).toBe(true);
  });

  it("mostly do something when they are chosen", () => {
    const answering = [...MORE_DECOR].filter((id) => kindOf(id) !== null);
    expect(answering.length).toBe(MORE_DECOR.size);
  });
});

describe("the Decor shelf, without the whole house", () => {
  it("is what this is about: the whole house is not switched on here", () => {
    expect(FEATURES.fullPipHouse).toBe(false);
  });

  it("sells every one of them, at its price", () => {
    const shelf = decorShelf();
    for (const id of MORE_DECOR) {
      const entry = shelf.find((candidate) => candidate.id === id);
      expect(entry, id).toBeDefined();
      expect(entry?.owned, id).toBe(false);
      expect(entry?.locked ?? null, id).toBeNull();
      expect(entry?.price, id).toBe(catalogueItem("room", id)?.price);
    }
  });

  it("sells the bedroom's own pieces that this house has a floor for, the globe, the record player and the tent among them", () => {
    const shelf = decorShelf().map((entry) => entry.id);
    for (const id of ["lamp", "clock", "beanbag", "armchair", "aquarium", "catbed", "fireplace", "fairylights", "trophyshelf", "plant", "globe", "recordplayer", "readingnook"]) expect(shelf, id).toContain(id);
    // The library's own: no floor for them here.
    expect(shelf).not.toContain("bookshelf");
    expect(shelf).not.toContain("desk");
  });

  it("sells nothing else: no other floor's piece, no book nod, and no starter piece", () => {
    for (const entry of decorShelf()) {
      expect(onShelf(entry.id), entry.id).toBe(true);
      expect(entry.nod ?? null, entry.id).toBeNull();
      // A floor's starter piece is on the shelf only to say that it comes with the floor (to this reader, who is
      // made out here to own nothing): it cannot be bought.
      if (catalogueItem("room", entry.id)?.freeWith) expect(entry.locked, entry.id).toMatch(/^Comes with the /);
      else expect(entry.locked ?? null, entry.id).toBeNull();
    }
  });

  it("still shows a piece the reader owns, whatever the shelf sells", () => {
    const shelf = decorShelf(["room:stove", "room:wateringcan"]);
    expect(shelf.find((entry) => entry.id === "stove")?.owned).toBe(true);
    expect(shelf.find((entry) => entry.id === "wateringcan")?.owned).toBe(true);
  });
});
