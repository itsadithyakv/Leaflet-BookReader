import { SKINS, renderRoom, type PipAccessory, type PipRoomItem, type PipSkin, type PipTreat } from "../../pip";
import {
  EXTRA_PLOTS,
  FREE_SIGNATURES,
  PREMIUM_MOVES,
  accessories,
  catalogueItem,
  isEarnedOnly,
  nodMatches,
  roomItems,
  roomStyles,
  slotCovered,
  treats,
  type ShopKind
} from "../../pip/shop";
import { floorings, renderFinish, renderItem, wallpapers, type HouseLevel, type LevelDecor } from "../../pip/home.js";
import { renderSoil } from "../../pip/garden.js";
import type { Book } from "@shared/models/book";
import type { PipLook } from "../../services/pipService";
import { FEATURES } from "../../constants/features";
import type { ShopCategory, ShopEntry } from "../../components/pip/PipShop";
import { PixelImage } from "../../components/pip/PixelImage";
import { tally, type Tally } from "../../components/pip/collection";
import { PipSprite } from "../../components/PipSprite";
import { UiIcon, type UiIconName } from "../../components/UiIcon";
import { STARTER_DECOR, moveName, priceOf } from "./common";

type ShopEntriesOptions = {
  owns: (kind: ShopKind, id: string) => boolean;
  variant: string;
  outfit: string[];
  skin: PipSkin | undefined;
  signature: string;
  wearing: (id: string) => boolean;
  withAccessory: (id: string, from?: readonly string[]) => string[];
  /** Seeds to spend now. */
  spendable: number;
  /** The library, for the book nods a reader's own books earn a ribbon. */
  books: Book[];
  /** Where each placed piece is: item id -> "floor/slot". */
  where: Map<string, string>;
  level: HouseLevel;
  levels: HouseLevel[];
  /** This floor's decor. */
  decor: LevelDecor;
  /** Whether the house's art is there (the old single room, if not). */
  house: boolean;
  placeable: (item: PipRoomItem) => boolean;
  unlocked: (level: HouseLevel) => boolean;
  lockReason: (next: HouseLevel) => string | null;
  change: (patch: Partial<PipLook>) => Promise<void>;
  setFinish: (which: "wallpaper" | "floor", id: string) => Promise<void>;
  closeShop: () => void;
  startDecorating: () => void;
  placeFromShop: (itemId: string) => void;
  goToFloor: (next: HouseLevel) => void;
  give: (treat: PipTreat) => Promise<void>;
};

/**
 * The shop's shelves: everything seeds can buy (and what Pip already owns),
 * as the shop shows it: price, badge, why it is locked, and what can be done
 * with it now. Built afresh each render from what Pip owns, with the tallies
 * of each kind the shop's tabs and Pip's things both show.
 */
export const shopEntries = ({
  owns,
  variant,
  outfit,
  skin,
  signature,
  wearing,
  withAccessory,
  spendable,
  books,
  where,
  level,
  levels,
  decor,
  house,
  placeable,
  unlocked,
  lockReason,
  change,
  setFinish,
  closeShop,
  startDecorating,
  placeFromShop,
  goToFloor,
  give
}: ShopEntriesOptions) => {
  const pipArt = (move: string, skinId: string, worn: readonly string[]) => (size: number, hot: boolean) => (
    <PipSprite move={move} still={!hot} size={size} skin={skinId} outfit={worn} snap="nearest" />
  );
  const imageArt = (render: () => ImageData | null, key: string) => (size: number) => (
    <PixelImage render={render} drawKey={`${key}-${size}`} box={size} />
  );

  const skinEntry = (entry: PipSkin): ShopEntry => {
    const owned = owns("skin", entry.id);
    const earned = isEarnedOnly(entry);
    return {
      kind: "skin",
      id: entry.id,
      name: entry.name,
      blurb: entry.blurb ?? (earned ? entry.unlock : null),
      price: priceOf("skin", entry.id),
      owned,
      badge: entry.id === variant ? "Equipped" : "Owned",
      locked: earned && !owned ? `Earned by reading: ${entry.unlock}` : null,
      art: pipArt("idle", entry.id, outfit),
      preview: { variant: entry.id, move: "cheer" },
      use: owned ? (entry.id === variant ? null : { label: "Wear it", run: () => void change({ variant: entry.id }) }) : null
    };
  };

  const accessoryEntry = (entry: PipAccessory): ShopEntry => {
    const owned = owns("accessory", entry.id);
    const worn = wearing(entry.id);
    const covered = slotCovered(skin, entry.slot);
    return {
      kind: "accessory",
      id: entry.id,
      name: entry.name,
      blurb: covered ? `${skin?.name ?? "This variant"} covers the ${entry.slot} already, so it won't show on this look.` : `Worn on the ${entry.slot}.`,
      price: priceOf("accessory", entry.id),
      owned,
      badge: worn ? "Equipped" : "Owned",
      art: pipArt("idle", variant, withAccessory(entry.id)),
      preview: { outfit: withAccessory(entry.id), move: "cheer" },
      use: owned
        ? { label: worn ? "Take it off" : "Wear it", run: () => void change({ outfit: worn ? outfit.filter((id) => id !== entry.id) : withAccessory(entry.id) }) }
        : null
    };
  };

  const libraryHas = (nod: string | undefined) => Boolean(nod) && books.some((book) => nodMatches(nod, book));

  const decorEntry = (entry: PipRoomItem): ShopEntry => {
    const owned = owns("room", entry.id);
    const at = where.get(entry.id);
    const home = at ? levels.find((floor) => at.startsWith(`${floor.id}/`))?.name : null;
    return {
      kind: "room",
      id: entry.id,
      name: entry.name,
      blurb: entry.level && entry.level !== "any" ? `For the ${levels.find((floor) => floor.id === entry.level || (floor.garden && entry.level === "garden"))?.name ?? entry.level}.` : "Goes on any floor.",
      price: priceOf("room", entry.id),
      owned,
      badge: at ? `In the ${home ?? "house"}` : "Owned",
      locked: !owned && catalogueItem("room", entry.id)?.freeWith ? `Comes with the ${levels.find((floor) => floor.id === catalogueItem("room", entry.id)?.freeWith)?.name ?? "floor"}` : null,
      nod: entry.nod ?? null,
      fromLibrary: libraryHas(entry.nod),
      art: imageArt(() => renderItem(entry, 0), `item-${entry.id}`),
      use: !owned
        ? null
        : at?.startsWith(`${level.id}/`)
          ? { label: "Move it about", run: () => { closeShop(); startDecorating(); } }
          : { label: at ? `Bring it to the ${level.name}` : "Place it", run: () => placeFromShop(entry.id) }
    };
  };

  const finishEntry = (kind: "wallpaper" | "flooring", entry: { id: string; name?: string }): ShopEntry => {
    const owned = owns(kind, entry.id);
    const here = kind === "wallpaper" ? decor.wallpaper === entry.id : decor.floor === entry.id;
    return {
      kind,
      id: entry.id,
      name: entry.name ?? entry.id,
      blurb: kind === "wallpaper" ? "Wallpaper, for one floor at a time." : "Flooring, for one floor at a time.",
      price: priceOf(kind, entry.id),
      owned,
      badge: here ? "On this floor" : "Owned",
      group: kind === "wallpaper" ? "Wallpaper" : "Flooring",
      art: imageArt(() => renderFinish(kind === "wallpaper" ? "wallpaper" : "floor", entry.id, 48, 48), `${kind}-${entry.id}`),
      use: owned && !here ? { label: `Use on the ${level.name}`, run: () => void setFinish(kind === "wallpaper" ? "wallpaper" : "floor", entry.id) } : null
    };
  };

  const styleEntry = (entry: { id: string; name?: string; price?: number }): ShopEntry => {
    const owned = owns("style", entry.id);
    return {
      kind: "style",
      id: entry.id,
      name: entry.name ?? entry.id,
      price: priceOf("style", entry.id),
      owned,
      badge: decor.wallpaper === entry.id ? "In use" : "Owned",
      art: imageArt(() => renderRoom(entry.id, 0), `style-${entry.id}`),
      use: owned && decor.wallpaper !== entry.id ? { label: "Use it", run: () => void change({ roomStyle: entry.id }) } : null
    };
  };

  const levelEntry = (entry: HouseLevel): ShopEntry => {
    const open = unlocked(entry);
    return {
      kind: "level",
      id: entry.id,
      name: entry.name,
      blurb: entry.blurb ?? entry.unlock,
      price: priceOf("level", entry.id),
      owned: open,
      badge: entry.id === level.id ? "You're here" : "Open",
      locked: open ? null : lockReason(entry),
      group: "Floors of the house",
      art: () => <UiIcon name={open ? "home" : "lock"} size={40} />,
      use: open && entry.id !== level.id ? { label: "Go there", run: () => { closeShop(); goToFloor(entry); } } : null
    };
  };

  const plotEntry = (entry: { id: string; name: string }, index: number): ShopEntry => {
    const owned = owns("plot", entry.id);
    const before = index > 0 ? EXTRA_PLOTS[index - 1] : null;
    return {
      kind: "plot",
      id: entry.id,
      name: entry.name,
      blurb: "Room for one more planting in the garden.",
      price: priceOf("plot", entry.id),
      owned,
      badge: "Dug",
      locked: !owned && before && !owns("plot", before.id) ? `Dig the ${before.name.toLowerCase()} first.` : null,
      group: "Garden plots",
      art: imageArt(() => renderSoil(true), "soil")
    };
  };

  const treatEntry = (entry: PipTreat): ShopEntry => {
    const food = entry.kind === "food";
    const owned = !food && owns("treat", entry.id);
    const price = priceOf("treat", entry.id);
    return {
      kind: "treat",
      id: entry.id,
      name: entry.name,
      blurb: food ? "A snack, bought as you give it. Cheers Pip up." : "A toy: bought once, played with forever.",
      price,
      owned,
      consumable: food,
      group: food ? "Snacks" : "Toys",
      art: pipArt(entry.move, variant, outfit),
      preview: { move: entry.move },
      use: food
        ? { label: spendable >= price ? `Give Pip one · ${price}` : "Keep reading", run: () => { closeShop(); void give(entry); } }
        : owned
          ? { label: "Play", run: () => { closeShop(); void give(entry); } }
          : null
    };
  };

  const moveEntry = (entry: { id: string; price: number }): ShopEntry => {
    const owned = owns("move", entry.id);
    return {
      kind: "move",
      id: entry.id,
      name: moveName(entry.id),
      blurb: "A move for Pip's free time, and a possible signature for your profile picture.",
      price: entry.price === 0 ? 0 : priceOf("move", entry.id),
      owned,
      badge: entry.id === signature ? "Signature" : "Owned",
      art: pipArt(entry.id, variant, outfit),
      preview: { move: entry.id },
      use: owned && entry.id !== signature ? { label: "Make it my signature", run: () => void change({ signature: entry.id }) } : null
    };
  };

  const byPrice = (a: ShopEntry, b: ShopEntry) => Number(a.owned) - Number(b.owned) || a.price - b.price;
  const allRoomItems = roomItems();
  const nodItems = allRoomItems.filter((item) => item.nod);
  const decorForSale = allRoomItems.filter((item) => owns("room", item.id) || (!item.nod && (FEATURES.fullPipHouse || STARTER_DECOR.has(item.id)) && placeable(item)));
  const paidFloors = levels.filter((entry) => !entry.garden && entry.price >= 0 && entry !== levels[0]);
  const moveList = [...FREE_SIGNATURES.map((id) => ({ id, price: 0 })), ...PREMIUM_MOVES];
  const walls = house ? wallpapers() : roomStyles();
  const wallKind: "wallpaper" | "style" = house ? "wallpaper" : "style";

  // How much of each kind is Pip's: on the shop's tabs and in Pip's things.
  const ownsRoom = (item: { id: string }) => owns("room", item.id);
  const tallies: Record<string, Tally> = {
    variants: tally(SKINS, (entry) => owns("skin", entry.id)),
    wardrobe: tally(accessories(), (entry) => owns("accessory", entry.id)),
    decor: tally(decorForSale, ownsRoom),
    nods: tally(nodItems, ownsRoom),
    treats: tally(treats(), (entry) => owns("treat", entry.id), (entry) => entry.kind === "toy"),
    moves: tally(moveList, (entry) => owns("move", entry.id)),
    walls: house
      ? tally([...wallpapers().map((entry) => ({ kind: "wallpaper" as const, id: entry.id })), ...floorings().map((entry) => ({ kind: "flooring" as const, id: entry.id }))], (entry) =>
          owns(entry.kind, entry.id)
        )
      : tally(roomStyles(), (entry) => owns("style", entry.id)),
    house: tally([...paidFloors.map((entry) => ({ kind: "level" as const, id: entry.id })), ...EXTRA_PLOTS.map((entry) => ({ kind: "plot" as const, id: entry.id }))], (entry) =>
      owns(entry.kind, entry.id)
    )
  };

  const shopCategories: ShopCategory[] = [
    { id: "variants", label: "Variants", icon: "pip", tally: tallies.variants, entries: SKINS.filter((entry) => !isEarnedOnly(entry)).map(skinEntry).sort(byPrice) },
    { id: "wardrobe", label: "Wardrobe", icon: "outfit", tally: tallies.wardrobe, entries: accessories().map(accessoryEntry).sort(byPrice) },
    {
      id: "decor",
      label: "Decor",
      icon: "decorate",
      tally: tallies.decor,
      note: "Decor goes straight into a free spot on this floor that fits it. Move things about from Decorate.",
      entries: decorForSale.map(decorEntry).sort(byPrice)
    },
    ...(FEATURES.fullPipHouse
      ? [
          {
            id: "nods",
            label: "Book Nods",
            icon: "book-open" as UiIconName,
            tally: tallies.nods,
            note: "Little tributes to famous books, original designs. A ribbon means the book is in your library.",
            entries: nodItems.map(decorEntry).sort((a, b) => Number(b.fromLibrary) - Number(a.fromLibrary) || byPrice(a, b))
          }
        ]
      : []),
    { id: "treats", label: "Treats", icon: "treat", tally: tallies.treats, entries: treats().map(treatEntry).sort(byPrice) },
    { id: "moves", label: "Moves", icon: "move", tally: tallies.moves, entries: PREMIUM_MOVES.map(moveEntry).sort(byPrice) },
    {
      id: "walls",
      label: house ? "Walls & flooring" : "Room styles",
      icon: "grid",
      tally: tallies.walls,
      note: house ? "Wallpaper and flooring dress one floor at a time." : undefined,
      entries: house
        ? [...wallpapers().map((entry) => finishEntry("wallpaper", entry)).sort(byPrice), ...floorings().map((entry) => finishEntry("flooring", entry)).sort(byPrice)]
        : roomStyles().map(styleEntry)
    },
    {
      id: "house",
      label: "House",
      icon: "home",
      tally: tallies.house,
      note: paidFloors.length > 0 ? "New floors open in order, after enough focus sessions. Plots are dug one after another." : "Plots are dug one after another.",
      entries: [...paidFloors.map(levelEntry), ...EXTRA_PLOTS.map(plotEntry)]
    }
  ];
  const allEntries = shopCategories.flatMap((category) => category.entries);
  const entryFor = (kind: ShopKind, id: string) => allEntries.find((entry) => entry.kind === kind && entry.id === id) ?? null;

  return { shopCategories, tallies, entryFor, allRoomItems, moveList, walls, wallKind };
};
