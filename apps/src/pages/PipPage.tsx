import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
// The house and arcade art load with this page, not with the app.
import "../pip/houseArt";
import { SKINS } from "../pip";
import { PLANTS, treats, type ShopKind } from "../pip/shop";
import { renderPacket } from "../pip/garden.js";
import { ownsItem, usePipWardrobeStore } from "../store/pipWardrobeStore";
import { usePipStore } from "../store/pipStore";
import { useLibraryStore } from "../store/libraryStore";
import type { PipLook } from "../services/pipService";
import type { WishView } from "../pip/wish";
import { HouseScene, type HouseSceneHandle } from "../components/pip/HouseScene";
import { bump, capture, centerOf, clearEffects, collect, floatText, reducedMotion, seedPixel, type Captured } from "../components/pip/fx";
import { playSound } from "../pip/sound";
import type { PlayKind } from "../pip/play";
import { FloorSwitch } from "../components/pip/FloorSwitch";
import { PipDrawer } from "../components/pip/PipDrawer";
import { PipShop, type PreviewLook, type ShopEntry, type ShopRequest } from "../components/pip/PipShop";
import { PipThings } from "../components/pip/PipThings";
import { PixelImage } from "../components/pip/PixelImage";
import { Empty } from "../components/pip/shopParts";
import { PurchaseConfirm } from "../components/pip/PurchaseConfirm";
import { UndoToast } from "../components/pip/UndoToast";
import { PacketPicker } from "../components/pip/PacketPicker";
import { Walkthrough } from "../components/pip/Walkthrough";
import { WALK, markWalkSeen, walkSeen, type WalkStep, type WalkTarget } from "../components/pip/walkSteps";
import { ArcadeOverlay, type ArcadePage } from "../components/pip/arcade/ArcadeOverlay";
import type { GameId } from "../components/pip/arcade/games";
import { MOOD_LOW, aOrAn, errorText, moodWord, pickOne, priceOf, storage, wait, type Drawer, type FinishPanel } from "./pip/common";
import { usePipActs } from "./pip/usePipActs";
import { usePipWorld } from "./pip/usePipWorld";
import { Visitors, prepareVisitorProfile } from "../components/pip/Visitors";
import { useVisitorStore } from "../pip/useVisitors";
import { cuePip } from "../pip/life";
import { missedLine } from "../pip/behaviour";
import { coldWords } from "../pip/cold";
import { usePipLook } from "./pip/usePipLook";
import { purchaseFlow, useGrace, useStandIns } from "./pip/purchaseFlow";
import { usePipHouse } from "./pip/usePipHouse";
import { useDecorating } from "./pip/useDecorating";
import { usePipGarden } from "./pip/usePipGarden";
import { useBuyThing } from "./pip/useBuyThing";
import { useProfilePicture } from "./pip/useProfilePicture";
import { shopEntries } from "./pip/shopEntries";
import { usePinnedGoal } from "./pip/usePinnedGoal";
import { pipThingsTabs } from "./pip/thingsTabs";
import { useResourceBumps } from "./pip/useResourceBumps";
import { useRoomFrame } from "./pip/useRoomFrame";
import { PipHud } from "./pip/PipHud";
import { PreviewBar } from "./pip/PreviewBar";
import { PipRail } from "./pip/PipRail";
import { GardenPanel } from "./pip/GardenPanel";
import { SeedsPanel } from "./pip/SeedsPanel";
import { MoodPanel } from "./pip/MoodPanel";
import { explainMood } from "../pip/mood";
import { GAMES } from "../components/pip/arcade/games";
import { useHabitStore } from "../store/habitStore";
import { getDateKey } from "../services/habitService";
import { FinishSheet, SlotSheet } from "./pip/DecorSheets";

/** Between the room and the lift beside it; the lift is 44 wide (index.css keeps the two in step). */
const LIFT_GAP = 8;

type ThingsTabId = "looks" | "treats" | "moves";
type Preview = { entry: ShopEntry; look: PreviewLook };

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
  /** Shows the Social page (a visitor's card has a way to their profile). Left out, the card has no such button. */
  openSocial?: () => void;
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
 * drifts slowly and stops while she is still content, any reading cheers her
 * up, and games cheer Pip up but pay nothing.
 *
 * This file puts the tab together; its parts are in pages/pip/: Pip's acts,
 * the look, the purchase flow, the house, decorating, the garden, what buying
 * each thing does, the shop's entries, the tabs of Pip's things, the HUD, the
 * rail and the drawers.
 */
export const PipPage = ({ showToast, openSocial }: PipPageProps) => {
  const { overview, load, buy, setLook, feed, plant, harvest, gamePlayed, played } = usePipWardrobeStore(
    useShallow((state) => ({
      overview: state.overview,
      load: state.load,
      buy: state.buy,
      setLook: state.setLook,
      feed: state.feed,
      plant: state.plant,
      harvest: state.harvest,
      gamePlayed: state.gamePlayed,
      played: state.played
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
  // Today's reading, for the mood's reasons (read only: the streak engine owns it).
  const habit = useHabitStore((state) => state.snapshot);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  // The tab of Pip's things last looked at, which it opens on again.
  const [thingsTab, setThingsTab] = useState<ThingsTabId>("looks");
  const [decorating, setDecorating] = useState(false);
  // The rail is showing the ways to play with Pip.
  const [playing, setPlaying] = useState(false);
  const [finishPanel, setFinishPanel] = useState<FinishPanel | null>(null);
  const [shopOpen, setShopOpen] = useState<ShopRequest | null>(null);
  // The spot being decorated when the shop was opened for it: a piece bought then goes there.
  const [shopSlot, setShopSlot] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [slotFocus, setSlotFocus] = useState<string | null>(null);
  const [pickerPlot, setPickerPlot] = useState<number | null>(null);
  // The arcade's games, open; and the game a machine opened it at, if one did.
  const [arcadeOpen, setArcadeOpen] = useState(false);
  // (Or one of its other pages: a thing in the room may open it straight onto the word quiz, or "My words".)
  const [arcadeGame, setArcadeGame] = useState<GameId | ArcadePage | null>(null);
  const openArcade = (game: GameId | ArcadePage | null = null) => {
    setArcadeGame(game);
    setArcadeOpen(true);
  };
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
  const ripe = overview?.garden.plants.filter((entry) => entry.ripe && !entry.harvested).length ?? 0;

  const { act, line, play, duringAct, onActDone, repertoire, poke } = usePipActs({ reaction, suspended, finishReaction, overview, signature, actTimers, setHeldMood });
  // What she knows of the world outside her room (the reader's books, an expedition, a visitor, a cold): it colours what she does.
  const { world, markSeen } = usePipWorld({ books });
  // A friend came by while she was asleep or out and left a note: once she is about, she says so (once a note, a visit to the tab).
  const visitorNote = useVisitorStore((state) => state.note?.record.from ?? null);
  const remarked = useRef<number | null>(null);
  const pipOut = Boolean(world.away);
  useEffect(() => {
    if (visitorNote === null || pipOut || remarked.current === visitorNote) return;
    remarked.current = visitorNote;
    cuePip({ move: "look", loops: 1, line: missedLine(Math.random), houseOnly: true });
  }, [visitorNote, pipOut]);

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

  const { levels, level, levelIndex, levelRef, gardenLevel, unlocked, visiting, goToFloor, house, roomItemById, homeOf, placeable, decor, shownDecor, lockReason, openFloor } =
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

  // ---- playing with Pip ------------------------------------------------------------------------

  /**
   * A bout of play that counted (the scene says so: stroked a while, the ball
   * brought back): Rust cheers Pip up a little, out of the day's allowance it
   * shares with the games, and a heart flies from her to the meter for it.
   */
  const onPlayed = useCallback(
    async (kind: PlayKind) => {
      const gained = await played(kind);
      const head = sceneRef.current?.pipPoint("head");
      const meter = heartsRef.current?.getBoundingClientRect();
      if (gained <= 0 || !head) return;
      floatText({ x: head.x, y: head.y - 14 }, `+${Math.round(gained)}`, "mood");
      playSound("chime", { pitch: 1.3, volume: 0.5 });
      if (!meter || reducedMotion()) return;
      void collect(head, centerOf(meter), { sprite: "heart", count: 1, px: seedPixel(sceneRef.current?.pixel() ?? 4), onLand: () => bump(heartsRef.current, 0.6) });
    },
    [played]
  );

  /** A dance together: a move she owns if she has one, a little bop if not. Counts as play. */
  const danceWithPip = () => {
    const move = repertoire.dances.length > 0 ? pickOne([...repertoire.dances]) : "bop";
    play(move, move === "bop" ? 3 : 4, pickOne(["dance with me!", "this is my song.", "one, two, three!"]));
    void onPlayed("dance");
  };

  const playWith = (how: "pet" | "tickle" | "ball" | "toss" | "dance" | "bed") => {
    if (how === "dance") danceWithPip();
    else sceneRef.current?.playWith(how);
  };

  // ---- the profile picture, the shop, the goal and Pip's things ------------------------------

  const { myAvatar, signedIn, avatarInUse, useMyPip } = useProfilePicture({ variant, signature, outfit, play, showToast });

  const { shopCategories, tallies, entryFor, allRoomItems, moveList, walls, wallKind } = shopEntries({
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
  });

  const onShopBuy = (entry: ShopEntry) => buyThing(entry.kind, entry.id);

  const pinned = usePinnedGoal({ overview, owns, balance, suspended, entryFor, shopCategories, goalRef, sceneRef, play, openShop });
  const { goal, pinGoal } = pinned;

  const thingsTabs = pipThingsTabs({
    owns,
    variant,
    outfit,
    skin,
    shownVariant,
    signature,
    wearing,
    withAccessory,
    tallies,
    moveList,
    spendable,
    change,
    give,
    play,
    openShop,
    showToast
  });

  // ---- the walkthrough ---------------------------------------------------------------------------

  const startWalk = () => {
    setDrawer(null);
    stopDecorating();
    closeShop();
    setPickerPlot(null);
    setPreview(null);
    setPlaying(false);
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

  // ---- the mood, explained ---------------------------------------------------------------------

  /** Why Pip feels as she does: Rust's numbers, in words (pip/mood.ts). Worked out when its panel opens. */
  const moodReport = () => {
    const today = getDateKey();
    const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
    const treatName = (id: string) => upper(aOrAn(treats().find((treat) => treat.id === id)?.name ?? "treat"));
    // The snack that cheers her most among those the reader can pay for now.
    const snack = treats()
      .filter((treat) => treat.kind === "food" && priceOf("treat", treat.id) <= spendable)
      .sort((a, b) => b.mood - a.mood)[0];
    return explainMood({
      mood: shownMood,
      moodUpdatedAt: state?.moodUpdatedAt ?? new Date().toISOString(),
      now: Date.now(),
      rules: overview?.moodRules ?? { driftPerDay: 0, driftFloor: 0, perReadingMinute: 0, readingPerDay: 0, perSession: 0, perHarvest: 0, perGame: 0, perPlay: 0, playPerDay: 0, perWish: 0, start: 70 },
      log: overview?.moodLog ?? [],
      playToday: overview?.arcade.day === today ? overview.arcade.moodToday : 0,
      readingToday: overview?.readingMood.days[today] ?? 0,
      sessionsToday: habit.sessions.filter((session) => session.dateKey === today && session.minutes >= 1).length,
      minutesToday: habit.todayMinutes,
      wish: overview?.wish ? { granted: overview.wish.granted, mood: overview.wish.mood } : null,
      ripe,
      snack: snack ? { name: aOrAn(snack.name), price: priceOf("treat", snack.id), mood: snack.mood } : null,
      treatName,
      gameName: (id) => GAMES.find((game) => game.id === id)?.name ?? "the arcade"
    });
  };

  // ---- the drawers ------------------------------------------------------------------------------

  const openDrawer = (id: Drawer) => {
    setPickerPlot(null);
    setDrawer((current) => (current === id ? null : id));
  };

  // The sheet on screen: a drawer, or while decorating, what goes in a spot.
  const sheet: { key: string; title: string; note?: ReactNode; size?: "short"; body: ReactNode; close: () => void } | null = decorating
    ? slot
      ? {
          key: `slot-${slot.id}`,
          title: slotName(slot),
          note: "Select a piece to put it here.",
          size: "short",
          body: (
            <SlotSheet
              slot={slot}
              level={level}
              levels={levels}
              allRoomItems={allRoomItems}
              owns={owns}
              where={where}
              itemIn={itemIn}
              slotName={slotName}
              placeIn={placeIn}
              flyInto={flyInto}
              clickedArt={clickedArt}
              play={play}
              openShop={openShop}
            />
          ),
          close: () => setSlotFocus(null)
        }
      : finishPanel
        ? {
            key: finishPanel,
            title: finishPanel === "wallpaper" ? (house ? "Wallpaper" : "Room style") : "Flooring",
            note: `For the ${level.name}.`,
            size: "short",
            body: (
              <FinishSheet
                panel={finishPanel}
                house={house}
                walls={walls}
                wallKind={wallKind}
                owns={owns}
                decor={decor}
                setLook={setLook}
                setFinish={setFinish}
                clickedArt={clickedArt}
                roomPart={roomPart}
                openShop={openShop}
              />
            ),
            close: () => setFinishPanel(null)
          }
        : null
    : drawer === "things"
      ? { key: "things", title: "Pip's things", note: "What Pip has: wear it, give it, do it.", body: <PipThings tabs={thingsTabs} initial={thingsTab} onTab={(id) => setThingsTab(id as ThingsTabId)} />, close: () => setDrawer(null) }
      : drawer === "garden"
        ? {
            key: "garden",
            title: "Garden",
            note: "Where seeds come from.",
            body: (
              <GardenPanel
                garden={garden}
                level={level}
                gardenLevel={gardenLevel}
                goToFloor={goToFloor}
                plotCount={plotCount}
                growing={growing}
                minutesLeft={minutesLeft}
                nextPlot={nextPlot}
                pick={pick}
                plantAt={plantAt}
              />
            ),
            close: () => setDrawer(null)
          }
        : drawer === "me"
          ? {
              key: "me",
              title: "Seeds",
              body: (
                <SeedsPanel
                  spendable={spendable}
                  earned={overview?.wallet.earned}
                  spent={overview?.wallet.spent}
                  ahead={standIns.ahead}
                  water={garden?.water}
                  onMood={() => setDrawer("mood")}
                  onWalk={startWalk}
                  myAvatar={myAvatar}
                  signedIn={signedIn}
                  avatarInUse={avatarInUse}
                  onUseMyPip={useMyPip}
                />
              ),
              close: () => setDrawer(null)
            }
          : drawer === "mood"
            ? {
                key: "mood",
                title: "Pip's mood",
                note: "Why it is what it is, and what would lift it.",
                body: (
                  <MoodPanel
                    report={moodReport()}
                    cold={world.cold ? { ...coldWords(world.cold), percent: Math.floor(Math.max(0, Math.min(1, world.cold.cure)) * 100) } : null}
                    hearts={hearts}
                    onPlay={() => {
                      setDrawer(null);
                      setPlaying(true);
                    }}
                    onSnacks={() => {
                      setThingsTab("treats");
                      setDrawer("things");
                    }}
                  />
                ),
                close: () => setDrawer(null)
              }
            : null;

  // ---- the page -----------------------------------------------------------------------------------

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
        <PipHud
          seedChipRef={seedChipRef}
          heartsRef={heartsRef}
          heartRefs={heartRefs}
          goalRef={goalRef}
          spendable={spendable}
          heldSeeds={heldSeeds}
          countMs={countMs}
          hearts={hearts}
          shownMood={shownMood}
          openMe={() => openDrawer("me")}
          openMood={() => openDrawer("mood")}
          onGoalsFlight={(phase, seeds) => {
            if (phase === "start") {
              setHeldSeeds((held) => held ?? Math.max(0, spendable - seeds));
            } else {
              releaseSeeds();
            }
          }}
          pinned={pinned}
          artFor={artFor}
          grantWish={grantWish}
          floorName={level.name}
          startWalk={startWalk}
        />

        {preview && (
          <PreviewBar
            entry={preview.entry}
            spendable={spendable}
            // The preview stays on until the look is Pip's own, so it does not
            // spin back to the old one while the purchase is asked about.
            onBuy={() => buyThing(preview.entry.kind, preview.entry.id, () => setPreview(null))}
            endPreview={endPreview}
          />
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
            repertoire={repertoire}
            mood={mood}
            mopey={mood < MOOD_LOW}
            onPoke={poke}
            onPlayed={onPlayed}
            ownBall={owns("treat", "ball")}
            attentive={walking}
            decorating={decorating}
            selectedSlot={slotFocus}
            onSlot={(target) => {
              setFinishPanel(null);
              setSlotFocus(target.id);
            }}
            slotLabel={slotLabel}
            onArcade={openArcade}
            onJukebox={danceWithPip}
            hidePip={arcadeOpen}
            plots={plots}
            onPlot={level.garden ? onPlot : undefined}
            onEmptyPlot={level.garden ? (plot) => setPickerPlot(plot.plot) : undefined}
            plotLabel={plotLabel}
            reserveBelow={reserve}
            world={world}
            onWelcomed={markSeen}
            overlay={(frame) => (
              <Visitors
                frame={frame}
                taken={frame.floor()}
                busy={decorating || arcadeOpen}
                away={pipOut}
                onEvent={(event) => sceneRef.current?.visitor(event.type)}
                onOpenProfile={
                  openSocial
                    ? (handle) => {
                        prepareVisitorProfile(handle);
                        openSocial();
                      }
                    : undefined
                }
              />
            )}
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

        <PipRail
          railRef={railRef}
          decorateRef={decorateRef}
          decorating={decorating}
          floorName={level.name}
          house={house}
          arcade={level.arcade}
          canDecorate={!visiting(level)}
          drawer={drawer}
          finishPanel={finishPanel}
          ripe={ripe}
          openShop={openShop}
          openDrawer={openDrawer}
          startDecorating={startDecorating}
          stopDecorating={stopDecorating}
          toggleFinish={toggleFinish}
          openArcade={() => openArcade()}
          playing={playing}
          startPlaying={() => {
            setDrawer(null);
            setPickerPlot(null);
            setPlaying(true);
          }}
          stopPlaying={() => setPlaying(false)}
          playWith={playWith}
          openSnacks={() => {
            setThingsTab("treats");
            setDrawer("things");
            // Where there is a fridge she is off to it, and has it open by the time a snack is chosen.
            sceneRef.current?.playWith("snack");
          }}
        />

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
          initial={arcadeGame}
          skin={variant}
          outfit={outfit}
          best={overview?.arcade.best ?? {}}
          moodToday={overview?.arcade.moodToday ?? 0}
          moodCap={overview?.moodRules.playPerDay ?? 12}
          onFinished={onGameFinished}
          onClose={closeArcade}
        />
      )}

      <PurchaseConfirm />
      {walking && <Walkthrough steps={WALK} find={findWalk} prepare={prepareWalk} onClose={() => setWalking(false)} />}
    </div>
  );
};
