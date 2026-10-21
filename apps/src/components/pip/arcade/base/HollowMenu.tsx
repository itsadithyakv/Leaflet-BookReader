import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { Camera, DoorOpen, Gamepad2, Menu, Volume2, VolumeX } from "lucide-react";
import { UiIcon } from "../../../UiIcon";
import { ProfileFace } from "../../../ProfileButton";
import { backdropClose } from "../../../ui/backdrop";
import { useBackLayer } from "../../../../platform/back";
import { PIP_MENU_PLACES, usePipFullScreen, type PipMenuPlace } from "../../../../pages/pip/PipMenu";
import { playSound } from "../../../../pip/sound";

/** The way to the rest of the app, where Pip's tab fills a phone on its side (PipPage hands it down). */
export type HollowNav = { onNavigate: (place: PipMenuPlace) => void; onOpenProfile: () => void };

type HollowMenuProps = {
  sound: boolean;
  onSound: (on: boolean) => void;
  /** The postcard of the camp, once the camp has one to show. */
  onPostcard: (() => void) | null;
  onArcade: (() => void) | null;
  onHouse: (() => void) | null;
  nav?: HollowNav;
};

/**
 * The ☰ at the start of the Hollow's top bar (1.5.10): everything the bar used to carry that is not the
 * chapter, the acorns, the parcels or the guide. Sound, the postcard, the arcade and Pip's house; and where
 * her tab fills a phone on its side, the rest of the app (the rail and the header are not there).
 * A card of Pip's paper under the key (touch.css `.pip-menu`); a tap outside or Back closes it.
 */
export const HollowMenu = ({ sound, onSound, onPostcard, onArcade, onHouse, nav }: HollowMenuProps) => {
  const fullScreen = usePipFullScreen();
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
    const onResize = () => setAt(null);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const go = (run: () => void) => {
    setAt(null);
    run();
  };
  const toggle = () => {
    if (open) {
      setAt(null);
      return;
    }
    playSound("click");
    const box = keyRef.current?.getBoundingClientRect();
    setAt({ top: Math.round((box?.bottom ?? 40) + 8), left: Math.round(box?.left ?? 8) });
  };
  const style = at ? ({ top: at.top, left: at.left, maxHeight: `calc(100dvh - ${at.top}px - var(--inset-bottom, 0px) - 8px)` } as CSSProperties) : undefined;
  const places = Boolean(nav && fullScreen);

  return (
    <>
      <button
        ref={keyRef}
        type="button"
        className="pip-menu-key pip-base-chip pip-hud-chip pip-hollow-menu-key"
        aria-label="Menu"
        title="Sound, postcard, arcade, Pip's house"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Menu size={16} strokeWidth={2.5} aria-hidden />
      </button>
      {open &&
        createPortal(
          <div className="pip-menu-backdrop" {...backdropClose(() => setAt(null))}>
            <div className="pip-menu pip-hollow-menu" role="menu" aria-label="Menu" style={style} onClick={(event) => event.stopPropagation()}>
              <Item
                itemRef={firstRef}
                onClick={() => {
                  onSound(!sound);
                  // Heard at once, so turning them on says what it turned on.
                  window.setTimeout(() => playSound("chime"), 0);
                }}
                checked={sound}
              >
                {sound ? <Volume2 size={20} aria-hidden /> : <VolumeX size={20} aria-hidden />}
                {sound ? "Sound on" : "Sound off"}
              </Item>
              {onPostcard && (
                <Item onClick={() => go(onPostcard)}>
                  <Camera size={20} aria-hidden />
                  Postcard
                </Item>
              )}
              {onArcade && (
                <Item onClick={() => go(onArcade)}>
                  <Gamepad2 size={20} aria-hidden />
                  Arcade
                </Item>
              )}
              {onHouse && (
                <Item onClick={() => go(onHouse)}>
                  <DoorOpen size={20} aria-hidden />
                  Pip's house
                </Item>
              )}
              {places && nav && (
                <>
                  <span className="pip-menu-rule" aria-hidden="true" />
                  {PIP_MENU_PLACES.map((place) => (
                    <Item key={place.id} onClick={() => go(() => nav.onNavigate(place.id))}>
                      <UiIcon name={place.icon} size={20} />
                      {place.label}
                    </Item>
                  ))}
                  <Item onClick={() => go(nav.onOpenProfile)}>
                    <span className="pip-menu-face" aria-hidden="true">
                      <ProfileFace size={28} />
                    </span>
                    Profile & settings
                  </Item>
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

const Item = ({ onClick, itemRef, checked, children }: { onClick: () => void; itemRef?: Ref<HTMLButtonElement>; checked?: boolean; children: ReactNode }) => (
  <button
    ref={itemRef}
    type="button"
    role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
    aria-checked={checked}
    className="pip-menu-item"
    onClick={onClick}
  >
    {children}
  </button>
);
