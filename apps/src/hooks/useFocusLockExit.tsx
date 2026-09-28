import { useMemo, useRef, useState } from "react";
import { askConfirm } from "../components/ConfirmDialog";
import { PipSay } from "../components/PipSay";
import { PipSprite } from "../components/PipSprite";
import { pickBeat } from "../pip/moments";
import { useHabitStore } from "../store/habitStore";

/** Holding Escape this long leaves a book under focus lock. */
const EXIT_HOLD_MS = 1000;
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
  const [guardShown, setGuardShown] = useState<{ key: number; line: string } | null>(null);
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
      const confirmed = await askConfirm({
        title: "Leave mid-session?",
        body: "Your focus session is still running. Leaving ends it early. The minutes you read still count, and it goes on your shelf as ended early.",
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

    return { guard, requestClose, escape };
  }, []);

  return { locked, guardShown, clearGuard: () => setGuardShown(null), ...api };
};

/** Long enough to read the line after the swat, short enough not to linger. */
const LINGER_MS = 1600;

/**
 * Pip, guarding the way out: pops up under Back, swats at the cursor
 * (mirrored, so the paper swings toward the button) and says how to leave.
 * Place it inside a positioned parent.
 */
export const PipExitGuard = ({
  shown,
  onDone
}: {
  shown: { key: number; line: string } | null;
  onDone: () => void;
}) =>
  shown === null ? null : (
    <span className="reader-exit-guard" role="status" key={shown.key}>
      <span className="reader-exit-guard-sprite" aria-hidden="true">
        <PipSprite
          move="swat"
          size={56}
          loops={1}
          playKey={shown.key}
          onDone={() => window.setTimeout(onDone, LINGER_MS)}
        />
      </span>
      <PipSay text={shown.line} tail="left" tailAt={50} className="reader-exit-guard-say" />
    </span>
  );
