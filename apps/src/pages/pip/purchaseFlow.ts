import { useCallback, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { ShopItem, ShopKind } from "../../pip/shop";
import { usePipWardrobeStore } from "../../store/pipWardrobeStore";
import { burst, centerOf, fly, reducedMotion, ring, type Box, type Captured, type Point } from "../../components/pip/fx";
import type { PreviewLook, ShopRequest } from "../../components/pip/PipShop";
import { askPurchase } from "../../components/pip/PurchaseConfirm";
import type { UndoToastItem } from "../../components/pip/UndoToast";
import { createGrace, isQuickBuy, type Grace, type GraceItem, type Pending } from "../../components/pip/quickBuy";
import { shortfall } from "../../components/pip/shopParts";
import { THANKS, errorText, pickOne, plural, wait } from "./common";

/** Where a bought thing goes once it is bought: it flies there, then `after` runs. */
export type Delivery = {
  to: () => Box | Point | null;
  /** Flies in a little card (a look, a move); bare art (decor) flies as itself. */
  card?: boolean;
  /** Shrinks into the target and is gone (Pip puts it on). */
  vanish?: boolean;
  /** What Pip says once it has arrived, instead of a thank-you. */
  line?: string;
};

/** A purchase worth asking about: the question, the purchase, and what happens once it is made. */
export type AskPlan = {
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
export type QuickPlan = {
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

/**
 * One quick purchase at a time waits out its toast (quickBuy.ts): the grace
 * period, the toast it shows, and its Undo.
 */
export const useGrace = (showToast: (message: string) => void) => {
  const [toast, setToast] = useState<UndoToastItem | null>(null);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const graceRef = useRef<ReturnType<typeof createGrace<QuickItem>> | null>(null);
  if (!graceRef.current) {
    graceRef.current = createGrace<QuickItem>({
      onChange: (pending: Pending<QuickItem> | null) =>
        setToast(pending ? { id: pending.id, label: pending.label, price: pending.price, art: pending.art, startedAt: pending.startedAt, endsAt: pending.endsAt } : null),
      onError: (cause) => showToastRef.current(errorText(cause))
    });
  }
  const grace = graceRef.current;

  const undo = useCallback((id: number) => {
    graceRef.current?.undo(id);
  }, []);

  return { grace, graceRef, toast, undo };
};

export type PendingDecor = { level: string; slot: string; itemId: string };
export type PendingPlant = { plot: number; plant: string };

/**
 * A quick purchase shows at once and is made a few seconds later: until
 * then these stand in for it. Seeds spent but not yet taken from the
 * wallet, a snack's cheer not yet in the mood, a hat not yet bought, a
 * lamp not yet placed, a packet not yet planted.
 */
export const useStandIns = () => {
  const [ahead, setAhead] = useState(0);
  const [moodAhead, setMoodAhead] = useState(0);
  const [pendingLook, setPendingLook] = useState<PreviewLook | null>(null);
  const [pendingDecor, setPendingDecor] = useState<PendingDecor | null>(null);
  const [pendingPlant, setPendingPlant] = useState<PendingPlant | null>(null);
  // Stand-ins that arrive after a flight check they are still wanted (not undone mid-air).
  const standIn = useRef(0);
  return { ahead, setAhead, moodAhead, setMoodAhead, pendingLook, setPendingLook, pendingDecor, setPendingDecor, pendingPlant, setPendingPlant, standIn };
};

type PurchaseFlowOptions = {
  grace: Grace<QuickItem>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  /** Seeds to spend now: the wallet, less a quick purchase still in its grace period. */
  spendable: number;
  setAhead: Dispatch<SetStateAction<number>>;
  buy: (kind: ShopKind, id: string) => Promise<void>;
  play: (move: string, loops?: number, text?: string | null) => void;
  artFor: (kind: ShopKind, id: string, size: number) => ReactNode;
  /** The art of what was just chosen on the page, for effects to start from. */
  clickedArt: () => Captured | null;
  shopOpen: ShopRequest | null;
  closeShop: () => void;
  showToast: (message: string) => void;
};

/**
 * How a purchase plays out: dearer things are asked about, then bought and
 * delivered; cheap ones happen at once and are bought when the toast's few
 * seconds are up, unless undone. Made afresh each render, like the page's
 * other handlers, so it reads that render's seeds and shop.
 */
export const purchaseFlow = ({ grace, busy, setBusy, spendable, setAhead, buy, play, artFor, clickedArt, shopOpen, closeShop, showToast }: PurchaseFlowOptions) => {
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

  return { purchase, spend };
};
