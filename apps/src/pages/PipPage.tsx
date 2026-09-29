import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
import { renderPacket, renderSoil } from "../pip/garden.js";
import { pickBeat } from "../pip/moments";
import { ownPipAvatar } from "../pip/avatars";
import { ownedPremiumMoves, ownsItem, usePipWardrobeStore } from "../store/pipWardrobeStore";
import { usePipStore } from "../store/pipStore";
import { useAccountStore } from "../store/accountStore";
import { useLibraryStore } from "../store/libraryStore";
import { FEATURES } from "../constants/features";
import { HouseScene, type HouseSceneHandle, type SceneAct, type ScenePlot } from "../components/pip/HouseScene";
import {
  bump,
  burst,
  capture,
  centerOf,
  clearEffects,
  collect,
  confetti,
  dip,
  fly,
  floatText,
  puff,
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
import { PipShop, type PreviewLook, type ShopCategory, type ShopEntry, type ShopRequest } from "../components/pip/PipShop";
import { PixelImage } from "../components/pip/PixelImage";
import { Empty, Group, Hint, Hints, MoveCard, PriceTag, Status, Tile, shortfall } from "../components/pip/shopParts";
import { PurchaseConfirm, askPurchase } from "../components/pip/PurchaseConfirm";
import { UndoToast, type UndoToastItem } from "../components/pip/UndoToast";
import { GoalChip } from "../components/pip/GoalChip";
import { PipThings, type ThingsTab } from "../components/pip/PipThings";
import { PacketPicker } from "../components/pip/PacketPicker";
import { Walkthrough } from "../components/pip/Walkthrough";
import { WALK, markWalkSeen, walkSeen, type WalkStep, type WalkTarget } from "../components/pip/walkSteps";
import { createGrace, isQuickBuy, type GraceItem, type Pending } from "../components/pip/quickBuy";
import { goalProgress, readGoal, stepGoal, writeGoal, type PinnedGoal } from "../components/pip/goal";
import { tally, type Tally } from "../components/pip/collection";
import type { Rect } from "../components/pip/layout";
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
/** Between the room and the lift beside it; the lift is 44 wide (index.css keeps the two in step). */
const LIFT_GAP = 8;
/** Kept under the tool rail: the gap above it and what is left of the page's bottom margin, so nothing scrolls. */
const BELOW_RAIL = 26;

type Drawer = "things" | "garden" | "me";
type ThingsTabId = "looks" | "treats" | "moves";
type FinishPanel = "wallpaper" | "flooring";

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

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];

const moveName = (id: string) => LIB.find((move) => move.id === id)?.name ?? id;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const pickOne = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];
const plantInfo = (id: string) => PLANTS.find((plant) => plant.id === id);
const priceOf = (kind: ShopKind, id: string) => catalogueItem(kind, id)?.price ?? 0;
/** "a Cookie", "an Oak". */
const aOrAn = (name: string) => `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;

const moodWord = (mood: number) =>
  mood >= 80 ? "Blissful" : mood >= 60 ? "Happy" : mood >= 40 ? "Content" : mood >= MOOD_LOW ? "Wistful" : "Missing you";

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const readFloor = () => {
  try {
    return localStorage.getItem(FLOOR_KEY);
  } catch {
    return null;
  }
};

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * The water each planting had when the garden was last on screen (a
 * preference of this device), so what reading poured in since can rain down
 * the next time it is.
 */
const SEEN_KEY = "leaflet.pip.gardenSeen";
const readSeen = (): Record<string, number> => {
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as unknown;
    return seen && typeof seen === "object" ? (seen as Record<string, number>) : {};
  } catch {
    return {};
  }
};
const writeSeen = (seen: Record<string, number>) => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Remembered for this visit only.
  }
};

/**
 * The art of what was just chosen (the tile, shop card, detail pane, garden
 * row or seed packet that holds `clicked`), copied, for effects to start
 * from. Read before anything moves on (the confirm dialog opening, the shop
 * closing).
 */
const chosenArt = (clicked: Element | null): Captured | null => {
  if (!clicked || !clicked.isConnected) return null;
  const holder = clicked.closest(".pip-shop-tile, .pip-shop-card, .pip-shop-detail, .pip-garden-row, .pip-packet") ?? clicked;
  return capture(holder.querySelector(".pip-shop-art, .pip-shop-card-art, .pip-shop-detail-art, .pip-garden-art, .pip-packet-art") ?? holder);
};

/** Where an element is inside `ancestor`, by layout (a zoom still animating does not move it). */
const offsetWithin = (element: HTMLElement, ancestor: HTMLElement): Rect => {
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = element;
  while (node && node !== ancestor) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { left, top, width: element.offsetWidth, height: element.offsetHeight };
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

/** A purchase worth asking about: the question, the purchase, and what happens once it is made. */
type AskPlan = {
  /** "Buy Top Hat?" unless said otherwise. */
  title?: string;
  /** "Buy", "Give", "Plant", "Open", "Dig". */
  verb?: string;
  note?: string | null;
  /** The purchase itself, when it is not a plain buy (a snack is fed, a packet planted). */
  pay?: () => Promise<void>;
  /** Just before paying: whatever must be held as it was until the thing arrives. */
  before?: (from: Captured | null) => void;
  delivery?: Delivery;
  after?: (from: Captured | null) => Promise<void> | void;
};

/** A quick purchase: the thing happens now, and is bought once the toast's time is up. */
type QuickPlan = {
  /** For the toast: "Cookie for Pip". */
  label?: string;
  /** Shows the result before it is bought. */
  show: (from: Captured | null) => void;
  /** Makes the purchase, and whatever follows it (wear it, place it). */
  make: () => Promise<void>;
  /** Runs as the wallet takes the seeds, in the same render: the page's stand-ins can go. */
  landed?: () => void;
  /** Takes back what `show` did: an undo, or a refusal. */
  hide: () => void;
};

type QuickItem = GraceItem & { label: string; price: number; art: ReactNode };

type Act = SceneAct & { reactionId?: number };
type Preview = { entry: ShopEntry; look: PreviewLook };

export type PipPageProps = {
  showToast: (message: string) => void;
};

/**
 * Pip's own tab: Pip's house, the whole page, played like a game.
 *
 * The current floor fills the page and Pip lives in it: strolling, doing its
 * signature move, carried about, poked. Over it, the reader's seeds and Pip's
 * mood (and a goal pinned from the shop); under it, one rail of tools: the
 * shop (the one place seeds are spent), Pip's things (what Pip owns, to wear,
 * give and do), the garden, and decorating, which turns the scene into a
 * mode of its own. A lift up the side rides between floors: the bedroom and
 * the garden are free; each floor above opens after the one below and some
 * focus sessions, for seeds.
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
  const { reaction, suspended, finishReaction, setOnStage, tour } = usePipStore(
    useShallow((state) => ({
      reaction: state.reaction,
      suspended: state.suspended,
      finishReaction: state.finishReaction,
      setOnStage: state.setOnStage,
      tour: state.tour
    }))
  );
  const books = useLibraryStore((state) => state.books);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  // The tab of Pip's things last looked at, which it opens on again.
  const [thingsTab, setThingsTab] = useState<ThingsTabId>("looks");
  const [decorating, setDecorating] = useState(false);
  const [finishPanel, setFinishPanel] = useState<FinishPanel | null>(null);
  const [shopOpen, setShopOpen] = useState<ShopRequest | null>(null);
  // The spot being decorated when the shop was opened for it: a piece bought then goes there.
  const [shopSlot, setShopSlot] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [slotFocus, setSlotFocus] = useState<string | null>(null);
  const [pickerPlot, setPickerPlot] = useState<number | null>(null);
  const [arcadeOpen, setArcadeOpen] = useState(false);
  const [act, setAct] = useState<Act | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [floorId, setFloorId] = useState<string | null>(readFloor);
  const [walking, setWalking] = useState(false);
  const [goal, setGoalState] = useState<PinnedGoal | null>(() => readGoal(storage()));
  // A quick purchase shows at once and is made a few seconds later: until
  // then these stand in for it. Seeds spent but not yet taken from the
  // wallet, a snack's cheer not yet in the mood, a hat not yet bought, a
  // lamp not yet placed, a packet not yet planted.
  const [ahead, setAhead] = useState(0);
  const [moodAhead, setMoodAhead] = useState(0);
  const [pendingLook, setPendingLook] = useState<PreviewLook | null>(null);
  const [pendingDecor, setPendingDecor] = useState<{ level: string; slot: string; itemId: string } | null>(null);
  const [pendingPlant, setPendingPlant] = useState<{ plot: number; plant: string } | null>(null);
  const [toast, setToast] = useState<UndoToastItem | null>(null);
  // The room's box in the house's body, for the lift beside it and the HUD lined up with it.
  const [roomBox, setRoomBox] = useState<Rect | null>(null);
  const [reserve, setReserve] = useState(120);
  const actKey = useRef(1);
  const sceneRef = useRef<HouseSceneHandle | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const seedChipRef = useRef<HTMLButtonElement | null>(null);
  const heartsRef = useRef<HTMLButtonElement | null>(null);
  const decorateRef = useRef<HTMLButtonElement | null>(null);
  const goalRef = useRef<HTMLDivElement | null>(null);
  // Stand-ins that arrive after a flight check they are still wanted (not undone mid-air).
  const standIn = useRef(0);
  // While seeds are in the air the counter shows what it had, and counts up as
  // they land; hearts likewise wait for the hearts flying to them.
  const [heldSeeds, setHeldSeeds] = useState<number | null>(null);
  const [heldMood, setHeldMood] = useState<number | null>(null);
  // Plots shown as they were until the rain on them lands: plot -> growth then.
  const [rainHold, setRainHold] = useState<Record<number, { progress: number; ripe: boolean }> | null>(null);
  const [countMs, setCountMs] = useState(700);
  // Effects timed to Pip's current act (crumbs at each bite): a new act cancels them.
  const actTimers = useRef(new Set<number>());
  // What was last clicked on the page (by pointer or keyboard), for effects to
  // start from. Not the focused element: a click does not focus a button in
  // every webview.
  const lastClicked = useRef<Element | null>(null);
  const clickedArt = () => chosenArt(lastClicked.current);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

  // One quick purchase at a time waits out its toast (quickBuy.ts).
  const graceRef = useRef<ReturnType<typeof createGrace<QuickItem>> | null>(null);
  if (!graceRef.current) {
    graceRef.current = createGrace<QuickItem>({
      onChange: (pending: Pending<QuickItem> | null) =>
        setToast(pending ? { id: pending.id, label: pending.label, price: pending.price, art: pending.art, startedAt: pending.startedAt, endsAt: pending.endsAt } : null),
      onError: (cause) => showToastRef.current(errorText(cause))
    });
  }
  const grace = graceRef.current;

  // Pip lives here while the tab is open: the roaming Pip steps aside.
  useEffect(() => {
    setOnStage(true);
    return () => setOnStage(false);
  }, [setOnStage]);

  // Leaving the tab leaves no seed mid-air, and makes a quick purchase not taken back.
  useEffect(() => {
    const timers = actTimers.current;
    const pending = graceRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      clearEffects();
      void pending?.flush();
    };
  }, []);

  // Water may have been poured since startup (a session, a sync).
  useEffect(() => {
    void load();
  }, [load]);

  const state = overview?.state;
  const balance = overview?.wallet.balance ?? 0;
  /** Seeds to spend now: the wallet, less a quick purchase still in its grace period. */
  const spendable = balance - ahead;
  const mood = state?.mood ?? 70;
  /** The hearts: held while hearts fly to them, and with a snack's cheer counted as it is eaten. */
  const shownMood = heldMood ?? Math.min(100, mood + moodAhead);
  const hearts = Math.round(shownMood / 10) / 2;
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
    return level.fallback && !level.garden ? { ...found, wallpaper: state?.roomStyle || roomStyles()[0]?.id || null } : found;
  }, [layout, level, state?.roomStyle]);
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

  // ---- the look -----------------------------------------------------------------------------------

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

  // The house Pip: the reader's look, or the one being tried on, or one in its grace period.
  const shownVariant = preview?.look.variant ?? pendingLook?.variant ?? variant;
  const shownOutfit = preview?.look.outfit ?? pendingLook?.outfit ?? outfit;

  /** The thing's picture at a size: for the confirm, the toast and the goal. */
  const artFor = (kind: ShopKind, id: string, size: number): ReactNode => {
    const sprite = (move: string, skinId = variant, worn: readonly string[] = outfit) => (
      <PipSprite move={move} still size={size} skin={skinId} outfit={worn} snap="nearest" />
    );
    const image = (render: () => ImageData | null, key: string) => <PixelImage render={render} drawKey={`${key}-${size}`} box={size} />;
    switch (kind) {
      case "skin":
        return sprite("idle", id);
      case "accessory":
        return sprite("idle", variant, withAccessory(id));
      case "treat":
        return sprite(treats().find((entry) => entry.id === id)?.move ?? "idle");
      case "move":
        return sprite(id);
      case "room":
        return image(() => renderItem(id, 0), `item-${id}`);
      case "wallpaper":
      case "flooring":
        return image(() => renderFinish(kind === "wallpaper" ? "wallpaper" : "floor", id, 48, 48), `${kind}-${id}`);
      case "style":
        return image(() => renderRoom(id, 0), `style-${id}`);
      case "plant":
        return image(() => renderPacket(id, 0), `packet-${id}`);
      case "plot":
        return image(() => renderSoil(true), "soil");
      default:
        return <UiIcon name="home" size={Math.round(size * 0.5)} />;
    }
  };

  // ---- buying ---------------------------------------------------------------------------

  /** Where Pip is, for things that fly to Pip. */
  const toPip = () => sceneRef.current?.pip() ?? null;
  const tooDear = (item: { name: string; price: number }, have: number) => {
    const lacking = shortfall(item.price, have);
    if (lacking) showToast(`${plural(lacking.short, "more seed")} for ${item.name}: about ${plural(lacking.minutes, "minute")} of focused reading.`);
    return Boolean(lacking);
  };

  /**
   * Asks, buys, then delivers: a burst where it was chosen, the shop steps
   * aside, the thing flies to where it goes, and `after` runs as it lands
   * (wear it, place it, play it).
   */
  const purchase = async (item: ShopItem, plan: AskPlan = {}, chosen?: Captured | null) => {
    if (busy) return;
    // Where it was chosen, before the question takes the focus and the shop closes.
    const from = chosen !== undefined ? chosen : clickedArt();
    // A quick purchase still waiting is made first, so the question sees the true balance.
    await grace.flush();
    const have = usePipWardrobeStore.getState().overview?.wallet.balance ?? 0;
    if (tooDear(item, have)) return;
    const ok = await askPurchase({
      title: plan.title ?? `Buy ${item.name}?`,
      verb: plan.verb,
      note: plan.note,
      price: item.price,
      balance: have,
      art: artFor(item.kind, item.id, 96)
    });
    if (!ok) return;
    setBusy(true);
    try {
      plan.before?.(from);
      await (plan.pay ? plan.pay() : buy(item.kind, item.id));
      if (from) {
        const middle = centerOf(from.rect);
        ring(middle, Math.max(from.rect.width, from.rect.height) * 1.5);
        burst(middle, { px: 4, count: 14, sprite: "spark", spread: from.rect.width * 0.9, lift: 20, fall: 18 });
      }
      if (shopOpen) {
        // A beat to see the burst, then the shop steps aside for the delivery.
        await wait(reducedMotion() ? 0 : 200);
        closeShop();
      }
      const delivery = plan.delivery;
      if (delivery) {
        const target = delivery.to();
        await fly(from, target, { card: delivery.card, vanish: delivery.vanish });
        // Nothing flew (reduced motion, or it came from a button): sparkle where it landed.
        if (target && "width" in target && !from?.canvas) burst(centerOf(target), { px: 4, count: 10, sprite: "spark", spread: target.width, lift: 16 });
      }
      await plan.after?.(from);
      // Moves, treats, floors and plots show themselves off once bought; the rest get a thank-you.
      if (!["move", "treat", "level", "plot", "plant"].includes(item.kind)) {
        play("cheer", 1, delivery?.line ?? pickOne(THANKS));
      }
    } catch (cause) {
      showToast(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Makes a quick purchase that was already shown. The wallet's answer and
   * the page's own count change in the same render (a store listener, called
   * as the wallet updates), so the counter never counts the seeds twice.
   */
  const commitSpend = async (price: number, make: () => Promise<void>, landed?: () => void) => {
    let counted = false;
    const before = usePipWardrobeStore.getState().overview?.wallet.balance;
    const stop = usePipWardrobeStore.subscribe((next) => {
      if (!counted && next.overview && next.overview.wallet.balance !== before) {
        counted = true;
        setAhead((value) => value - price);
        landed?.();
      }
    });
    try {
      await make();
    } finally {
      stop();
      // Refused, or it cost nothing after all: the page stops counting it.
      if (!counted) {
        setAhead((value) => value - price);
        landed?.();
      }
    }
  };

  /** A quick purchase: shown now, bought when the toast's few seconds are up, unless undone. */
  const quickBuy = (item: ShopItem, plan: QuickPlan, chosen?: Captured | null) => {
    if (tooDear(item, spendable)) return;
    const from = chosen !== undefined ? chosen : clickedArt();
    let started = false;
    setAhead((value) => value + item.price);
    plan.show(from);
    grace.start({
      label: plan.label ?? item.name,
      price: item.price,
      art: artFor(item.kind, item.id, 32),
      commit: async () => {
        started = true;
        await commitSpend(item.price, plan.make, plan.landed);
      },
      revert: () => {
        if (!started) setAhead((value) => value - item.price);
        plan.hide();
      }
    });
  };

  /**
   * Spends by the shop's rules: under QUICK_BUY_UNDER at once with an undo,
   * dearer after a question. `chosen` is where it was picked, when that is
   * about to close (a packet picker) and could not be read later.
   */
  const spend = (item: ShopItem, ask: AskPlan, quick?: QuickPlan, chosen?: Captured | null) => {
    if (quick && isQuickBuy(item.price)) quickBuy(item, quick, chosen);
    else void purchase(item, ask, chosen);
  };

  const undo = useCallback((id: number) => {
    graceRef.current?.undo(id);
  }, []);

  const change = async (patch: Parameters<typeof setLook>[0]) => {
    try {
      await setLook(patch);
    } catch (cause) {
      showToast(errorText(cause));
    }
  };

  /** The layout as it is now in the store (after a purchase, the store has moved on). */
  const freshLayout = () => usePipWardrobeStore.getState().overview?.state.room ?? layout;

  const openShop = (request: ShopRequest, slotId: string | null = null) => {
    setPickerPlot(null);
    setShopSlot(slotId);
    setShopOpen(request);
  };
  const closeShop = () => {
    setShopOpen(null);
    setShopSlot(null);
  };

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

  // ---- decorating -------------------------------------------------------------------------

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

  // Escape leaves decorating (a sheet open in it closes first, on its own Escape).
  useEffect(() => {
    if (!decorating) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || shopOpen || slotFocus || finishPanel) return;
      stopDecorating();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decorating, shopOpen, slotFocus, finishPanel]);

  // ---- the garden --------------------------------------------------------------------------

  const garden = overview?.garden;
  const plotCount = garden?.plots ?? 3;
  const growing = (plot: number): PlantState | undefined => garden?.plants.find((entry) => entry.plot === plot && !entry.harvested);
  const nextPlot = EXTRA_PLOTS.find((entry) => !owns("plot", entry.id)) ?? null;
  const scenePlots: ScenePlot[] = [
    ...Array.from({ length: plotCount }, (_, index) => {
      const here = growing(index + 1);
      const held = here ? rainHold?.[index + 1] : undefined;
      // A packet in its grace period is in the ground already.
      const sown = !here && pendingPlant?.plot === index + 1 ? pendingPlant.plant : null;
      return {
        plot: index + 1,
        plant: here?.plant ?? sown,
        progress: held ? held.progress : here ? Math.min(1, here.water / Math.max(1, here.need)) : 0,
        ripe: held ? held.ripe : Boolean(here?.ripe)
      };
    }),
    ...(nextPlot ? [{ plot: plotCount + 1, plant: null, progress: 0, ripe: false, locked: true, price: priceOf("plot", nextPlot.id) }] : [])
  ];
  const minutesLeft = (here: PlantState) => Math.max(1, Math.ceil(here.need - here.water));
  const plotLabel = (plot: ScenePlot) => {
    if (plot.locked) return `Dig a new plot: ${nextPlot ? priceOf("plot", nextPlot.id) : 0} seeds`;
    const here = growing(plot.plot);
    if (!here) return plot.plant ? `Plot ${plot.plot}: just planted.` : `Plot ${plot.plot}: empty. Select to plant a seed.`;
    const name = plantInfo(here.plant)?.name ?? here.plant;
    return here.ripe ? `Plot ${plot.plot}: ${name}, ripe! Select to pick it.` : `Plot ${plot.plot}: ${name}, ${plural(minutesLeft(here), "more minute")} of focus.`;
  };

  // Reading waters the garden out of sight (in the reader, on other days).
  // When the garden is next on screen, what it took rains down on the plots it
  // went to, then their growth catches up: the bars fill, a plant that grew a
  // stage stretches, one that ripened sparkles. Not while a book covers the
  // tab: the rain waits for the reader to come back.
  const onGarden = Boolean(level.garden);
  useEffect(() => {
    if (!onGarden || !garden || suspended) return;
    const seen = readSeen();
    const planted = garden.plants.filter((entry) => !entry.harvested);
    const remember = () => writeSeen(Object.fromEntries(planted.map((entry) => [entry.id, entry.water])));
    const watered = planted
      .filter((entry) => seen[entry.id] !== undefined && entry.water - seen[entry.id] >= 1)
      .sort((a, b) => a.plot - b.plot);
    if (watered.length === 0 || reducedMotion()) {
      remember();
      return;
    }
    // The plots show their old growth from the start; the rain begins once a
    // floor that slid in has settled.
    setRainHold(
      Object.fromEntries(
        watered.map((entry) => [entry.plot, { progress: Math.min(1, seen[entry.id] / Math.max(1, entry.need)), ripe: seen[entry.id] >= entry.need }])
      )
    );
    let current = true;
    const timer = window.setTimeout(() => {
      remember();
      const falling = sceneRef.current?.rain(watered.map((entry) => ({ plot: entry.plot, gained: entry.water - seen[entry.id] })));
      void (falling ?? Promise.resolve()).then(() => {
        if (current) setRainHold(null);
      });
    }, 450);
    return () => {
      current = false;
      window.clearTimeout(timer);
      setRainHold(null);
    };
  }, [onGarden, garden, suspended]);

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
    setHeldSeeds(spendable);
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

  /** A packet planted: the seed arcs from the packet into the plot, and a shoot comes up. */
  const sow = (plot: number, plantId: string) => {
    const item = catalogueItem("plant", plantId);
    const info = plantInfo(plantId);
    if (!item || !info) return;
    // The packet's picture first: the picker it is in closes now.
    const packet = clickedArt();
    setPickerPlot(null);
    const planted = `${info.name.toLowerCase()} planted. ${info.water} minutes of reading and it's ripe.`;
    spend(
      item,
      {
        title: `Plant ${aOrAn(info.name)}?`,
        verb: "Plant",
        note: `${info.water} minutes of focus to ripen, then ${info.yield} seeds.`,
        pay: () => plant(plot, plantId),
        before: (from) => sceneRef.current?.expectSprout(plot, Boolean(from?.canvas)),
        after: (from) => {
          sceneRef.current?.sow(plot, from);
          play("idea", 1, planted);
        }
      },
      {
        label: `${info.name} in plot ${plot}`,
        show: (from) => {
          sceneRef.current?.expectSprout(plot, Boolean(from?.canvas));
          setPendingPlant({ plot, plant: plantId });
          sceneRef.current?.sow(plot, from);
          play("idea", 1, planted);
        },
        make: () => plant(plot, plantId),
        landed: () => setPendingPlant((current) => (current?.plot === plot ? null : current)),
        hide: () => {
          setPendingPlant((current) => (current?.plot === plot ? null : current));
          const bed = sceneRef.current?.plotBox(plot);
          if (bed) puff({ x: bed.left + bed.width / 2, y: bed.top + bed.height * 0.8 }, { px: sceneRef.current?.pixel() ?? 4, count: 6, spread: bed.width * 0.6 });
          play("nervous", 1, "okay. back in the packet.");
        }
      },
      packet
    );
  };

  const digPlot = () => {
    if (!nextPlot) return;
    const item = catalogueItem("plot", nextPlot.id);
    const ordinal = ORDINALS[plotCount] ?? "new";
    if (item) void purchase(item, { title: `Dig a ${ordinal} plot?`, verb: "Dig", after: () => play("cheer", 1, "a new plot! room for one more.") });
  };

  const onPlot = (plot: ScenePlot) => {
    if (plot.locked) {
      digPlot();
      return;
    }
    const here = growing(plot.plot);
    if (here?.ripe) {
      void pick(here);
      return;
    }
    if (!here && !plot.plant) {
      setPickerPlot(plot.plot);
      return;
    }
    setDrawer("garden");
  };

  /** "Plant" from the garden list: the picker opens over the plot, riding up to the garden first. */
  const plantAt = (plot: number) => {
    if (gardenLevel && level.id !== gardenLevel.id) {
      goToFloor(gardenLevel);
      window.setTimeout(() => setPickerPlot(plot), reducedMotion() ? 50 : 450);
    } else {
      setPickerPlot(plot);
    }
    setDrawer(null);
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
          if (mouth && pip) spill(mouth, pip.bottom + pip.height * 0.02, { px: Math.max(3, scene.pixel() * 1.25), colors: [crumb] });
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

  /** Pip eats or plays: one snack is one snack; a toy is played with twice. */
  const enjoy = (treat: PipTreat) => {
    const food = treat.kind === "food";
    play(treat.move, food ? 1 : 2, pickOne(food ? FOOD_LINES : TOY_LINES));
    setHeldMood(shownMood);
    treatEffects(treat);
  };

  /**
   * A toy Pip owns: no purchase, just the play (Rust adds its cheer). Also
   * what follows buying one, so it must not ask whether Pip owns it: the
   * render that bought it has not seen that yet.
   */
  const playToy = async (treat: PipTreat) => {
    setHeldMood(shownMood);
    try {
      await feed(treat.id);
      enjoy(treat);
    } catch (cause) {
      setHeldMood(null);
      showToast(errorText(cause));
    }
  };

  /**
   * Gives Pip a treat. A toy Pip owns is free to play with. A snack is bought
   * as it is given, by the shop's rules: most are a handful of seeds, so Pip
   * eats at once and the toast can take it back; a dearer one asks first.
   */
  const give = async (treat: PipTreat) => {
    const food = treat.kind === "food";
    const item = catalogueItem("treat", treat.id);
    if (!item) return;
    if (!food) {
      if (!owns("treat", treat.id)) {
        buyThing("treat", treat.id);
        return;
      }
      if (busy) return;
      setBusy(true);
      try {
        await playToy(treat);
      } finally {
        setBusy(false);
      }
      return;
    }
    const gain = item.mood ?? 0;
    // The hearts show the old mood until the new hearts reach them.
    const held = shownMood;
    spend(
      item,
      {
        title: `Give Pip ${aOrAn(treat.name)}?`,
        verb: "Give",
        note: "A snack is bought as it's given. It cheers Pip up.",
        before: () => setHeldMood(held),
        pay: () => feed(treat.id),
        after: () => {
          play(treat.move, 1, pickOne(FOOD_LINES));
          setHeldMood(held);
          treatEffects(treat);
        }
      },
      {
        label: `${treat.name} for Pip`,
        show: () => {
          setMoodAhead((value) => value + gain);
          enjoy(treat);
        },
        make: () => feed(treat.id),
        landed: () => setMoodAhead((value) => value - gain),
        hide: () => {
          setMoodAhead((value) => value - gain);
          play("nervous", 1, "oh. okay, maybe later.");
          setHeldMood(null);
        }
      }
    );
  };

  // ---- buying from the shop, and elsewhere ---------------------------------------------------

  /** The wall and the floor of the room on screen: where wallpaper and flooring fly to. */
  const roomPart = (part: "wall" | "floor"): Box | null => {
    const room = sceneRef.current?.room();
    if (!room) return null;
    return part === "wall"
      ? { left: room.left + room.width * 0.35, top: room.top + room.height * 0.2, width: room.width * 0.3, height: room.height * 0.3 }
      : { left: room.left + room.width * 0.35, top: room.top + room.height * 0.84, width: room.width * 0.3, height: room.height * 0.12 };
  };

  /**
   * Buys a thing by the shop's rules, and sends it where it goes: a look or a
   * move to Pip (who puts it on, or shows it off), decor into a free spot,
   * paper to the wall, a floor to its door. `bought` runs first (a preview
   * ending as the look it showed becomes Pip's own).
   */
  const buyThing = (kind: ShopKind, id: string, bought?: () => void) => {
    const item = catalogueItem(kind, id);
    if (!item) return;
    const toWear: Delivery = { to: toPip, card: true, vanish: true };
    const done = (then?: (from: Captured | null) => Promise<void> | void) => async (from: Captured | null) => {
      bought?.();
      await then?.(from);
    };
    switch (kind) {
      case "accessory": {
        const mine = ++standIn.current;
        spend(
          item,
          { delivery: toWear, after: done(() => wearAccessory(id)) },
          {
            show: (from) => {
              bought?.();
              if (shopOpen) closeShop();
              // The hat flies to Pip, who spins into it as it lands.
              void fly(from, toPip(), { card: true, vanish: true }).then(() => {
                if (standIn.current === mine) {
                  setPendingLook({ outfit: withAccessory(id) });
                  play("cheer", 1, pickOne(THANKS));
                }
              });
            },
            // Bought and worn; the stand-in look goes once the real one matches it (below).
            make: async () => {
              await buy("accessory", id);
              await wearAccessory(id);
            },
            hide: () => {
              if (standIn.current === mine) standIn.current += 1;
              setPendingLook(null);
              play("look", 1, "back it goes.");
            }
          }
        );
        return;
      }
      case "treat": {
        const treat = treats().find((entry) => entry.id === id);
        if (!treat) return;
        if (treat.kind === "food") {
          if (shopOpen) closeShop();
          void give(treat);
          return;
        }
        const mine = ++standIn.current;
        spend(
          item,
          { delivery: toWear, after: done(() => playToy(treat)) },
          {
            show: (from) => {
              if (shopOpen) closeShop();
              void fly(from, toPip(), { card: true, vanish: true }).then(() => {
                if (standIn.current === mine) enjoy(treat);
              });
            },
            // Bought, then played with: the play is what cheers Pip (Rust adds the mood).
            make: async () => {
              await buy("treat", id);
              await feed(id);
            },
            hide: () => {
              if (standIn.current === mine) standIn.current += 1;
              play("nervous", 1, "oh. okay, maybe later.");
              setHeldMood(null);
            }
          }
        );
        return;
      }
      case "room": {
        const plan = deliverDecor(id, shopSlot);
        const mine = ++standIn.current;
        spend(
          item,
          { delivery: plan.delivery, after: done(plan.after) },
          {
            show: (from) => {
              if (shopOpen) closeShop();
              const spot = plan.spot;
              void fly(from, plan.delivery.to(), { card: plan.delivery.card, vanish: plan.delivery.vanish }).then(() => {
                if (standIn.current !== mine) return;
                if (spot) setPendingDecor({ level: level.id, slot: spot.id, itemId: id });
                else bump(decorateRef.current);
                // Without a free spot it waits in Decorate, which is not opened for it: it is not bought yet.
                play("cheer", 1, spot ? plan.delivery.line ?? pickOne(THANKS) : "it's yours. find it a spot in decorate.");
              });
            },
            make: async () => {
              await buy("room", id);
              if (plan.spot) await placeIn(plan.spot, id, freshLayout());
              setPendingDecor(null);
            },
            hide: () => {
              if (standIn.current === mine) standIn.current += 1;
              setPendingDecor(null);
              play("look", 1, "back in the box.");
            }
          }
        );
        return;
      }
      case "skin":
        spend(item, { delivery: toWear, after: done(() => setLook({ variant: id })) });
        return;
      case "move":
        spend(item, { delivery: toWear, after: done(() => play(id, 2, `new move: ${item.name.toLowerCase()}.`)) });
        return;
      case "level": {
        const next = levels.find((floor) => floor.id === id);
        if (next) openFloor(next);
        return;
      }
      case "plot":
        digPlot();
        return;
      case "style":
        spend(item, { delivery: { to: () => roomPart("wall"), card: true, vanish: true }, after: done(() => setLook({ roomStyle: id })) });
        return;
      case "wallpaper":
        spend(item, { delivery: { to: () => roomPart("wall"), card: true, vanish: true }, after: done(() => setFinish("wallpaper", id, freshLayout())) });
        return;
      case "flooring":
        spend(item, { delivery: { to: () => roomPart("floor"), card: true, vanish: true }, after: done(() => setFinish("floor", id, freshLayout())) });
        return;
      default:
        spend(item, { after: done() });
    }
  };

  // A look bought and worn for real: the stand-in has done its job.
  useEffect(() => {
    if (!pendingLook) return;
    const bought = (pendingLook.outfit ?? []).every((id) => outfit.includes(id)) && (!pendingLook.variant || pendingLook.variant === variant);
    if (bought) setPendingLook(null);
  }, [pendingLook, outfit, variant]);

  const onShopPreview = (entry: ShopEntry) => {
    if (!entry.preview) return;
    const reopen = shopOpen;
    setPreview({ entry, look: entry.preview });
    closeShop();
    setDrawer(null);
    play(entry.preview.move ?? "cheer", 2, pickOne(["how do i look?", "ooh. fancy.", "is this me?"]));
    previewFrom.current = reopen;
  };
  const previewFrom = useRef<ShopRequest | null>(null);
  const endPreview = (back: boolean) => {
    setPreview(null);
    if (back) setShopOpen(previewFrom.current ?? { tab: "variants" });
  };

  // ---- the goal ---------------------------------------------------------------------------------

  const setGoal = (next: PinnedGoal | null) => {
    setGoalState(next);
    writeGoal(storage(), next);
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

  // ---- the shop's entries -----------------------------------------------------------------------

  const priceTag = (price: number) => <PriceTag price={price} balance={spendable} />;
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
  const wallKind = house ? "wallpaper" : "style";

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

  const onShopBuy = (entry: ShopEntry) => buyThing(entry.kind, entry.id);

  // ---- the goal, in the HUD -----------------------------------------------------------------------

  const goalEntry = goal ? entryFor(goal.kind, goal.id) : null;
  const goalItem = goal ? catalogueItem(goal.kind, goal.id) : null;
  const goalLock = goalEntry?.locked ?? null;
  const progress = goalItem ? goalProgress(goalItem.price, balance) : null;

  // A goal comes within reach (a cheer, once), slips out of it, or is bought (done).
  useEffect(() => {
    if (!goal || !overview) return;
    if (!goalItem) {
      setGoal(null);
      return;
    }
    const { goal: next, event } = stepGoal(goal, { owned: owns(goal.kind, goal.id), ready: balance >= goalItem.price && !goalLock });
    if (next !== goal) setGoal(next);
    if (event === "affordable" && !suspended) {
      const chip = goalRef.current?.getBoundingClientRect();
      if (chip) confetti({ left: chip.left - 20, top: chip.top - 10, width: chip.width + 40, height: chip.height + 80 }, { px: 3, count: 28 });
      bump(goalRef.current, 1.2);
      play("cheer", 1, `enough seeds for the ${goalItem.name.toLowerCase()}!`);
    }
    // The goal's own fields and the wallet are what move it on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal, balance, overview, goalLock, suspended]);

  const pinGoal = (entry: ShopEntry | null) => {
    if (!entry) {
      setGoal(null);
      return;
    }
    // Already within reach when pinned: nothing to cheer later.
    setGoal({ kind: entry.kind, id: entry.id, cheered: balance >= entry.price });
    play("idea", 1, `saving up for the ${entry.name.toLowerCase()}.`);
  };

  const openGoal = () => {
    if (!goal) return;
    const category = shopCategories.find((entry) => entry.entries.some((candidate) => candidate.kind === goal.kind && candidate.id === goal.id));
    openShop({ tab: category?.id ?? "variants", item: `${goal.kind}:${goal.id}` });
  };

  // ---- Pip's things -----------------------------------------------------------------------------

  const wardrobeTile = (entry: PipSkin) => {
    const owned = owns("skin", entry.id);
    const worn = entry.id === shownVariant;
    const earned = isEarnedOnly(entry);
    return (
      <Tile
        key={entry.id}
        selected={worn}
        name={entry.name}
        hint={entry.blurb ?? entry.unlock}
        label={`${entry.name}. ${worn ? "Wearing." : owned ? "Select to wear it." : `Locked. Earned by reading: ${entry.unlock}`}`}
        art={(hot) => <PipSprite move="idle" still={!hot && !worn} size={72} snap="nearest" skin={entry.id} outfit={outfit} />}
        status={worn ? <Status icon="check">Wearing</Status> : owned ? <Status>Wear</Status> : <Status icon="lock">Locked</Status>}
        onSelect={() => {
          if (worn) return;
          if (owned) void change({ variant: entry.id });
          else if (earned) showToast(`${entry.name} is earned, not bought: ${entry.unlock}`);
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
        status={worn ? <Status icon="check">Wearing</Status> : <Status>Wear</Status>}
        onSelect={() => void change({ outfit: worn ? outfit.filter((id) => id !== entry.id) : withAccessory(entry.id) })}
      />
    );
  };

  const ownedAccessories = accessories().filter((entry) => owns("accessory", entry.id));
  const looksBody = (
    <>
      <Group title="Variants" tally={tallies.variants}>
        {SKINS.filter((entry) => owns("skin", entry.id)).map(wardrobeTile)}
      </Group>
      {ownedAccessories.length > 0 ? (
        SLOTS.map(({ slot: which, label, covered }) => {
          const items = ownedAccessories.filter((entry) => entry.slot === which);
          if (items.length === 0) return null;
          const hidden = slotCovered(skin, which);
          return (
            <Group key={which} title={label} note={hidden ? `${skin?.name ?? "This variant"} ${covered}: ${label.toLowerCase()} pieces stay off for now.` : undefined}>
              {items.map(accessoryTile)}
            </Group>
          );
        })
      ) : (
        <Empty>No accessories yet: hats, glasses and capes are in the shop.</Empty>
      )}
      <Group title="Earned by reading" note="Never sold, only earned.">
        {SKINS.filter((entry) => isEarnedOnly(entry) && !owns("skin", entry.id)).map(wardrobeTile)}
      </Group>
    </>
  );

  const treatTile = (entry: PipTreat) => {
    const food = entry.kind === "food";
    const price = priceOf("treat", entry.id);
    return (
      <Tile
        key={entry.id}
        name={entry.name}
        label={`${entry.name}. ${food ? `Give Pip one for ${price} seeds.` : "Play with Pip."} Cheers Pip up.`}
        art={(hot) => <PipSprite move={entry.move} still={!hot} size={72} snap="nearest" skin={variant} outfit={outfit} />}
        status={food ? priceTag(price) : <Status icon="heart">Play</Status>}
        onSelect={() => void give(entry)}
      />
    );
  };
  const ownedToys = treats().filter((entry) => entry.kind === "toy" && owns("treat", entry.id));
  const treatsBody = (
    <>
      <Hints>
        <Hint icon="heart" more="Every treat cheers Pip up: the hearts fill.">
          Treats cheer Pip up
        </Hint>
        <Hint icon="seed" more="A snack is bought each time you give it; a toy is bought once.">
          Snacks cost each time
        </Hint>
      </Hints>
      <Group title="Snacks">{treats().filter((entry) => entry.kind === "food").map(treatTile)}</Group>
      <Group title="Toys" tally={tallies.treats}>
        {ownedToys.length > 0 ? ownedToys.map(treatTile) : <p className="col-span-full text-xs text-on-surface-variant">No toys yet.</p>}
      </Group>
    </>
  );

  const movesBody = (
    <>
      <Hints>
        <Hint icon="sparkle" more="Your signature is Pip's idle flourish and your profile picture's move.">
          Signature: Pip's idle move
        </Hint>
        <Hint icon="heart" more="Celebrations stay free: Pip cheers your goals with every move it knows.">
          Cheers are always free
        </Hint>
      </Hints>
      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(9.5rem, 1fr))" }}>
        {moveList
          .filter((entry) => owns("move", entry.id))
          .map((entry) => {
            const chosen = entry.id === signature;
            const name = moveName(entry.id);
            return (
              <MoveCard
                key={entry.id}
                name={name}
                art={(hot) => <PipSprite move={entry.id} still={!hot && !chosen} size={72} snap="nearest" skin={variant} outfit={outfit} />}
                selected={chosen}
                status={chosen ? <Status icon="check">Signature</Status> : <Status>{entry.price === 0 ? "Free" : "Yours"}</Status>}
                previewLabel="Do it"
                onPreview={() => play(entry.id, 2)}
                action={chosen ? null : { label: "Signature", run: () => void change({ signature: entry.id }).then(() => play(entry.id, 1, "my new signature move.")) }}
              />
            );
          })}
      </div>
    </>
  );

  const thingsTabs: ThingsTab[] = [
    {
      id: "looks",
      label: "Looks",
      icon: "outfit",
      tally: { owned: tallies.variants.owned + tallies.wardrobe.owned, total: tallies.variants.total + tallies.wardrobe.total },
      body: looksBody,
      more: { label: "More looks in the shop", open: () => openShop({ tab: ownedAccessories.length < accessories().length ? "wardrobe" : "variants" }) }
    },
    { id: "treats", label: "Treats", icon: "treat", tally: tallies.treats, body: treatsBody, more: { label: "More toys in the shop", open: () => openShop({ tab: "treats" }) } },
    { id: "moves", label: "Moves", icon: "move", tally: tallies.moves, body: movesBody, more: { label: "More moves in the shop", open: () => openShop({ tab: "moves" }) } }
  ];

  // ---- decorating's sheets -----------------------------------------------------------------------

  // What Decorate offers is what Pip owns; the shop has the rest. It used to
  // sell the whole catalogue here too, book nods and all, that the shop keeps back.
  const onSale = (item: PipRoomItem) => FEATURES.fullPipHouse || (!item.nod && STARTER_DECOR.has(item.id));
  const fitting = slot ? allRoomItems.filter((item) => fitsSlot(item, slot, level.id)) : [];
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

  const slotSheet = slot ? (
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
  ) : null;

  const ownedWalls = walls.filter((entry) => owns(wallKind, entry.id));
  const ownedFloors = floorings().filter((entry) => owns("flooring", entry.id));
  const finishSheet =
    finishPanel === "wallpaper" ? (
      <>
        <Group title={house ? "Your wallpaper" : "Your room styles"}>{ownedWalls.map((entry) => finishTile(wallKind, entry))}</Group>
        {shopLink(walls.length - ownedWalls.length, house ? "wallpapers" : "room styles", () => openShop({ tab: "walls" }))}
      </>
    ) : finishPanel === "flooring" ? (
      <>
        <Group title="Your flooring">{ownedFloors.map((entry) => finishTile("flooring", entry))}</Group>
        {shopLink(floorings().length - ownedFloors.length, "floorings", () => openShop({ tab: "walls" }))}
      </>
    ) : null;

  // ---- the garden's and the wallet's drawers ----------------------------------------------------

  const barrel = garden ? Math.round(garden.barrel) : 0;
  const gardenPanel = (
    <>
      <Hints>
        <Hint icon="water" more="Reading in focus is water: a minute each, half as much again when a session runs to the end.">
          1 focus minute = 1 water
        </Hint>
        <Hint icon="garden" more="Water flows to the oldest planting first.">
          Oldest plant drinks first
        </Hint>
        <Hint icon="heart" more="Plants wait for you, however long you're away.">
          Nothing withers
        </Hint>
        <span className="seed-chip water-chip" title="Water waiting for a plant to drink it">
          <UiIcon name="water" size={12} />
          Barrel <CountUp value={barrel} /> / {garden?.barrelCap ?? 120}
        </span>
      </Hints>
      {gardenLevel && level.id !== gardenLevel.id && (
        <button type="button" className="pip-key mt-3" onClick={() => goToFloor(gardenLevel)}>
          <UiIcon name="up" size={15} />
          Ride up to the garden
        </button>
      )}
      <div className="mt-3 grid gap-2">
        {Array.from({ length: plotCount }, (_, index) => {
          const plot = index + 1;
          const here = growing(plot);
          const info = here ? plantInfo(here.plant) : null;
          return (
            <div key={plot} className="pip-garden-row">
              <span className="pip-garden-art">
                {/* An empty plot is its dug bed, not somebody else's sunflower. */}
                <PixelImage render={() => (here ? renderPacket(here.plant, 0) : renderSoil(true))} drawKey={`plot-${here?.plant ?? "empty"}`} box={36} />
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
                <button type="button" className="pip-key pip-key-primary pip-key-small" onClick={() => void pick(here)}>
                  Pick
                </button>
              ) : !here ? (
                <button type="button" className="pip-key pip-key-small" aria-haspopup="dialog" onClick={() => plantAt(plot)}>
                  Plant
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {nextPlot && (
        <p className="mt-3 text-xs text-on-surface-variant">
          <UiIcon name="plus" size={12} className="mr-1 inline" />
          Dig more plots from the dashed bed in the garden ({priceOf("plot", nextPlot.id)} seeds).
        </p>
      )}
    </>
  );

  const earned = overview?.wallet.earned;
  const mePanel = (
    <>
      <p className="flex items-center gap-2 font-headline text-4xl font-bold tabular-nums text-on-surface">
        <UiIcon name="seed" size={26} className="text-primary" />
        <CountUp value={spendable} />
      </p>
      <Hints>
        <Hint icon="garden" more="Reading in focus waters Pip's garden; ripe plants are picked for seeds.">
          Seeds grow in the garden
        </Hint>
        <Hint icon="sparkle" more="Goal days add a few more seeds, and a few more still on a streak.">
          Goal days add more
        </Hint>
        <Hint icon="game" more="Games cheer Pip up a little each day, but never pay seeds.">
          Games never pay seeds
        </Hint>
      </Hints>
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
          <dd>−{(overview?.wallet.spent ?? 0) + ahead}</dd>
          <dt>Water poured, all told</dt>
          <dd>{Math.round(garden?.water ?? 0)}</dd>
        </dl>
      )}
      <div className="section-rule mt-4 pt-3">
        <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Mood: {moodWord(shownMood)}</p>
        <Hints>
          <Hint icon="heart" more="Reading sessions, treats and harvests cheer Pip up; so do games, a little each day.">
            Reading and treats cheer Pip
          </Hint>
          <Hint icon="moon" more="Pip's mood drifts down slowly on days away, and only ever mopes.">
            Drifts slowly when away
          </Hint>
        </Hints>
      </div>
      <button type="button" className="pip-key mt-4" onClick={() => startWalk()}>
        <UiIcon name="help" size={15} />
        Show me around again
      </button>
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

  const openDrawer = (id: Drawer) => {
    setPickerPlot(null);
    setDrawer((current) => (current === id ? null : id));
  };

  // The sheet on screen: a drawer, or while decorating, what goes in a spot.
  const sheet: { key: string; title: string; note?: ReactNode; size?: "short"; body: ReactNode; close: () => void } | null = decorating
    ? slot
      ? { key: `slot-${slot.id}`, title: slotName(slot), note: "Select a piece to put it here.", size: "short", body: slotSheet, close: () => setSlotFocus(null) }
      : finishPanel
        ? {
            key: finishPanel,
            title: finishPanel === "wallpaper" ? (house ? "Wallpaper" : "Room style") : "Flooring",
            note: `For the ${level.name}.`,
            size: "short",
            body: finishSheet,
            close: () => setFinishPanel(null)
          }
        : null
    : drawer === "things"
      ? { key: "things", title: "Pip's things", note: "What Pip has: wear it, give it, do it.", body: <PipThings tabs={thingsTabs} initial={thingsTab} onTab={(id) => setThingsTab(id as ThingsTabId)} />, close: () => setDrawer(null) }
      : drawer === "garden"
        ? { key: "garden", title: "Garden", note: "Where seeds come from.", body: gardenPanel, close: () => setDrawer(null) }
        : drawer === "me"
          ? { key: "me", title: "Seeds and mood", body: mePanel, close: () => setDrawer(null) }
          : null;

  // ---- the walkthrough ---------------------------------------------------------------------------

  const startWalk = () => {
    setDrawer(null);
    stopDecorating();
    closeShop();
    setPickerPlot(null);
    setPreview(null);
    setWalking(true);
  };

  // The first visit: once the house has loaded, and not over the app's own tour.
  const loaded = overview !== null;
  useEffect(() => {
    if (!loaded || walking || tour !== null || suspended || walkSeen(storage())) return;
    const timer = window.setTimeout(() => {
      markWalkSeen(storage());
      setWalking(true);
    }, 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, tour, suspended]);

  const findWalk = (target: WalkTarget): Element | null =>
    target === "plot"
      ? document.querySelector('.pip-plot[data-state="empty"]') ?? document.querySelector(".pip-plot:not([data-state='locked'])")
      : document.querySelector(`[data-walk="${target}"]`);

  // The plot's step rides up to the garden first, and waits for the floor to slide in.
  const prepareWalk = async (step: WalkStep) => {
    if (step.target !== "plot" || !gardenLevel || levelRef.current.id === gardenLevel.id) return;
    goToFloor(gardenLevel);
    await wait(reducedMotion() ? 80 : 520);
  };

  // ---- the page -----------------------------------------------------------------------------------

  const ripe = garden?.plants.filter((entry) => entry.ripe && !entry.harvested).length ?? 0;

  // Seeds coming and going outside a harvest (a purchase, a reading session
  // finishing while the tab is open): the counter dips or bumps, and says by
  // how much. A quick purchase counts as it is shown, not again when it is made.
  const lastBalance = useRef<number | null>(loaded ? spendable : null);
  useEffect(() => {
    const before = lastBalance.current;
    lastBalance.current = loaded ? spendable : null;
    if (before === null || before === spendable || heldSeeds !== null) return;
    const chip = seedChipRef.current;
    const box = chip?.getBoundingClientRect();
    if (!chip || !box) return;
    const change = spendable - before;
    if (change > 0) {
      floatText({ x: box.left + box.width / 2, y: box.top }, `+${change}`, "gain");
      bump(chip);
    } else {
      floatText({ x: box.left + box.width / 2, y: box.bottom + 4 }, `−${-change}`, "spend");
      dip(chip);
    }
    // Only a new balance matters; the hold is read as it stands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spendable, loaded]);

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

  // Where the room is, for the lift beside it and the HUD lined up with it.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => {
      const room = body.querySelector<HTMLElement>(".pip-house-room");
      if (!room) return;
      const next = offsetWithin(room, body);
      setRoomBox((current) =>
        current && current.left === next.left && current.top === next.top && current.width === next.width && current.height === next.height ? current : next
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    body.querySelectorAll(".pip-house-stage, .pip-house-room").forEach((element) => observer.observe(element));
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Room kept under the scene: the rail, and a sheet at the bottom of a narrow
  // window, so the room shrinks to sit above them rather than under them.
  const sheetKey = sheet?.key ?? null;
  useLayoutEffect(() => {
    const measure = () => {
      const rail = railRef.current?.offsetHeight ?? 72;
      const panel = drawerRef.current;
      const low = panel && getComputedStyle(panel).position === "fixed" ? panel.offsetHeight + 12 : 0;
      const next = rail + BELOW_RAIL + low;
      setReserve((current) => (Math.abs(current - next) < 2 ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (railRef.current) observer.observe(railRef.current);
    if (drawerRef.current) observer.observe(drawerRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [sheetKey, decorating]);

  // The top bar and the rail line up with the room and its lift. Not while a
  // sheet is open: the sheet shrinks the room, and a HUD that followed it
  // could wrap onto another line, taking height that shrinks the room again.
  const frame =
    roomBox && !sheet
      ? ({ "--frame-left": `${roomBox.left}px`, "--frame-width": `${roomBox.width + (levels.length > 1 ? LIFT_GAP + 44 : 0)}px` } as CSSProperties)
      : undefined;
  const plots = level.garden ? scenePlots : undefined;
  const pickerAnchor = () => (pickerPlot === null ? null : sceneRef.current?.plotBox(pickerPlot) ?? null);

  return (
    <div
      className="pip-house-page"
      onClickCapture={(event) => {
        lastClicked.current = event.target instanceof Element ? event.target : null;
      }}
    >
      <h2 className="sr-only">Pip's house</h2>
      <section
        className="pip-house"
        aria-label={`Pip's house: the ${level.name}`}
        style={frame}
        data-decorating={decorating || undefined}
        data-sheet={sheet ? "open" : undefined}
        data-small-room={(roomBox && roomBox.width < 420) || undefined}
      >
        <div className="pip-hud-top">
          {/* Seeds and mood, the house's resources. The cluster takes more (a goals widget) as another .pip-resource. */}
          <div className="pip-resources" data-walk="resources" role="group" aria-label="Seeds and mood">
            <button
              ref={seedChipRef}
              type="button"
              className="pip-resource pip-resource-seeds"
              onClick={() => openDrawer("me")}
              aria-label={`${plural(spendable, "seed")}. Where they come from`}
              title="Seeds: where they come from"
            >
              <span className="pip-resource-icon">
                <UiIcon name="seed" size={16} />
              </span>
              <span className="pip-resource-value tabular-nums">
                <CountUp value={heldSeeds ?? spendable} duration={heldSeeds === null ? countMs : 700} />
              </span>
            </button>
            {/* The hearts are Pip's mood: they open what cheers it up. */}
            <button
              ref={heartsRef}
              type="button"
              className="pip-resource pip-resource-mood"
              onClick={() => openDrawer("me")}
              aria-label={`Pip's mood: ${hearts} of 5 hearts. ${moodWord(shownMood)}. What cheers Pip up`}
              title={`Pip's mood: ${moodWord(shownMood)}`}
            >
              <span className="pip-resource-label">Mood</span>
              <span className="pip-hearts">
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
              </span>
            </button>
          </div>
          {goal && goalEntry && goalItem && progress && (
            <GoalChip
              ref={goalRef}
              name={goalEntry.name}
              art={artFor(goal.kind, goal.id, 32)}
              have={progress.have}
              price={progress.price}
              fraction={progress.fraction}
              ready={progress.ready}
              locked={goalLock}
              onOpen={openGoal}
              onUnpin={() => setGoal(null)}
            />
          )}
          <span className="pip-hud-spacer" />
          <span className="pip-floor-plate" title={`You're in the ${level.name}`}>
            <UiIcon name="home" size={14} />
            <span className="truncate">{level.name}</span>
          </span>
          <button type="button" className="pip-hud-help" onClick={startWalk} aria-label="Show me around" title="Show me around">
            <UiIcon name="help" size={18} />
          </button>
        </div>

        {preview && (
          <div className="pip-preview-bar" role="status">
            <span className="text-sm">
              Trying on <strong>{preview.entry.name}</strong>
            </span>
            {!preview.entry.owned && spendable < preview.entry.price && (
              <span className="text-xs text-on-surface-variant">
                {plural(preview.entry.price - spendable, "more seed")} · ~{shortfall(preview.entry.price, spendable)?.minutes} min of reading
              </span>
            )}
            {!preview.entry.owned && spendable >= preview.entry.price && !preview.entry.locked && (
              <button
                type="button"
                className="pip-key pip-key-primary pip-key-small"
                // The preview stays on until the look is Pip's own, so it does not
                // spin back to the old one while the purchase is asked about.
                onClick={() => buyThing(preview.entry.kind, preview.entry.id, () => setPreview(null))}
              >
                Buy for {preview.entry.price}
              </button>
            )}
            <button type="button" className="pip-key pip-key-small" onClick={() => endPreview(true)}>
              Back to the shop
            </button>
            <button type="button" className="pip-key pip-key-small" onClick={() => endPreview(false)}>
              Done
            </button>
          </div>
        )}

        <div ref={bodyRef} className="pip-house-body" data-lift={levels.length > 1 || undefined}>
          <HouseScene
            ref={sceneRef}
            level={level}
            floorIndex={levelIndex}
            decor={shownDecor}
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
            onSlot={(target) => {
              setFinishPanel(null);
              setSlotFocus(target.id);
            }}
            slotLabel={slotLabel}
            onArcade={() => setArcadeOpen(true)}
            hidePip={arcadeOpen}
            plots={plots}
            onPlot={level.garden ? onPlot : undefined}
            onEmptyPlot={level.garden ? (plot) => setPickerPlot(plot.plot) : undefined}
            plotLabel={plotLabel}
            reserveBelow={reserve}
            label={`The ${level.name}, with Pip in ${SKINS.find((entry) => entry.id === shownVariant)?.name ?? "its"} outfit. ${moodWord(shownMood)}.`}
          />

          {levels.length > 1 && roomBox && (
            <FloorSwitch
              levels={levels}
              current={level}
              unlocked={unlocked}
              lockReason={lockReason}
              priceOf={(entry) => priceOf("level", entry.id)}
              onOpen={openFloor}
              height={roomBox.height}
              style={{ left: roomBox.left + roomBox.width + LIFT_GAP, top: roomBox.top }}
            />
          )}

          <UndoToast
            item={toast}
            onUndo={undo}
            style={roomBox ? ({ "--toast-left": `${roomBox.left + roomBox.width / 2}px`, "--toast-top": `${roomBox.top + 12}px` } as CSSProperties) : undefined}
          />

        </div>

        {decorating ? (
          <nav ref={railRef} className="pip-rail" aria-label="Decorating">
            <div className="pip-rail-belt pip-rail-decorate">
              <p className="pip-rail-mode">
                <UiIcon name="decorate" size={20} />
                <span>
                  <strong>Decorating the {level.name}</strong>
                  <span className="pip-rail-mode-hint">Select a pin to choose what goes there.</span>
                </span>
              </p>
              <button type="button" className="pip-rail-key" aria-pressed={finishPanel === "wallpaper"} onClick={() => toggleFinish("wallpaper")}>
                <UiIcon name="grid" size={20} />
                <span className="pip-rail-label">{house ? "Wallpaper" : "Room style"}</span>
              </button>
              {house && (
                <button type="button" className="pip-rail-key" aria-pressed={finishPanel === "flooring"} onClick={() => toggleFinish("flooring")}>
                  <UiIcon name="home" size={20} />
                  <span className="pip-rail-label">Flooring</span>
                </button>
              )}
              <button type="button" className="pip-rail-key pip-rail-done" onClick={stopDecorating}>
                <UiIcon name="check" size={20} />
                <span className="pip-rail-label">Done</span>
              </button>
            </div>
          </nav>
        ) : (
          <nav ref={railRef} className="pip-rail" aria-label="Pip's tools">
            <div className="pip-rail-belt">
              <button type="button" className="pip-rail-key pip-rail-shop" data-walk="shop" onClick={() => openShop({ tab: "variants" })}>
                <UiIcon name="shop" size={22} />
                <span className="pip-rail-label">Shop</span>
              </button>
              <button type="button" className="pip-rail-key" aria-pressed={drawer === "things"} onClick={() => openDrawer("things")}>
                <UiIcon name="things" size={22} />
                <span className="pip-rail-label">Pip's things</span>
              </button>
              <button type="button" className="pip-rail-key" aria-pressed={drawer === "garden"} onClick={() => openDrawer("garden")}>
                <UiIcon name="garden" size={22} />
                <span className="pip-rail-label">Garden</span>
                {ripe > 0 && <span className="pip-hud-dot" aria-label={`${ripe} ripe`} />}
              </button>
              <button ref={decorateRef} type="button" className="pip-rail-key" data-walk="decorate" onClick={startDecorating}>
                <UiIcon name="decorate" size={22} />
                <span className="pip-rail-label">Decorate</span>
              </button>
              {level.arcade && (
                <button type="button" className="pip-rail-key pip-rail-play" onClick={() => setArcadeOpen(true)}>
                  <UiIcon name="game" size={22} />
                  <span className="pip-rail-label">Arcade</span>
                </button>
              )}
            </div>
          </nav>
        )}

        {sheet && (
          // Keyed, so switching drawers slides the new one in. Beside the whole
          // house on a wide window (so it never pushes the rail down), a sheet
          // at the bottom on a narrow one.
          <PipDrawer key={sheet.key} ref={drawerRef} title={sheet.title} note={sheet.note} size={sheet.size} onClose={sheet.close}>
            {overview === null ? <Empty>Pip is getting dressed…</Empty> : sheet.body}
          </PipDrawer>
        )}
      </section>

      {pickerPlot !== null && level.garden && (
        <PacketPicker
          plot={pickerPlot}
          packets={PLANTS}
          balance={spendable}
          priceOf={(id) => priceOf("plant", id)}
          anchor={pickerAnchor}
          art={(id) => <PixelImage render={() => renderPacket(id, 0)} drawKey={`packet-${id}`} box={32} />}
          onPick={(id) => sow(pickerPlot, id)}
          onClose={() => setPickerPlot(null)}
        />
      )}

      {shopOpen && (
        <PipShop
          categories={shopCategories}
          balance={spendable}
          request={shopOpen}
          goal={goal ? `${goal.kind}:${goal.id}` : null}
          onGoal={pinGoal}
          onBuy={onShopBuy}
          onPreview={onShopPreview}
          onClose={closeShop}
        />
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

      <PurchaseConfirm />
      {walking && <Walkthrough steps={WALK} find={findWalk} prepare={prepareWalk} onClose={() => setWalking(false)} />}
    </div>
  );
};
