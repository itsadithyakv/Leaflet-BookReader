import { renderRoom, type PipRoomItem } from "../../pip";
import type { ShopKind } from "../../pip/shop";
import { fitsSlot, floorings, renderFinish, renderItem, type HouseLevel, type HouseSlot, type LevelDecor } from "../../pip/home.js";
import type { PipLook } from "../../services/pipService";
import { FEATURES } from "../../constants/features";
import type { ShopRequest } from "../../components/pip/PipShop";
import { PixelImage } from "../../components/pip/PixelImage";
import { Empty, Group, Status, Tile } from "../../components/pip/shopParts";
import { fly, type Box, type Captured } from "../../components/pip/fx";
import { UiIcon } from "../../components/UiIcon";
import type { shopEntries } from "./shopEntries";
import { PLACED, STARTER_DECOR, pickOne, type FinishPanel } from "./common";

/**
 * Decorating's sheets: what goes in a spot (a pin in the room), and the
 * floor's wallpaper or flooring. What Decorate offers is what Pip owns; each
 * sheet ends with a way into the shop for the rest.
 */

// What Decorate offers is what Pip owns; the shop has the rest. It used to
// sell the whole catalogue here too, book nods and all, that the shop keeps back.
const onSale = (item: PipRoomItem) => FEATURES.fullPipHouse || (!item.nod && STARTER_DECOR.has(item.id));

const shopLink = (count: number, what: string, open: () => void) =>
  count > 0 ? (
    <button type="button" className="pip-get-more" onClick={open}>
      <UiIcon name="shop" size={15} />
      <span>
        {count} more {what} in the shop
      </span>
      <span aria-hidden="true">→</span>
    </button>
  ) : null;

type SlotSheetProps = {
  slot: HouseSlot;
  level: HouseLevel;
  levels: HouseLevel[];
  allRoomItems: PipRoomItem[];
  owns: (kind: ShopKind, id: string) => boolean;
  /** Where each placed piece is: item id -> "floor/slot". */
  where: Map<string, string>;
  itemIn: (target: HouseSlot) => string | null;
  slotName: (target: HouseSlot) => string;
  placeIn: (target: HouseSlot, itemId: string | null) => Promise<void>;
  flyInto: (target: HouseSlot, itemId: string, from: Captured | null) => Promise<void>;
  clickedArt: () => Captured | null;
  play: (move: string, loops?: number, text?: string | null) => void;
  openShop: (request: ShopRequest, slotId?: string | null) => void;
};

/** What goes in one spot: Pip's pieces that fit it, or none. */
export const SlotSheet = ({ slot, level, levels, allRoomItems, owns, where, itemIn, slotName, placeIn, flyInto, clickedArt, play, openShop }: SlotSheetProps) => {
  const fitting = allRoomItems.filter((item) => fitsSlot(item, slot, level.id));
  // The shop's Decor tab, which a spot's link opens filtered: book nods have a tab of their own.
  const fittingInShop = fitting.filter((item) => !owns("room", item.id) && onSale(item) && !item.nod);
  const decorTile = (item: PipRoomItem, target: HouseSlot) => {
    const here = itemIn(target) === item.id;
    const at = where.get(item.id);
    const elsewhere = at && !here ? levels.find((floor) => at.startsWith(`${floor.id}/`))?.name ?? "the house" : null;
    return (
      <Tile
        key={item.id}
        selected={here}
        name={item.name}
        label={`${item.name}. ${here ? "Here. Select to take it out." : elsewhere ? `In the ${elsewhere}. Select to move it here.` : "Select to put it here."}`}
        art={() => <PixelImage render={() => renderItem(item, 0)} drawKey={item.id} box={56} />}
        status={here ? <Status icon="check">Here</Status> : <Status>{elsewhere ? `In the ${elsewhere}` : "Put here"}</Status>}
        onSelect={() => {
          if (here) void placeIn(target, null);
          else void flyInto(target, item.id, clickedArt()).then(() => play("kudos", 1, pickOne(PLACED)));
        }}
      />
    );
  };

  return (
    <>
      {itemIn(slot) && (
        <button type="button" className="pip-key mb-3" onClick={() => void placeIn(slot, null)}>
          Leave it empty
        </button>
      )}
      {fitting.some((item) => owns("room", item.id)) ? (
        <Group title="Yours">{fitting.filter((item) => owns("room", item.id)).map((item) => decorTile(item, slot))}</Group>
      ) : (
        <Empty>Nothing of Pip's fits here yet.</Empty>
      )}
      {shopLink(fittingInShop.length, "fit here", () =>
        openShop({ tab: "decor", fits: { label: slotName(slot), keys: fittingInShop.map((item) => `room:${item.id}`) } }, slot.id)
      )}
    </>
  );
};

type FinishSheetProps = {
  panel: FinishPanel;
  /** Whether the house's art is there (the old single room, with its room styles, if not). */
  house: boolean;
  walls: ReturnType<typeof shopEntries>["walls"];
  wallKind: ReturnType<typeof shopEntries>["wallKind"];
  owns: (kind: ShopKind, id: string) => boolean;
  /** This floor's decor. */
  decor: LevelDecor;
  setLook: (patch: Partial<PipLook>) => Promise<void>;
  setFinish: (which: "wallpaper" | "floor", id: string) => Promise<void>;
  clickedArt: () => Captured | null;
  roomPart: (part: "wall" | "floor") => Box | null;
  openShop: (request: ShopRequest) => void;
};

/** The floor's wallpaper (or the old room's style), or its flooring: Pip's own, to put up. */
export const FinishSheet = ({ panel, house, walls, wallKind, owns, decor, setLook, setFinish, clickedArt, roomPart, openShop }: FinishSheetProps) => {
  const finishTile = (kind: "wallpaper" | "flooring" | "style", entry: { id: string; name?: string }) => {
    const chosen = kind === "flooring" ? decor.floor === entry.id : decor.wallpaper === entry.id;
    const apply = () => (kind === "style" ? setLook({ roomStyle: entry.id }) : setFinish(kind === "wallpaper" ? "wallpaper" : "floor", entry.id));
    return (
      <Tile
        key={`${kind}-${entry.id}`}
        selected={chosen}
        name={entry.name ?? entry.id}
        label={`${entry.name ?? entry.id}. ${chosen ? "On this floor." : "Select to use it here."}`}
        art={() =>
          kind === "style" ? (
            <PixelImage render={() => renderRoom(entry.id, 0)} drawKey={`style-${entry.id}`} box={56} />
          ) : (
            <PixelImage render={() => renderFinish(kind === "wallpaper" ? "wallpaper" : "floor", entry.id, 40, 40)} drawKey={`${kind}-${entry.id}`} box={48} />
          )
        }
        status={chosen ? <Status icon="check">Here</Status> : <Status>Use</Status>}
        onSelect={() => {
          if (chosen) return;
          // The swatch flies to the wall (or the floor), then the room is papered over.
          void fly(clickedArt(), roomPart(kind === "flooring" ? "floor" : "wall"), { card: true, vanish: true }).then(() => apply());
        }}
      />
    );
  };

  const ownedWalls = walls.filter((entry) => owns(wallKind, entry.id));
  const ownedFloors = floorings().filter((entry) => owns("flooring", entry.id));
  return panel === "wallpaper" ? (
    <>
      <Group title={house ? "Your wallpaper" : "Your room styles"}>{ownedWalls.map((entry) => finishTile(wallKind, entry))}</Group>
      {shopLink(walls.length - ownedWalls.length, house ? "wallpapers" : "room styles", () => openShop({ tab: "walls" }))}
    </>
  ) : panel === "flooring" ? (
    <>
      <Group title="Your flooring">{ownedFloors.map((entry) => finishTile("flooring", entry))}</Group>
      {shopLink(floorings().length - ownedFloors.length, "floorings", () => openShop({ tab: "walls" }))}
    </>
  ) : null;
};
