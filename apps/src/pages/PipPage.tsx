import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
// The house and arcade art load with this page, not with the app.
import "../pip/houseArt";
import { SKINS, renderRoom, type PipAccessory, type PipRoomItem, type PipSkin, type PipTreat } from "../pip";
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
  type ShopKind
} from "../pip/shop";
import { fitsSlot, floorings, renderFinish, renderItem, wallpapers, type HouseLevel, type HouseSlot } from "../pip/home.js";
import { renderPacket, renderSoil } from "../pip/garden.js";
import { ownsItem, usePipWardrobeStore } from "../store/pipWardrobeStore";
import { usePipStore } from "../store/pipStore";
import { useLibraryStore } from "../store/libraryStore";
import { FEATURES } from "../constants/features";
import type { PipLook } from "../services/pipService";
import type { WishView } from "../pip/wish";
import { HouseScene, type HouseSceneHandle } from "../components/pip/HouseScene";
import { capture, clearEffects, fly, reducedMotion, type Captured } from "../components/pip/fx";
import { FloorSwitch } from "../components/pip/FloorSwitch";
import { PipDrawer } from "../components/pip/PipDrawer";
import { PipShop, type PreviewLook, type ShopCategory, type ShopEntry, type ShopRequest } from "../components/pip/PipShop";
import { PipGoals } from "../components/pip/PipGoals";
import { PipWish } from "../components/pip/PipWish";
import { PipThings, type ThingsTab } from "../components/pip/PipThings";
import { PixelImage } from "../components/pip/PixelImage";
import { Empty, Group, Hint, Hints, MoveCard, PriceTag, Status, Tile, shortfall } from "../components/pip/shopParts";
import { PurchaseConfirm } from "../components/pip/PurchaseConfirm";
import { UndoToast } from "../components/pip/UndoToast";
import { GoalChip } from "../components/pip/GoalChip";
import { PacketPicker } from "../components/pip/PacketPicker";
import { Walkthrough } from "../components/pip/Walkthrough";
import { WALK, markWalkSeen, walkSeen, type WalkStep, type WalkTarget } from "../components/pip/walkSteps";
import { ArcadeOverlay } from "../components/pip/arcade/ArcadeOverlay";
import type { GameId } from "../components/pip/arcade/games";
import { PipAvatar } from "../components/community/PipAvatar";
import { CountUp } from "../components/community/CountUp";
import { tally, type Tally } from "../components/pip/collection";
import { PipSprite } from "../components/PipSprite";
import { UiIcon, type UiIconName } from "../components/UiIcon";
import { MOOD_LOW, PLACED, STARTER_DECOR, errorText, moodWord, moveName, pickOne, plantInfo, plural, priceOf, storage, wait, type Drawer, type FinishPanel } from "./pip/common";
import { usePipActs } from "./pip/usePipActs";
import { usePipLook } from "./pip/usePipLook";
import { purchaseFlow, useGrace, useStandIns } from "./pip/purchaseFlow";
import { usePipHouse } from "./pip/usePipHouse";
import { useDecorating } from "./pip/useDecorating";
import { usePipGarden } from "./pip/usePipGarden";
import { useBuyThing } from "./pip/useBuyThing";
import { useProfilePicture } from "./pip/useProfilePicture";
import { usePinnedGoal } from "./pip/usePinnedGoal";
import { useResourceBumps } from "./pip/useResourceBumps";
import { useRoomFrame } from "./pip/useRoomFrame";

/** Mirrors GAME_MOOD_PER_DAY in pip/mod.rs, for the arcade's note. */
const GAME_MOOD_PER_DAY = 12;
/** Between the room and the lift beside it; the lift is 44 wide (index.css keeps the two in step). */
const LIFT_GAP = 8;

type ThingsTabId = "looks" | "treats" | "moves";
type Preview = { entry: ShopEntry; look: PreviewLook };

const SLOTS: Array<{ slot: PipAccessory["slot"]; label: string; covered: string }> = [
  { slot: "head", label: "Head", covered: "has its own hat" },
  { slot: "face", label: "Face", covered: "already covers the face" },
  { slot: "neck", label: "Neck", covered: "already has something round the neck" },
  { slot: "back", label: "Back", covered: "already wears something on the back" },
  { slot: "hand", label: "Hand", covered: "has its hands full" }
];

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
 *
 * This file puts the tab together; its state and handlers are hooks in
 * pages/pip/: Pip's acts, the look, the purchase flow, the house, decorating,
 * the garden and what buying each thing does.
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
  const [busy, setBusy] = useState(false);
  const [walking, setWalking] = useState(false);
  // What a quick purchase shows before it is made (purchaseFlow.ts).
  const standIns = useStandIns();
  const sceneRef = useRef<HouseSceneHandle | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const seedChipRef = useRef<HTMLButtonElement | null>(null);
  const heartsRef = useRef<HTMLButtonElement | null>(null);
  const decorateRef = useRef<HTMLButtonElement | null>(null);
  const goalRef = useRef<HTMLDivElement | null>(null);
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

  // One quick purchase at a time waits out its toast (quickBuy.ts).
  const { grace, graceRef, toast, undo } = useGrace(showToast);

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
  const spendable = balance - standIns.ahead;
  const mood = state?.mood ?? 70;
  /** The hearts: held while hearts fly to them, and with a snack's cheer counted as it is eaten. */
  const shownMood = heldMood ?? Math.min(100, mood + standIns.moodAhead);
  const hearts = Math.round(shownMood / 10) / 2;
  const variant = state?.variant ?? "sprout";
  const outfit = useMemo(() => state?.outfit ?? [], [state?.outfit]);
  const signature = state?.signature ?? "read";
  const layout = useMemo(() => state?.room ?? {}, [state?.room]);
  const owns = useCallback((kind: ShopKind, id: string) => ownsItem(overview, kind, id), [overview]);
  const sessionsDone = overview?.sessionsDone ?? 0;

  const { act, line, play, duringAct, onActDone, pastime, poke } = usePipActs({ reaction, suspended, finishReaction, overview, mood, signature, actTimers, setHeldMood });

  const { skin, wearing, withAccessory, wearAccessory, shownVariant, shownOutfit, artFor } = usePipLook({
    variant,
    outfit,
    setLook,
    preview: preview?.look ?? null,
    pendingLook: standIns.pendingLook
  });

  // ---- buying ---------------------------------------------------------------------------

  const openShop = (request: ShopRequest, slotId: string | null = null) => {
    setPickerPlot(null);
    setShopSlot(slotId);
    setShopOpen(request);
  };
  const closeShop = () => {
    setShopOpen(null);
    setShopSlot(null);
  };

  const { purchase, spend } = purchaseFlow({ grace, busy, setBusy, spendable, setAhead: standIns.setAhead, buy, play, artFor, clickedArt, shopOpen, closeShop, showToast });

  const change = async (patch: Partial<PipLook>) => {
    try {
      await setLook(patch);
    } catch (cause) {
      showToast(errorText(cause));
    }
  };

  /** The layout as it is now in the store (after a purchase, the store has moved on). */
  const freshLayout = () => usePipWardrobeStore.getState().overview?.state.room ?? layout;

  // ---- the house, decorating and the garden ------------------------------------------------

  const { levels, level, levelIndex, levelRef, gardenLevel, unlocked, goToFloor, house, roomItemById, homeOf, placeable, decor, shownDecor, lockReason, openFloor } =
    usePipHouse({
      owns,
      layout,
      roomStyle: state?.roomStyle,
      pendingDecor: standIns.pendingDecor,
      sessionsDone,
      setSlotFocus,
      setPickerPlot,
      purchase,
      play,
      sceneRef,
      showToast
    });

  const { slot, where, placeIn, setFinish, itemIn, slotName, slotLabel, flyInto, deliverDecor, placeFromShop, startDecorating, stopDecorating, toggleFinish, roomPart } =
    useDecorating({
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
    });

  const garden = overview?.garden;
  const { plotCount, growing, nextPlot, scenePlots, minutesLeft, plotLabel, releaseSeeds, pick, sow, digPlot, onPlot, plantAt } = usePipGarden({
    garden,
    owns,
    level,
    gardenLevel,
    goToFloor,
    suspended,
    busy,
    setBusy,
    spendable,
    setHeldSeeds,
    setCountMs,
    pendingPlant: standIns.pendingPlant,
    setPendingPlant: standIns.setPendingPlant,
    harvest,
    plant,
    purchase,
    spend,
    play,
    clickedArt,
    sceneRef,
    seedChipRef,
    setPickerPlot,
    setDrawer,
    showToast
  });

  // ---- treats, and buying from the shop ------------------------------------------------------

  const { give, buyThing } = useBuyThing({
    buy,
    feed,
    setLook,
    owns,
    busy,
    setBusy,
    spend,
    shownMood,
    setHeldMood,
    standIn: standIns.standIn,
    setMoodAhead: standIns.setMoodAhead,
    pendingLook: standIns.pendingLook,
    setPendingLook: standIns.setPendingLook,
    setPendingDecor: standIns.setPendingDecor,
    variant,
    outfit,
    withAccessory,
    wearAccessory,
    play,
    duringAct,
    level,
    levels,
    openFloor,
    digPlot,
    deliverDecor,
    placeIn,
    setFinish,
    roomPart,
    freshLayout,
    shopOpen,
    shopSlot,
    closeShop,
    sceneRef,
    heartsRef,
    decorateRef,
    showToast
  });

  /**
   * Pip's wish, granted from its plaque the way the page does each thing: the
   * snack given (by the shop's rules), the packet planted in a free plot (from
   * the garden, which the house rides to first), or the shop open at the piece
   * or the move.
   */
  const grantWish = (wish: WishView) => {
    if (wish.kind === "treat") {
      const treat = treats().find((entry) => entry.id === wish.id);
      if (treat) void give(treat);
      return;
    }
    if (wish.kind === "plant") {
      const free = Array.from({ length: plotCount }, (_, index) => index + 1).find((plot) => !growing(plot));
      if (!free) return;
      if (gardenLevel && level.id !== gardenLevel.id) {
        goToFloor(gardenLevel);
        window.setTimeout(() => sow(free, wish.id), 600);
      } else {
        sow(free, wish.id);
      }
      return;
    }
    openShop({ tab: wish.kind === "room" ? "decor" : "moves", item: wish.id });
  };

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

  // ---- the arcade -----------------------------------------------------------------------------

  const onGameFinished = useCallback(async (game: GameId, score: number) => Math.round(await gamePlayed(game, score)), [gamePlayed]);
  const closeArcade = () => {
    setArcadeOpen(false);
    play("cheer", 1, "that was fun. back to the books?");
  };

  // ---- the profile picture, the shop, the goal and Pip's things ------------------------------

  const { myAvatar, signedIn, avatarInUse, useMyPip } = useProfilePicture({ variant, signature, outfit, play, showToast });

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

  const { goal, setGoal, goalEntry, goalItem, goalLock, progress, pinGoal, openGoal } = usePinnedGoal({
    overview,
    owns,
    balance,
    suspended,
    entryFor,
    shopCategories,
    goalRef,
    sceneRef,
    play,
    openShop
  });

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
          {earned.chest > 0 && (
            <>
              <dt>Starter chest</dt>
              <dd>{earned.chest}</dd>
            </>
          )}
          {earned.goals > 0 && (
            <>
              <dt>First steps</dt>
              <dd>{earned.goals}</dd>
            </>
          )}
          {earned.sets > 0 && (
            <>
              <dt>Sets finished</dt>
              <dd>{earned.sets}</dd>
            </>
          )}
          {earned.wishes > 0 && (
            <>
              <dt>Wishes granted</dt>
              <dd>{earned.wishes}</dd>
            </>
          )}
          {earned.earlier > 0 && (
            <>
              <dt>Earned before the garden</dt>
              <dd>{earned.earlier}</dd>
            </>
          )}
          <dt>Spent on Pip</dt>
          <dd>−{(overview?.wallet.spent ?? 0) + standIns.ahead}</dd>
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

  // ---- the page -----------------------------------------------------------------------------------

  const ripe = garden?.plants.filter((entry) => entry.ripe && !entry.harvested).length ?? 0;

  const heartRefs = useResourceBumps({ loaded, spendable, heldSeeds, seedChipRef, hearts });

  const { roomBox, reserve } = useRoomFrame({ bodyRef, railRef, drawerRef, sheetKey: sheet?.key ?? null, decorating });

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
            {/* First steps (its own resource until they are all done): a reward's
                seeds fly to the counter, which holds its old number meanwhile,
                as it does for a harvest. */}
            <PipGoals
              dropdown
              className="pip-resource pip-resource-goals"
              counter={() => seedChipRef.current}
              onFlight={(phase, seeds) => {
                if (phase === "start") {
                  setHeldSeeds((held) => held ?? Math.max(0, spendable - seeds));
                } else {
                  releaseSeeds();
                }
              }}
            />
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
          <PipWish compact onGrant={grantWish} counter={() => seedChipRef.current} />
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
