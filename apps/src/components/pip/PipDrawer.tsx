import { useEffect, useRef, type ReactNode } from "react";

type PipDrawerProps = {
  title: string;
  /** A line under the title. */
  note?: ReactNode;
  onClose: () => void;
  children: ReactNode;
};

/**
 * A panel that slides over the side of Pip's house: the wardrobe, the shop,
 * treats, moves, decorating. Non-modal, so the house stays live beside it
 * (Pip reacts, a placed lamp lights up at once). Escape or Close shuts it and
 * focus goes back to the button that opened it.
 */
export const PipDrawer = ({ title, note, onClose, children }: PipDrawerProps) => {
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
      className="pip-drawer modal-surface"
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
};
