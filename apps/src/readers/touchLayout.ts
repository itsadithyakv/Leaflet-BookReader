import { useEffect, useState, useSyncExternalStore } from "react";
import { isAndroid, isTouchInput } from "../platform/device";
import { android, holdRotation, type RotationLock } from "../platform/android";
import { steadyHeight, type HeightMemory } from "../platform/shape";
import { LAYOUT_KEY, type ReaderLayout } from "./readerTypes";

/**
 * The readers on a phone and a tablet (docs/android.md, "The reader"): what
 * shape of screen the book is on, what a tap on the page means there, and the
 * layout, which a turn keeps.
 *
 *   desktop   a mouse (or a touch screen wider than a phone): as it was
 *   tablet    a finger, and room in both directions
 *   upright   a phone held upright: four buttons on the toolbar, sheets
 *   sideways  a phone on its side: the chrome hides, and comes as a strip
 *             down the right edge; the pages are a spread of two columns
 */
export type ReaderShape = "desktop" | "tablet" | "upright" | "sideways";

/** A phone is under this wide, or under `PHONE_MAX_HEIGHT` tall (docs/android.md). */
export const PHONE_MAX_WIDTH = 768;
export const PHONE_MAX_HEIGHT = 520;

export const readerShape = (width: number, height: number, touch: boolean): ReaderShape => {
  if (!touch) {
    return "desktop";
  }
  const phone = width < PHONE_MAX_WIDTH || height < PHONE_MAX_HEIGHT;
  if (!phone) {
    return "tablet";
  }
  return width > height ? "sideways" : "upright";
};

/** A phone, either way up: what has a compact toolbar and sheets. */
export const isPhoneShape = (shape: ReaderShape) => shape === "upright" || shape === "sideways";

/**
 * The window's height for its shape: the tallest it has been at this width
 * (platform/shape.ts, shared with the app around the pages). Without it a
 * keyboard had the book laid out again as a phone on its side, in pages, and
 * back when the keyboard went, at the place it was saved at by then (the top
 * of the chapter, the pages having opened there).
 */
export { steadyHeight, type HeightMemory };

const windowHeights: HeightMemory = { width: 0, height: 0 };

const currentShape = (): ReaderShape =>
  typeof window === "undefined" ? "desktop" : readerShape(window.innerWidth, steadyHeight(windowHeights, window.innerWidth, window.innerHeight), isTouchInput());

const subscribeShape = (listener: () => void) => {
  window.addEventListener("resize", listener);
  const touch = window.matchMedia?.("(hover: none) and (pointer: coarse)");
  touch?.addEventListener?.("change", listener);
  return () => {
    window.removeEventListener("resize", listener);
    touch?.removeEventListener?.("change", listener);
  };
};

/** The reader's shape of screen, kept as the phone turns. */
export const useReaderShape = (): ReaderShape => useSyncExternalStore(subscribeShape, currentShape, () => "desktop");

/**
 * A tap on the page, by a finger: which third of the page it fell in. The
 * outer thirds turn the page (the right goes on, the left back; a
 * right-to-left book the other way); the middle brings the toolbar and the
 * dock, or sends them away. A mouse keeps the narrower sides of `clickZone`
 * (readers/pageTurn.ts), so the middle is left to selecting text.
 */
export const TAP_SIDE_SHARE = 1 / 3;

export const tapZone = (x: number, pageLeft: number, pageWidth: number, rtl = false): 1 | -1 | 0 => {
  if (!(pageWidth > 0)) {
    return 0;
  }
  const zone = pageWidth * TAP_SIDE_SHARE;
  const side = x < pageLeft + zone ? -1 : x >= pageLeft + pageWidth - zone ? 1 : 0;
  return side === 0 ? 0 : ((rtl ? -side : side) as 1 | -1);
};

export type TapAction = { kind: "turn"; step: 1 | -1 } | { kind: "chrome" } | { kind: "hide" } | { kind: "bookmark" } | { kind: "none" };

/**
 * What a plain tap does. With pages, the sides turn and the middle shows or
 * hides the chrome. Scrolling there is no page to turn: on a tablet any tap
 * shows or hides the chrome; on a phone (`immersive`) only one in the middle
 * does, and one at a side only sends the chrome away, so the reader's options
 * come where they are asked for and nowhere else.
 */
export const tapAction = (zone: 1 | -1 | 0, layout: ReaderLayout, immersive = false, corner = false): TapAction => {
  // A phone's top right corner (readers/phoneReading.ts, `inBookmarkCorner`)
  // bookmarks the place, before the side it is in turns the page.
  if (immersive && corner) {
    return { kind: "bookmark" };
  }
  if (zone === 0) {
    return { kind: "chrome" };
  }
  if (layout === "scroll") {
    return immersive ? { kind: "hide" } : { kind: "chrome" };
  }
  return { kind: "turn", step: zone };
};

/**
 * What a run of finger taps does (readers/tapRun.ts), from what one tap there
 * would (`single`, `tapAction`). Two taps bring the menu or send it away,
 * anywhere; three select the word (that is the tap counter's own), so the
 * run does nothing more. One tap keeps its own meaning, except in the middle:
 * the menu no longer comes for one tap, which a scroll could be taken for.
 */
export const runAction = (single: TapAction, taps: number): TapAction => {
  if (taps >= 3) {
    return { kind: "none" };
  }
  if (taps === 2) {
    return { kind: "chrome" };
  }
  return single.kind === "chrome" ? { kind: "none" } : single;
};

// ---- The layout, kept as the phone turns ---------------------------------------

/**
 * Where a sideways phone's own layout used to be kept, apart from the upright
 * one. It is read only for a book opened sideways by a reader who has never
 * chosen a layout (`layoutForShape`), and goes once one is chosen.
 */
export const SIDEWAYS_LAYOUT_KEY = "leaflet.reader.layout.sideways";

/** `chosen`: the reader's own choice (`LAYOUT_KEY`), for every shape. `sideways`: the old sideways key. */
export type StoredLayouts = { chosen: string | null; sideways: string | null };

const asLayout = (value: string | null): ReaderLayout | null => (value === "pages" || value === "scroll" ? value : null);

/**
 * The layout a book opens in. Scrolling or pages is the reader's one choice,
 * whichever way up the phone is: turning the phone never changes it (it used
 * to: a phone kept a layout for each way up and on its side defaulted to
 * pages, so a reader scrolling upright was put into pages by the turn, and
 * back). Only a reader who has never chosen gets a default for the shape the
 * book opens in: scrolling, or on a phone's side a spread of two pages (eight
 * or nine lines under a toolbar read poorly scrolling).
 */
export const layoutForShape = (shape: ReaderShape, stored: StoredLayouts): ReaderLayout =>
  asLayout(stored.chosen) ?? (shape === "sideways" ? (asLayout(stored.sideways) ?? "pages") : "scroll");

/**
 * The layout after a turn of the phone (or any change of the window's shape):
 * the one the book is in. A turn may make pages a spread or one column
 * (`spreadFor`), never scrolling pages or pages scrolling.
 */
export const layoutAcrossTurn = (now: ReaderLayout): ReaderLayout => now;

/** A tablet on its side spreads its pages from this wide (epub.js's own threshold for a spread). */
export const TABLET_SPREAD_MIN_WIDTH = 800;

const windowWidth = () => (typeof window === "undefined" ? 0 : window.innerWidth);
const windowHeight = () => (typeof window === "undefined" ? 0 : steadyHeight(windowHeights, window.innerWidth, window.innerHeight));

/** The window's height for its shape, now (`steadyHeight`): what a keyboard has not taken. */
export const steadyWindowHeight = windowHeight;

/**
 * Pages are a spread, two columns a turn, on a phone on its side and on a
 * tablet on its side: an open book, where one centred column left half the
 * screen bare. Upright, on a desktop, and scrolling, one column.
 */
export const spreadFor = (shape: ReaderShape, layout: ReaderLayout, width = windowWidth(), height = windowHeight()) =>
  layout === "pages" &&
  (shape === "sideways" || (shape === "tablet" && width > height && width >= TABLET_SPREAD_MIN_WIDTH));

const currentTabletSideways = () => currentShape() === "tablet" && windowWidth() > windowHeight();

/** A tablet on its side, kept as it turns (its shape stays "tablet"; its pages become a spread or stop being one). */
export const useTabletSideways = (): boolean => useSyncExternalStore(subscribeShape, currentTabletSideways, () => false);

const readKey = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const readStoredLayouts = (): StoredLayouts => ({ chosen: readKey(LAYOUT_KEY), sideways: readKey(SIDEWAYS_LAYOUT_KEY) });

export const readLayoutFor = (shape: ReaderShape): ReaderLayout => layoutForShape(shape, readStoredLayouts());

/** The reader chose a layout: for every way up, and the old sideways one goes. */
export const saveLayout = (layout: ReaderLayout) => {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
    localStorage.removeItem(SIDEWAYS_LAYOUT_KEY);
  } catch {
    // This session only.
  }
};

// ---- The page readers' own: fit and layout each way up -------------------------

/** A PDF's or comic's sideways view, kept with the book's other preferences. */
export type SidewaysView<Fit extends string, Layout extends string> = { fit?: Fit; layout?: Layout };

/**
 * What a PDF or a comic shows sideways on a phone: what the reader chose
 * there before, or fit-the-width and (a PDF) one scroll of pages, which is
 * how a page made for paper is read on a phone on its side.
 */
export const sidewaysPageView = <Fit extends string, Layout extends string>(
  kind: "pdf" | "comic",
  kept: SidewaysView<Fit, Layout> | null | undefined,
  defaults: { fit: Fit; pdfLayout: Layout; comicLayout: Layout }
): { fit: Fit; layout: Layout } => ({
  fit: kept?.fit ?? defaults.fit,
  layout: kind === "comic" ? defaults.comicLayout : (kept?.layout ?? defaults.pdfLayout)
});

// ---- Turning the phone ---------------------------------------------------------

export const ROTATION_KEY = "leaflet.reader.rotation";

export const ROTATION_CHOICES: Array<{ id: RotationLock; label: string }> = [
  { id: "auto", label: "Turn with the phone" },
  { id: "portrait", label: "Keep upright" },
  { id: "landscape", label: "Keep sideways" }
];

export const readRotationLock = (): RotationLock => {
  const value = readKey(ROTATION_KEY);
  return value === "portrait" || value === "landscape" ? value : "auto";
};

export const saveRotationLock = (lock: RotationLock) => {
  try {
    localStorage.setItem(ROTATION_KEY, lock);
  } catch {
    // This session only.
  }
};

/** Whether the rotation lock is offered: only the Android app can turn the screen. */
export const canLockRotation = () => isAndroid() && typeof document !== "undefined" && document.documentElement.dataset.platform === "android";

// ---- While a book is open --------------------------------------------------------

/**
 * What a reader asks of the Android side while it is open: the rotation lock
 * chosen in the type panel, and the system's bars out of the way (for a
 * focus-lock session, and on a phone). Both are let go when the book closes.
 * No-ops anywhere but the Android app.
 */
/**
 * Whether the system's status and gesture bars are away while a book is open:
 * for a focus-lock session, and on a phone either way up for as long as the
 * book is open (the page is all there is, and the chrome comes over it). Were
 * the bars to come and go with the chrome, the text would move under the
 * finger at every tap, since the page keeps clear of them: on its side the
 * pages were laid out again, 18 of them a chapter with the chrome away and 21
 * with it up, and the page being read was another. A swipe in from the edge
 * shows them for a moment.
 */
export const systemBarsHidden = (shape: ReaderShape, locked: boolean) =>
  locked || isPhoneShape(shape);

/** What lies over a phone's page, for `floatsAway`. */
export type OverThePage = { keyboard: boolean; card: boolean; drawer: boolean; sheet: boolean };

/**
 * Whether what floats over the page by finger (the pace and read-aloud pills,
 * and Dotty) is out of sight: while the keyboard is up, and while a card (a
 * note, a character, a word looked up), the chapter list or a sheet is open
 * over the page. The pill sat over the card being typed in, and over the
 * chapter list. Only out of sight: Smart Read stays paused or reading as it
 * was, and the pill's room at the foot is kept, so the text does not move.
 */
export const floatsAway = (shape: ReaderShape, over: OverThePage) =>
  shape !== "desktop" && (over.keyboard || over.card || over.drawer || over.sheet);

export const useReaderDevice = (barsHidden: boolean, rotation: RotationLock) => {
  // Held while the book is open, and let go when it closes, so the screen goes
  // back to whatever held it before (Pip's tab holds it sideways).
  useEffect(() => holdRotation(rotation), [rotation]);
  useEffect(() => {
    void android.hideSystemBars(barsHidden);
  }, [barsHidden]);
  useEffect(() => () => void android.hideSystemBars(false), []);
};

/** The rotation lock, as the type panel shows and changes it. */
export const useRotationLock = () => {
  const [lock, setLock] = useState<RotationLock>(readRotationLock);
  const choose = (next: RotationLock) => {
    saveRotationLock(next);
    setLock(next);
  };
  return [lock, choose] as const;
};

/** An inset the system draws over (`--inset-bottom` and the rest, platform/device.css), in px, as laid out now. */
export const insetPx = (name: "top" | "right" | "bottom" | "left" | "keyboard"): number => {
  if (typeof document === "undefined" || !document.body) {
    return 0;
  }
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;top:0;left:0;width:0;height:var(--inset-${name}, 0px)`;
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(px) ? px : 0;
};

/** A CSS length (a `var()` or `calc()` of the reader's) as laid out in `host` now, in px. */
export const lengthIn = (host: Element, value: string): number => {
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;top:0;left:0;width:0;height:${value}`;
  host.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(px) ? px : 0;
};

/**
 * Where a card or the selection's bar rests at the foot of the page, as px
 * up from the frame's foot. A mouse: above the chapter dock (and above the
 * pace control when it shows). A finger: just over the gesture bar (or the
 * keyboard), where the chapter dock would be, since it is away while text is
 * selected; above the pace pill when that shows.
 */
export const DOCK_FOOT_MOUSE = 64;
export const DOCK_FOOT_ABOVE_PACE = 118;
export const DOCK_FOOT_TOUCH = 8;
export const PACE_PILL_ROOM = 60;

export const selectionDockFoot = (touch: boolean, abovePace: boolean, inset: number) =>
  touch ? inset + DOCK_FOOT_TOUCH + (abovePace ? PACE_PILL_ROOM : 0) : abovePace ? DOCK_FOOT_ABOVE_PACE : DOCK_FOOT_MOUSE;

/** What the keyboard covers of the reader's page frame (which ends at the gesture bar), in px. */
export const keyboardOverFrame = () => Math.max(0, insetPx("keyboard") - insetPx("bottom"));
