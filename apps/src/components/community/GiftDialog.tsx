import { useEffect, useMemo, useRef, useState } from "react";
import { catalogue, type ShopItem } from "../../pip/shop";
import { friendsService } from "../../services/friendsService";
import { seedExtras, seedService } from "../../services/seedService";
import type { CommunityPerson } from "../../services/socialService";
import { usePipWardrobeStore } from "../../store/pipWardrobeStore";
import { UiIcon } from "../UiIcon";
import { PipSprite } from "../PipSprite";
import { PixelImage } from "../pip/PixelImage";
import { renderFinish, renderItem } from "../../pip/home.js";
import { at, errorText, nameOf } from "./format";
import { SheetHandle } from "../ui/SheetHandle";
import { useBackClose } from "../../hooks/useBackClose";
import { isTouchInput } from "../../platform/device";

/** The kinds of thing that can be given: ones Pip keeps. Food and seed packets are used up, floors and plots are a reader's own. */
const KINDS: Partial<Record<ShopItem["kind"], string>> = {
  accessory: "To wear",
  room: "For the house",
  wallpaper: "Wallpaper",
  flooring: "Flooring",
  skin: "A look",
  move: "A move"
};

/** The kinds as tabs, in the order a present is most often chosen from. */
type Tab = "all" | "wear" | "house" | "look";
const TABS: Array<{ id: Tab; label: string; kinds: Array<ShopItem["kind"]> | null }> = [
  { id: "all", label: "All", kinds: null },
  { id: "wear", label: "To wear", kinds: ["accessory"] },
  { id: "house", label: "For the house", kinds: ["room", "wallpaper", "flooring"] },
  { id: "look", label: "Looks & moves", kinds: ["skin", "move"] }
];

/** A thing's picture, as the shop draws it: worn by a Pip, as a Pip, Pip doing it, or the thing itself. */
const GiftArt = ({ item, size }: { item: ShopItem; size: number }) => {
  if (item.kind === "accessory") return <PipSprite move="idle" still size={size} skin="sprout" outfit={[item.id]} snap="nearest" />;
  if (item.kind === "skin") return <PipSprite move="idle" still size={size} skin={item.id} outfit={[]} snap="nearest" />;
  if (item.kind === "move") return <PipSprite move={item.id} still size={size} skin="sprout" outfit={[]} snap="nearest" />;
  if (item.kind === "wallpaper" || item.kind === "flooring") {
    const finish = item.kind === "wallpaper" ? "wallpaper" : "floor";
    return <PixelImage render={() => renderFinish(finish, item.id, 48, 48)} drawKey={`${finish}-${item.id}-${size}`} box={size} />;
  }
  return <PixelImage render={() => renderItem(item.id, 0)} drawKey={`item-${item.id}-${size}`} box={size} />;
};

/** Whether a thing can be bought for someone else (Rust's rule, `pip/gifts.rs`, said here to list only those). */
export const giftable = (item: ShopItem, level: number): boolean =>
  item.kind in KINDS && item.price > 0 && !item.earnedOnly && !item.consumable && !item.freeWith && (item.level ?? 0) <= level;

type Props = {
  to: CommunityPerson;
  onClose: () => void;
  showToast: (message: string) => void;
};

/**
 * Buying a friend's Pip a present: a thing from the shop, paid for in this
 * reader's seeds, that is theirs when they next open the app. Only between
 * readers who follow each other (the server sees to that), and only things
 * this reader could buy for themself.
 */
export const GiftDialog = ({ to, onClose, showToast }: Props) => {
  const overview = usePipWardrobeStore((state) => state.overview);
  const load = usePipWardrobeStore((state) => state.load);
  const balance = overview?.wallet.balance ?? 0;
  const level = seedExtras(overview).level?.level ?? 1;
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [picked, setPicked] = useState<ShopItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  useBackClose(true, () => (busy ? false : onClose()));

  useEffect(() => {
    // The balance on the Social page may never have been asked for.
    if (!overview) {
      void load();
    }
    // Not on a phone: the keyboard would come up over the presents before anything was asked of it.
    if (!isTouchInput()) {
      field.current?.focus();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const things = useMemo(() => catalogue().filter((item) => giftable(item, level)).sort((a, b) => a.price - b.price || a.name.localeCompare(b.name)), [level]);
  const wanted = query.trim().toLowerCase();
  const kinds = TABS.find((entry) => entry.id === tab)?.kinds ?? null;
  const shown = things.filter((item) => (!kinds || kinds.includes(item.kind)) && (!wanted || item.name.toLowerCase().includes(wanted)));

  const send = async () => {
    if (!picked) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The server first: it says whether these two may send each other things, and names the gift.
      const giftId = await friendsService.sendGift(to.handle, picked.kind, picked.id);
      await seedService.sendGift(picked.kind, picked.id, to.handle, giftId);
      showToast(`${picked.name} is on its way to ${at(to.handle)}.`);
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop fixed inset-0 z-[85] flex items-center justify-center bg-black/55 px-4 py-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-surface sheet-panel sheet-inner-scroll flex max-h-full w-full max-w-lg flex-col p-6" role="dialog" aria-modal="true" aria-labelledby="gift-dialog-title">
        <SheetHandle onClose={onClose} />
        <h2 id="gift-dialog-title" className="page-title text-2xl">
          A present for {nameOf(to)}
        </h2>
        <p className="mt-1 flex items-center gap-1.5 text-xs tabular-nums text-on-surface-variant">
          <UiIcon name="seed" size={13} className="text-primary" /> {balance} to spend
        </p>
        <input
          ref={field}
          className="inset-field mt-3 w-full px-3 py-2 text-sm text-on-surface"
          placeholder="Find a thing"
          aria-label="Find a thing"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Kinds of present">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={`tactile-button px-3 py-1 text-[11px] ${tab === entry.id ? "tactile-button-primary" : ""}`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {/* Each thing as a tile with its picture: what it is is seen, not read. */}
        <ul className="gift-grid mt-3 grid min-h-[8rem] flex-1 grid-cols-3 content-start gap-2 overflow-y-auto pr-1 sm:grid-cols-4" role="listbox" aria-label="Things to give">
          {shown.map((item) => {
            const on = picked?.kind === item.kind && picked.id === item.id;
            const short = item.price > balance;
            return (
              <li key={`${item.kind}:${item.id}`} className="list-none">
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  aria-label={`${item.name}, ${KINDS[item.kind]?.toLowerCase()}, ${item.price} seeds`}
                  disabled={short}
                  title={short ? `${item.price - balance} more seeds needed` : `${item.name} · ${KINDS[item.kind]}`}
                  className={`flex w-full flex-col items-center gap-1 rounded-xl px-1.5 pb-2 pt-2.5 text-center transition-colors disabled:opacity-45 ${
                    on ? "bg-primary/15 ring-2 ring-primary" : "bg-surface-container-high/40 hover:bg-surface-container-high"
                  }`}
                  onClick={() => setPicked(item)}
                >
                  <span className="flex h-14 w-14 items-center justify-center" aria-hidden>
                    <GiftArt item={item} size={56} />
                  </span>
                  <span className="w-full truncate text-[11px] font-semibold leading-tight text-on-surface">{item.name}</span>
                  <span className="flex items-center gap-1 text-[11px] tabular-nums text-on-surface-variant">
                    <UiIcon name="seed" size={11} className="text-primary" /> {item.price}
                  </span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className="col-span-full list-none px-3 py-2 text-sm text-on-surface-variant">Nothing by that name.</li>}
        </ul>
        {error && <p className="mt-2 rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-surface">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="tactile-button px-4 py-2 text-xs" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="tactile-button tactile-button-primary px-4 py-2 text-xs font-semibold disabled:opacity-60" disabled={busy || !picked || picked.price > balance} onClick={() => void send()}>
            {busy ? "Sending…" : picked ? `Send · ${picked.price} seeds` : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
};
