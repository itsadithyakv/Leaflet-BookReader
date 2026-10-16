import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackLayer } from "../../platform/back";
import { backdropClose } from "./backdrop";
import { SheetHandle } from "./SheetHandle";

type PhoneSheetProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * A sheet of choices on a phone: up from the bottom held upright, at the side of the thumb held
 * sideways (styles/touch-shell.css, `.phone-sheet`). A tap outside, Back, Escape and a pull on
 * its grip close it. Rendered only while open.
 */
export const PhoneSheet = ({ title, onClose, children }: PhoneSheetProps) => {
  useBackLayer(true, onClose);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="sheet-backdrop sheet-backdrop-menu fixed inset-0 z-[80] flex items-end justify-center bg-black/45" {...backdropClose(onClose)}>
      <div role="dialog" aria-label={title} className="modal-surface sheet-panel phone-sheet w-full p-4 text-sm text-on-surface">
        <SheetHandle onClose={onClose} />
        <h2 className="page-title mb-3 text-xl">{title}</h2>
        {children}
      </div>
    </div>,
    document.body
  );
};

/** One of a few choices in a sheet, a thumb high: pressed when it is the one chosen. */
export const SheetChoice = ({
  chosen,
  onClick,
  children,
  label
}: {
  chosen: boolean;
  onClick: () => void;
  children: ReactNode;
  label?: string;
}) => (
  <button type="button" className="sheet-choice" aria-pressed={chosen} aria-label={label} onClick={onClick}>
    {children}
  </button>
);
