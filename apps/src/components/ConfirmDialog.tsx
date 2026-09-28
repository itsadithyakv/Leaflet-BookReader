import { useEffect, useRef } from "react";
import { create } from "zustand";
import { PipSprite } from "./PipSprite";

/**
 * Leaflet's own yes/no dialog.
 *
 * `window.confirm` in WebView2 is a grey system box titled with the page's
 * origin, and in fullscreen it can open behind the window. This one is part of
 * the app: themed, keyboard-driven, and it can have Pip in it.
 */
export type ConfirmRequest = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as the risky choice; the safe one gets focus either way. */
  danger?: boolean;
  /** A Pip move shown above the title. */
  pip?: string;
};

type Pending = ConfirmRequest & { id: number; resolve: (ok: boolean) => void };

type ConfirmState = {
  pending: Pending | null;
  ask: (request: ConfirmRequest) => Promise<boolean>;
  settle: (ok: boolean) => void;
};

let nextId = 1;

const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,
  ask(request) {
    // A second question replaces the first, which counts as "no": the caller
    // that asked first must never be left waiting forever.
    get().pending?.resolve(false);
    return new Promise<boolean>((resolve) => {
      set({ pending: { ...request, id: nextId++, resolve } });
    });
  },
  settle(ok) {
    const pending = get().pending;
    if (!pending) {
      return;
    }
    set({ pending: null });
    pending.resolve(ok);
  }
}));

/** Asks the reader a yes/no question in the app's own dialog. */
export const askConfirm = (request: ConfirmRequest) => useConfirmStore.getState().ask(request);

/** Mounted once, at the top of the app. */
export const ConfirmDialog = () => {
  const pending = useConfirmStore((state) => state.pending);
  const settle = useConfirmStore((state) => state.settle);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!pending) {
      return;
    }
    cancelRef.current?.focus();
    // Capture phase, so the reader's own Escape (close the book) never sees it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        settle(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pending, settle]);

  if (!pending) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          settle(false);
        }
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`confirm-title-${pending.id}`}
        className="modal-surface confirm-pop w-full max-w-sm rounded-2xl p-6 text-center"
      >
        {pending.pip && (
          <div className="mb-2 flex justify-center">
            <PipSprite move={pending.pip} size={72} playKey={pending.id} />
          </div>
        )}
        <h2 id={`confirm-title-${pending.id}`} className="page-title text-xl text-on-surface">
          {pending.title}
        </h2>
        {pending.body && <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{pending.body}</p>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          <button
            ref={cancelRef}
            type="button"
            className="tactile-button tactile-button-primary px-5 py-2 text-xs font-semibold uppercase tracking-[0.16em]"
            onClick={() => settle(false)}
          >
            {pending.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className={`tactile-button px-5 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${
              pending.danger ? "text-error" : ""
            }`}
            onClick={() => settle(true)}
          >
            {pending.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
};
