import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
// The house and arcade art load with this page, not with the app.
import "../pip/houseArt";
import { LIB, ROOM_ITEMS, SKINS, renderRoom, type PipAccessory, type PipRoomItem, type PipSkin, type PipTreat } from "../pip";
import {
  EXTRA_PLOTS,
  FREE_SIGNATURES,
  PLANTS,
  PREMIUM_MOVES,
  accessories,
  catalogueItem,
  isEarnedOnly,
  nodMatches,
  roomItems,
  roomStyles,
  slotCovered,
  treats,
  type ShopItem,
  type ShopKind
} from "../pip/shop";
import {
  fitsSlot,
  floorings,
  hasHouse,
  houseLevels,
  levelDecor,
  placements,
  renderFinish,
  renderItem,
  wallpapers,
  withLevelDecor,
  type HouseLevel,
  type HouseSlot,
  type LevelDecor
} from "../pip/home.js";
import { renderPacket } from "../pip/garden.js";
import { pickBeat } from "../pip/moments";
import { ownPipAvatar } from "../pip/avatars";
import { ownedPremiumMoves, ownsItem, usePipWardrobeStore } from "../store/pipWardrobeStore";
import { usePipStore } from "../store/pipStore";
import { useAccountStore } from "../store/accountStore";
import { useLibraryStore } from "../store/libraryStore";
import { FEATURES } from "../constants/features";
import { askConfirm } from "../components/ConfirmDialog";
import { HouseScene, type HouseSceneHandle, type SceneAct, type ScenePlot } from "../components/pip/HouseScene";
import {
  bump,
  burst,
  capture,
  centerOf,
  clearEffects,
  collect,
  dip,
  fly,
  floatText,
  reducedMotion,
  ring,
  seedPixel,
  spill,
  type Box,
  type Captured,
  type Point
} from "../components/pip/fx";
import { FloorSwitch } from "../components/pip/FloorSwitch";
import { PipDrawer } from "../components/pip/PipDrawer";
import { PipShop, type PreviewLook, type ShopCategory, type ShopEntry } from "../components/pip/PipShop";
import { PixelImage } from "../components/pip/PixelImage";
import { Empty, Group, MoveCard, PriceTag, Status, Tile, shortfall } from "../components/pip/shopParts";
import { ArcadeOverlay } from "../components/pip/arcade/ArcadeOverlay";
import type { GameId } from "../components/pip/arcade/games";
import type { PlantState } from "../services/pipService";
import { PipSprite } from "../components/PipSprite";
import { PipAvatar } from "../components/community/PipAvatar";
import { CountUp } from "../components/community/CountUp";
import { UiIcon, type UiIconName } from "../components/UiIcon";

/** Below this Pip mopes (a droopy leaf, a sigh). Nothing more: no nagging. */
const MOOD_LOW = 20;
/** How long a line stays up after Pip says it. */
const LINE_MS = 4200;
/** Mirrors GAME_MOOD_PER_DAY in pip/mod.rs, for the arcade's note. */
const GAME_MOOD_PER_DAY = 12;
/** The floor the reader was last on, a preference of this device. */
const FLOOR_KEY = "leaflet.pip.floor";
/**
 * Without the full house (FEATURES.fullPipHouse), the shop's decor is the
 * bedroom's own twenty pieces; the rest of the catalogue waits for later.
 */
const STARTER_DECOR = new Set(ROOM_ITEMS.map((item) => item.id));

type Drawer = "wardrobe" | "treats" | "moves" | "decorate" | "garden" | "me";
const TOOLS: Array<{ id: Drawer; label: string; icon: UiIconName }> = [
  { id: "wardrobe", label: "Wardrobe", icon: "outfit" },
  { id: "garden", label: "Garden", icon: "garden" },
  { id: "treats", label: "Treats", icon: "treat" },
  { id: "moves", label: "Moves", icon: "move" },
  { id: "decorate", label: "Decorate", icon: "home" }
];

const SLOTS: Array<{ slot: PipAccessory["slot"]; label: string; covered: string }> = [
  { slot: "head", label: "Head", covered: "has its own hat" },
  { slot: "face", label: "Face", covered: "already covers the face" },
  { slot: "neck", label: "Neck", covered: "already has something round the neck" },
  { slot: "back", label: "Back", covered: "already wears something on the back" },
  { slot: "hand", label: "Hand", covered: "has its hands full" }
];

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

const FOOD_LINES = ["yum.", "crunchy. thank you!", "om nom nom.", "delicious. more reading, more snacks?"];
const TOY_LINES = ["again! again!", "best. toy. ever.", "wheee!", "you're the best."];
const THANKS = ["ooh. thank you!", "for me? you shouldn't have.", "i love it."];
const PLACED = ["perfect.", "ooh, cosy.", "that goes there.", "home sweet home."];

/**
 * Snacks eaten in three bites (treats.js, eatMove): when each bite's crumbs
 * fall, and their colour. Drinks and noodles make no crumbs.
 */
const BITES_MS = [950, 1620, 2290];
const CRUMBS: Record<string, string> = {
  apple: "#FFF3D6",
  cookie: "#C88A45",
  watermelon: "#FF6F7A",
  donut: "#FF9ACB",
  cupcake: "#F6C9A0",
  pizza: "#F2B84B",
  icecream: "#FFF3E0",
  sushi: "#FFFFFF",
  cake: "#FFD6E0"
};
/** A treat's move ends with a happy flourish: the hearts rise then. */
const TICK_MS = 1000 / 12;

const moveName = (id: string) => LIB.find((move) => move.id === id)?.name ?? id;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const pickOne = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];
const plantInfo = (id: string) => PLANTS.find((plant) => plant.id === id);
const priceOf = (kind: ShopKind, id: string) => catalogueItem(kind, id)?.price ?? 0;

const moodWord = (mood: number) =>
  mood >= 80 ? "Blissful" : mood >= 60 ? "Happy" : mood >= 40 ? "Content" : mood >= MOOD_LOW ? "Wistful" : "Missing you";

const readFloor = () => {
  try {
    return localStorage.getItem(FLOOR_KEY);
  } catch {
    return null;
  }
};

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * The art of what was just chosen (the tile, shop card, detail pane or garden
 * row that holds `clicked`), copied, for effects to start from. Read before
 * anything moves on (the confirm dialog opening, the shop closing).
 */
const chosenArt = (clicked: Element | null): Captured | null => {
  if (!clicked || !clicked.isConnected) return null;
  const holder = clicked.closest(".pip-shop-tile, .pip-shop-card, .pip-shop-detail, .pip-garden-row") ?? clicked;
  return capture(holder.querySelector(".pip-shop-art, .pip-shop-card-art, .pip-shop-detail-art, .pip-garden-art") ?? holder);
};

/** Where a bought thing goes once it is bought: it flies there, then `after` runs. */
type Delivery = {
  to: () => Box | Point | null;
  /** Flies in a little card (a look, a move); bare art (decor) flies as itself. */
  card?: boolean;
  /** Shrinks into the target and is gone (Pip puts it on). */
  vanish?: boolean;
  /** What Pip says once it has arrived, instead of a thank-you. */
  line?: string;
};

type Act = SceneAct & { reactionId?: number };
type Preview = { entry: ShopEntry; look: PreviewLook };

export type PipPageProps = {
  showToast: (message: string) => void;
};

/**
 * Pip's own tab: Pip's house, the whole page.
 *
 * The current floor fills the page and Pip lives in it: strolling, doing its
 * signature move, carried about, poked. A toolbar over the scene opens the
 * shop (big, by category, with a preview on Pip before buying) and drawers
 * for the wardrobe, the garden, treats, moves and decorating. A switcher moves
 * between floors: the bedroom and the garden are free; each floor above opens
 * after the one below and some focus sessions, for seeds.
 *
 * Seeds grow in the garden: reading in focus is water, plants ripen on it,
 * ripe plants are picked for seeds (habit/seeds.rs). So this page is the other
 * half of focus mode, a reason to start the timer. It rewards and never
 * guilts: nothing withers, prices say how much reading they are, Pip's mood
 * drifts slowly and only ever mopes, and games cheer Pip up but pay nothing.
 */
export const PipPage = ({ showToast }: PipPageProps) => {
  const { overview, load, buy, setLook, feed, plant, harvest, gamePlayed } = usePipWardrobeStore(
    useShallow((state) => ({
      overview: state.overview,
      load: state.load,
      buy: state.buy,
      setLook: state.setLook,
      feed: state.feed,
      plant: state.plant,
      harvest: state.harvest,
      gamePlayed: state.gamePlayed
    }))
  );
  const { reaction, suspended, finishReaction, setOnStage } = usePipStore(
    useShallow((state) => ({
      reaction: state.reaction,
      suspended: state.suspended,
      finishReaction: state.finishReaction,
      setOnStage: state.setOnStage
    }))
  );
  const books = useLibraryStore((state) => state.books);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [shopOpen, setShopOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [slotFocus, setSlotFocus] = useState<string | null>(null);
  const [plotFocus, setPlotFocus] = useState<number | null>(null);
  const [arcadeOpen, setArcadeOpen] = useState(false);
  const [act, setAct] = useState<Act | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [floorId, setFloorId] = useState<string | null>(readFloor);
  const actKey = useRef(1);
  const sceneRef = useRef<HouseSceneHandle | null>(null);
  const seedChipRef = useRef<HTMLButtonElement | null>(null);
  const heartsRef = useRef<HTMLButtonElement | null>(null);
  const decorateRef = useRef<HTMLButtonElement | null>(null);
  // While seeds are in the air the counter shows what it had, and counts up as
  // they land; hearts likewise wait for the hearts flying to them.
  const [heldSeeds, setHeldSeeds] = useState<number | null>(null);
  const [heldMood, setHeldMood] = useState<number | null>(null);
  const [countMs, setCountMs] = useState(700);
  // Effects timed to Pip's current act (crumbs at each bite): a new act cancels them.
  const actTimers = useRef(new Set<number>());
  // What was last clicked on the page (by pointer or keyboard), for effects to
  // start from. Not the focused element: a click does not focus a button in
  // every webview.
  const lastClicked = useRef<Element | null>(null);
  const clickedArt = () => chosenArt(lastClicked.current);

  // Pip lives here while the tab is open: the roaming Pip steps aside.
  useEffect(() => {
    setOnStage(true);
    return () => setOnStage(false);
  }, [setOnStage]);

  // Leaving the tab leaves no seed mid-air.
  useEffect(() => {
    const timers = actTimers.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      clearEffects();
    };
  }, []);

  // Water may have been poured since startup (a session, a sync).
  useEffect(() => {
    void load();
  }, [load]);

  const state = overview?.state;
  const balance = overview?.wallet.balance ?? 0;
  const mood = state?.mood ?? 70;
  const variant = state?.variant ?? "sprout";
  const outfit = useMemo(() => state?.outfit ?? [], [state?.outfit]);
  const signature = state?.signature ?? "read";
  const layout = useMemo(() => state?.room ?? {}, [state?.room]);
  const owns = useCallback((kind: ShopKind, id: string) => ownsItem(overview, kind, id), [overview]);
  const sessionsDone = overview?.sessionsDone ?? 0;

  // ---- the house ------------------------------------------------------------------
  // The bedroom and the garden, unless the whole house is switched on.
  const levels = useMemo(
    () => houseLevels().filter((level, index) => FEATURES.fullPipHouse || index === 0 || level.garden),
    []
  );
  const unlocked = (level: HouseLevel) => owns("level", level.id);
  const level = levels.find((entry) => entry.id === floorId && unlocked(entry)) ?? levels[0];
  const levelIndex = levels.indexOf(level);
  const gardenLevel = levels.find((entry) => entry.garden) ?? null;
  const goToFloor = (next: HouseLevel) => {
    setFloorId(next.id);
    setSlotFocus(null);
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
    return level.fallback && !level.garden ? { ...found, wallpaper: state?.roomStyle || roomStyles()[0]?.id || null } : found;
  }, [layout, level, state?.roomStyle]);

  // ---- Pip's lines and moves ---------------------------------------------------------
  useEffect(() => {
    if (!line) return;
    const timer = window.setTimeout(() => setLine(null), LINE_MS);
    return () => window.clearTimeout(timer);
  }, [line]);

  const actRef = useRef<Act | null>(null);
  actRef.current = act;
  const play = useCallback(
    (move: string, loops = 2, text: string | null = null, reactionId?: number) => {
      // A celebration cut short (by a poke, a treat) still counts as done, or
      // the queue behind it would wait until the tab closes.
      const previous = actRef.current;
      if (previous?.reactionId !== undefined && previous.reactionId !== reactionId) {
        finishReaction(previous.reactionId);
      }
      // Crumbs from a snack Pip is no longer eating would fall from nowhere,
      // and hearts that will not fly now should not keep the meter waiting.
      if (actTimers.current.size > 0) {
        actTimers.current.forEach((timer) => window.clearTimeout(timer));
        actTimers.current.clear();
        setHeldMood(null);
      }
      setAct({ move, loops, key: actKey.current++, reactionId });
      if (text) setLine(text);
    },
    [finishReaction]
  );
  /** Runs `run` in `ms`, unless Pip starts something else first. */
  const duringAct = (ms: number, run: () => void) => {
    const timer = window.setTimeout(() => {
      actTimers.current.delete(timer);
      run();
    }, ms);
    actTimers.current.add(timer);
  };

  // Leaving the tab mid-celebration finishes it here rather than replaying it
  // when the roaming Pip comes back out.
  useEffect(
    () => () => {
      const reactionId = actRef.current?.reactionId;
      if (reactionId !== undefined) finishReaction(reactionId);
    },
    [finishReaction]
  );

  // Celebrations (goal met, a streak milestone...) play in the house while the
  // tab is open, since the roaming Pip is not out to do them.
  useEffect(() => {
    if (!reaction || suspended || act?.reactionId === reaction.id) return;
    play(reaction.move, reaction.loops, reaction.line, reaction.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reaction, suspended]);

  const onActDone = () => {
    if (act?.reactionId !== undefined) finishReaction(act.reactionId);
    setAct(null);
  };

  // A free moment: the signature move, or one of Pip's hobbies (the free ones
  // plus the moves the reader bought). Not while moping.
  const hobbies = useMemo(() => ["jog", "rope", "tree", "read", ...ownedPremiumMoves(overview)], [overview]);
  const pastimeRef = useRef<() => string | null>(() => null);
  pastimeRef.current = () => (mood < MOOD_LOW ? null : Math.random() < 0.5 ? signature : pickOne(hobbies));
  const pastime = useCallback(() => pastimeRef.current(), []);

  const poke = useCallback(() => {
    const beat = pickBeat("poke", `${Date.now()}`);
    play(beat.move, 1, beat.line);
  }, [play]);

  // ---- buying ---------------------------------------------------------------------------

  const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

  /** Where Pip is, for things that fly to Pip. */
  const toPip = () => sceneRef.current?.pip() ?? null;

  /**
   * Asks, buys, then delivers: a burst where it was chosen, the shop steps
   * aside, the thing flies to where it goes, and `after` runs as it lands
   * (wear it, place it, play it).
   */
  const purchase = async (item: ShopItem, after?: () => Promise<void> | void, delivery?: Delivery) => {
    if (busy) return;
    const lacking = shortfall(item.price, balance);
    if (lacking) {
      showToast(`${plural(lacking.short, "more seed")} for ${item.name}: about ${plural(lacking.minutes, "minute")} of focused reading.`);
      return;
    }
    // Where it was chosen, before the question takes the focus and the shop closes.
    const from = clickedArt();
    const ok = await askConfirm({
      title: `Buy ${item.name}?`,
      body: `${plural(item.price, "seed")}. You'll have ${plural(balance - item.price, "seed")} left.`,
      confirmLabel: `Buy for ${item.price}`,
      pip: "idea"
    });
    if (!ok) return;
    setBusy(true);
    try {
      await buy(item.kind, item.id);
      if (from) {
        const middle = centerOf(from.rect);
        ring(middle, Math.max(from.rect.width, from.rect.height) * 1.5);
        burst(middle, { px: 4, count: 14, sprite: "spark", spread: from.rect.width * 0.9, lift: 20, fall: 18 });
      }
      if (shopOpen) {
        // A beat to see the burst, then the shop steps aside for the delivery.
        await wait(reducedMotion() ? 0 : 200);
        setShopOpen(null);
      }
      if (delivery) {
        const target = delivery.to();
        await fly(from, target, { card: delivery.card, vanish: delivery.vanish });
        // Nothing flew (reduced motion, or it came from a button): sparkle where it landed.
        if (target && "width" in target && !from?.canvas) burst(centerOf(target), { px: 4, count: 10, sprite: "spark", spread: target.width, lift: 16 });
      }
      await after?.();
      // Moves, toys and floors show themselves off once bought; the rest get a thank-you.
      if (!["move", "treat", "level", "plot"].includes(item.kind)) {
        play("cheer", 1, delivery?.line ?? pickOne(THANKS));
      }
    } catch (cause) {
      showToast(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const buyItem = (kind: ShopKind, id: string, after?: () => Promise<void> | void, delivery?: Delivery) => {
    const item = catalogueItem(kind, id);
    if (item) void purchase(item, after, delivery);
  };

  const change = async (patch: Parameters<typeof setLook>[0]) => {
    try {
      await setLook(patch);
    } catch (cause) {
      showToast(errorText(cause));
    }
  };

  /** The layout as it is now in the store (after a purchase, the store has moved on). */
  const freshLayout = () => usePipWardrobeStore.getState().overview?.state.room ?? layout;

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
    buyItem("level", next.id, () => moveIn(next));
  };

  // ---- decorating -------------------------------------------------------------------------

  const decorating = drawer === "decorate";
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

  /** An empty spot on this floor the item fits, for a piece bought or placed from the shop. */
  const freeSlotFor = (itemId: string) => {
    const item = roomItemById.get(itemId);
    const taken = new Set(levelDecor(freshLayout(), level).placed.map((entry) => entry.slot));
    return item ? level.slots.find((entry) => !taken.has(entry.id) && fitsSlot(item, entry, level.id)) ?? null : null;
  };

  /**
   * A piece of decor from the shop goes straight into the room when it has an
   * empty spot here that fits. Otherwise it flies to Decorate: which opens,
   * to swap something out, when the piece goes on this floor; and Pip says
   * where it lives when it belongs on another.
   */
  const deliverDecor = (itemId: string): { spot: HouseSlot | null; delivery: Delivery; after: () => Promise<void> | void } => {
    const spot = freeSlotFor(itemId);
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
        setShopOpen(null);
        setSlotFocus(null);
        setDrawer("decorate");
      }
    };
  };

  /** "Place it" in the shop: an owned piece flies into a free spot here, or to Decorate. */
  const placeFromShop = (itemId: string) => {
    const from = clickedArt();
    const { delivery, after } = deliverDecor(itemId);
    setShopOpen(null);
    void fly(from, delivery.to(), { card: delivery.card, vanish: delivery.vanish })
      .then(after)
      .then(() => play("idea", 1, delivery.line ?? null))
      .catch((cause) => showToast(errorText(cause)));
  };

  // ---- the garden --------------------------------------------------------------------------

  const garden = overview?.garden;
  const plotCount = garden?.plots ?? 3;
  const growing = (plot: number): PlantState | undefined => garden?.plants.find((entry) => entry.plot === plot && !entry.harvested);
  const nextPlot = EXTRA_PLOTS.find((entry) => !owns("plot", entry.id)) ?? null;
  const scenePlots: ScenePlot[] = [
    ...Array.from({ length: plotCount }, (_, index) => {
      const here = growing(index + 1);
      return {
        plot: index + 1,
        plant: here?.plant ?? null,
        progress: here ? Math.min(1, here.water / Math.max(1, here.need)) : 0,
        ripe: Boolean(here?.ripe)
      };
    }),
    ...(nextPlot ? [{ plot: plotCount + 1, plant: null, progress: 0, ripe: false, locked: true, price: priceOf("plot", nextPlot.id) }] : [])
  ];
  const minutesLeft = (here: PlantState) => Math.max(1, Math.ceil(here.need - here.water));
  const plotLabel = (plot: ScenePlot) => {
    if (plot.locked) return `Dig a new plot: ${nextPlot ? priceOf("plot", nextPlot.id) : 0} seeds`;
    const here = growing(plot.plot);
    if (!here) return `Plot ${plot.plot}: empty. Select to plant.`;
    const name = plantInfo(here.plant)?.name ?? here.plant;
    return here.ripe ? `Plot ${plot.plot}: ${name}, ripe! Select to pick it.` : `Plot ${plot.plot}: ${name}, ${plural(minutesLeft(here), "more minute")} of focus.`;
  };

  const releaseSeeds = () => setHeldSeeds(null);

  /**
   * The seeds a harvest gave fly from where it grew to the counter, which
   * takes each one with a bump and counts up as they land.
   */
  const flySeeds = (from: Box | null, seeds: number) => {
    const chip = seedChipRef.current;
    const icon = chip?.querySelector("svg") ?? chip;
    const target = icon?.getBoundingClientRect();
    if (!from || !target || seeds <= 0 || reducedMotion()) {
      releaseSeeds();
      return;
    }
    const start = { x: from.left + from.width / 2, y: from.top + from.height * 0.45 };
    floatText({ x: start.x, y: from.top }, `+${seeds}`, "gain");
    const count = Math.max(3, Math.min(14, Math.round(seeds / 2)));
    // The count runs while they land: first seed to last.
    setCountMs(count * 55 + 320);
    void collect(start, centerOf(target), {
      sprite: "seed",
      count,
      px: seedPixel(sceneRef.current?.pixel() ?? 4),
      onLand: (index) => {
        if (index === 0) releaseSeeds();
        if (index === count - 1) setCountMs(700);
        bump(chip, index === count - 1 ? 1.2 : 0.5);
      }
    });
  };

  const pick = async (here: PlantState) => {
    if (busy) return;
    // From the garden list, the seeds fly from the row's picture if the plot is not in view.
    const row = clickedArt();
    setBusy(true);
    setHeldSeeds(balance);
    try {
      const seeds = await harvest(here.id);
      const name = (plantInfo(here.plant)?.name ?? here.plant).toLowerCase();
      const stood = sceneRef.current?.reap(here.plot, here.plant) ?? row?.rect ?? null;
      play(pickOne(["cheer", "sunbathe", "tapdance"]), 1, `fresh ${name}! +${seeds} seeds.`);
      flySeeds(stood, seeds);
    } catch (cause) {
      releaseSeeds();
      showToast(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const sow = async (plot: number, plantId: string) => {
    if (busy) return;
    const info = plantInfo(plantId);
    const price = priceOf("plant", plantId);
    if (balance < price) {
      showToast(`${plural(price - balance, "more seed")} for a ${info?.name ?? plantId} packet.`);
      return;
    }
    // The packet the seed comes from; the new plant waits for it to land.
    const from = clickedArt();
    setBusy(true);
    sceneRef.current?.expectSprout(plot, Boolean(from?.canvas));
    try {
      await plant(plot, plantId);
      setPlotFocus(null);
      sceneRef.current?.sow(plot, from);
      play("idea", 1, `${(info?.name ?? plantId).toLowerCase()} planted. ${info?.water ?? ""} minutes of reading and it's ripe.`);
    } catch (cause) {
      showToast(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const onPlot = (plot: ScenePlot) => {
    if (plot.locked) {
      if (nextPlot) buyItem("plot", nextPlot.id, () => play("cheer", 1, "a new plot! room for one more."));
      return;
    }
    const here = growing(plot.plot);
    if (here?.ripe) {
      void pick(here);
      return;
    }
    setPlotFocus(plot.plot);
    setDrawer("garden");
  };

  // ---- treats ---------------------------------------------------------------------------------

  /**
   * A treat, eaten or played with: crumbs fall at each bite, and as Pip
   * finishes, hearts rise and fly to the mood meter, which fills as they
   * land. That is what the hearts are: Pip's mood, and what cheers it.
   */
  const treatEffects = (treat: PipTreat) => {
    const scene = sceneRef.current;
    if (!scene || reducedMotion()) {
      setHeldMood(null);
      return;
    }
    const crumb = CRUMBS[treat.id];
    if (treat.kind === "food" && crumb) {
      BITES_MS.forEach((ms) =>
        duringAct(ms, () => {
          const mouth = scene.pipPoint("mouth");
          const pip = scene.pip();
          if (mouth && pip) spill(mouth, pip.bottom + pip.height * 0.02, { px: Math.max(3, scene.pixel() * 1.25), count: 6, colors: [crumb] });
        })
      );
    }
    // Near the end of (the first run of) the move, as its happy finish plays.
    const frames = LIB.find((move) => move.id === treat.move)?.loop ?? 44;
    duringAct(Math.max(600, (frames - 10) * TICK_MS), () => {
      const head = scene.pipPoint("head");
      const meter = heartsRef.current?.getBoundingClientRect();
      if (!head || !meter) {
        setHeldMood(null);
        return;
      }
      void collect(head, centerOf(meter), {
        sprite: "heart",
        count: 3,
        px: Math.max(3, Math.round(scene.pixel() * 0.8)),
        stagger: 120,
        onLand: (index) => {
          if (index === 0) setHeldMood(null);
          bump(heartsRef.current, 0.6);
        }
      });
    });
  };

  const give = async (treat: PipTreat) => {
    if (busy) return;
    const food = treat.kind === "food";
    const price = priceOf("treat", treat.id);
    const lacking = food ? shortfall(price, balance) : null;
    if (lacking) {
      showToast(`${plural(lacking.short, "more seed")} for ${treat.name}: about ${plural(lacking.minutes, "minute")} of focused reading.`);
      return;
    }
    // The hearts show the old mood until the new hearts reach them.
    const moodBefore = heldMood ?? mood;
    setBusy(true);
    setHeldMood(moodBefore);
    try {
      await feed(treat.id);
      // One snack is one snack; a toy is played with twice.
      play(treat.move, food ? 1 : 2, pickOne(food ? FOOD_LINES : TOY_LINES));
      setHeldMood(moodBefore);
      treatEffects(treat);
    } catch (cause) {
      setHeldMood(null);
      showToast(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  // ---- the arcade -----------------------------------------------------------------------------

  const onGameFinished = useCallback(async (game: GameId, score: number) => Math.round(await gamePlayed(game, score)), [gamePlayed]);
  const closeArcade = () => {
    setArcadeOpen(false);
    play("cheer", 1, "that was fun. back to the books?");
  };

  // ---- the profile picture ---------------------------------------------------------------------

  const { account, signedIn, accountsLoaded, loadAccount, setAvatar } = useAccountStore(
    useShallow((store) => ({
      account: store.status.account,
      signedIn: store.status.signedIn,
      accountsLoaded: store.loaded,
      loadAccount: store.load,
      setAvatar: store.setAvatar
    }))
  );
  useEffect(() => {
    if (FEATURES.accounts && !accountsLoaded) void loadAccount();
  }, [accountsLoaded, loadAccount]);
  const myAvatar = ownPipAvatar(variant, signature, outfit);
  const avatarInUse = account?.avatar === myAvatar;
  const useMyPip = async () => {
    try {
      await setAvatar(myAvatar);
      showToast("Your Pip is your profile picture now.");
      play(signature, 2, "say cheese.");
    } catch (cause) {
      showToast(errorText(cause));
    }
  };

  // ---- the look ---------------------------------------------------------------------------------

  const skin = SKINS.find((entry) => entry.id === variant);
  const accessoryById = useMemo(() => new Map(accessories().map((item) => [item.id, item])), []);
  const wearing = (id: string) => outfit.includes(id);
  /** The outfit with `id` in its slot (replacing whatever was there). */
  const withAccessory = (id: string, from: readonly string[] = outfit) => {
    const slotOf = accessoryById.get(id)?.slot;
    return [...from.filter((worn) => accessoryById.get(worn)?.slot !== slotOf), id];
  };
  const wearAccessory = (id: string) =>
    setLook({ outfit: withAccessory(id, usePipWardrobeStore.getState().overview?.state.outfit ?? []) });

  // The house Pip: the reader's look, or the one being previewed.
  const shownVariant = preview?.look.variant ?? variant;
  const shownOutfit = preview?.look.outfit ?? outfit;

  // ---- the shop's entries -----------------------------------------------------------------------

  const priceTag = (price: number) => <PriceTag price={price} balance={balance} />;
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
      nod: entry.nod ?? null,
      fromLibrary: libraryHas(entry.nod),
      art: imageArt(() => renderItem(entry, 0), `item-${entry.id}`),
      use: !owned
        ? null
        : at?.startsWith(`${level.id}/`)
          ? { label: "Move it about", run: () => { setShopOpen(null); setDrawer("decorate"); } }
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
      art: () => <UiIcon name={open ? "home" : "lock"} size={40} />,
      use: open && entry.id !== level.id ? { label: "Go there", run: () => { setShopOpen(null); goToFloor(entry); } } : null
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
      art: pipArt(entry.move, variant, outfit),
      preview: { move: entry.move },
      use: food
        ? { label: balance >= price ? `Feed Pip · ${price}` : "Keep reading", run: () => { setShopOpen(null); void give(entry); } }
        : owned
          ? { label: "Play", run: () => { setShopOpen(null); void give(entry); } }
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
  const shopCategories: ShopCategory[] = [
    { id: "variants", label: "Variants", icon: "pip", entries: SKINS.filter((entry) => !isEarnedOnly(entry)).map(skinEntry).sort(byPrice) },
    { id: "wardrobe", label: "Wardrobe", icon: "outfit", entries: accessories().map(accessoryEntry).sort(byPrice) },
    {
      id: "decor",
      label: "Decor",
      icon: "home",
      note: "Decor goes straight into a free spot on this floor that fits it. Move things about from Decorate.",
      entries: allRoomItems
        .filter((item) => owns("room", item.id) || (!item.nod && (FEATURES.fullPipHouse || STARTER_DECOR.has(item.id)) && placeable(item)))
        .map(decorEntry)
        .sort(byPrice)
    },
    ...(FEATURES.fullPipHouse
      ? [
          {
            id: "nods",
            label: "Book Nods",
            icon: "book-open" as UiIconName,
            note: "Little tributes to famous books, original designs. A ribbon means the book is in your library.",
            entries: nodItems.map(decorEntry).sort((a, b) => Number(b.fromLibrary) - Number(a.fromLibrary) || byPrice(a, b))
          }
        ]
      : []),
    { id: "treats", label: "Treats", icon: "treat", entries: treats().map(treatEntry).sort(byPrice) },
    { id: "moves", label: "Moves", icon: "move", entries: PREMIUM_MOVES.map(moveEntry).sort(byPrice) },
    {
      id: "rooms",
      label: "Floors & walls",
      icon: "grid",
      note: "Floors of the house open in order, after enough focus sessions. Wallpaper and flooring dress one floor at a time.",
      entries: [
        ...levels.filter((entry) => !entry.garden && entry.price >= 0 && entry !== levels[0]).map(levelEntry),
        ...(house
          ? [...wallpapers().map((entry) => finishEntry("wallpaper", entry)), ...floorings().map((entry) => finishEntry("flooring", entry))]
          : roomStyles().map(styleEntry))
      ]
    }
  ];

  /** The wall and the floor of the room on screen: where wallpaper and flooring fly to. */
  const roomPart = (part: "wall" | "floor"): Box | null => {
    const room = sceneRef.current?.room();
    if (!room) return null;
    return part === "wall"
      ? { left: room.left + room.width * 0.35, top: room.top + room.height * 0.2, width: room.width * 0.3, height: room.height * 0.3 }
      : { left: room.left + room.width * 0.35, top: room.top + room.height * 0.84, width: room.width * 0.3, height: room.height * 0.12 };
  };

  /**
   * Buys from the shop, and sends the thing where it goes: a look or a move
   * to Pip (who puts it on, or shows it off), decor into a free spot, paper to
   * the wall, a floor to its door. `bought` runs first (a preview ending as
   * the look it showed becomes Pip's own).
   */
  const onShopBuy = (entry: ShopEntry, bought?: () => void) => {
    const toWear: Delivery = { to: toPip, card: true, vanish: true };
    const treat = treats().find((candidate) => candidate.id === entry.id);
    const next = levels.find((floor) => floor.id === entry.id);
    const decorDelivery = entry.kind === "room" ? deliverDecor(entry.id) : null;
    const plans: Partial<Record<ShopKind, { after?: () => Promise<void> | void; delivery?: Delivery }>> = {
      skin: { after: () => setLook({ variant: entry.id }), delivery: toWear },
      accessory: { after: () => wearAccessory(entry.id), delivery: toWear },
      move: { after: () => play(entry.id, 2, `new move: ${entry.name.toLowerCase()}.`), delivery: toWear },
      level: { after: () => (next ? moveIn(next) : undefined) },
      treat: { after: () => (treat ? give(treat) : undefined), delivery: toWear },
      room: decorDelivery ? { after: decorDelivery.after, delivery: decorDelivery.delivery } : {},
      style: { after: () => setLook({ roomStyle: entry.id }), delivery: { to: () => roomPart("wall"), card: true, vanish: true } },
      wallpaper: { after: () => setFinish("wallpaper", entry.id, freshLayout()), delivery: { to: () => roomPart("wall"), card: true, vanish: true } },
      flooring: { after: () => setFinish("floor", entry.id, freshLayout()), delivery: { to: () => roomPart("floor"), card: true, vanish: true } }
    };
    const plan = plans[entry.kind] ?? {};
    buyItem(
      entry.kind,
      entry.id,
      () => {
        bought?.();
        return plan.after?.();
      },
      plan.delivery
    );
  };

  const onShopPreview = (entry: ShopEntry) => {
    if (!entry.preview) return;
    const reopen = shopOpen;
    setPreview({ entry, look: entry.preview });
    setShopOpen(null);
    setDrawer(null);
    play(entry.preview.move ?? "cheer", 2, pickOne(["how do i look?", "ooh. fancy.", "is this me?"]));
    previewFrom.current = reopen;
  };
  const previewFrom = useRef<string | null>(null);
  const endPreview = (back: boolean) => {
    setPreview(null);
    if (back) setShopOpen(previewFrom.current ?? "variants");
  };

  // ---- drawers ------------------------------------------------------------------------------------

  const wardrobeTile = (entry: PipSkin) => {
    const owned = owns("skin", entry.id);
    const worn = entry.id === variant;
    const earned = isEarnedOnly(entry);
    return (
      <Tile
        key={entry.id}
        selected={worn}
        name={entry.name}
        hint={entry.blurb ?? entry.unlock}
        label={`${entry.name}. ${worn ? "Wearing." : owned ? "Owned. Select to wear it." : earned ? `Locked. Earned by reading: ${entry.unlock}` : "In the shop."}`}
        art={(hot) => <PipSprite move="idle" still={!hot && !worn} size={72} snap="nearest" skin={entry.id} outfit={outfit} />}
        status={
          worn ? (
            <Status icon="check">Wearing</Status>
          ) : owned ? (
            <Status>Owned</Status>
          ) : earned ? (
            // "Earned" read as if it already was; these are still to earn.
            <Status icon="lock">Locked</Status>
          ) : (
            priceTag(priceOf("skin", entry.id))
          )
        }
        onSelect={() => {
          if (worn) return;
          if (owned) void change({ variant: entry.id });
          else if (earned) showToast(`${entry.name} is earned, not bought: ${entry.unlock}`);
          else setShopOpen("variants");
        }}
      />
    );
  };

  const accessoryTile = (entry: PipAccessory) => {
    const worn = wearing(entry.id);
    return (
      <Tile
        key={entry.id}
        selected={worn}
        name={entry.name}
        label={`${entry.name}. ${worn ? "Wearing. Select to take it off." : "Select to wear it."}`}
        art={(hot) => <PipSprite move="idle" still={!hot} size={72} snap="nearest" skin={variant} outfit={withAccessory(entry.id)} />}
        status={worn ? <Status icon="check">Wearing</Status> : <Status>Owned</Status>}
        onSelect={() => void change({ outfit: worn ? outfit.filter((id) => id !== entry.id) : withAccessory(entry.id) })}
      />
    );
  };

  const ownedAccessories = accessories().filter((entry) => owns("accessory", entry.id));
  const wardrobePanel = (
    <>
      <Group title="Variants" note="Pip's whole look. Accessories go on top.">
        {SKINS.filter((entry) => owns("skin", entry.id)).map(wardrobeTile)}
      </Group>
      {ownedAccessories.length > 0 ? (
        SLOTS.map(({ slot: which, label, covered }) => {
          const items = ownedAccessories.filter((entry) => entry.slot === which);
          if (items.length === 0) return null;
          const hidden = slotCovered(skin, which);
          return (
            <Group key={which} title={label} note={hidden ? `${skin?.name ?? "This variant"} ${covered}, so ${label.toLowerCase()} pieces stay off for now.` : undefined}>
              {items.map(accessoryTile)}
            </Group>
          );
        })
      ) : (
        <Empty>No accessories yet. The shop has hats, glasses, capes and more.</Empty>
      )}
      <button type="button" className="tactile-button tactile-button-primary mt-4 px-4 py-2 text-xs" onClick={() => setShopOpen("wardrobe")}>
        Shop for more
      </button>
      <Group title="Earned by reading" note="Achievements: never sold, only earned.">
        {SKINS.filter((entry) => isEarnedOnly(entry)).map(wardrobeTile)}
      </Group>
    </>
  );

  const treatTile = (entry: PipTreat) => {
    const food = entry.kind === "food";
    const owned = !food && owns("treat", entry.id);
    const price = priceOf("treat", entry.id);
    return (
      <Tile
        key={entry.id}
        name={entry.name}
        label={`${entry.name}. ${food ? `Feed Pip for ${price} seeds.` : owned ? "Play with Pip." : `${price} seeds.`} Cheers Pip up.`}
        art={(hot) => <PipSprite move={entry.move} still={!hot} size={72} snap="nearest" skin={variant} outfit={outfit} />}
        status={food ? priceTag(price) : owned ? <Status icon="heart">Play</Status> : priceTag(price)}
        onSelect={() => {
          if (food || owned) void give(entry);
          else buyItem("treat", entry.id, () => give(entry), { to: toPip, card: true, vanish: true });
        }}
      />
    );
  };
  const treatsPanel = (
    <>
      <Group title="Snacks" note="Bought as you give them. Each one cheers Pip up.">
        {treats().filter((entry) => entry.kind === "food").map(treatTile)}
      </Group>
      <Group title="Toys" note="Bought once, played with forever.">
        {treats().filter((entry) => entry.kind === "toy").map(treatTile)}
      </Group>
    </>
  );

  const moveList = [...FREE_SIGNATURES.map((id) => ({ id, price: 0 })), ...PREMIUM_MOVES];
  const movesPanel = (
    <>
      <p className="text-xs text-on-surface-variant">
        Your signature move is Pip's idle flourish and your profile picture's move. Moves you own join Pip's free time.
        Celebrations stay free: Pip cheers your goals with every move it knows.
      </p>
      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(9.5rem, 1fr))" }}>
        {moveList.map((entry) => {
          const owned = owns("move", entry.id);
          const chosen = entry.id === signature;
          const name = moveName(entry.id);
          const price = entry.price === 0 ? 0 : priceOf("move", entry.id);
          return (
            <MoveCard
              key={entry.id}
              name={name}
              art={(hot) => <PipSprite move={entry.id} still={!hot && !chosen} size={72} snap="nearest" skin={variant} outfit={outfit} />}
              selected={chosen}
              status={chosen ? <Status icon="check">Signature</Status> : owned ? <Status>{price === 0 ? "Free" : "Owned"}</Status> : priceTag(price)}
              onPreview={() => play(entry.id, 2)}
              action={
                chosen
                  ? null
                  : owned
                    ? { label: "Make signature", run: () => void change({ signature: entry.id }).then(() => play(entry.id, 1, "my new signature move.")) }
                    : {
                        label: `Buy · ${price}`,
                        run: () => buyItem("move", entry.id, () => play(entry.id, 2, `new move: ${name.toLowerCase()}.`), { to: toPip, card: true, vanish: true })
                      }
              }
            />
          );
        })}
      </div>
    </>
  );

  // What Decorate offers to buy is what the shop sells: without the whole
  // house, the starter pieces. It used to offer the full catalogue, book nods
  // and all, that the shop keeps back.
  const onSale = (item: PipRoomItem) => FEATURES.fullPipHouse || (!item.nod && STARTER_DECOR.has(item.id));
  const fitting = slot ? allRoomItems.filter((item) => fitsSlot(item, slot, level.id) && (owns("room", item.id) || onSale(item))) : [];
  const decorTile = (item: PipRoomItem, target: HouseSlot) => {
    const owned = owns("room", item.id);
    const here = itemIn(target) === item.id;
    const at = where.get(item.id);
    const elsewhere = at && !here ? levels.find((floor) => at.startsWith(`${floor.id}/`))?.name ?? "the house" : null;
    const price = priceOf("room", item.id);
    return (
      <Tile
        key={item.id}
        selected={here}
        name={item.name}
        label={`${item.name}. ${here ? "Here. Select to take it out." : owned ? (elsewhere ? `In the ${elsewhere}. Select to move it here.` : "Select to put it here.") : `${price} seeds.`}`}
        art={() => <PixelImage render={() => renderItem(item, 0)} drawKey={item.id} box={56} />}
        status={here ? <Status icon="check">Here</Status> : owned ? <Status>{elsewhere ? `In the ${elsewhere}` : "Owned"}</Status> : priceTag(price)}
        onSelect={() => {
          if (here) void placeIn(target, null);
          else if (owned) void flyInto(target, item.id, clickedArt()).then(() => play("kudos", 1, pickOne(PLACED)));
          else buyItem("room", item.id, () => placeIn(target, item.id, freshLayout()), { to: () => sceneRef.current?.dropStart(target.id, item.id) ?? null });
        }}
      />
    );
  };
  const finishTile = (kind: "wallpaper" | "flooring" | "style", entry: { id: string; name?: string }) => {
    const owned = owns(kind, entry.id);
    const chosen = kind === "flooring" ? decor.floor === entry.id : decor.wallpaper === entry.id;
    const price = priceOf(kind, entry.id);
    const apply = (base?: Record<string, string>) =>
      kind === "style" ? setLook({ roomStyle: entry.id }) : setFinish(kind === "wallpaper" ? "wallpaper" : "floor", entry.id, base);
    return (
      <Tile
        key={`${kind}-${entry.id}`}
        selected={chosen}
        name={entry.name ?? entry.id}
        label={`${entry.name ?? entry.id}. ${chosen ? "On this floor." : owned ? "Select to use it here." : `${price} seeds.`}`}
        art={() =>
          kind === "style" ? (
            <PixelImage render={() => renderRoom(entry.id, 0)} drawKey={`style-${entry.id}`} box={56} />
          ) : (
            <PixelImage render={() => renderFinish(kind === "wallpaper" ? "wallpaper" : "floor", entry.id, 40, 40)} drawKey={`${kind}-${entry.id}`} box={48} />
          )
        }
        status={chosen ? <Status icon="check">Here</Status> : owned ? <Status>Owned</Status> : priceTag(price)}
        onSelect={() => {
          if (chosen) return;
          // The swatch flies to the wall (or the floor), then the room is papered over.
          const to = () => roomPart(kind === "flooring" ? "floor" : "wall");
          if (owned) void fly(clickedArt(), to(), { card: true, vanish: true }).then(() => apply());
          else buyItem(kind, entry.id, () => apply(freshLayout()), { to, card: true, vanish: true });
        }}
      />
    );
  };
  const walls = house ? wallpapers() : roomStyles();
  const wallKind = house ? "wallpaper" : "style";
  const decoratePanel = slot ? (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-on-surface">{slotName(slot)}</p>
        <button type="button" className="text-xs text-on-surface-variant underline" onClick={() => setSlotFocus(null)}>
          Back to the floor
        </button>
      </div>
      {itemIn(slot) && (
        <button type="button" className="tactile-button mt-2 px-3 py-1.5 text-xs" onClick={() => void placeIn(slot, null)}>
          Leave it empty
        </button>
      )}
      {fitting.some((item) => owns("room", item.id)) ? (
        <Group title="Yours">{fitting.filter((item) => owns("room", item.id)).map((item) => decorTile(item, slot))}</Group>
      ) : (
        <Empty>Nothing of Pip's fits here yet.</Empty>
      )}
      {fitting.some((item) => !owns("room", item.id)) && (
        <Group title="In the shop">
          {fitting
            .filter((item) => !owns("room", item.id))
            .sort((a, b) => priceOf("room", a.id) - priceOf("room", b.id))
            .map((item) => decorTile(item, slot))}
        </Group>
      )}
    </>
  ) : (
    <>
      <p className="text-xs text-on-surface-variant">
        Select a pin in the room, or a spot below, to choose what goes there. Things snap into place, and each is in one place in the house at a
        time.
      </p>
      {level.slots.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {level.slots.map((entry) => (
            <button key={entry.id} type="button" className="tactile-button px-2.5 py-1 text-[11px]" onClick={() => setSlotFocus(entry.id)}>
              {slotName(entry)}
              {itemIn(entry) ? `: ${roomItemById.get(itemIn(entry) ?? "")?.name ?? ""}` : ""}
            </button>
          ))}
        </div>
      )}
      {walls.length > 0 && <Group title={house ? "Wallpaper" : "Room style"}>{walls.map((entry) => finishTile(wallKind, entry))}</Group>}
      {house && floorings().length > 0 && <Group title="Floor">{floorings().map((entry) => finishTile("flooring", entry))}</Group>}
    </>
  );

  const barrel = garden ? Math.round(garden.barrel) : 0;
  const gardenPanel = (
    <>
      <p className="text-xs text-on-surface-variant">
        Reading in focus is water: a minute each, half as much again when a session runs to the end. Water flows to the oldest
        planting first. When a plant has had its minutes it ripens; pick it for seeds. Nothing withers while you're away.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="seed-chip water-chip">
          <UiIcon name="water" size={12} />
          Rain barrel <CountUp value={barrel} /> / {garden?.barrelCap ?? 120}
        </span>
        {gardenLevel && level.id !== gardenLevel.id && (
          <button type="button" className="tactile-button px-3 py-1 text-xs" onClick={() => goToFloor(gardenLevel)}>
            Go to the garden
          </button>
        )}
      </div>
      <div className="mt-3 grid gap-2">
        {Array.from({ length: plotCount }, (_, index) => {
          const plot = index + 1;
          const here = growing(plot);
          const info = here ? plantInfo(here.plant) : null;
          return (
            <div key={plot} className="pip-garden-row" data-focus={plotFocus === plot || undefined}>
              <span className="pip-garden-art">
                <PixelImage render={() => renderPacket(here?.plant ?? "sunflower", 0)} drawKey={`plot-${here?.plant ?? "empty"}`} box={36} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-on-surface">
                  Plot {plot}: {here ? info?.name ?? here.plant : "empty"}
                </p>
                {here && !here.ripe && (
                  <>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-outline-variant/30" aria-hidden="true">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (here.water / here.need) * 100)}%` }} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-on-surface-variant">
                      {Math.floor(here.water)} / {here.need} water · {plural(minutesLeft(here), "more minute")} of focus
                    </p>
                  </>
                )}
                {here?.ripe && <p className="text-[11px] font-semibold text-on-surface">Ripe! {info ? `${info.yield} seeds` : ""}</p>}
              </div>
              {here?.ripe ? (
                <button type="button" className="tactile-button tactile-button-primary px-3 py-1.5 text-xs" onClick={() => void pick(here)}>
                  Pick
                </button>
              ) : !here ? (
                <button type="button" className="tactile-button px-3 py-1.5 text-xs" aria-pressed={plotFocus === plot} onClick={() => setPlotFocus(plot)}>
                  Plant
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {plotFocus !== null && !growing(plotFocus) && (
        <Group title={`Seed packets for plot ${plotFocus}`} note="Longer plants pay better per minute of reading.">
          {PLANTS.map((entry) => {
            const price = priceOf("plant", entry.id);
            return (
              <Tile
                key={entry.id}
                name={entry.name}
                hint={entry.blurb}
                label={`${entry.name}: ${entry.water} minutes of focus to ripen, gives ${entry.yield} seeds. Packet ${price} seeds.`}
                art={() => <PixelImage render={() => renderPacket(entry.id, 0)} drawKey={`packet-${entry.id}`} box={48} />}
                status={
                  <span className="text-[11px] text-on-surface-variant">
                    {entry.water} min → {entry.yield} · {priceTag(price)}
                  </span>
                }
                onSelect={() => void sow(plotFocus, entry.id)}
              />
            );
          })}
        </Group>
      )}
      {nextPlot && (
        <button
          type="button"
          className="tactile-button mt-4 px-4 py-2 text-xs"
          onClick={() => buyItem("plot", nextPlot.id, () => play("cheer", 1, "a new plot! room for one more."))}
        >
          Dig a new plot · {priceOf("plot", nextPlot.id)} seeds
        </button>
      )}
    </>
  );

  const earned = overview?.wallet.earned;
  const mePanel = (
    <>
      <p className="flex items-center gap-2 font-headline text-4xl font-bold tabular-nums text-on-surface">
        <UiIcon name="seed" size={26} className="text-primary" />
        <CountUp value={balance} />
      </p>
      <p className="mt-1 text-xs text-on-surface-variant">
        Seeds grow in Pip's garden. Reading in focus waters it (a minute each, half again for a session finished cleanly); ripe plants
        are picked for seeds. Goal days add a few more, a few more still on a streak. Games never pay seeds.
      </p>
      {earned && (
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs tabular-nums text-on-surface-variant">
          <dt>Harvests</dt>
          <dd>{earned.harvests}</dd>
          <dt>Goal days</dt>
          <dd>{earned.goalDays}</dd>
          <dt>Streak bonus</dt>
          <dd>{earned.streakBonus}</dd>
          <dt>Welcome gift</dt>
          <dd>{earned.welcome}</dd>
          {earned.earlier > 0 && (
            <>
              <dt>Earned before the garden</dt>
              <dd>{earned.earlier}</dd>
            </>
          )}
          <dt>Spent on Pip</dt>
          <dd>−{overview?.wallet.spent ?? 0}</dd>
          <dt>Water poured, all told</dt>
          <dd>{Math.round(garden?.water ?? 0)}</dd>
        </dl>
      )}
      <div className="section-rule mt-4 pt-3">
        <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Mood: {moodWord(mood)}</p>
        <p className="mt-1 text-xs text-on-surface-variant">
          Reading sessions, treats and harvests cheer Pip up; so do games, a little each day. It drifts down slowly on days away.
        </p>
      </div>
      {FEATURES.accounts && (
        <div className="section-rule mt-4 flex items-center gap-3 pt-3">
          <PipAvatar seed={null} avatar={myAvatar} size={56} play label="Your Pip as a profile picture" />
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Profile picture</p>
            {signedIn ? (
              <button
                type="button"
                className="tactile-button mt-1 px-3 py-1.5 text-xs disabled:cursor-default disabled:opacity-60"
                onClick={() => void useMyPip()}
                disabled={avatarInUse}
              >
                {avatarInUse ? "In use" : "Use my Pip"}
              </button>
            ) : (
              <p className="mt-1 text-xs text-on-surface-variant">Sign in (Settings, Account) to wear your Pip on the leaderboard.</p>
            )}
          </div>
        </div>
      )}
    </>
  );

  const drawers: Record<Drawer, { title: string; note?: ReactNode; body: ReactNode }> = {
    wardrobe: { title: "Wardrobe", note: "What Pip wears shows everywhere Pip goes.", body: wardrobePanel },
    garden: { title: "Garden", note: "Where seeds come from.", body: gardenPanel },
    treats: { title: "Treats", note: "Snacks and toys cheer Pip up.", body: treatsPanel },
    moves: { title: "Moves", body: movesPanel },
    decorate: { title: `Decorate the ${level.name}`, body: decoratePanel },
    me: { title: "Seeds and mood", body: mePanel }
  };

  const toggleDrawer = (id: Drawer) => {
    setDrawer((current) => (current === id ? null : id));
    setSlotFocus(null);
    if (id !== "garden") setPlotFocus(null);
  };

  // ---- the page -----------------------------------------------------------------------------------

  const shownMood = heldMood ?? mood;
  const hearts = Math.round(shownMood / 10) / 2;
  const above = levels[levelIndex + 1];
  const below = levels[levelIndex - 1];
  const ripe = garden?.plants.filter((entry) => entry.ripe && !entry.harvested).length ?? 0;

  // Seeds coming and going outside a harvest (a purchase, a reading session
  // finishing while the tab is open): the counter dips or bumps, and says by how much.
  const loaded = overview !== null;
  const lastBalance = useRef<number | null>(loaded ? balance : null);
  useEffect(() => {
    const before = lastBalance.current;
    lastBalance.current = loaded ? balance : null;
    if (before === null || before === balance || heldSeeds !== null) return;
    const chip = seedChipRef.current;
    const box = chip?.getBoundingClientRect();
    if (!chip || !box) return;
    const change = balance - before;
    if (change > 0) {
      floatText({ x: box.left + box.width / 2, y: box.top }, `+${change}`, "gain");
      bump(chip);
    } else {
      floatText({ x: box.left + box.width / 2, y: box.bottom + 4 }, `−${-change}`, "spend");
      dip(chip);
    }
    // Only a new balance matters; the hold is read as it stands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance, loaded]);

  // A heart filling pops as it fills.
  const heartRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const lastHearts = useRef(hearts);
  useEffect(() => {
    const before = lastHearts.current;
    lastHearts.current = hearts;
    if (hearts <= before) return;
    heartRefs.current.forEach((node, index) => {
      if (index + 1 > before && index < hearts) bump(node, 1.6);
    });
  }, [hearts]);

  return (
    <div
      className="pip-house-page"
      onClickCapture={(event) => {
        lastClicked.current = event.target instanceof Element ? event.target : null;
      }}
    >
      <h2 className="sr-only">Pip's house</h2>
      <section className="pip-house" aria-label={`Pip's house: the ${level.name}`}>
        <div className="pip-hud">
          <div className="pip-hud-group">
            <button
              ref={seedChipRef}
              type="button"
              className="pip-hud-chip pip-hud-seeds"
              onClick={() => toggleDrawer("me")}
              aria-label={`${plural(balance, "seed")}. Where they come from`}
              title="Seeds: where they come from"
            >
              <UiIcon name="seed" size={15} />
              <span className="tabular-nums">
                <CountUp value={heldSeeds ?? balance} duration={heldSeeds === null ? countMs : 700} />
              </span>
            </button>
            <button type="button" className="pip-hud-shop" onClick={() => setShopOpen("variants")}>
              <UiIcon name="shop" size={17} />
              <span>Shop</span>
            </button>
            {/* The hearts are Pip's mood: they open what cheers it up. */}
            <button
              ref={heartsRef}
              type="button"
              className="pip-hud-chip pip-hearts"
              onClick={() => toggleDrawer("me")}
              aria-label={`Pip's mood: ${hearts} of 5 hearts. ${moodWord(shownMood)}. What cheers Pip up`}
              title={`Pip's mood: ${moodWord(shownMood)}`}
            >
              {[0, 1, 2, 3, 4].map((index) => (
                <span
                  key={index}
                  ref={(node) => {
                    heartRefs.current[index] = node;
                  }}
                  className="pip-heart"
                  data-fill={hearts >= index + 1 ? "full" : hearts > index ? "half" : "empty"}
                >
                  <UiIcon name="heart" size={14} />
                </span>
              ))}
            </button>
          </div>
          {levels.length > 1 && (
            <FloorSwitch
              levels={levels}
              current={level}
              above={above}
              below={below}
              unlocked={unlocked}
              lockReason={lockReason}
              priceOf={(entry) => priceOf("level", entry.id)}
              onOpen={openFloor}
            />
          )}
          <div className="pip-hud-group pip-toolbar" role="toolbar" aria-label="Pip's things">
            {TOOLS.map((tool) => (
              <button
                key={tool.id}
                ref={tool.id === "decorate" ? decorateRef : undefined}
                type="button"
                className="pip-hud-button"
                aria-pressed={drawer === tool.id}
                onClick={() => toggleDrawer(tool.id)}
              >
                <UiIcon name={tool.icon} size={16} />
                <span>{tool.label}</span>
                {tool.id === "garden" && ripe > 0 && <span className="pip-hud-dot" aria-label={`${ripe} ripe`} />}
              </button>
            ))}
            {level.arcade && (
              <button type="button" className="pip-hud-button pip-hud-play" onClick={() => setArcadeOpen(true)}>
                <UiIcon name="game" size={16} />
                <span>Arcade</span>
              </button>
            )}
          </div>
        </div>

        {preview && (
          <div className="pip-preview-bar" role="status">
            <span className="text-sm">
              Previewing <strong>{preview.entry.name}</strong>
            </span>
            {!preview.entry.owned && balance < preview.entry.price && (
              <span className="text-xs text-on-surface-variant">
                {plural(preview.entry.price - balance, "more seed")} · ~{shortfall(preview.entry.price, balance)?.minutes} min of reading
              </span>
            )}
            {!preview.entry.owned && balance >= preview.entry.price && !preview.entry.locked && (
              <button
                type="button"
                className="tactile-button tactile-button-primary px-3 py-1.5 text-xs"
                // The preview stays on until the look is Pip's own, so it does not
                // spin back to the old one while the purchase is asked about.
                onClick={() => onShopBuy(preview.entry, () => setPreview(null))}
              >
                Buy for {preview.entry.price}
              </button>
            )}
            <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={() => endPreview(true)}>
              Back to the shop
            </button>
            <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={() => endPreview(false)}>
              Done
            </button>
          </div>
        )}

        <div className="pip-house-body">
          <HouseScene
            ref={sceneRef}
            level={level}
            floorIndex={levelIndex}
            decor={decor}
            skin={shownVariant}
            outfit={shownOutfit}
            act={act}
            onActDone={onActDone}
            line={line}
            pastime={pastime}
            mopey={mood < MOOD_LOW}
            onPoke={poke}
            decorating={decorating}
            selectedSlot={slotFocus}
            onSlot={(target) => setSlotFocus(target.id)}
            slotLabel={slotLabel}
            onArcade={() => setArcadeOpen(true)}
            hidePip={arcadeOpen}
            plots={level.garden ? scenePlots : undefined}
            onPlot={level.garden ? onPlot : undefined}
            plotLabel={plotLabel}
            label={`The ${level.name}, with Pip in ${SKINS.find((entry) => entry.id === shownVariant)?.name ?? "its"} outfit. ${moodWord(mood)}.`}
          />

          {drawer && (
            // Keyed, so switching drawers slides the new one in.
            <PipDrawer key={drawer} title={drawers[drawer].title} note={drawers[drawer].note} onClose={() => setDrawer(null)}>
              {overview === null ? <Empty>Pip is getting dressed…</Empty> : drawers[drawer].body}
            </PipDrawer>
          )}
        </div>

        <p className="pip-house-hint">
          {decorating
            ? "Decorating: select a pin in the room to choose what goes there."
            : level.garden
              ? "Select a plot to plant or pick. Reading in focus waters the garden."
              : level.arcade
                ? "Select the arcade cabinet (or Arcade) to play. Games cheer Pip up but never pay seeds."
                : "Select Pip to poke it, drag to carry it about. Seeds grow in the garden, watered by your reading."}
        </p>
      </section>

      {shopOpen && (
        <PipShop categories={shopCategories} balance={balance} initial={shopOpen} onBuy={onShopBuy} onPreview={onShopPreview} onClose={() => setShopOpen(null)} />
      )}

      {arcadeOpen && (
        <ArcadeOverlay
          skin={variant}
          outfit={outfit}
          best={overview?.arcade.best ?? {}}
          moodToday={overview?.arcade.moodToday ?? 0}
          moodCap={GAME_MOOD_PER_DAY}
          onFinished={onGameFinished}
          onClose={closeArcade}
        />
      )}
    </div>
  );
};
