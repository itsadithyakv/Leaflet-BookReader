import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { askConfirm } from "../components/ConfirmDialog";
import { PipSay } from "../components/PipSay";
import { PipSprite } from "../components/PipSprite";
import { pickBeat } from "../pip/moments";
import { useHabitStore } from "../store/habitStore";
import { useBackLayer } from "../platform/back";

/** Holding Escape (or, on a phone, the guard's own button) this long leaves a book under focus lock. */
export const EXIT_HOLD_MS = 1000;
/** Pip guards the exit at most this often, so hovering back and forth is not a slapstick loop. */
const EXIT_GUARD_COOLDOWN_MS = 8000;

/**
 * Leaving a book under focus lock (a session running with the lock on).
 *
 * Pip guards the Back button and Escape, but never traps anyone: holding
 * Escape, or confirming the dialog, always leaves. Without the lock every
 * method here simply closes. Both readers use it, so the rules cannot drift.
 *
 * The returned functions are stable and read live state through refs, so
 * key handlers bound once (including inside the book's iframes) stay correct.
 */
export const useFocusLockExit = (onClose: () => void) => {
  const locked = useHabitStore((state) => Boolean(state.activeSession) && state.focusSettings.kioskMode);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  /** Pip at the door; `hold`: with her "Hold to leave" button (Android's Back, where there is no Escape to hold). */
  const [guardShown, setGuardShown] = useState<{ key: number; line: string; hold?: boolean } | null>(null);
  const guardAtRef = useRef(0);
  const escapeDownAtRef = useRef<number | null>(null);

  const api = useMemo(() => {
    const guard = (force = false) => {
      const now = Date.now();
      if (!lockedRef.current || (!force && now - guardAtRef.current < EXIT_GUARD_COOLDOWN_MS)) {
        return;
      }
      guardAtRef.current = now;
      setGuardShown({ key: now, line: pickBeat("exitGuard", now).line });
    };

    /** Ends the session early (it still goes on the shelf, minutes counted) and closes. */
    const leave = () => {
      void useHabitStore.getState().stopSession({ reason: "manual_end", cleanSession: false });
      onCloseRef.current();
    };

    const requestClose = async () => {
      if (!lockedRef.current) {
        onCloseRef.current();
        return;
      }
      guard(true);
      // A flower still growing wilts on the way out: the one thing leaving costs.
      const session = useHabitStore.getState().activeSession;
      const flower = session?.flower && !session.flower.wilted ? session.flower.kind : null;
      const confirmed = await askConfirm({
        title: "Leave mid-session?",
        body: flower
          ? `Your focus session is still running, and your ${flower} wilts if you leave now. The minutes you read still count.`
          : "Your focus session is still running. Leaving ends it early. The minutes you read still count, and it goes on your shelf as ended early.",
        confirmLabel: "End session",
        cancelLabel: "Keep reading",
        danger: true,
        pip: "swat"
      });
      if (confirmed) {
        leave();
      }
    };

    /**
     * Escape. Unlocked it closes. Locked, a tap brings Pip to guard and a hold
     * leaves. There is no keyup from inside the book's iframe, so the hold is
     * timed across the key's auto-repeat.
     */
    const escape = (event: KeyboardEvent) => {
      if (!lockedRef.current) {
        onCloseRef.current();
        return;
      }
      const now = Date.now();
      if (!event.repeat || escapeDownAtRef.current === null) {
        escapeDownAtRef.current = now;
        guard(true);
        return;
      }
      if (now - escapeDownAtRef.current >= EXIT_HOLD_MS) {
        escapeDownAtRef.current = null;
        leave();
      }
    };

    /**
     * Android's Back with nothing left open in the book. Unlocked it closes.
     * Locked, Pip comes to the door with a button that leaves when it is held
     * (as holding Escape does); Back again sends her away.
     */
    const back = () => {
      if (!lockedRef.current) {
        onCloseRef.current();
        return;
      }
      const now = Date.now();
      guardAtRef.current = now;
      setGuardShown({ key: now, line: pickBeat("exitGuard", now).line, hold: true });
    };

    return { guard, requestClose, escape, back, leave };
  }, []);

  return { locked, guardShown, clearGuard: () => setGuardShown(null), ...api };
};

/** Long enough to read the line after the swat, short enough not to linger. */
const LINGER_MS = 1600;
/** With her button, long enough to reach for it. */
const HOLD_LINGER_MS = 6000;

/** "Hold to leave": a press held for `EXIT_HOLD_MS` leaves; let go sooner, nothing happens. */
const HoldToLeave = ({ onLeave }: { onLeave: () => void }) => {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const stop = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setHolding(false);
  };
  useEffect(() => stop, []);
  const start = (event: ReactPointerEvent<HTMLButtonElement>) => {
    try {
      // The hold stays the button's if the finger wanders a little.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer the browser no longer knows: the hold is timed all the same.
    }
    stop();
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onLeave();
    }, EXIT_HOLD_MS);
  };
  return (
    <button
      type="button"
      className={`reader-exit-hold ${holding ? "is-holding" : ""}`}
      style={{ ["--exit-hold-ms" as string]: `${EXIT_HOLD_MS}ms` }}
      data-long-press=""
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onContextMenu={(event) => event.preventDefault()}
      aria-label="Hold to leave the session"
    >
      <span className="reader-exit-hold-fill" aria-hidden="true" />
      <span>Hold to leave</span>
    </button>
  );
};

/**
 * Pip, guarding the way out: pops up under Back, swats at the cursor
 * (mirrored, so the paper swings toward the button) and says how to leave.
 * Place it inside a positioned parent.
 */
export const PipExitGuard = ({
  shown,
  onDone,
  onLeave
}: {
  shown: { key: number; line: string; hold?: boolean } | null;
  onDone: () => void;
  /** Leaves the session (the guard's "Hold to leave", held). */
  onLeave?: () => void;
}) => {
  const holding = Boolean(shown?.hold && onLeave);
  // With her button up, Back sends her away and the reading goes on.
  useBackLayer(holding, onDone);
  return shown === null ? null : (
    <span className={`reader-exit-guard ${holding ? "has-hold" : ""}`} role="status" key={shown.key}>
      <span className="reader-exit-guard-sprite" aria-hidden="true">
        <PipSprite
          move="swat"
          size={56}
          loops={1}
          playKey={shown.key}
          onDone={() => window.setTimeout(onDone, holding ? HOLD_LINGER_MS : LINGER_MS)}
        />
      </span>
      <PipSay text={shown.line} tail="left" tailAt={50} className="reader-exit-guard-say" />
      {holding && onLeave && <HoldToLeave onLeave={onLeave} />}
    </span>
  );
};
