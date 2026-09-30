import { useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { PipRoomItem } from "../../pip";
import { catalogueItem, roomItems, roomStyles, type ShopKind } from "../../pip/shop";
import { hasHouse, houseLevels, levelDecor, type HouseLevel, type LevelDecor } from "../../pip/home.js";
import { FEATURES } from "../../constants/features";
import type { HouseSceneHandle } from "../../components/pip/HouseScene";
import { reducedMotion } from "../../components/pip/fx";
import type { PendingDecor, purchaseFlow } from "./purchaseFlow";
import { plural } from "./common";

/** The floor the reader was last on, a preference of this device. */
const FLOOR_KEY = "leaflet.pip.floor";

const readFloor = () => {
  try {
    return localStorage.getItem(FLOOR_KEY);
  } catch {
    return null;
  }
};

type PipHouseOptions = {
  owns: (kind: ShopKind, id: string) => boolean;
  layout: Record<string, string>;
  /** The old single room's style, which its scheme keeps. */
  roomStyle: string | undefined;
  pendingDecor: PendingDecor | null;
  sessionsDone: number;
  setSlotFocus: Dispatch<SetStateAction<string | null>>;
  setPickerPlot: Dispatch<SetStateAction<number | null>>;
  purchase: ReturnType<typeof purchaseFlow>["purchase"];
  play: (move: string, loops?: number, text?: string | null) => void;
  sceneRef: RefObject<HouseSceneHandle>;
  showToast: (message: string) => void;
};

/**
 * Pip's house: its floors (the one on screen, remembered on this device), the
 * decor of the floor on screen, and opening a new floor.
 */
export const usePipHouse = ({ owns, layout, roomStyle, pendingDecor, sessionsDone, setSlotFocus, setPickerPlot, purchase, play, sceneRef, showToast }: PipHouseOptions) => {
  const [floorId, setFloorId] = useState<string | null>(readFloor);

  // The bedroom and the garden, unless the whole house is switched on.
  const levels = useMemo(
    () => houseLevels().filter((level, index) => FEATURES.fullPipHouse || index === 0 || level.garden),
    []
  );
  const unlocked = (level: HouseLevel) => owns("level", level.id);
  const level = levels.find((entry) => entry.id === floorId && unlocked(entry)) ?? levels[0];
  const levelIndex = levels.indexOf(level);
  const gardenLevel = levels.find((entry) => entry.garden) ?? null;
  const levelRef = useRef(level);
  levelRef.current = level;
  const goToFloor = (next: HouseLevel) => {
    setFloorId(next.id);
    setSlotFocus(null);
    setPickerPlot(null);
    try {
      localStorage.setItem(FLOOR_KEY, next.id);
    } catch {
      // Remembered for this visit only.
    }
  };
  const house = hasHouse();
  const roomItemById = useMemo(() => new Map(roomItems().map((item) => [item.id, item])), []);
  /** The floor a piece belongs on, when it belongs on one ("garden" and "greenhouse" are one floor). */
  const homeOf = (item: PipRoomItem) =>
    item.level && item.level !== "any"
      ? levels.find((floor) => floor.id === item.level || (floor.garden && ["garden", "greenhouse"].includes(item.level ?? ""))) ?? null
      : null;
  // A piece for a floor this house does not have (the library's bookshelf,
  // without the whole house) could be bought but never placed.
  const placeable = (item: PipRoomItem) => !item.level || item.level === "any" || homeOf(item) !== null;
  const decor: LevelDecor = useMemo(() => {
    const found = levelDecor(layout, level);
    // The single room from before the house keeps its scheme in the old room style.
    return level.fallback && !level.garden ? { ...found, wallpaper: roomStyle || roomStyles()[0]?.id || null } : found;
  }, [layout, level, roomStyle]);
  // A piece in its grace period stands in its spot already.
  const shownDecor: LevelDecor = useMemo(
    () =>
      pendingDecor && pendingDecor.level === level.id
        ? {
            ...decor,
            placed: [...decor.placed.filter((entry) => entry.slot !== pendingDecor.slot && entry.itemId !== pendingDecor.itemId), { slot: pendingDecor.slot, itemId: pendingDecor.itemId }]
          }
        : decor,
    [decor, pendingDecor, level.id]
  );

  // ---- floors -------------------------------------------------------------------------------

  const lockReason = (next: HouseLevel) => {
    if (next.earnedOnly) return next.unlock ?? "Earned by reading.";
    const below = levels.find((entry) => entry.id === next.requires);
    if (below && !unlocked(below)) return `Open the ${below.name} first.`;
    if (sessionsDone < next.sessions) return `${plural(next.sessions - sessionsDone, "more focus session")} first.`;
    return null;
  };

  /** A floor just opened: go there, and make a moment of it once it has slid in. */
  const moveIn = (next: HouseLevel) => {
    goToFloor(next);
    play("welcome", 1, `a whole new floor. ${next.name.toLowerCase()}!`);
    window.setTimeout(() => sceneRef.current?.celebrate(next.name, "A new floor!"), reducedMotion() ? 0 : 380);
  };

  const openFloor = (next: HouseLevel) => {
    if (unlocked(next)) {
      goToFloor(next);
      return;
    }
    const why = lockReason(next);
    if (why) {
      showToast(`${next.name}: ${why}`);
      return;
    }
    const item = catalogueItem("level", next.id);
    if (item) void purchase(item, { title: `Open the ${next.name}?`, verb: "Open", note: next.blurb ?? next.unlock, after: () => moveIn(next) });
  };

  return { levels, level, levelIndex, levelRef, gardenLevel, unlocked, goToFloor, house, roomItemById, homeOf, placeable, decor, shownDecor, lockReason, openFloor };
};
