import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { Menu } from "lucide-react";
import { UiIcon, type UiIconName } from "../../components/UiIcon";
import { ProfileFace } from "../../components/ProfileButton";
import { backdropClose } from "../../components/ui/backdrop";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useBackLayer } from "../../platform/back";

/**
 * Where Pip's tab is the whole screen: a phone on its side, by a finger. The app's header and
 * its rail step away there (components/pip/touch.css, the same query), and this menu is the way
 * to the rest of the app. Keep the two in step.
 */
export const PIP_FULL_SCREEN_QUERY = "(orientation: landscape) and (max-height: 520px) and (pointer: coarse)";

export type PipMenuPlace = "library" | "collections" | "social";

/** The other places, in the rail's order. Settings is behind the profile, as everywhere on a phone. */
export const PIP_MENU_PLACES: ReadonlyArray<{ id: PipMenuPlace; label: string; icon: UiIconName }> = [
  { id: "library", label: "Library", icon: "library" },
  { id: "collections", label: "Collections", icon: "collections" },
  { id: "social", label: "Social", icon: "analytics" }
];

type PipMenuProps = {
  onNavigate: (place: PipMenuPlace) => void;
  /** The profile sheet: the reader, their backup, and Settings. */
  onOpenProfile: () => void;
  /** The key's look: a chip in the Hollow's row, a key in the house's. */
  className: string;
  /** Shown only where the tab is the whole screen; `always` is for tests. */
  always?: boolean;
};

/**
 * Pip's way back to the rest of the app, where her tab fills a phone held sideways: a small key
 * at the start of her row of chips, drawn her way, that opens a card of the other places.
 * A tap outside or Back closes it.
 */
export const PipMenu = ({ onNavigate, onOpenProfile, className, always = false }: PipMenuProps) => {
  const fullScreen = useMediaQuery(PIP_FULL_SCREEN_QUERY);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const keyRef = useRef<HTMLButtonElement | null>(null);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const open = at !== null;

  const close = () => {
    setAt(null);
    keyRef.current?.focus({ preventScroll: true });
  };
  useBackLayer(open, close);

  useEffect(() => {
    if (!open) return undefined;
    firstRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setAt(null);
      }
    };
    // Turned or resized, the card would hang from where the key was: it closes instead.
    const onResize = () => setAt(null);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  // Leaving the whole-screen layout (turned upright) takes the menu with it.
  useEffect(() => {
    if (!fullScreen && !always) setAt(null);
  }, [fullScreen, always]);

  if (!fullScreen && !always) return null;

  const go = (run: () => void) => {
    setAt(null);
    run();
  };

  const toggle = () => {
    if (open) {
      setAt(null);
      return;
    }
    const box = keyRef.current?.getBoundingClientRect();
    setAt({ top: Math.round((box?.bottom ?? 40) + 10), left: Math.round(box?.left ?? 8) });
  };

  const style = at
    ? ({ top: at.top, left: at.left, maxHeight: `calc(100dvh - ${at.top}px - var(--inset-bottom, 0px) - 8px)` } as CSSProperties)
    : undefined;

  return (
    <>
      <button
        ref={keyRef}
        type="button"
        className={`pip-menu-key ${className}`}
        aria-label="Menu"
        title="Library, Collections, Social and Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Menu size={16} strokeWidth={2.5} aria-hidden />
      </button>
      {open &&
        createPortal(
          <div className="pip-menu-backdrop" {...backdropClose(() => setAt(null))}>
            {/* A portal's click still reaches the page's handlers above the key: it stops at the card. */}
            <div className="pip-menu" role="menu" aria-label="Go to" style={style} onClick={(event) => event.stopPropagation()}>
              {PIP_MENU_PLACES.map((place, index) => (
                <MenuItem key={place.id} itemRef={index === 0 ? firstRef : undefined} onClick={() => go(() => onNavigate(place.id))}>
                  <UiIcon name={place.icon} size={20} />
                  {place.label}
                </MenuItem>
              ))}
              <span className="pip-menu-rule" aria-hidden="true" />
              <MenuItem onClick={() => go(onOpenProfile)}>
                <span className="pip-menu-face" aria-hidden="true">
                  <ProfileFace size={28} />
                </span>
                Profile & settings
              </MenuItem>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

const MenuItem = ({
  onClick,
  itemRef,
  children
}: {
  onClick: () => void;
  itemRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) => (
  <button ref={itemRef} type="button" role="menuitem" className="pip-menu-item" onClick={onClick}>
    {children}
  </button>
);
