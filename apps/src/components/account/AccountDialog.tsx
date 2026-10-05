import { useEffect } from "react";
import { create } from "zustand";
import { AccountForm, type AccountFormMode } from "./AccountForm";
import { PipSprite } from "../PipSprite";
import { UiIcon } from "../UiIcon";

/**
 * Signing in or creating an account, as a dialog: offered once after the
 * welcome screen on first launch (with "Skip for now"), and opened from the
 * profile menu any time after. Mounted once, at the top of the app.
 */
type AccountDialogState = {
  open: boolean;
  mode: AccountFormMode;
  /** The one-time offer on first launch, rather than one the reader asked for. */
  firstRun: boolean;
  show: (mode: AccountFormMode, firstRun?: boolean) => void;
  close: () => void;
};

export const useAccountDialog = create<AccountDialogState>((set) => ({
  open: false,
  mode: "signin",
  firstRun: false,
  show: (mode, firstRun = false) => set({ open: true, mode, firstRun }),
  close: () => set({ open: false })
}));

/** Set once the first-run offer has been made, so it is never made twice. */
export const ACCOUNT_OFFERED_KEY = "leaflet.accountOffered";

export const accountOffered = () => {
  try {
    return localStorage.getItem(ACCOUNT_OFFERED_KEY) === "1";
  } catch {
    return true;
  }
};

export const markAccountOffered = () => {
  try {
    localStorage.setItem(ACCOUNT_OFFERED_KEY, "1");
  } catch {
    // Offered again next launch at worst.
  }
};

export const AccountDialog = ({ showToast }: { showToast: (message: string) => void }) => {
  const { open, mode, firstRun, close } = useAccountDialog();

  useEffect(() => {
    if (!open) {
      return;
    }
    // Capture phase, so nothing underneath (the reader's own Escape) sees it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[88] flex overflow-y-auto overscroll-contain bg-black/60 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={firstRun ? "Create your Leaflet account" : "Leaflet account"}
        className="modal-surface confirm-pop relative m-auto w-full max-w-md rounded-2xl p-6"
      >
        <button
          type="button"
          className="absolute right-4 top-4 rounded-full px-2 py-1 text-xs text-on-surface-variant hover:text-on-surface"
          onClick={close}
          aria-label={firstRun ? "Skip for now" : "Close"}
        >
          <UiIcon name="close" size={16} />
        </button>
        {firstRun && (
          <div className="mb-4 flex items-center gap-3">
            <PipSprite move="welcome" size={56} loops={2} />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">One more thing</p>
          </div>
        )}
        <AccountForm
          key={`${mode}-${firstRun}`}
          initialMode={mode}
          welcoming={firstRun}
          intro={
            firstRun
              ? "Optional. It puts you and a Pip of your choosing on the weekly leaderboard, and your reading will carry over to the Leaflet mobile app. Everything else works without one."
              : undefined
          }
          onDone={(message) => {
            close();
            showToast(message);
          }}
        />
        {firstRun && (
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-outline-variant/30 pt-4">
            <p className="text-[11px] leading-relaxed text-on-surface-variant">You can do this later from your profile, top right.</p>
            <button type="button" className="tactile-button shrink-0 px-4 py-2 text-xs font-semibold" onClick={close}>
              Skip for now
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
