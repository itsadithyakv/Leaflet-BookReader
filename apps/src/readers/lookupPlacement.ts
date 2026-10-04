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
};

/**
 * Directly above the bar by default. If that would cover the selected text,
 * the card is shortened to fit between the text and the bar; failing that it
 * moves above the text; and if neither leaves it room to be read, it stays
 * where it was (a long selection near the foot of the page cannot be cleared).
 */
export const placeCard = ({ barTop, barCentre, ceiling, cardWidth, windowWidth, selection }: Room): CardPlace => {
  const foot = barTop - CARD_GAP;
  const fit = (room: number) => Math.round(Math.max(Math.min(CARD_HEIGHT, room), Math.min(CARD_MIN_HEIGHT, CARD_HEIGHT)));

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
