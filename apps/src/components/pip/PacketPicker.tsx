import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Plant } from "../../pip/shop";
import { UiIcon } from "../UiIcon";
import { placeNear, type Rect } from "./layout";
import { shortfall } from "./shopParts";

type PacketPickerProps = {
  plot: number;
  packets: Plant[];
  /** Seeds to spend now. */
  balance: number;
  priceOf: (id: string) => number;
  /** Where the plot is on screen now; null once it is not (the floor changed). */
  anchor: () => Rect | null;
  art: (id: string) => ReactNode;
  onPick: (id: string) => void;
  onClose: () => void;
};

/**
 * Seed packets, right there over the empty plot that was selected: what each
 * takes (minutes of focus) and gives (seeds), and its price. It follows the
 * plot as the page scrolls, and closes on Escape, on a click elsewhere, or
 * once a packet is chosen. Packets are bought as they are planted, so every
 * one is here; those out of reach say how many seeds they want.
 */
export const PacketPicker = ({ plot, packets, balance, priceOf, anchor, art, onPick, onClose }: PacketPickerProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number; side: "above" | "below"; tailAt: number } | null>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const measure = () => {
      const root = rootRef.current;
      const box = anchorRef.current();
      if (!root || !box) {
        closeRef.current();
        return;
      }
      const viewport = { left: 8, top: 8, width: window.innerWidth - 16, height: window.innerHeight - 16 };
      setPlace(placeNear(box, { width: root.offsetWidth, height: root.offsetHeight }, viewport, { gap: 6 }));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [plot]);

  // The first packet the seeds run to has the focus, for the keyboard.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const buttons = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>(".pip-packet") ?? []);
    (buttons.find((button) => button.getAttribute("aria-disabled") !== "true") ?? buttons[0])?.focus();
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeRef.current();
    };
    window.addEventListener("mousedown", onPointer, true);
    return () => {
      window.removeEventListener("mousedown", onPointer, true);
      if (before && document.contains(before) && !rootRef.current?.contains(before)) before.focus();
    };
  }, [plot]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    const step = { ArrowRight: 1, ArrowDown: 3, ArrowLeft: -1, ArrowUp: -3 }[event.key];
    if (!step) return;
    const buttons = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>(".pip-packet") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, (at < 0 ? 0 : at) + step))];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      className="pip-picker"
      role="dialog"
      aria-label={`Seed packets for plot ${plot}`}
      data-side={place?.side ?? "above"}
      style={{ left: place?.left ?? -9999, top: place?.top ?? 0, ["--tail-at" as string]: `${place?.tailAt ?? 50}%` }}
      onKeyDown={onKeyDown}
    >
      <div className="pip-picker-head">
        <span>Plant in plot {plot}</span>
        <button type="button" className="pip-picker-close" onClick={onClose} aria-label="Close the seed packets">
          <UiIcon name="close" size={14} />
        </button>
      </div>
      <div className="pip-picker-grid">
        {packets.map((packet) => {
          const price = priceOf(packet.id);
          const lacking = shortfall(price, balance);
          return (
            <button
              key={packet.id}
              type="button"
              className="pip-packet"
              aria-disabled={lacking ? "true" : undefined}
              aria-label={`${packet.name}: ripe after ${packet.water} minutes of focus, gives ${packet.yield} seeds. Packet ${price} seeds.${lacking ? ` ${lacking.short} more seeds needed.` : ""}`}
              title={lacking ? `${lacking.short} more seeds: about ${lacking.minutes} minutes of focused reading` : packet.blurb}
              onClick={() => {
                if (!lacking) onPick(packet.id);
              }}
            >
              <span className="pip-packet-art">{art(packet.id)}</span>
              <span className="pip-packet-name">{packet.name}</span>
              <span className="pip-packet-deal" aria-hidden="true">
                <UiIcon name="water" size={10} />
                {packet.water}m
                <span className="pip-packet-arrow">→</span>
                <UiIcon name="seed" size={10} />
                {packet.yield}
              </span>
              <span className={`seed-chip ${lacking ? "seed-chip-short" : ""}`} aria-hidden="true">
                <UiIcon name="seed" size={11} />
                {price}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
