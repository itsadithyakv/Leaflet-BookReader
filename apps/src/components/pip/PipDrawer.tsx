import { forwardRef, useEffect, useRef, type ReactNode } from "react";

type PipDrawerProps = {
  title: string;
  /** A line under the title. */
  note?: ReactNode;
  /** "short": the low sheet decorating uses on narrow windows, so the room's pins stay in view. */
  size?: "short";
  onClose: () => void;
  children: ReactNode;
};

/**
 * A panel beside Pip's house (a sheet at the bottom on narrow windows): Pip's
 * things, the garden, seeds and mood, what goes in a spot while decorating.
 * Non-modal, so the house stays live beside it (Pip reacts, a placed lamp
 * lights up at once). Escape or Close shuts it and focus goes back to the
 * button that opened it.
 */
export const PipDrawer = forwardRef<HTMLElement, PipDrawerProps>(function PipDrawer({ title, note, size, onClose, children }, ref) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    return () => {
      if (before && document.contains(before)) before.focus();
    };
  }, []);

  return (
    <aside
      ref={ref}
      className="pip-drawer modal-surface"
      data-size={size}
      role="dialog"
      aria-modal="false"
      aria-labelledby="pip-drawer-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="pip-drawer-head">
        <div className="min-w-0">
          <h3 id="pip-drawer-title" ref={headingRef} tabIndex={-1} className="page-title text-2xl text-on-surface outline-none">
            {title}
          </h3>
          {note && <p className="mt-0.5 text-xs text-on-surface-variant">{note}</p>}
        </div>
        <button type="button" className="tactile-button shrink-0 px-3 py-1.5 text-xs" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="pip-drawer-body">{children}</div>
    </aside>
  );
});
