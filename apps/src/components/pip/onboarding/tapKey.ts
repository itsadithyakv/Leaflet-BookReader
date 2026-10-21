import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

/**
 * A key in Pip's tour (Next, Got it, Skip) that a finger cannot miss. A tap held a little long (818 ms in a logged
 * miss) is a long press to the phone, and no click follows it; and a key that moved under the finger between press
 * and release had the release land beside it. So a key is pressed when a press that began on it is let go on it
 * (or near it: `SLOP_PX`), at once, whether a click follows or not. The click that does follow is not a second
 * press, nor does it land on whatever the key's going uncovered (the page under a closing bubble). The keyboard's
 * Enter and Space still press it by their click.
 */

/** How far from the key, as it was pressed or as it is now, a finger may be let go and still press it. */
export const SLOP_PX = 16;
/** A click this soon after a press by a finger is that press's own. */
export const FOLLOW_MS = 700;

type Box = { left: number; top: number; right: number; bottom: number };
type Press = { key: Element; pointer: number; box: Box | null };

let press: Press | null = null;
let pressedAt = -Infinity;
let swallow: ((event: Event) => void) | null = null;

const clock = () => Date.now();

const boxOf = (node: Element): Box | null => {
  if (typeof node.getBoundingClientRect !== "function") return null;
  const rect = node.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
};

const near = (box: Box | null, x: number, y: number) =>
  box !== null && x >= box.left - SLOP_PX && x <= box.right + SLOP_PX && y >= box.top - SLOP_PX && y <= box.bottom + SLOP_PX;

/** The click after a press by a finger, wherever it lands: kept from the page (the key has done its work). */
const swallowFollowingClick = (x: number, y: number) => {
  if (typeof window === "undefined") return;
  if (swallow) window.removeEventListener("click", swallow, true);
  const listener = (event: Event) => {
    window.removeEventListener("click", listener, true);
    if (swallow === listener) swallow = null;
    const click = event as MouseEvent;
    if (clock() - pressedAt > FOLLOW_MS || click.detail === 0) return;
    // Another tap altogether (none followed the long press): left alone.
    if (Math.abs(click.clientX - x) > SLOP_PX * 2 || Math.abs(click.clientY - y) > SLOP_PX * 2) return;
    event.stopPropagation();
    event.preventDefault();
  };
  swallow = listener;
  window.addEventListener("click", listener, true);
  window.setTimeout(() => {
    window.removeEventListener("click", listener, true);
    if (swallow === listener) swallow = null;
  }, FOLLOW_MS);
};

export type TapKeyProps = {
  onPointerDown: (event: ReactPointerEvent<Element>) => void;
  onPointerUp: (event: ReactPointerEvent<Element>) => void;
  onPointerCancel: (event: ReactPointerEvent<Element>) => void;
  onClick: (event: ReactMouseEvent<Element>) => void;
  onContextMenu: (event: ReactMouseEvent<Element>) => void;
};

/** The handlers for a tour key that runs `act` when pressed: spread them on the button (in place of `onClick`). */
export const tapKey = (act: () => void): TapKeyProps => ({
  onPointerDown: (event) => {
    if (event.button !== 0) return;
    const key = event.currentTarget;
    press = { key, pointer: event.pointerId, box: boxOf(key) };
    // The release comes to the key even if the finger (or the key) has moved off it.
    try {
      (key as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(event.pointerId);
    } catch {
      // (A pointer already gone.)
    }
  },
  onPointerUp: (event) => {
    const held = press;
    if (!held || held.key !== event.currentTarget || held.pointer !== event.pointerId) return;
    press = null;
    if (!near(held.box, event.clientX, event.clientY) && !near(boxOf(event.currentTarget), event.clientX, event.clientY)) return;
    pressedAt = clock();
    swallowFollowingClick(event.clientX, event.clientY);
    act();
  },
  onPointerCancel: (event) => {
    if (press?.key === event.currentTarget) press = null;
  },
  onClick: (event) => {
    // The click of a press already acted on (a keyboard's has no pointer: detail 0).
    if (event.detail !== 0 && clock() - pressedAt <= FOLLOW_MS) return;
    act();
  },
  // A long press is a press here, not the phone's menu and buzz.
  onContextMenu: (event) => event.preventDefault()
});

/** For tests: forgets any press. */
export const resetTapKeys = () => {
  press = null;
  pressedAt = -Infinity;
  if (swallow && typeof window !== "undefined") window.removeEventListener("click", swallow, true);
  swallow = null;
};
