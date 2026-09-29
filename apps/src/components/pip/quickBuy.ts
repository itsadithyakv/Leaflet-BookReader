/**
 * Quick purchases: a cookie, a seed packet, a 20-seed hat. Asking "are you
 * sure?" over a handful of seeds is friction, not safety, so below
 * QUICK_BUY_UNDER nothing is asked: the thing happens at once (Pip eats the
 * cookie, puts the hat on) and a toast offers to take it back.
 *
 * Rust has no refunds: a purchase is a record the ledger replays, and synced
 * records cannot be taken back safely. So "take it back" means it was never
 * bought. The page shows the result straight away, and the purchase itself is
 * made only when the toast's few seconds are up; Undo in that time puts the
 * page back as it was, and nothing was spent.
 */

/** Below this price a purchase is made without a question, with an undo instead. */
export const QUICK_BUY_UNDER = 30;

/** How long the toast can take a quick purchase back. */
export const GRACE_MS = 4500;

export const isQuickBuy = (price: number) => price > 0 && price < QUICK_BUY_UNDER;

/** A purchase waiting out its grace period. */
export type GraceItem = {
  /** Makes the purchase (the real call). Rejects with a readable message. */
  commit: () => Promise<void>;
  /** Takes back what the page showed before it was bought: an undo, or a refusal. */
  revert: () => void;
};

export type Pending<T extends GraceItem> = T & { id: number; startedAt: number; endsAt: number };

type Clock = {
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
  now: () => number;
};

const realClock: Clock = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now()
};

type GraceOptions<T extends GraceItem> = {
  ms?: number;
  /** The purchase waiting now, or null: what the toast shows. */
  onChange?: (pending: Pending<T> | null) => void;
  /** A purchase that failed when it was made (already reverted). */
  onError?: (cause: unknown, item: T) => void;
  clock?: Clock;
};

/**
 * One quick purchase at a time waits out its grace period, then is made.
 * Starting another makes the waiting one at once (the reader moved on
 * without taking it back), and so does `flush` (leaving the tab, or a bigger
 * purchase that must see the true balance). Purchases are made one after
 * another, in order, so the wallet's answers arrive in the order they were
 * spent.
 */
export const createGrace = <T extends GraceItem>({ ms = GRACE_MS, onChange, onError, clock = realClock }: GraceOptions<T> = {}) => {
  let pending: Pending<T> | null = null;
  let timer: unknown = null;
  let nextId = 1;
  let chain: Promise<void> = Promise.resolve();

  const stopTimer = () => {
    if (timer !== null) clock.clear(timer);
    timer = null;
  };

  /** Makes the waiting purchase now; resolves once every purchase so far is made. */
  const flush = () => {
    const item = pending;
    if (item) {
      pending = null;
      stopTimer();
      onChange?.(null);
      chain = chain.then(() =>
        item.commit().catch((cause) => {
          item.revert();
          onError?.(cause, item);
        })
      );
    }
    return chain;
  };

  return {
    /** Starts a grace period for this purchase; the one waiting before it is made now. */
    start(item: T) {
      void flush();
      const now = clock.now();
      const next = { ...item, id: nextId++, startedAt: now, endsAt: now + ms } as Pending<T>;
      pending = next;
      timer = clock.set(() => void flush(), ms);
      onChange?.(next);
      return next.id;
    },
    /** Takes back the waiting purchase (this one, when an id is given). False when it is too late. */
    undo(id?: number) {
      const item = pending;
      if (!item || (id !== undefined && item.id !== id)) return false;
      pending = null;
      stopTimer();
      onChange?.(null);
      item.revert();
      return true;
    },
    flush,
    current: () => pending
  };
};

export type Grace<T extends GraceItem> = ReturnType<typeof createGrace<T>>;
