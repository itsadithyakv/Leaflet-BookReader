import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ScrollEdge from "./ui/ScrollEdge";
import type { Book } from "@shared/models/book";
import { useCollectionStore } from "../store/collectionStore";
import { useLibraryStore } from "../store/libraryStore";
import { isFinished } from "../constants/books";
import { getBookExtension, isHighlightableFormat } from "../constants/bookFormats";
import { openHighlights, useHighlightsStore } from "./highlights/highlightsStore";
import { cardCount, openBookCards, useStudyStore } from "../study/studyStore";
import { sizeText } from "../library/largeBooks";
import { FEATURES } from "../constants/features";
import { useAccountStore } from "../store/accountStore";
import { composePost } from "./community/postStore";
import { syncService } from "../services/syncService";
import { openSeriesEditor } from "./SeriesEditor";
import { askConfirm } from "./ConfirmDialog";
import { UiIcon } from "./UiIcon";
import { SheetHandle } from "./ui/SheetHandle";
import { useBackClose } from "../hooks/useBackClose";
import { usePhoneMenus } from "../hooks/useMediaQuery";
import { useCloseWhenHidden } from "../hooks/pageShown";

export type BookMenuAction = { label: string; onSelect: () => void; danger?: boolean };

type Props = {
  book: Book;
  /** More actions, below the built-in ones (for example "Remove from this collection"). */
  actions?: BookMenuAction[];
  /** Told the book's title once it has been removed, for the page to say so (this menu has no toast). */
  onRemoved?: (title: string) => void;
  className?: string;
};

export const MENU_WIDTH = 248;

/** The entries the arrow keys walk: every one that can be chosen, top to bottom. */
const menuItemsOf = (menu: HTMLElement | null) =>
  Array.from(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? []);

/**
 * A book's "⋯" menu: its collections (tick to add or take out, or make a new
 * one with it in), its series and its highlights, and, last and set apart,
 * taking the book out of the library.
 *
 * The menu is drawn at the top of the page rather than inside the card: cards
 * lift on hover (a transform) and sit in rows drawn one over another, either of
 * which would clip or bury a menu drawn inside them.
 *
 * On a phone it is a sheet from the bottom instead, and opens by holding a
 * finger on the book too (the card clicks this button: `data-book-menu`).
 */
export const BookMenu = ({ book, actions, onRemoved, className = "" }: Props) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const highlightable = isHighlightableFormat(getBookExtension(book.localPath));
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More for ${book.title}`}
        title={highlightable ? "Collections, series and highlights" : "Collections and series"}
        data-book-menu=""
        className={`book-menu-trigger relative flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface ${className}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <UiIcon name="more" size={18} />
      </button>
      {open && (
        <BookMenuPanel book={book} actions={actions} onRemoved={onRemoved} triggerRef={triggerRef} onDismiss={() => setOpen(false)} />
      )}
    </>
  );
};

type PanelProps = Omit<Props, "className"> & {
  triggerRef: MutableRefObject<HTMLButtonElement | null>;
  onDismiss: () => void;
};

/**
 * The open menu. Apart from its button so that a card in a long library pays
 * for a button, not for the menu: the stores it watches (collections,
 * highlights, the account, the backup), its listeners and its phone check
 * are taken up only while it is open, and a card mounts in a fraction of the
 * time as it scrolls into view.
 */
const BookMenuPanel = ({ book, actions = [], onRemoved, triggerRef, onDismiss }: PanelProps) => {
  // The Library hidden behind another tab (App.tsx) takes its menus with it.
  useCloseWhenHidden(onDismiss);
  // Drawn only while open; `setOpen(false)` is its closing.
  const open = true;
  const setOpen = (value: boolean) => {
    if (!value) {
      onDismiss();
    }
  };
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [place, setPlace] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // A phone's menus are sheets: they hang from nothing, so a scroll or a turn
  // of the phone does not take them away.
  const sheet = usePhoneMenus();
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const collections = useCollectionStore((state) => state.collections);
  const loaded = useCollectionStore((state) => state.loaded);
  const load = useCollectionStore((state) => state.load);
  const toggleBook = useCollectionStore((state) => state.toggleBook);
  const create = useCollectionStore((state) => state.create);
  const setBookFinished = useLibraryStore((state) => state.setBookFinished);
  const deleteBook = useLibraryStore((state) => state.deleteBook);
  const onDrive = useLibraryStore((state) => state.sync.driveConnected);
  const inFolder = useLibraryStore((state) => Boolean(state.sync.folderPath));
  const atItsEnd = isFinished(book.progress);
  // Something to take back: a place in the book, or a finished date.
  const begun = (book.progress ?? 0) > 0 || Boolean(book.finishedAt);
  // A book of words can be highlighted (a PDF too, since 1.3); a comic has none to show.
  const highlightable = isHighlightableFormat(getBookExtension(book.localPath));
  const highlightCount = useHighlightsStore((state) => state.counts[book.id] ?? 0);
  // Read with the Library's Revise key (pages/library/ReviseWordsKey.tsx): none until then.
  const cardsHere = useStudyStore((state) => cardCount(state.cards, book.id));
  // A finished book can be told of to the readers who follow you (components/community/Posts.tsx).
  const canPost = useAccountStore((state) => state.status.signedIn) && FEATURES.community && (atItsEnd || Boolean(book.finishedAt));
  // A large file the backup is not sending (not asked yet, or the reader said
  // no): asked for when the menu opens, where a backup carries files at all.
  const carriesFiles = useLibraryStore((state) => state.sync.driveConnected || Boolean(state.sync.folderPath));
  const requestBackup = useLibraryStore((state) => state.requestBackup);
  const [heldBytes, setHeldBytes] = useState<number | null>(null);
  useEffect(() => {
    if (!open || !carriesFiles) {
      setHeldBytes(null);
      return;
    }
    let wanted = true;
    void syncService
      .largeBooks()
      .then((large) => {
        const own = large.find((entry) => entry.id === book.id);
        if (wanted) {
          setHeldBytes(own && own.backUp !== true ? own.bytes : null);
        }
      })
      .catch(() => undefined);
    return () => {
      wanted = false;
    };
  }, [open, carriesFiles, book.id]);

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
      // A sheet's backdrop takes its own tap (below), so the tap is not left to land on the card beneath.
      if (sheetRef.current) {
        return;
      }
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
        return;
      }
      // Tab leaves the menu, and the menu closes. The keyboard is put back on
      // the button that opened it first and the key is left to do its work,
      // so it goes on (or back, with Shift) from there: the menu is drawn at
      // the end of the page, and from inside it Tab went nowhere near.
      if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey) {
        // In the new collection form Tab still goes between the name and "Add".
        const form = event.target instanceof Element ? event.target.closest("form") : null;
        if (form && menuRef.current?.contains(form)) {
          const fields = Array.from(form.querySelectorAll<HTMLElement>("input, button"));
          const to = fields.indexOf(event.target as HTMLElement) + (event.shiftKey ? -1 : 1);
          if (to >= 0 && to < fields.length) {
            return;
          }
        }
        dismiss();
        triggerRef.current?.focus();
        return;
      }
      // Up, Down, Home and End walk the entries. Not while a name is being
      // typed: the keys are the text field's own there.
      const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if ((!step && event.key !== "Home" && event.key !== "End") || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (event.target instanceof HTMLInputElement) {
        return;
      }
      const items = menuItemsOf(menuRef.current);
      if (items.length === 0) {
        return;
      }
      // Without this the arrow scrolls the page, and a scroll closes the menu.
      event.preventDefault();
      event.stopImmediatePropagation();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : at < 0
              ? step > 0
                ? 0
                : items.length - 1
              : (at + step + items.length) % items.length;
      items[next].focus();
    };
    // A scroll moves the card from under the menu.
    const onScroll = (event: Event) => {
      if (!sheetRef.current && !menuRef.current?.contains(event.target as Node)) {
        dismiss();
      }
    };
    // So does a resize, but not the phone's keyboard opening for "New
    // collection" (the window is resized for it), and not a sheet.
    const onResize = () => {
      const typing = menuRef.current?.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement;
      if (sheetRef.current || typing || document.documentElement.dataset.keyboard === "open") {
        return;
      }
      dismiss();
    };
    window.addEventListener("mousedown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, loaded, load]);

  // Opening the menu puts the keyboard on its first entry. Once for each
  // opening: the menu is drawn a moment after `open`, when its place is known.
  const enteredRef = useRef(false);
  useEffect(() => {
    if (!open) {
      enteredRef.current = false;
      return;
    }
    if (enteredRef.current || !menuRef.current) {
      return;
    }
    enteredRef.current = true;
    menuItemsOf(menuRef.current)[0]?.focus();
  }, [open, place]);

  // After "Add" the new collection form goes, and the keyboard was on it:
  // it is put back on the menu's first entry once the form is gone.
  const backToMenuRef = useRef(false);
  useEffect(() => {
    if (!open) {
      backToMenuRef.current = false;
      return;
    }
    if (!backToMenuRef.current || creating) {
      return;
    }
    backToMenuRef.current = false;
    (menuItemsOf(menuRef.current)[0] ?? triggerRef.current)?.focus();
  }, [creating, open]);

  /** Closes the menu after an entry is chosen, and hands the keyboard back to the button that opened it. */
  const close = () => {
    setOpen(false);
    setCreating(false);
    triggerRef.current?.focus();
  };
  useBackClose(open, close);

  /** Says what went wrong, in the app's own dialog (this menu has no toast), with the menu out of the way. */
  const failed = (title: string, cause: unknown) => {
    close();
    return askConfirm({ title, body: cause instanceof Error ? cause.message : String(cause), confirmLabel: "OK", cancelLabel: "Close" });
  };

  const markFinished = async () => {
    try {
      await setBookFinished(book.id, true);
    } catch (cause) {
      await failed("That book could not be marked as finished", cause);
    }
  };

  /** Back to the start with no finished date, after asking: the book's place is not kept anywhere else. */
  const markNotStarted = async () => {
    const ok = await askConfirm({
      title: "Mark as not started?",
      body: `“${book.title}” goes back to the start. Its place and finished date are cleared.`,
      confirmLabel: "Mark as not started",
      danger: true
    });
    if (!ok) {
      return;
    }
    try {
      await setBookFinished(book.id, false);
    } catch (cause) {
      await failed("That book could not be marked as not started", cause);
    }
  };

  /**
   * Takes the book out of the library, after asking. What goes is Leaflet's
   * own copy of the file (an import copies the book in); the file it was added
   * from is never touched. The reading done in it stays in the history.
   *
   * With a backup on, the copy there goes too: removing a book starts a backup
   * run a moment later (`libraryStore.deleteBook`), and that run deletes the
   * file of every removed book from Google Drive (`sync/drive.rs`) or the
   * backup folder. A run that fails tries again on the next, for ninety days.
   */
  const removeFromLibrary = async () => {
    const ok = await askConfirm({
      title: `Remove “${book.title}”?`,
      body: `Leaflet deletes its copy of the book${onDrive ? ", here and from your Google Drive backup" : inFolder ? ", here and in your backup folder" : ""}. The file you added it from stays where it is, and the reading you did in it is kept.`,
      confirmLabel: "Remove",
      danger: true
    });
    if (!ok) {
      return;
    }
    try {
      await deleteBook(book.id);
    } catch (cause) {
      await askConfirm({ title: "That book could not be removed", body: cause instanceof Error ? cause.message : String(cause), confirmLabel: "OK", cancelLabel: "Close" });
      return;
    }
    onRemoved?.(book.title);
  };

  const createWithBook = async () => {
    const name = newName.trim();
    if (!name) {
      return;
    }
    try {
      await create(name, [book.id]);
    } catch (cause) {
      // The name stays typed, for another try.
      await failed("That collection could not be made", cause);
      return;
    }
    setNewName("");
    // (Only while the menu is still up: closed meanwhile, the keyboard is wherever the reader took it.)
    backToMenuRef.current = menuRef.current !== null;
    setCreating(false);
  };

  const item =
    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-high focus-visible:bg-surface-container-high focus-visible:outline-none";

  return (
    <>
      {(sheet || place) &&
        createPortal(
          <MenuFrame
            sheet={sheet}
            menuRef={menuRef}
            place={place}
            label={`${book.title}: ${highlightable ? "collections, series and highlights" : "collections and series"}`}
            title={book.title}
            onClose={close}
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
                  onClick={() => void toggleBook(collection.id, book.id).catch((cause) => failed("That collection could not be changed", cause))}
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
                  aria-label="Collection name"
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
            {cardsHere > 0 && (
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  close();
                  triggerRef.current?.focus();
                  openBookCards(book.id);
                }}
              >
                <UiIcon name="cards" size={16} className="text-on-surface-variant" />
                Study cards
                <span className="ml-auto text-xs tabular-nums text-on-surface-variant">{cardsHere}</span>
              </button>
            )}
            {heldBytes !== null && (
              <button
                type="button"
                role="menuitem"
                className={item}
                title="A file over 10 MB is backed up only when you say so"
                onClick={() => {
                  close();
                  void syncService
                    .setLargeBookBackup([book.id], true)
                    .then(() => requestBackup())
                    .catch((cause) => failed("This file could not be backed up", cause));
                }}
              >
                <UiIcon name="cloud" size={16} className="text-on-surface-variant" />
                Back up this file
                <span className="ml-auto text-xs tabular-nums text-on-surface-variant">{sizeText(heldBytes)}</span>
              </button>
            )}
            {canPost && (
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  close();
                  composePost({ title: book.title, author: book.author ?? null });
                }}
              >
                <UiIcon name="people" size={16} className="text-on-surface-variant" />
                Tell your followers…
              </button>
            )}
            {!atItsEnd && (
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  close();
                  void markFinished();
                }}
              >
                <UiIcon name="check" size={16} className="text-on-surface-variant" />
                Mark as finished
              </button>
            )}
            {begun && (
              <button
                type="button"
                role="menuitem"
                className={item}
                title="Back to the start, with no finished date"
                onClick={() => {
                  close();
                  void markNotStarted();
                }}
              >
                <UiIcon name="undo" size={16} className="text-on-surface-variant" />
                Mark as not started…
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
            <div className="my-1 border-t border-outline-variant/30" />
            <button
              type="button"
              role="menuitem"
              className={`${item} text-error`}
              onClick={() => {
                close();
                void removeFromLibrary();
              }}
            >
              <UiIcon name="trash" size={16} />
              Remove from library…
            </button>
          </MenuFrame>,
          document.body
        )}
    </>
  );
};

type FrameProps = {
  sheet: boolean;
  menuRef: MutableRefObject<HTMLDivElement | null>;
  place: { top?: number; bottom?: number; left: number } | null;
  label: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * The menu hanging from its button, or, on a phone, a sheet rising from the bottom with the
 * book's name on it. The series page's ⋯ menu is drawn in it too (collections/SeriesMenu.tsx).
 */
export const MenuFrame = ({ sheet, menuRef, place, label, title, onClose, children }: FrameProps) => {
  if (!sheet) {
    return (
      <div
        ref={menuRef}
        role="menu"
        aria-label={label}
        className="modal-surface fixed z-[80] max-h-[70dvh] overflow-y-auto rounded-xl p-2 shadow-xl"
        style={{ ...place, width: MENU_WIDTH }}
        onClick={(event) => event.stopPropagation()}
      >
        <ScrollEdge edge="top" height="1.75rem" />
        {children}
        <ScrollEdge edge="bottom" height="2rem" />
      </div>
    );
  }
  return (
    <div
      className="sheet-backdrop sheet-backdrop-menu fixed inset-0 z-[80] flex items-end justify-center bg-black/45"
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label={label}
        className="modal-surface sheet-panel book-menu-sheet overflow-y-auto p-2"
        onClick={(event) => event.stopPropagation()}
      >
        <SheetHandle onClose={onClose} />
        <p className="book-title truncate px-3 pb-1 text-base text-on-surface">{title}</p>
        {children}
      </div>
    </div>
  );
};
