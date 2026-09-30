import { useEffect, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { PipLook } from "../../services/pipService";
import { fitsSlot, levelDecor, placements, wallpapers, withLevelDecor, type HouseSlot, type LevelDecor } from "../../pip/home.js";
import type { HouseSceneHandle } from "../../components/pip/HouseScene";
import type { ShopRequest } from "../../components/pip/PipShop";
import { bump, fly, type Box, type Captured } from "../../components/pip/fx";
import type { Delivery } from "./purchaseFlow";
import type { usePipHouse } from "./usePipHouse";
import { PLACED, errorText, pickOne, priceOf, type Drawer, type FinishPanel } from "./common";

const SLOT_NAME: Record<HouseSlot["fits"], string> = {
  ceiling: "Ceiling",
  wall: "Wall",
  window: "Window",
  top: "Shelf",
  stand: "Floor",
  rug: "Rug"
};

/** Where slots of one kind sit, left to right, by how many there are. */
const SLOT_PLACES: Record<number, string[]> = {
  2: ["left", "right"],
  3: ["left", "middle", "right"],
  4: ["far left", "left", "right", "far right"]
};

type House = ReturnType<typeof usePipHouse>;

type DecoratingOptions = {
  level: House["level"];
  /** Whether the house's art is there (the old single room, if not). */
  house: boolean;
  /** This floor's decor, as saved. */
  decor: House["decor"];
  roomItemById: House["roomItemById"];
  homeOf: House["homeOf"];
  layout: Record<string, string>;
  /** Changes Pip's look or home, saying so if Rust refuses. */
  change: (patch: Partial<PipLook>) => Promise<void>;
  /** The layout as it is now in the store (after a purchase, the store has moved on). */
  freshLayout: () => Record<string, string>;
  decorating: boolean;
  setDecorating: Dispatch<SetStateAction<boolean>>;
  slotFocus: string | null;
  setSlotFocus: Dispatch<SetStateAction<string | null>>;
  finishPanel: FinishPanel | null;
  setFinishPanel: Dispatch<SetStateAction<FinishPanel | null>>;
  shopOpen: ShopRequest | null;
  /** The spot being decorated when the shop was opened for it. */
  shopSlot: string | null;
  closeShop: () => void;
  setDrawer: Dispatch<SetStateAction<Drawer | null>>;
  setPickerPlot: Dispatch<SetStateAction<number | null>>;
  sceneRef: RefObject<HouseSceneHandle>;
  decorateRef: RefObject<HTMLButtonElement>;
  clickedArt: () => Captured | null;
  play: (move: string, loops?: number, text?: string | null) => void;
  showToast: (message: string) => void;
};

/**
 * Decorating: the mode itself (a pin in each spot, a sheet for what goes
 * there, the wallpaper and the flooring), putting pieces in their spots, and
 * where a piece bought in the shop goes.
 */
export const useDecorating = ({
  level,
  house,
  decor,
  roomItemById,
  homeOf,
  layout,
  change,
  freshLayout,
  decorating,
  setDecorating,
  slotFocus,
  setSlotFocus,
  finishPanel,
  setFinishPanel,
  shopOpen,
  shopSlot,
  closeShop,
  setDrawer,
  setPickerPlot,
  sceneRef,
  decorateRef,
  clickedArt,
  play,
  showToast
}: DecoratingOptions) => {
  const slot = slotFocus ? level.slots.find((entry) => entry.id === slotFocus) ?? null : null;
  const where = useMemo(() => placements(layout), [layout]);

  /** Saves this floor's decor; an item placed here leaves wherever it was. */
  const saveDecor = (next: LevelDecor, base: Record<string, string> = layout) => {
    const moving = new Set(next.placed.map((entry) => entry.itemId));
    const cleared = Object.fromEntries(
      Object.entries(base).filter(([key, value]) => key.startsWith(`${level.id}/`) || key.includes("@") || !moving.has(value))
    );
    // A floor with nothing on it still counts as decorated, or the art's own
    // furnishings would come back: a free wallpaper marks it.
    const marked =
      house && !next.wallpaper && next.placed.length === 0
        ? { ...next, wallpaper: wallpapers().find((paper) => priceOf("wallpaper", paper.id) === 0)?.id ?? null }
        : next;
    return change({ room: withLevelDecor(cleared, level, marked) });
  };

  const placeIn = (target: HouseSlot, itemId: string | null, base: Record<string, string> = layout) => {
    const current = levelDecor(base, level);
    const placed = current.placed.filter((entry) => entry.slot !== target.id && entry.itemId !== itemId);
    if (itemId) placed.push({ slot: target.id, itemId });
    return saveDecor({ ...current, placed }, base);
  };

  const setFinish = (which: "wallpaper" | "floor", id: string, base: Record<string, string> = layout) => {
    const current = levelDecor(base, level);
    return saveDecor({ ...current, [which]: id }, base);
  };

  const itemIn = (target: HouseSlot) => decor.placed.find((entry) => entry.slot === target.id)?.itemId ?? null;
  // "Floor, far left": where it is in the room, as the reader sees it. The art
  // numbers its slots (ceiling-2), which says nothing about where they are.
  const slotName = (target: HouseSlot) => {
    if (target.name) return target.name;
    const kind = SLOT_NAME[target.fits] ?? "Spot";
    const same = level.slots.filter((entry) => entry.fits === target.fits).sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2));
    if (same.length <= 1) return kind;
    const index = same.indexOf(target);
    const places = SLOT_PLACES[same.length];
    return places ? `${kind}, ${places[index]}` : `${kind} ${index + 1}`;
  };
  const slotLabel = (target: HouseSlot) => {
    const inside = itemIn(target);
    const name = inside ? roomItemById.get(inside)?.name ?? inside : "empty";
    return `${slotName(target)}: ${name}. Select to choose what goes here.`;
  };

  /** A piece flies from where it was chosen into its spot, then drops in (the scene animates the drop). */
  const flyInto = async (target: HouseSlot, itemId: string, from: Captured | null, base?: Record<string, string>) => {
    await fly(from, sceneRef.current?.dropStart(target.id, itemId) ?? null);
    await placeIn(target, itemId, base ?? freshLayout());
  };

  /** An empty spot on this floor the item fits (the spot it was bought for first), for a piece from the shop. */
  const freeSlotFor = (itemId: string, prefer: string | null = null) => {
    const item = roomItemById.get(itemId);
    if (!item) return null;
    const wanted = prefer ? level.slots.find((entry) => entry.id === prefer) : undefined;
    if (wanted && fitsSlot(item, wanted, level.id)) return wanted;
    const taken = new Set(levelDecor(freshLayout(), level).placed.map((entry) => entry.slot));
    return level.slots.find((entry) => !taken.has(entry.id) && fitsSlot(item, entry, level.id)) ?? null;
  };

  /**
   * A piece of decor from the shop goes straight into the room when it has an
   * empty spot here that fits (or the spot the shop was opened for).
   * Otherwise it flies to Decorate: which opens, to swap something out, when
   * the piece goes on this floor; and Pip says where it lives when it belongs
   * on another.
   */
  const deliverDecor = (itemId: string, prefer: string | null = null): { spot: HouseSlot | null; delivery: Delivery; after: () => Promise<void> | void } => {
    const spot = freeSlotFor(itemId, prefer);
    if (spot) {
      return {
        spot,
        delivery: { to: () => sceneRef.current?.dropStart(spot.id, itemId) ?? null, line: pickOne(PLACED) },
        after: () => placeIn(spot, itemId, freshLayout())
      };
    }
    const item = roomItemById.get(itemId);
    const home = item ? homeOf(item) : null;
    const elsewhere = home && home.id !== level.id ? home : null;
    return {
      spot: null,
      delivery: {
        to: () => decorateRef.current?.getBoundingClientRect() ?? null,
        card: true,
        vanish: true,
        line: elsewhere ? `that one lives in the ${elsewhere.name.toLowerCase()}.` : "no free spot. pick one to swap."
      },
      after: () => {
        bump(decorateRef.current);
        if (elsewhere) return;
        closeShop();
        setSlotFocus(null);
        setDrawer(null);
        setDecorating(true);
      }
    };
  };

  /** "Place it" in the shop: an owned piece flies into a free spot here, or to Decorate. */
  const placeFromShop = (itemId: string) => {
    const from = clickedArt();
    const { delivery, after } = deliverDecor(itemId, shopSlot);
    closeShop();
    void fly(from, delivery.to(), { card: delivery.card, vanish: delivery.vanish })
      .then(after)
      .then(() => play("idea", 1, delivery.line ?? null))
      .catch((cause) => showToast(errorText(cause)));
  };

  const startDecorating = () => {
    setDrawer(null);
    setPickerPlot(null);
    setSlotFocus(null);
    setFinishPanel(null);
    setDecorating(true);
  };
  const stopDecorating = () => {
    setDecorating(false);
    setSlotFocus(null);
    setFinishPanel(null);
  };
  /** Wallpaper or flooring, from the decorating rail: its sheet opens, or closes again. */
  const toggleFinish = (which: FinishPanel) => {
    setSlotFocus(null);
    setFinishPanel((current) => (current === which ? null : which));
  };

  // Escape steps back out of decorating: an open sheet closes first, then the
  // mode ends. (The shop, a question or the sheet itself, holding the focus,
  // take their own Escape before it gets here.)
  useEffect(() => {
    if (!decorating) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || shopOpen) return;
      if (slotFocus) setSlotFocus(null);
      else if (finishPanel) setFinishPanel(null);
      else stopDecorating();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decorating, shopOpen, slotFocus, finishPanel]);

  /** The wall and the floor of the room on screen: where wallpaper and flooring fly to. */
  const roomPart = (part: "wall" | "floor"): Box | null => {
    const room = sceneRef.current?.room();
    if (!room) return null;
    return part === "wall"
      ? { left: room.left + room.width * 0.35, top: room.top + room.height * 0.2, width: room.width * 0.3, height: room.height * 0.3 }
      : { left: room.left + room.width * 0.35, top: room.top + room.height * 0.84, width: room.width * 0.3, height: room.height * 0.12 };
  };

  return { slot, where, placeIn, setFinish, itemIn, slotName, slotLabel, flyInto, deliverDecor, placeFromShop, startDecorating, stopDecorating, toggleFinish, roomPart };
};
