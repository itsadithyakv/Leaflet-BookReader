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
import { HouseScene, type SceneAct, type ScenePlot } from "../components/pip/HouseScene";
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
  top: "Shelf top",
  stand: "Floor spot",
  rug: "Rug"
};

const FOOD_LINES = ["yum.", "crunchy. thank you!", "om nom nom.", "delicious. more reading, more snacks?"];
const TOY_LINES = ["again! again!", "best. toy. ever.", "wheee!", "you're the best."];
const THANKS = ["ooh. thank you!", "for me? you shouldn't have.", "i love it."];

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

  // Pip lives here while the tab is open: the roaming Pip steps aside.
  useEffect(() => {
    setOnStage(true);
    return () => setOnStage(false);
  }, [setOnStage]);

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
      setAct({ move, loops, key: actKey.current++, reactionId });
      if (text) setLine(text);
    },
    [finishReaction]
  );

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

  /** Asks, buys, then runs `after` (wear it, place it, play it). */
  const purchase = async (item: ShopItem, after?: () => Promise<void> | void) => {
    if (busy) return;
    const lacking = shortfall(item.price, balance);
    if (lacking) {
      showToast(`${plural(lacking.short, "more seed")} for ${item.name}: about ${plural(lacking.minutes, "minute")} of focused reading.`);
      return;
    }
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
      await after?.();
      // Moves, toys and floors show themselves off once bought; the rest get a thank-you.
      if (!["move", "treat", "level", "plot"].includes(item.kind)) {
        play("cheer", 1, pickOne(THANKS));
      }
    } catch (cause) {
      showToast(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const buyItem = (kind: ShopKind, id: string, after?: () => Promise<void> | void) => {
    const item = catalogueItem(kind, id);
    if (item) void purchase(item, after);
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
    buyItem("level", next.id, () => {
      goToFloor(next);
      play("welcome", 1, `a whole new floor. ${next.name.toLowerCase()}!`);
    });
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
  // "Ceiling 2": the art numbers its slots (ceiling-2), which tells three ceilings apart.
  const slotName = (target: HouseSlot) => {
    if (target.name) return target.name;
    const number = /-(\d+)$/.exec(target.id)?.[1];
    return `${SLOT_NAME[target.fits] ?? "Spot"}${number ? ` ${number}` : ""}`;
  };
  const slotLabel = (target: HouseSlot) => {
    const inside = itemIn(target);
    const name = inside ? roomItemById.get(inside)?.name ?? inside : "empty";
    return `${slotName(target)}: ${name}. Select to choose what goes here.`;
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
    ...(nextPlot ? [{ plot: plotCount + 1, plant: null, progress: 0, ripe: false, locked: true }] : [])
  ];
  const minutesLeft = (here: PlantState) => Math.max(1, Math.ceil(here.need - here.water));
  const plotLabel = (plot: ScenePlot) => {
    if (plot.locked) return `Dig a new plot: ${nextPlot ? priceOf("plot", nextPlot.id) : 0} seeds`;
    const here = growing(plot.plot);
    if (!here) return `Plot ${plot.plot}: empty. Select to plant.`;
    const name = plantInfo(here.plant)?.name ?? here.plant;
    return here.ripe ? `Plot ${plot.plot}: ${name}, ripe! Select to pick it.` : `Plot ${plot.plot}: ${name}, ${plural(minutesLeft(here), "more minute")} of focus.`;
  };

  const pick = async (here: PlantState) => {
    if (busy) return;
    setBusy(true);
    try {
      const seeds = await harvest(here.id);
      const name = (plantInfo(here.plant)?.name ?? here.plant).toLowerCase();
      play(pickOne(["cheer", "sunbathe", "tapdance"]), 1, `fresh ${name}! +${seeds} seeds.`);
    } catch (cause) {
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
    setBusy(true);
    try {
      await plant(plot, plantId);
      setPlotFocus(null);
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

  const give = async (treat: PipTreat) => {
    if (busy) return;
    const food = treat.kind === "food";
    const price = priceOf("treat", treat.id);
    const lacking = food ? shortfall(price, balance) : null;
    if (lacking) {
      showToast(`${plural(lacking.short, "more seed")} for ${treat.name}: about ${plural(lacking.minutes, "minute")} of focused reading.`);
      return;
    }
    setBusy(true);
    try {
      await feed(treat.id);
      play(treat.move, 2, pickOne(food ? FOOD_LINES : TOY_LINES));
    } catch (cause) {
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
      use: owned ? { label: "Place it", run: () => { setShopOpen(null); setDrawer("decorate"); } } : null
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
      note: "Place what you buy from Decorate, in the spots each floor has.",
      entries: allRoomItems
        .filter((item) => !item.nod && (FEATURES.fullPipHouse || STARTER_DECOR.has(item.id)))
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

  const onShopBuy = (entry: ShopEntry) => {
    const after: Record<string, (() => Promise<void> | void) | undefined> = {
      skin: () => setLook({ variant: entry.id }),
      accessory: () => wearAccessory(entry.id),
      move: () => play(entry.id, 2, `new move: ${entry.name.toLowerCase()}.`),
      level: () => {
        setShopOpen(null);
        const next = levels.find((floor) => floor.id === entry.id);
        if (next) goToFloor(next);
        play("welcome", 1, `a whole new floor. ${entry.name.toLowerCase()}!`);
      },
      treat: () => {
        const treat = treats().find((candidate) => candidate.id === entry.id);
        if (treat) {
          setShopOpen(null);
          void give(treat);
        }
      },
      style: () => setLook({ roomStyle: entry.id }),
      wallpaper: () => setFinish("wallpaper", entry.id, freshLayout()),
      flooring: () => setFinish("floor", entry.id, freshLayout())
    };
    buyItem(entry.kind, entry.id, after[entry.kind]);
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
        label={`${entry.name}. ${worn ? "Wearing." : owned ? "Owned. Select to wear it." : earned ? `Earned by reading: ${entry.unlock}` : "In the shop."}`}
        art={(hot) => <PipSprite move="idle" still={!hot && !worn} size={72} snap="nearest" skin={entry.id} outfit={outfit} />}
        status={worn ? <Status icon="check">Wearing</Status> : owned ? <Status>Owned</Status> : earned ? <Status icon="lock">Earned</Status> : priceTag(priceOf("skin", entry.id))}
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
          else buyItem("treat", entry.id, () => give(entry));
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
                    : { label: `Buy · ${price}`, run: () => buyItem("move", entry.id, () => play(entry.id, 2, `new move: ${name.toLowerCase()}.`)) }
              }
            />
          );
        })}
      </div>
    </>
  );

  const fitting = slot ? allRoomItems.filter((item) => fitsSlot(item, slot, level.id)) : [];
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
          else if (owned) void placeIn(target, item.id);
          else buyItem("room", item.id, () => placeIn(target, item.id, freshLayout()));
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
          if (owned) void apply();
          else buyItem(kind, entry.id, () => apply(freshLayout()));
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
        Select a dotted spot in the room to choose what goes there. Things snap into place, and each is in one place in the house at a time.
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
          Rain barrel {barrel} / {garden?.barrelCap ?? 120}
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

  const hearts = Math.round(mood / 10) / 2;
  const above = levels[levelIndex + 1];
  const below = levels[levelIndex - 1];
  const ripe = garden?.plants.filter((entry) => entry.ripe && !entry.harvested).length ?? 0;

  return (
    <div className="pip-house-page">
      <h2 className="sr-only">Pip's house</h2>
      <section className="pip-house" aria-label={`Pip's house: the ${level.name}`}>
        <div className="pip-hud">
          <div className="pip-hud-group">
            <button type="button" className="pip-hud-chip" onClick={() => toggleDrawer("me")} aria-label={`${plural(balance, "seed")}. Where they come from`}>
              <UiIcon name="seed" size={15} />
              <span className="tabular-nums">
                <CountUp value={balance} />
              </span>
            </button>
            <button type="button" className="pip-hud-shop" onClick={() => setShopOpen("variants")}>
              <UiIcon name="shop" size={17} />
              <span>Shop</span>
            </button>
            <span className="pip-hud-chip pip-hearts" role="img" aria-label={`Mood: ${hearts} of 5 hearts. ${moodWord(mood)}.`}>
              {[0, 1, 2, 3, 4].map((index) => (
                <span key={index} className="pip-heart" data-fill={hearts >= index + 1 ? "full" : hearts > index ? "half" : "empty"}>
                  <UiIcon name="heart" size={14} />
                </span>
              ))}
            </span>
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
              <button key={tool.id} type="button" className="pip-hud-button" aria-pressed={drawer === tool.id} onClick={() => toggleDrawer(tool.id)}>
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
                onClick={() => {
                  const entry = preview.entry;
                  endPreview(false);
                  onShopBuy(entry);
                }}
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
            level={level}
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
            <PipDrawer title={drawers[drawer].title} note={drawers[drawer].note} onClose={() => setDrawer(null)}>
              {overview === null ? <Empty>Pip is getting dressed…</Empty> : drawers[drawer].body}
            </PipDrawer>
          )}
        </div>

        <p className="pip-house-hint">
          {decorating
            ? "Decorating: select a dotted spot to choose what goes there."
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
