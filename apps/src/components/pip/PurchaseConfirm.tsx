import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { create } from "zustand";
import { UiIcon } from "../UiIcon";

/**
 * The question before a purchase worth asking about (QUICK_BUY_UNDER seeds
 * and up): the thing itself, big, what it costs and what is left after.
 * Buying is what the reader came to do, so Buy is the primary button and has
 * the focus; Cancel, Escape and the backdrop all back out.
 */
export type PurchaseRequest = {
  /** "Buy Top Hat?", "Give Pip a Cake?", "Open the Kitchen?" */
  title: string;
  price: number;
  /** Seeds to spend now, before this. */
  balance: number;
  art?: ReactNode;
  /** What it is or does, in a line. */
  note?: string | null;
  /** "Buy", "Give", "Plant", "Open", "Dig": the button says it with the price. */
  verb?: string;
};

type Pending = PurchaseRequest & { id: number; resolve: (ok: boolean) => void };

let nextId = 1;

const usePurchaseStore = create<{ pending: Pending | null; ask: (request: PurchaseRequest) => Promise<boolean>; settle: (ok: boolean) => void }>(
  (set, get) => ({
    pending: null,
    ask(request) {
      // A second question replaces the first, which counts as a no.
      get().pending?.resolve(false);
      return new Promise<boolean>((resolve) => set({ pending: { ...request, id: nextId++, resolve } }));
    },
    settle(ok) {
      const pending = get().pending;
      if (!pending) return;
      set({ pending: null });
      pending.resolve(ok);
    }
  })
);

/** Asks before spending; resolves true to buy. */
export const askPurchase = (request: PurchaseRequest) => usePurchaseStore.getState().ask(request);

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Mounted once, by the Pip tab. */
export const PurchaseConfirm = () => {
  const pending = usePurchaseStore((state) => state.pending);
  const settle = usePurchaseStore((state) => state.settle);
  const buyRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pending) return;
    const before = document.activeElement as HTMLElement | null;
    buyRef.current?.focus();
    // Capture phase, like the app's own confirm: the shop's Escape never sees it.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        settle(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (before && document.contains(before)) before.focus();
    };
  }, [pending, settle]);

  // Leaving the tab with the question open is a no.
  useEffect(() => () => usePurchaseStore.getState().settle(false), []);

  if (!pending) return null;

  // Tab stays on the two buttons.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  const left = pending.balance - pending.price;
  return (
    <div
      className="pip-confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) settle(false);
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`pip-confirm-title-${pending.id}`}
        aria-describedby={`pip-confirm-cost-${pending.id}`}
        className="pip-confirm"
        onKeyDown={onKeyDown}
      >
        {pending.art && (
          <div className="pip-confirm-art" aria-hidden="true">
            {pending.art}
          </div>
        )}
        <h2 id={`pip-confirm-title-${pending.id}`} className="pip-confirm-title">
          {pending.title}
        </h2>
        {pending.note && <p className="pip-confirm-note">{pending.note}</p>}
        <p id={`pip-confirm-cost-${pending.id}`} className="pip-confirm-cost">
          <span className="pip-confirm-price">
            <UiIcon name="seed" size={16} />
            {pending.price}
          </span>
          <span>{left >= 0 ? `${plural(left, "seed")} left after.` : `${plural(-left, "more seed")} needed.`}</span>
        </p>
        <div className="pip-confirm-actions">
          <button type="button" className="pip-key" onClick={() => settle(false)}>
            Cancel
          </button>
          <button ref={buyRef} type="button" className="pip-key pip-key-primary" onClick={() => settle(true)}>
            {pending.verb ?? "Buy"} for {pending.price}
          </button>
        </div>
      </div>
    </div>
  );
};
