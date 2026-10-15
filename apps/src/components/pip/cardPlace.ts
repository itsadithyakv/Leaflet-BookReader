import { placeNear, type Rect, type Size } from "./layout";

export type CardPlace = { left: number; top: number; side: "above" | "below" | "beside"; tailAt: number };

/**
 * Where a room card goes, by the thing that opened it and never over it while
 * there is anywhere else: above it when it fits there, else below, else
 * beside it (to the right, then the left), level with its middle. Only when
 * it fits nowhere (a narrow window) does it go where there is most room, and
 * cover what it must. A card above or below points at its thing with a tail
 * (`tailAt`, percent along its edge); one beside it has none.
 */
export const placeCard = (anchor: Rect, size: Size, bounds: Rect, gap = 8): CardPlace => {
  const near = placeNear(anchor, size, bounds, { gap });
  const room = near.side === "above" ? anchor.top - gap - bounds.top : bounds.top + bounds.height - (anchor.top + anchor.height + gap);
  if (room >= size.height) return near;
  const right = bounds.left + bounds.width - (anchor.left + anchor.width + gap);
  const left = anchor.left - gap - bounds.left;
  if (right < size.width && left < size.width) return near;
  const top = Math.max(bounds.top, Math.min(bounds.top + bounds.height - size.height, anchor.top + anchor.height / 2 - size.height / 2));
  return { left: right >= size.width ? anchor.left + anchor.width + gap : anchor.left - gap - size.width, top, side: "beside", tailAt: 50 };
};

/**
 * Where a card or a picker over the room may go: the window, less a margin, and clear of the app's rail (a phone
 * on its side has the rail down the left with the room right beside it, and a card at the window's edge lay over it).
 */
export const cardBounds = () => {
  const rail = document.querySelector(".sidebar-stage")?.getBoundingClientRect();
  const left = rail && rail.width > 0 ? Math.max(8, rail.right + 6) : 8;
  return { left, top: 8, width: window.innerWidth - left - 8, height: window.innerHeight - 16 };
};
