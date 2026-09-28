import { useState, type ReactNode } from "react";
import { UiIcon, type UiIconName } from "../UiIcon";

/**
 * The small pieces the Pip tab's drawers are built from: a grid of tiles, a
 * price in seeds, a status line. Shared by the wardrobe, the shop, treats,
 * moves and decorating, so they all look and behave alike.
 */

/**
 * Seeds a minute of focused reading grows, roughly: a clean minute is 1.5
 * water, and the garden's best plants give about a third of a seed per water.
 * Used only to say "about N minutes of reading"; habit/seeds.rs is the truth.
 */
export const SEEDS_PER_MINUTE = 0.5;

/** What an item still costs in reading, for a can't-afford tile. */
export const shortfall = (price: number, balance: number) => {
  const short = price - balance;
  return short > 0 ? { short, minutes: Math.ceil(short / SEEDS_PER_MINUTE) } : null;
};

export const Group = ({ title, note, children }: { title: string; note?: string; children: ReactNode }) => (
  <div className="mt-5 first:mt-0">
    <p className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">{title}</p>
    {note && <p className="mt-0.5 text-xs text-on-surface-variant">{note}</p>}
    <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(6.5rem, 1fr))" }}>
      {children}
    </div>
  </div>
);

export const Empty = ({ children }: { children: ReactNode }) => (
  <p className="mt-4 rounded-xl bg-surface-container-high/50 px-4 py-6 text-center text-sm text-on-surface-variant">{children}</p>
);

export const Status = ({ icon, children }: { icon?: UiIconName; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-on-surface-variant">
    {icon && <UiIcon name={icon} size={12} />}
    {children}
  </span>
);

/** A price in seeds; dimmed, with the minutes it would take, when out of reach. */
export const PriceTag = ({ price, balance }: { price: number; balance: number }) => {
  const lacking = shortfall(price, balance);
  return (
    <span
      className={`seed-chip ${lacking ? "seed-chip-short" : ""}`}
      title={lacking ? `${lacking.short} more seeds: about ${lacking.minutes} minutes of focused reading` : undefined}
    >
      <UiIcon name="seed" size={12} />
      {price}
    </span>
  );
};

type TileProps = {
  name: string;
  /** Spoken in full: what it is and what selecting it does. */
  label: string;
  /** Shown on hover. */
  hint?: string;
  art: (hot: boolean) => ReactNode;
  status: ReactNode;
  selected?: boolean;
  onSelect: () => void;
};

/**
 * One thing in a grid. The art only animates while the tile is hovered or
 * focused, so a grid of forty Pips stays calm (they share one 12 fps clock).
 */
export const Tile = ({ name, label, hint, art, status, selected = false, onSelect }: TileProps) => {
  const [hot, setHot] = useState(false);
  return (
    <button
      type="button"
      className="pip-shop-tile"
      aria-pressed={selected}
      aria-label={label}
      title={hint}
      onClick={onSelect}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
    >
      <span className="pip-shop-art">{art(hot)}</span>
      <span className="w-full truncate text-xs font-semibold text-on-surface">{name}</span>
      {status}
    </button>
  );
};

type MoveCardProps = {
  name: string;
  art: (hot: boolean) => ReactNode;
  status: ReactNode;
  selected: boolean;
  onPreview: () => void;
  action: { label: string; run: () => void } | null;
};

/** A move: a preview in the room, and buy or make it the signature. */
export const MoveCard = ({ name, art, status, selected, onPreview, action }: MoveCardProps) => {
  const [hot, setHot] = useState(false);
  return (
    <div
      className="pip-shop-tile pip-move-card"
      data-selected={selected || undefined}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
    >
      <span className="pip-shop-art">{art(hot)}</span>
      <span className="w-full truncate text-xs font-semibold text-on-surface">{name}</span>
      {status}
      <span className="mt-1 flex w-full gap-1.5">
        <button type="button" className="tactile-button flex-1 px-2 py-1 text-[11px]" onClick={onPreview} aria-label={`Preview ${name}`}>
          Preview
        </button>
        {action && (
          <button type="button" className="tactile-button tactile-button-primary flex-1 px-2 py-1 text-[11px]" onClick={action.run} aria-label={`${action.label}: ${name}`}>
            {action.label}
          </button>
        )}
      </span>
    </div>
  );
};
