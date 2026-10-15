import { useEffect, useState, useSyncExternalStore } from "react";
import { isAndroid, isTouchInput } from "../platform/device";
import { android, holdRotation, type RotationLock } from "../platform/android";
import { LAYOUT_KEY, type ReaderLayout } from "./readerTypes";

/**
 * The readers on a phone and a tablet (docs/android.md, "The reader"): what
 * shape of screen the book is on, what a tap on the page means there, and the
 * layout each way up remembers.
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

const currentShape = (): ReaderShape =>
  typeof window === "undefined" ? "desktop" : readerShape(window.innerWidth, window.innerHeight, isTouchInput());

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

export type TapAction = { kind: "turn"; step: 1 | -1 } | { kind: "chrome" } | { kind: "none" };

/**
 * What a plain tap does. With pages, the sides turn and the middle shows or
 * hides the chrome; scrolling there is no page to turn, so any tap does.
 */
export const tapAction = (zone: 1 | -1 | 0, layout: ReaderLayout): TapAction => {
  if (layout === "scroll" || zone === 0) {
    return { kind: "chrome" };
  }
  return { kind: "turn", step: zone };
};

// ---- The layout each way up --------------------------------------------------

/** A sideways phone's own layout. The upright phone (and every other screen) keeps `LAYOUT_KEY`. */
export const SIDEWAYS_LAYOUT_KEY = "leaflet.reader.layout.sideways";

export type StoredLayouts = { upright: string | null; sideways: string | null };

const asLayout = (value: string | null): ReaderLayout | null => (value === "pages" || value === "scroll" ? value : null);

/**
 * The layout for this shape of screen. Upright (and on a desktop or tablet),
 * the reader's own choice, scrolling by default. Sideways a phone has eight
 * or nine lines under a toolbar, so it defaults to pages, laid out as a
 * spread of two columns, like an open paperback; scrolling is its other
 * choice, and it is remembered apart.
 */
export const layoutForShape = (shape: ReaderShape, stored: StoredLayouts): ReaderLayout =>
  shape === "sideways" ? (asLayout(stored.sideways) ?? "pages") : (asLayout(stored.upright) ?? "scroll");

/** Pages on a sideways phone are a spread: two columns a turn. */
export const spreadFor = (shape: ReaderShape, layout: ReaderLayout) => shape === "sideways" && layout === "pages";

/** The key a layout chosen on this shape of screen is kept under. */
export const layoutKeyFor = (shape: ReaderShape) => (shape === "sideways" ? SIDEWAYS_LAYOUT_KEY : LAYOUT_KEY);

const readKey = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const readStoredLayouts = (): StoredLayouts => ({ upright: readKey(LAYOUT_KEY), sideways: readKey(SIDEWAYS_LAYOUT_KEY) });

export const readLayoutFor = (shape: ReaderShape): ReaderLayout => layoutForShape(shape, readStoredLayouts());

export const saveLayoutFor = (shape: ReaderShape, layout: ReaderLayout) => {
  try {
    localStorage.setItem(layoutKeyFor(shape), layout);
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
 * focus-lock session, and on a phone on its side while the chrome is away).
 * Both are let go when the book closes. No-ops anywhere but the Android app.
 */
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
