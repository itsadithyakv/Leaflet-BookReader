import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Book } from "@shared/models/book";
import { useCollectionStore } from "../store/collectionStore";
import { getBookExtension, isPageImageFormat } from "../constants/bookFormats";
import { openHighlights, useHighlightsStore } from "./highlights/highlightsStore";
import { openSeriesEditor } from "./SeriesEditor";
import { UiIcon } from "./UiIcon";

export type BookMenuAction = { label: string; onSelect: () => void; danger?: boolean };

type Props = {
  book: Book;
  /** More actions, below the built-in ones (for example "Remove from this collection"). */
  actions?: BookMenuAction[];
  className?: string;
};

const MENU_WIDTH = 248;

/**
 * A book's "⋯" menu: its collections (tick to add or take out, or make a new
 * one with it in), its series and its highlights.
 *
 * The menu is drawn at the top of the page rather than inside the card: cards
 * lift on hover (a transform) and sit in rows drawn one over another, either of
 * which would clip or bury a menu drawn inside them.
 */
export const BookMenu = ({ book, actions = [], className = "" }: Props) => {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [place, setPlace] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const collections = useCollectionStore((state) => state.collections);
  const loaded = useCollectionStore((state) => state.loaded);
  const load = useCollectionStore((state) => state.load);
  const toggleBook = useCollectionStore((state) => state.toggleBook);
  const create = useCollectionStore((state) => state.create);
  // Only books read as text can be highlighted; a PDF or a comic has none to show.
  const highlightable = !isPageImageFormat(getBookExtension(book.localPath));
  const highlightCount = useHighlightsStore((state) => state.counts[book.id] ?? 0);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    // Opens upward when there is more room above.
    setPlace(
      rect.bottom + 320 > window.innerHeight && rect.top > window.innerHeight - rect.bottom
        ? { bottom: window.innerHeight - rect.top + 6, left }
        : { top: rect.bottom + 6, left }
    );
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (!loaded) {
      void load();
    }
    const dismiss = () => {
      setOpen(false);
      setCreating(false);
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        dismiss();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismiss();
        triggerRef.current?.focus();
      }
    };
    // A scroll moves the card from under the menu.
    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        dismiss();
      }
    };
    window.addEventListener("mousedown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open, loaded, load]);

  const close = () => {
    setOpen(false);
    setCreating(false);
  };

  const createWithBook = async () => {
    const name = newName.trim();
    if (!name) {
      return;
    }
    await create(name, [book.id]);
    setNewName("");
    setCreating(false);
  };

  const item =
    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-high focus-visible:bg-surface-container-high focus-visible:outline-none";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More for ${book.title}`}
        title={highlightable ? "Collections, series and highlights" : "Collections and series"}
        className={`flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface ${className}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <UiIcon name="more" size={18} />
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`${book.title}: ${highlightable ? "collections, series and highlights" : "collections and series"}`}
            className="modal-surface fixed z-[80] max-h-[70vh] overflow-y-auto rounded-xl p-2 shadow-xl"
            style={{ ...place, width: MENU_WIDTH }}
            onClick={(event) => event.stopPropagation()}
          >
            <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-[0.18em] text-on-surface-variant">Collections</p>
            {collections.map((collection) => {
              const inIt = collection.bookIds.includes(book.id);
              return (
                <button
                  key={collection.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={inIt}
                  className={item}
                  onClick={() => void toggleBook(collection.id, book.id)}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      inIt ? "border-primary bg-primary text-on-primary" : "border-outline-variant"
                    }`}
                  >
                    {inIt && <UiIcon name="check" size={12} />}
                  </span>
                  <span className="truncate">{collection.name}</span>
                </button>
              );
            })}
            {creating ? (
              <form
                className="flex items-center gap-1 px-1 py-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createWithBook();
                }}
              >
                <input
                  autoFocus
                  className="inset-field min-w-0 flex-1 px-2 py-1.5 text-sm text-on-surface"
                  placeholder="Collection name"
                  maxLength={80}
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                />
                <button type="submit" className="tactile-button tactile-button-primary px-3 py-1.5 text-xs font-semibold">
                  Add
                </button>
              </form>
            ) : (
              <button type="button" role="menuitem" className={item} onClick={() => setCreating(true)}>
                <UiIcon name="plus" size={16} className="text-on-surface-variant" />
                New collection…
              </button>
            )}
            <div className="my-1 border-t border-outline-variant/30" />
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                close();
                openSeriesEditor(book.id);
              }}
            >
              <UiIcon name="series" size={16} className="text-on-surface-variant" />
              Series…
            </button>
            {highlightable && (
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  close();
                  // So closing the highlights comes back to this book's menu button.
                  triggerRef.current?.focus();
                  openHighlights(book.id);
                }}
              >
                <UiIcon name="highlight" size={16} className="text-on-surface-variant" />
                Highlights
                {highlightCount > 0 && (
                  <span className="ml-auto text-xs tabular-nums text-on-surface-variant">{highlightCount}</span>
                )}
              </button>
            )}
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                className={`${item} ${action.danger ? "text-error" : ""}`}
                onClick={() => {
                  close();
                  action.onSelect();
                }}
              >
                {action.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
};
