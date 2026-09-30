import { useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import { LIB, type PipTreat } from "../../pip";
import { catalogueItem, treats, type ShopKind } from "../../pip/shop";
import type { HouseLevel } from "../../pip/home.js";
import type { PipLook } from "../../services/pipService";
import type { HouseSceneHandle } from "../../components/pip/HouseScene";
import type { PreviewLook, ShopRequest } from "../../components/pip/PipShop";
import { bump, centerOf, collect, fly, reducedMotion, spill, type Captured } from "../../components/pip/fx";
import type { Delivery, PendingDecor, purchaseFlow } from "./purchaseFlow";
import type { useDecorating } from "./useDecorating";
import { THANKS, aOrAn, errorText, pickOne } from "./common";

const FOOD_LINES = ["yum.", "crunchy. thank you!", "om nom nom.", "delicious. more reading, more snacks?"];
const TOY_LINES = ["again! again!", "best. toy. ever.", "wheee!", "you're the best."];

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

type Decorating = ReturnType<typeof useDecorating>;

type BuyThingOptions = {
  buy: (kind: ShopKind, id: string) => Promise<void>;
  feed: (treatId: string) => Promise<void>;
  setLook: (patch: Partial<PipLook>) => Promise<void>;
  owns: (kind: ShopKind, id: string) => boolean;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  spend: ReturnType<typeof purchaseFlow>["spend"];
  /** The hearts as shown, and a hold on them while hearts fly to the meter. */
  shownMood: number;
  setHeldMood: Dispatch<SetStateAction<number | null>>;
  standIn: MutableRefObject<number>;
  setMoodAhead: Dispatch<SetStateAction<number>>;
  pendingLook: PreviewLook | null;
  setPendingLook: Dispatch<SetStateAction<PreviewLook | null>>;
  setPendingDecor: Dispatch<SetStateAction<PendingDecor | null>>;
  variant: string;
  outfit: string[];
  withAccessory: (id: string, from?: readonly string[]) => string[];
  wearAccessory: (id: string) => Promise<void>;
  play: (move: string, loops?: number, text?: string | null) => void;
  duringAct: (ms: number, run: () => void) => void;
  level: HouseLevel;
  levels: HouseLevel[];
  openFloor: (next: HouseLevel) => void;
  digPlot: () => void;
  deliverDecor: Decorating["deliverDecor"];
  placeIn: Decorating["placeIn"];
  setFinish: Decorating["setFinish"];
  roomPart: Decorating["roomPart"];
  /** The layout as it is now in the store (after a purchase, the store has moved on). */
  freshLayout: () => Record<string, string>;
  shopOpen: ShopRequest | null;
  /** The spot being decorated when the shop was opened for it: a piece bought then goes there. */
  shopSlot: string | null;
  closeShop: () => void;
  sceneRef: RefObject<HouseSceneHandle>;
  heartsRef: RefObject<HTMLButtonElement>;
  decorateRef: RefObject<HTMLButtonElement>;
  showToast: (message: string) => void;
};

/**
 * What buying each kind of thing does, by the shop's rules: a look or a move
 * goes to Pip, decor into a free spot, paper to the wall, a floor to its door.
 * And treats, which Pip eats or plays with: a snack is bought as it is given.
 */
export const useBuyThing = ({
  buy,
  feed,
  setLook,
  owns,
  busy,
  setBusy,
  spend,
  shownMood,
  setHeldMood,
  standIn,
  setMoodAhead,
  pendingLook,
  setPendingLook,
  setPendingDecor,
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
}: BuyThingOptions) => {
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

  /** Where Pip is, for things that fly to Pip. */
  const toPip = () => sceneRef.current?.pip() ?? null;

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

  return { give, buyThing };
};
