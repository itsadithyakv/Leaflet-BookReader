import { useEffect, useMemo, useRef, useState } from "react";
import { catalogue, type ShopItem } from "../../pip/shop";
import { friendsService } from "../../services/friendsService";
import { seedExtras, seedService } from "../../services/seedService";
import type { CommunityPerson } from "../../services/socialService";
import { usePipWardrobeStore } from "../../store/pipWardrobeStore";
import { UiIcon } from "../UiIcon";
import { at, errorText, nameOf } from "./format";

/** The kinds of thing that can be given: ones Pip keeps. Food and seed packets are used up, floors and plots are a reader's own. */
const KINDS: Partial<Record<ShopItem["kind"], string>> = {
  accessory: "To wear",
  room: "For the house",
  wallpaper: "Wallpaper",
  flooring: "Flooring",
  skin: "A look",
  move: "A move"
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
  const [picked, setPicked] = useState<ShopItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // The balance on the Social page may never have been asked for.
    if (!overview) {
      void load();
    }
    field.current?.focus();
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
  const shown = wanted ? things.filter((item) => item.name.toLowerCase().includes(wanted)) : things;

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
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 px-4 py-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-surface flex max-h-full w-full max-w-md flex-col p-6" role="dialog" aria-modal="true" aria-labelledby="gift-dialog-title">
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
        <ul className="mt-3 min-h-[8rem] flex-1 overflow-y-auto pr-1" role="listbox" aria-label="Things to give">
          {shown.map((item) => {
            const on = picked?.kind === item.kind && picked.id === item.id;
            const short = item.price > balance;
            return (
              <li key={`${item.kind}:${item.id}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  disabled={short}
                  title={short ? `${item.price - balance} more seeds needed` : undefined}
                  className={`flex w-full items-baseline gap-2 rounded-lg px-3 py-2 text-left text-sm disabled:opacity-50 ${on ? "bg-primary/15 text-on-surface" : "text-on-surface hover:bg-surface-container-high"}`}
                  onClick={() => setPicked(item)}
                >
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="shrink-0 text-[11px] text-on-surface-variant">{KINDS[item.kind]}</span>
                  <span className="w-12 shrink-0 text-right text-xs tabular-nums text-on-surface-variant">{item.price}</span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-3 py-2 text-sm text-on-surface-variant">Nothing by that name.</li>}
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
