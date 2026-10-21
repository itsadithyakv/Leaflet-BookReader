/** A box of the screen by its edges. */
export type Area = { left: number; top: number; right: number; bottom: number };

/**
 * Where Pip's bubble may go, whole: the page's content, right of the rail (on a phone on its side a slim capsule in
 * a column of its own) and clear of the system's bars, 8 px in; and in a card's scrolling layer, inside what that
 * layer shows (it clips: a line was cut at the page's left edge, under the rail).
 */
export const bubbleArea = (bounds: { left: number; right: number }, insets: { top: number; right: number; bottom: number; left: number }, view: { width: number; height: number }, clip: Area | null): Area => {
  const edge = 8;
  let left = Math.max(insets.left + edge, bounds.left + edge);
  let right = Math.min(view.width - insets.right - edge, bounds.right - edge);
  let top = insets.top + edge;
  let bottom = view.height - insets.bottom - edge;
  if (clip) {
    left = Math.max(left, clip.left + edge);
    right = Math.min(right, clip.right - edge);
    top = Math.max(top, clip.top + 4);
    bottom = Math.min(bottom, clip.bottom - 4);
  }
  return { left, top, right: Math.max(left, right), bottom: Math.max(top, bottom) };
};

