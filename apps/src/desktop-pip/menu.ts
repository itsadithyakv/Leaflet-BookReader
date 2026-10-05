/**
 * Desktop Pip's menu: what is on it, and when it is open.
 *
 * Her window never takes the focus (a click on her must not pull the keyboard
 * out of what the reader is typing in), so the menu cannot close the way a
 * menu usually does, on Escape or on a click elsewhere: nothing tells the
 * page of either. It closes on its own instead: a few seconds after opening
 * if the pointer never comes to it, a moment after the pointer leaves it, on a
 * second right-click, when something is picked, and when she is picked up.
 * Pure: a menu, what happened, the menu after (menu.test.ts).
 */

export type MenuAction = "open" | "putDown" | "home" | "today";
export type MenuItem = { id: MenuAction; label: string; hint: string };

const OPEN: MenuItem = { id: "open", label: "Open Leaflet", hint: "Bring Leaflet's window forward" };
const NOT_NOW: MenuItem = { id: "putDown", label: "Not now", hint: "Put the sign away" };
const HOME: MenuItem = { id: "home", label: "Send her home", hint: "Pip goes back inside until Leaflet next starts" };
const TODAY: MenuItem = { id: "today", label: "Hide for today", hint: "Pip stays in until tomorrow" };

/** The window has room for this many (geometry.ts, MENU_BOX). */
export const MENU_ROWS = 3;

/**
 * What the menu offers. With a sign up, "Not now" takes the place of "Open
 * Leaflet": the sign itself is the way in then, and the reader who opens the
 * menu instead is looking for the way to say no.
 */
export const menuItems = (signUp: boolean): MenuItem[] => (signUp ? [NOT_NOW, HOME, TODAY] : [OPEN, HOME, TODAY]);

export type Menu = {
  open: boolean;
  /** The pointer is over her window. */
  hover: boolean;
  /** When it closes by itself (ms); null while it is closed, or held open by the pointer. */
  closeAt: number | null;
};

export type MenuEvent =
  /** A right click on her: opens it, or closes it if it is open. */
  | { type: "toggle" }
  /** A long press: opens it. */
  | { type: "press" }
  | { type: "enter" }
  | { type: "leave" }
  | { type: "pick" }
  | { type: "carried" }
  /** The time in `closeAt` may have come. */
  | { type: "tick" };

/** Open and never touched, it closes after this long... */
export const MENU_LINGER_MS = 6000;
/** ...and this long after the pointer leaves it. */
export const MENU_LEAVE_MS = 1200;

export const MENU_CLOSED: Menu = { open: false, hover: false, closeAt: null };

export const menuStep = (menu: Menu, event: MenuEvent, now: number): Menu => {
  const shut: Menu = { open: false, hover: menu.hover, closeAt: null };
  // Opened under the pointer (it always is: she was just clicked), it still
  // lingers only so long: a reader who right-clicked by mistake and stays put
  // should not have a menu up for ever.
  const opened: Menu = { open: true, hover: menu.hover, closeAt: now + MENU_LINGER_MS };
  switch (event.type) {
    case "toggle":
      return menu.open ? shut : opened;
    case "press":
      return menu.open ? menu : opened;
    case "enter":
      // Moving on it keeps it; it is leaving that starts the clock again.
      return menu.open ? { open: true, hover: true, closeAt: null } : { ...menu, hover: true };
    case "leave":
      return menu.open ? { open: true, hover: false, closeAt: now + MENU_LEAVE_MS } : { ...menu, hover: false };
    case "pick":
    case "carried":
      return shut;
    case "tick":
      return menu.open && menu.closeAt !== null && now >= menu.closeAt ? shut : menu;
  }
};
