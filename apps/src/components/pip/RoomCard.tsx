import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { UiIcon } from "../UiIcon";
import type { Rect } from "./layout";
import { placeCard, type CardPlace } from "./cardPlace";

type RoomCardProps = {
  title: string;
  /** A line under the title. */
  note?: ReactNode;
  /** "narrow": a note, a short list. "wide": a calendar, an album. */
  size?: "narrow" | "wide";
  /** Where the thing it belongs to is on screen now; null once it is not (the floor changed). */
  anchor: () => Rect | null;
  /** The thing's own button: a press on it is not a press elsewhere (it shuts the card itself). */
  owner?: () => Element | null;
  onClose: () => void;
  children: ReactNode;
};

/**
 * A small card over Pip's room, by the thing that opened it: the books in her
 * bookcase, the notes on her fridge. The room's own things open their panels
 * in one of these (components/pip/furnishings.tsx), so a panel brings only
 * what is in it: the card is the frame, the title and Close, and it closes on
 * Escape or a click elsewhere and puts the focus back on the thing. Non-modal,
 * like the drawers: the house stays live behind it. It is laid over the whole
 * window (a portal), so the room's edge does not clip it, and placed so as
 * not to cover its thing (cardPlace.ts).
 */
export const RoomCard = ({ title, note, size = "narrow", anchor, owner, onClose, children }: RoomCardProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [place, setPlace] = useState<CardPlace | null>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;

  useLayoutEffect(() => {
    const measure = () => {
      const root = rootRef.current;
      const box = anchorRef.current();
      if (!root || !box) {
        closeRef.current();
        return;
      }
      const viewport = { left: 8, top: 8, width: window.innerWidth - 16, height: window.innerHeight - 16 };
      setPlace(placeCard(box, { width: root.offsetWidth, height: root.offsetHeight }, viewport));
    };
    measure();
    // What is in it may arrive late (a list still loading), and the room may still be settling to a new size.
    const watcher = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (rootRef.current) watcher?.observe(rootRef.current);
    const settle = window.setTimeout(measure, 460);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      watcher?.disconnect();
      window.clearTimeout(settle);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, []);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    headingRef.current?.focus({ preventScroll: true });
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !ownerRef.current?.()?.contains(target)) closeRef.current();
    };
    window.addEventListener("mousedown", onPointer, true);
    return () => {
      window.removeEventListener("mousedown", onPointer, true);
      // Back to the thing in the room (a press does not focus a button in every webview, so not simply to what had it).
      const back = (ownerRef.current?.() as HTMLElement | null | undefined) ?? before;
      if (back && document.contains(back)) back.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div
      ref={rootRef}
      className="pip-room-card"
      role="dialog"
      aria-modal="false"
      aria-labelledby="pip-room-card-title"
      data-size={size}
      data-side={place?.side ?? "above"}
      style={{ left: place?.left ?? -9999, top: place?.top ?? 0, ["--tail-at" as string]: `${place?.tailAt ?? 50}%` }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="pip-room-card-head">
        <div className="min-w-0">
          <h3 id="pip-room-card-title" ref={headingRef} tabIndex={-1} className="pip-room-card-title">
            {title}
          </h3>
          {note && <p className="pip-room-card-note">{note}</p>}
        </div>
        <button type="button" className="pip-room-card-close" onClick={onClose} aria-label={`Close: ${title}`} title="Close">
          <UiIcon name="close" size={14} />
        </button>
      </div>
      <div className="pip-room-card-body">{children}</div>
    </div>,
    document.body
  );
};
