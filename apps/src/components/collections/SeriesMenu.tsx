import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MENU_WIDTH, MenuFrame } from "../BookMenu";
import { UiIcon } from "../UiIcon";
import { useBackClose } from "../../hooks/useBackClose";
import { usePhoneMenus } from "../../hooks/useMediaQuery";

const TRIGGER =
  "-mr-2 -mt-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full " +
  "text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface";

const ITEM =
  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-on-surface " +
  "transition-colors hover:bg-surface-container-high focus-visible:bg-surface-container-high " +
  "focus-visible:outline-none";

type Props = {
  /** The series' name, for the phone's sheet and the menu's label. */
  name: string;
  onFindCovers: () => void;
};

/**
 * A series' "⋯" menu, on its page: what is done to the whole series, and
 * seldom. Drawn like a book's menu (`MenuFrame`): hanging from its button, or
 * on a phone a sheet from the bottom.
 */
export const SeriesMenu = ({ name, onFindCovers }: Props) => {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const sheet = usePhoneMenus();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setPlace({ top: rect.bottom + 6, left });
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  useBackClose(open, close);

  useEffect(() => {
    if (!open) {
      return;
    }
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!sheet && !menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    // Capture phase, so the page under the menu does not see its Escape.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        close();
      }
    };
    // A scroll moves the button from under a menu that hangs from it.
    const onScroll = (event: Event) => {
      if (!sheet && !menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
    // `close` only puts the keyboard back; the menu's place is drawn once it is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sheet, place]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More for ${name}`}
        title="More"
        className={TRIGGER}
        onClick={() => setOpen((value) => !value)}
      >
        <UiIcon name="more" size={18} />
      </button>
      {open &&
        (sheet || place) &&
        createPortal(
          <MenuFrame
            sheet={sheet}
            menuRef={menuRef}
            place={place}
            label={`${name}: the series`}
            title={name}
            onClose={close}
          >
            <button
              type="button"
              role="menuitem"
              className={ITEM}
              onClick={() => {
                setOpen(false);
                onFindCovers();
              }}
            >
              <UiIcon name="collections" size={16} className="text-on-surface-variant" />
              Find covers…
            </button>
          </MenuFrame>,
          document.body
        )}
    </>
  );
};
