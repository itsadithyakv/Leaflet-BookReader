import { PAGE_FOOT_PAD } from "./pagesStyle";
import { isPhoneShape, type ReaderShape } from "./touchLayout";
import type { ReaderLayout } from "./readerTypes";

/**
 * Where a focus session's mark (the mug filling, or the flower growing:
 * readers/text/ReaderSessionMarks.tsx) sits over the reader. It is never over
 * the text: it lives in room the text already keeps clear of.
 *
 *   footer    a phone, either way up, either layout: the strip at the foot of
 *             the page the footer's line is in (readers/touch.css), at its
 *             right end, small and faint. It sat at the top right, under the
 *             toolbar's place, over the first lines of every page.
 *   foot-pad  pages on a desktop or a tablet: the room under a page's text
 *             (`PAGE_FOOT_PAD`), in the corner, smaller. Full size it stood
 *             40 px up into the last lines.
 *   corner    scrolling on a desktop or a tablet: as it was, the corner of
 *             the window, which the text scrolls on under.
 */
export type SessionMarkSpot = "footer" | "foot-pad" | "corner";

export const sessionMarkSpot = (shape: ReaderShape, layout: ReaderLayout): SessionMarkSpot =>
  isPhoneShape(shape) ? "footer" : layout === "pages" ? "foot-pad" : "corner";

/** The mark's box drawn at full size (index.css `.leaflet-mug`, and the flower's `box`). */
export const SESSION_MARK_BOX = 72;
/** A phone's footer strip (readers/touch.css `--reader-footer-height`). */
export const PHONE_FOOTER_STRIP = 28;

/** How large the mark is drawn, and how far up from the foot of the room it sits in, in px. */
export const SESSION_MARK_LOOK: Record<SessionMarkSpot, { scale: number; bottom: number; opacity: number }> = {
  footer: { scale: 0.3, bottom: 3, opacity: 0.6 },
  "foot-pad": { scale: 0.6, bottom: 8, opacity: 0.85 },
  corner: { scale: 1, bottom: 24, opacity: 1 }
};

/** The height of the room under the text where the mark sits; null where the text runs on under it (scrolling). */
export const roomUnderText = (spot: SessionMarkSpot): number | null =>
  spot === "footer" ? PHONE_FOOTER_STRIP : spot === "foot-pad" ? PAGE_FOOT_PAD : null;

/** How far up from that room's foot the mark's top reaches, in px. */
export const sessionMarkTop = (spot: SessionMarkSpot) => SESSION_MARK_LOOK[spot].bottom + SESSION_MARK_BOX * SESSION_MARK_LOOK[spot].scale;

/** Whether the mark stays in the room the text keeps clear of (true where there is no such room to keep to). */
export const sessionMarkClearOfText = (spot: SessionMarkSpot) => {
  const room = roomUnderText(spot);
  return room === null || sessionMarkTop(spot) <= room;
};
