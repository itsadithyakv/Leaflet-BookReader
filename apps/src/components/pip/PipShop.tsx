import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { ShopKind } from "../../pip/shop";
import { UiIcon, type UiIconName } from "../UiIcon";
import { CountUp } from "../community/CountUp";
import { shortfall } from "./shopParts";

/** What previewing an entry on Pip changes: the look, and a move to show it off. */
export type PreviewLook = { variant?: string; outfit?: string[]; move?: string };

/** One thing in the shop, as the shop shows it. */
export type ShopEntry = {
  kind: ShopKind;
  id: string;
  name: string;
  blurb?: string | null;
  price: number;
  owned: boolean;
  /** A badge for an owned thing: "Equipped", "In the house", "Signature"... */
  badge?: string | null;
  /** Why it cannot be bought yet (earned by reading, a floor first...). */
  locked?: string | null;
  /** Bought each time it is used (snacks), so never "owned". */
  consumable?: boolean;
  art: (size: number, hot: boolean) => ReactNode;
  /** Can be tried on Pip before buying. */
  preview?: PreviewLook | null;
  /** The book it nods to, and whether that book is in the reader's library. */
  nod?: string | null;
  fromLibrary?: boolean;
  /** What to do with it once owned (or, for a snack, instead of buying). */
  use?: { label: string; run: () => void } | null;
};

export type ShopCategory = { id: string; label: string; icon: UiIconName; note?: string; entries: ShopEntry[] };

type PipShopProps = {
  categories: ShopCategory[];
  balance: number;
  initial?: string;
  onBuy: (entry: ShopEntry) => void;
  onPreview: (entry: ShopEntry) => void;
  onClose: () => void;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * What the detail pane shows before anything is chosen: the dearest thing in
 * this tab the reader can buy now, or else the cheapest one still to save for,
 * so the pane is a goal rather than a blank.
 */
const suggest = (entries: ShopEntry[], balance: number) => {
  const open = entries.filter((entry) => !entry.owned && !entry.locked && !entry.consumable && entry.price > 0);
  const reach = open.filter((entry) => entry.price <= balance).sort((a, b) => b.price - a.price)[0];
  if (reach) return { entry: reach, heading: "Within reach" };
  const goal = [...open].sort((a, b) => a.price - b.price)[0];
  return goal ? { entry: goal, heading: "Your next goal" } : null;
};

/**
 * The shop, made to be easy to read: a tab per kind of thing, big tiles with
 * the thing drawn large, a price chip on each, "Owned" and "Equipped" badges,
 * and what is out of reach greyed with how much more reading it takes.
 * Selecting a tile opens it on the right: a big preview, what it is, and the
 * buttons (try it on Pip first, buy, wear, place). Until something is chosen
 * the pane suggests something: within reach now, or the next thing to save for.
 *
 * A modal dialog: tabs are a tablist (arrows move between them), tiles are
 * buttons, and Escape closes.
 */
export const PipShop = ({ categories, balance, initial, onBuy, onPreview, onClose }: PipShopProps) => {
  const [tab, setTab] = useState(() => categories.find((category) => category.id === initial)?.id ?? categories[0]?.id);
  const [chosen, setChosen] = useState<string | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const category = categories.find((entry) => entry.id === tab) ?? categories[0];
  const entries = category?.entries ?? [];
  const selected = useMemo(() => entries.find((entry) => `${entry.kind}:${entry.id}` === chosen) ?? null, [entries, chosen]);
  const suggestion = useMemo(() => (selected ? null : suggest(entries, balance)), [selected, entries, balance]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    tabRefs.current[categories.findIndex((entry) => entry.id === tab)]?.focus();
    return () => {
      if (before && document.contains(before)) before.focus();
    };
    // Focus once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let to: number | null = null;
    if (event.key === "ArrowRight") to = (index + 1) % categories.length;
    if (event.key === "ArrowLeft") to = (index - 1 + categories.length) % categories.length;
    if (event.key === "Home") to = 0;
    if (event.key === "End") to = categories.length - 1;
    if (to !== null) {
      event.preventDefault();
      setTab(categories[to].id);
      setChosen(null);
      tabRefs.current[to]?.focus();
    }
  };

  const statusOf = (entry: ShopEntry) => {
    if (entry.owned && !entry.consumable) return { text: entry.badge ?? "Owned", tone: "owned" as const };
    if (entry.locked) return { text: entry.locked, tone: "locked" as const };
    const lacking = shortfall(entry.price, balance);
    if (lacking) return { text: `${plural(lacking.short, "more seed")} · ~${lacking.minutes} min of reading`, tone: "short" as const };
    return null;
  };

  return (
    <div className="pip-shop-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="pip-shop modal-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pip-shop-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="pip-shop-head">
          <div className="min-w-0">
            <h2 id="pip-shop-title" className="page-title text-3xl text-on-surface">
              Shop
            </h2>
            <p className="text-xs text-on-surface-variant">Seeds grow in Pip's garden, watered by your reading.</p>
          </div>
          <span className="pip-shop-balance" aria-label={`${plural(balance, "seed")} to spend`}>
            <UiIcon name="seed" size={18} />
            <span className="tabular-nums">
              <CountUp value={balance} />
            </span>
          </span>
          <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="pip-shop-tabs" role="tablist" aria-label="Kinds of things">
          {categories.map((entry, index) => (
            <button
              key={entry.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`pip-shop-tab-${entry.id}`}
              aria-selected={entry.id === tab}
              aria-controls="pip-shop-panel"
              tabIndex={entry.id === tab ? 0 : -1}
              className="pip-tab"
              onClick={() => {
                setTab(entry.id);
                setChosen(null);
              }}
              onKeyDown={(event) => onTabKey(event, index)}
            >
              <UiIcon name={entry.icon} size={16} />
              <span>{entry.label}</span>
            </button>
          ))}
        </div>

        <div className="pip-shop-body">
          <div id="pip-shop-panel" role="tabpanel" aria-labelledby={`pip-shop-tab-${tab}`} className="pip-shop-grid-wrap">
            {category?.note && <p className="mb-2 text-xs text-on-surface-variant">{category.note}</p>}
            {entries.length === 0 ? (
              <p className="rounded-xl bg-surface-container-high/50 px-4 py-6 text-center text-sm text-on-surface-variant">Nothing here yet.</p>
            ) : (
              // Keyed by the tab, so a new tab's cards deal in rather than swapping in place.
              <div key={tab} className="pip-shop-grid">
                {entries.map((entry, index) => {
                  const key = `${entry.kind}:${entry.id}`;
                  const status = statusOf(entry);
                  const isHot = hot === key || chosen === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className="pip-shop-card"
                      style={{ "--i": Math.min(index, 12) } as CSSProperties}
                      data-tone={status?.tone ?? "buy"}
                      aria-pressed={chosen === key}
                      aria-label={`${entry.name}. ${entry.owned && !entry.consumable ? entry.badge ?? "Owned" : `${entry.price} seeds`}. ${status && status.tone !== "owned" ? status.text : ""}${entry.fromLibrary ? " From your library." : ""}`}
                      onClick={() => setChosen(key)}
                      onMouseEnter={() => setHot(key)}
                      onMouseLeave={() => setHot((current) => (current === key ? null : current))}
                      onFocus={() => setHot(key)}
                      onBlur={() => setHot((current) => (current === key ? null : current))}
                    >
                      {entry.fromLibrary && <span className="pip-shop-ribbon">From your library</span>}
                      <span className="pip-shop-card-art">{entry.art(84, isHot)}</span>
                      <span className="pip-shop-card-name">{entry.name}</span>
                      <span className="pip-shop-card-foot">
                        {entry.owned && !entry.consumable ? (
                          <span className="pip-badge" data-tone="owned">
                            <UiIcon name="check" size={12} />
                            {entry.badge ?? "Owned"}
                          </span>
                        ) : (
                          <span className={`seed-chip ${status?.tone === "short" || status?.tone === "locked" ? "seed-chip-short" : ""}`}>
                            <UiIcon name="seed" size={12} />
                            {entry.price}
                          </span>
                        )}
                        {status && status.tone !== "owned" && <span className="pip-shop-card-note">{status.text}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="pip-shop-detail" aria-live="polite">
            {selected ? (
              <Detail key={chosen} entry={selected} status={statusOf(selected)} balance={balance} onBuy={onBuy} onPreview={onPreview} />
            ) : suggestion ? (
              <>
                <p className="pip-shop-suggest">
                  <UiIcon name="sparkle" size={13} />
                  {suggestion.heading}
                </p>
                <Detail
                  key={`suggest-${suggestion.entry.kind}:${suggestion.entry.id}`}
                  entry={suggestion.entry}
                  status={statusOf(suggestion.entry)}
                  balance={balance}
                  onBuy={onBuy}
                  onPreview={onPreview}
                />
                <p className="mt-4 text-center text-[11px] text-on-surface-variant">Or select anything to see it here.</p>
              </>
            ) : (
              <div className="pip-shop-detail-empty">
                <UiIcon name="sparkle" size={22} />
                <p>Select something to see it big, try it on Pip, or buy it.</p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
};

const Detail = ({
  entry,
  status,
  balance,
  onBuy,
  onPreview
}: {
  entry: ShopEntry;
  status: { text: string; tone: "owned" | "locked" | "short" } | null;
  balance: number;
  onBuy: (entry: ShopEntry) => void;
  onPreview: (entry: ShopEntry) => void;
}) => {
  const canBuy = !entry.locked && (!entry.owned || entry.consumable) && balance >= entry.price && !entry.use;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <span className="pip-shop-detail-art">{entry.art(144, true)}</span>
      <div>
        <p className="font-headline text-xl font-bold text-on-surface">{entry.name}</p>
        {entry.nod && (
          <p className="mt-0.5 text-xs text-on-surface-variant">
            A nod to <em>{entry.nod}</em>
            {entry.fromLibrary ? ", which is in your library." : "."}
          </p>
        )}
        {entry.blurb && <p className="mt-1 text-xs text-on-surface-variant">{entry.blurb}</p>}
      </div>
      <p className="flex flex-wrap items-center justify-center gap-2">
        {entry.owned && !entry.consumable ? (
          <span className="pip-badge" data-tone="owned">
            <UiIcon name="check" size={12} />
            {entry.badge ?? "Owned"}
          </span>
        ) : (
          <span className="seed-chip">
            <UiIcon name="seed" size={12} />
            {entry.price}
          </span>
        )}
        {status && status.tone !== "owned" && <span className="text-xs text-on-surface-variant">{status.text}</span>}
      </p>
      <div className="flex w-full flex-col gap-2">
        {entry.preview && (
          <button type="button" className="tactile-button px-4 py-2 text-xs" onClick={() => onPreview(entry)}>
            <span className="inline-flex items-center gap-1.5">
              <UiIcon name="preview" size={14} />
              Preview on Pip
            </span>
          </button>
        )}
        {entry.use && (
          <button type="button" className="tactile-button tactile-button-primary px-4 py-2 text-xs" onClick={entry.use.run}>
            {entry.use.label}
          </button>
        )}
        {(!entry.owned || entry.consumable) && !entry.use && (
          <button
            type="button"
            className="tactile-button tactile-button-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => onBuy(entry)}
            disabled={!canBuy}
          >
            {entry.locked ? "Not yet" : balance >= entry.price ? `Buy for ${entry.price}` : "Keep reading"}
          </button>
        )}
      </div>
    </div>
  );
};
