import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackLayer } from "../../platform/back";
import { usePhoneMenus, useSheetLayout } from "../../hooks/useMediaQuery";
import { backdropClose } from "../ui/backdrop";
import { SheetHandle } from "../ui/SheetHandle";
import { InfoTip } from "../ui/InfoTip";

type Props = {
  title: string;
  /** What the title means, behind an (i). */
  note: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * The frame of the library-owner questions: a sheet from the bottom on a
 * phone (as `ui/PhoneSheet`), a small dialog in the middle elsewhere. A tap
 * outside, Back, Escape and a pull on the grip close it.
 */
export const OwnerSheetFrame = ({ title, note, onClose, children }: Props) => {
  const narrow = useSheetLayout();
  const phoneMenus = usePhoneMenus();
  const sheet = narrow || phoneMenus;
  useBackLayer(true, onClose);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const heading = (
    <div className="mb-4 flex items-center gap-2">
      <h2 className="page-title text-xl text-on-surface">{title}</h2>
      <InfoTip text={note} />
    </div>
  );

  return createPortal(
    sheet ? (
      <div className="sheet-backdrop sheet-backdrop-menu fixed inset-0 z-[85] flex items-end justify-center bg-black/45" {...backdropClose(onClose)}>
        <div role="dialog" aria-label={title} className="modal-surface sheet-panel phone-sheet w-full p-4 text-sm text-on-surface">
          <SheetHandle onClose={onClose} />
          {heading}
          {children}
        </div>
      </div>
    ) : (
      <div className="sheet-backdrop fixed inset-0 z-[85] flex items-center justify-center bg-black/50 px-4" {...backdropClose(onClose)}>
        <div role="dialog" aria-modal="true" aria-label={title} className="modal-surface confirm-pop dialog-fit sheet-panel w-full max-w-sm rounded-2xl p-6 text-sm text-on-surface">
          <SheetHandle onClose={onClose} />
          {heading}
          {children}
        </div>
      </div>
    ),
    document.body
  );
};

/** One answer in the frame: a full-width button, and what it does behind an (i) beside it. */
export const OwnerChoice = ({
  label,
  note,
  onClick,
  primary = false,
  danger = false,
  disabled = false
}: {
  label: string;
  note: string;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) => (
  <div className="mt-2 flex items-center gap-2">
    <button
      type="button"
      className={`tactile-button flex-1 px-4 py-2.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${primary ? "tactile-button-primary" : ""} ${danger ? "text-error" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
    <InfoTip text={note} />
  </div>
);
