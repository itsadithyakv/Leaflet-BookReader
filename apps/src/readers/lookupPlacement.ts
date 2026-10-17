/**
 * Where the lookup card goes. It opens above the selection bar, which sits at
 * the foot of the page, and the words being looked up are somewhere in the
 * page above: the card should not land on them if there is anywhere else.
 */

/** A box in the window, in CSS pixels from its top-left corner. */
export type Box = { top: number; bottom: number; left: number; right: number };

export type CardPlace = {
  /** The card's height. Fixed for as long as it is open, so nothing jumps when the answer arrives. */
  height: number;
  /** How far the card's foot is above the bar's top. */
  lift: number;
  /** Sideways, from centred on the bar, to stay inside the window. */
  shift: number;
};

/** Between the card and whatever it is next to. */
export const CARD_GAP = 8;
/** Tall enough for a part of speech and its definitions without scrolling. */
export const CARD_HEIGHT = 340;
/** Below this the card is not worth squeezing in: it goes where it fits instead. */
export const CARD_MIN_HEIGHT = 190;

type Room = {
  /** The top edge of the selection bar. */
  barTop: number;
  /** The centre of the bar, which the card is centred on. */
  barCentre: number;
  /** The lowest the card's top may be: under the reader's toolbar. */
  ceiling: number;
  cardWidth: number;
  windowWidth: number;
  /** The selected text, when it is known and on screen. */
  selection?: Box | null;
  /** The tallest the card may be (`CARD_HEIGHT`, the lookup card's). */
  tallest?: number;
};

/**
 * Directly above the bar by default. If that would cover the selected text,
 * the card is shortened to fit between the text and the bar; failing that it
 * moves above the text; and if neither leaves it room to be read, it stays
 * where it was (a long selection near the foot of the page cannot be cleared).
 */
export const placeCard = ({ barTop, barCentre, ceiling, cardWidth, windowWidth, selection, tallest = CARD_HEIGHT }: Room): CardPlace => {
  const foot = barTop - CARD_GAP;
  const fit = (room: number) => Math.round(Math.max(Math.min(tallest, room), Math.min(CARD_MIN_HEIGHT, tallest)));

  const centred = barCentre - cardWidth / 2;
  const leftmost = CARD_GAP;
  const rightmost = Math.max(leftmost, windowWidth - CARD_GAP - cardWidth);
  const left = Math.min(Math.max(centred, leftmost), rightmost);
  const shift = Math.round(left - centred);

  const height = fit(foot - ceiling);
  const usual: CardPlace = { height, lift: CARD_GAP, shift };
  if (!selection) {
    return usual;
  }
  const beside = selection.right <= left || selection.left >= left + cardWidth;
  const clear = selection.bottom + CARD_GAP <= foot - height || selection.top >= foot;
  if (beside || clear) {
    return usual;
  }
  const under = foot - (selection.bottom + CARD_GAP);
  if (under >= CARD_MIN_HEIGHT) {
    return { height: fit(under), lift: CARD_GAP, shift };
  }
  const over = selection.top - CARD_GAP - ceiling;
  if (over >= CARD_MIN_HEIGHT) {
    return { height: fit(over), lift: Math.round(barTop - (selection.top - CARD_GAP)), shift };
  }
  return usual;
};

/**
 * The highest a card's top may go (`placeCard`'s `ceiling`): under the
 * reader's toolbar when the toolbar runs across the top of the window, else
 * under the status bar (`insetTop`). An upright phone's bar is at the foot
 * and a sideways phone's is a strip down the side: taking their bottom edge
 * for a ceiling put it below the card's own foot, and every card was
 * squeezed to its least height (190 px, a 60 px body on a 740 px phone).
 */
export const cardCeiling = (toolbar: Box | null | undefined, windowWidth: number, insetTop = 0) => {
  const across = Boolean(toolbar && toolbar.top <= 1 && toolbar.bottom > 0 && toolbar.right - toolbar.left > windowWidth / 2);
  return Math.round(Math.max(across && toolbar ? toolbar.bottom : 0, insetTop, 0)) + CARD_GAP;
};

/** The status bar's height (`--inset-top`, platform/device.css), in px; 0 where there is none. */
export const insetTopNow = () => {
  if (typeof document === "undefined") {
    return 0;
  }
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--inset-top"));
  return Number.isFinite(value) ? value : 0;
};

/**
 * Where the highlight card goes (readers/HighlightCard.tsx): as the lookup
 * card, but never taller than the room there is between the bar and the
 * toolbar (what does not fit scrolls inside it; it used to be cut off at its
 * foot, the note's Done out of reach). While its note is typed with the
 * keyboard up, it takes all that room over the bar, the note in sight: the
 * words it is about are in it already.
 */
export const placeNoteCard = (room: Room & { typing: boolean }): CardPlace => {
  const free = (lift: number) => Math.max(0, Math.floor(room.barTop - lift - room.ceiling));
  const usual = placeCard(room.typing ? { ...room, selection: null } : room);
  return { ...usual, height: Math.min(usual.height, free(usual.lift)) };
};

/** How near the selection bar may come to the selected words. */
export const BAR_GAP = 10;

type BarRoom = {
  /** Where the bar's foot usually is: above the chapter dock, or above the pace controls. */
  usualFoot: number;
  barHeight: number;
  barLeft: number;
  barRight: number;
  /** The highest the bar's top may go: under the reader's toolbar. */
  ceiling: number;
  selection?: Box | null;
};

/**
 * Where the selection bar's foot goes (from the top of the window). The bar
 * sits at the foot of the page, which is also where the last lines of text
 * are: words selected there were covered by the very bar offering to
 * highlight them (a word at 658 to 678 px under a bar at 663 to 704). When
 * the bar would lie on the selection it goes just above it instead; the
 * cards that open from the bar open above it there as anywhere. A selection
 * that fills the page to the toolbar cannot be cleared, and the bar keeps its
 * usual place.
 */
export const placeBar = ({ usualFoot, barHeight, barLeft, barRight, ceiling, selection }: BarRoom) => {
  if (!selection) {
    return usualFoot;
  }
  const beside = selection.right <= barLeft || selection.left >= barRight;
  const clear = selection.bottom + BAR_GAP <= usualFoot - barHeight || selection.top >= usualFoot + BAR_GAP;
  if (beside || clear) {
    return usualFoot;
  }
  const above = Math.round(selection.top - BAR_GAP);
  return above - barHeight >= ceiling ? above : usualFoot;
};

/**
 * Where the selected text is in the window. The text lives in the book's own
 * frames (epub.js `Contents`), so its place there is moved by where its frame
 * sits. Null when nothing is selected or it cannot be measured.
 */
export const selectedTextBox = (contents: unknown): Box | null => {
  for (const item of Array.isArray(contents) ? contents : []) {
    try {
      const view = (item as { window?: Window } | null)?.window;
      const picked = view?.getSelection?.();
      if (!view || !picked || picked.isCollapsed || picked.rangeCount === 0) {
        continue;
      }
      const text = picked.getRangeAt(0).getBoundingClientRect();
      const frame = view.frameElement?.getBoundingClientRect();
      if (!frame || (text.width === 0 && text.height === 0)) {
        continue;
      }
      return {
        top: frame.top + text.top,
        bottom: frame.top + text.bottom,
        left: frame.left + text.left,
        right: frame.left + text.right
      };
    } catch {
      // A frame that has gone mid-measure: the card just takes its usual place.
    }
  }
  return null;
};
