import { useEffect, useRef, useSyncExternalStore } from "react";
import { AudioLines } from "lucide-react";
import { ambience, useAmbienceState } from "./ambience";
import { AmbienceSwitch, SceneChoices, VolumeSlider } from "./AmbienceParts";
import "./ambience.css";

/**
 * The radio in the readers. Its way in is a row in each reader's ··· menu
 * ("Sound"); while it is on, a small mark sits on the toolbar, lit, and the
 * controls hang under that: the scenes, the volume, off. A toolbar that is
 * already full gets nothing more while the radio is off.
 *
 * Whether the popover is open is kept here rather than in either reader, so
 * the row (inside the menu) and the mark (on the toolbar) agree, and a
 * reader can ask it for Escape with one line.
 */

let popoverOpen = false;
const popoverListeners = new Set<() => void>();

const setPopoverOpen = (open: boolean) => {
  if (popoverOpen === open) {
    return;
  }
  popoverOpen = open;
  popoverListeners.forEach((listener) => listener());
};

const subscribePopover = (listener: () => void) => {
  popoverListeners.add(listener);
  return () => {
    popoverListeners.delete(listener);
  };
};

/** Whether the radio's popover is open, for a reader's Escape. */
export const ambiencePopoverOpen = () => popoverOpen;
export const openAmbiencePopover = () => setPopoverOpen(true);
export const closeAmbiencePopover = () => setPopoverOpen(false);
/** The same, for what a reader draws (its toolbar stays while the popover is open). */
export const useAmbiencePopoverOpen = () => useSyncExternalStore(subscribePopover, ambiencePopoverOpen, () => false);

const STATUS = {
  off: "Off. Pick a sound and it plays while a book is open.",
  ready: "Plays when a book is open.",
  playing: "Playing while this book is open.",
  away: "Resting while Leaflet is out of sight. It comes back with you."
} as const;

/**
 * On a reader's toolbar. It is what tells the radio a book is open (and,
 * when the reader goes, that it has been left); it draws the mark and the
 * popover only while the radio is on or its popover has been asked for.
 */
export const ReaderAmbience = () => {
  const view = useAmbienceState();
  const open = useAmbiencePopoverOpen();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const markRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ambience.enterReader();
    return () => {
      ambience.leaveReader();
      closeAmbiencePopover();
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    // The keyboard goes to what is chosen, so arrows change it at once.
    popoverRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
    // A click anywhere else closes it, as it does the type panel. A click in
    // the book's text never reaches this document (the text is in a frame of
    // its own); the window losing the keyboard to that frame does.
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (wrapRef.current && target && !wrapRef.current.contains(target)) {
        closeAmbiencePopover();
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("blur", closeAmbiencePopover);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("blur", closeAmbiencePopover);
    };
  }, [open]);

  if (!view.on && !open) {
    return null;
  }

  const label = view.on ? `Sound while you read: ${view.sceneName}${view.playing ? ", playing" : view.phase === "away" ? ", resting" : ""}` : "Sound while you read: off";
  return (
    <div className="ambience relative" data-where="reader" ref={wrapRef}>
      <button
        ref={markRef}
        type="button"
        className="ambience-mark reader-icon transition-colors reader-hover-accent"
        data-on={view.on}
        data-playing={view.playing}
        onClick={() => setPopoverOpen(!open)}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <AudioLines size={22} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="ambience-popover ambience-stack absolute right-0 mt-3 rounded-xl border p-4 text-xs shadow-2xl reader-panel reader-border"
          role="dialog"
          aria-label="Sound while you read"
          onKeyDown={(event) => {
            // Escape closes this and nothing else, wherever in it the keyboard is
            // (the volume is a field, whose keys the readers leave alone).
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeAmbiencePopover();
              markRef.current?.focus();
            }
          }}
        >
          <AmbienceSwitch on={view.on} onChange={ambience.setOn} title="Sound while you read" />
          <SceneChoices scene={view.scene} lit={view.on} onChoose={(scene) => ambience.chooseScene(scene, true)} label="Sound" />
          <VolumeSlider volume={view.volume} onChange={ambience.setVolume} />
          {view.scene === "rain" && <AmbienceSwitch on={view.thunder} onChange={ambience.setThunder} title="Thunder, far off" />}
          <p className="ambience-note" aria-live="polite">
            {STATUS[view.phase]}
          </p>
        </div>
      )}
    </div>
  );
};

type ReaderAmbienceRowProps = {
  /** Called as the popover opens: the menu this row is in closes itself. */
  onOpen?: () => void;
};

/** The radio's row in a reader's ··· menu: what is playing, and the way to its controls. */
export const ReaderAmbienceRow = ({ onOpen }: ReaderAmbienceRowProps) => {
  const view = useAmbienceState();
  return (
    <button
      type="button"
      className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon reader-hover-accent"
      title="Rain, a fire or a cafe behind the page while a book is open"
      aria-haspopup="dialog"
      onClick={() => {
        onOpen?.();
        openAmbiencePopover();
      }}
    >
      <span>Sound</span>
      <span className="reader-muted">{view.on ? view.sceneName : "Off"}</span>
    </button>
  );
};
