import { useEffect } from "react";
import { SheetHandle } from "../ui/SheetHandle";
import { useBackClose } from "../../hooks/useBackClose";
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
  useBackClose(open, close);

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
    <div className="sheet-backdrop fixed inset-0 z-[88] flex overflow-y-auto overscroll-contain bg-black/60 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={firstRun ? "Create your Leaflet account" : "Leaflet account"}
        className="modal-surface confirm-pop sheet-panel relative m-auto w-full max-w-sm rounded-2xl p-6"
      >
        <SheetHandle onClose={close} />
        <button
          type="button"
          className="touch-hit absolute right-4 top-4 rounded-full px-2 py-1 text-xs text-on-surface-variant hover:text-on-surface"
          onClick={close}
          aria-label={firstRun ? "Skip for now" : "Close"}
        >
          <UiIcon name="close" size={16} />
        </button>
        {/* First run: Pip says hello, and "Skip for now" is said, not only an X. */}
        {firstRun && (
          <div className="mb-2 flex justify-center">
            <PipSprite move="welcome" size={44} loops={2} />
          </div>
        )}
        <AccountForm
          key={`${mode}-${firstRun}`}
          initialMode={mode}
          besideClose
          onDone={(message) => {
            close();
            showToast(message);
          }}
        />
        {firstRun && (
          <div className="mt-3 flex justify-center">
            <button type="button" className="py-1 text-xs font-semibold text-on-surface-variant hover:text-on-surface" onClick={close}>
              Skip for now
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
