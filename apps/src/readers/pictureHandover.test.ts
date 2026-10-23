import { describe, expect, it, vi } from "vitest";
import { PINCH_START_PX, bindPicturePinch, fingerFeed, fingersOf, isPinching, type PictureHandover } from "./pictureHandover";
import { centreOf, fromMiddle, gestureView, handoverView } from "./imageZoom";

/** A chapter's document in its frame, 100 px down the window, and a map in it. */
const page = () => {
  const doc = new EventTarget() as EventTarget & { defaultView: unknown };
  doc.defaultView = { frameElement: { getBoundingClientRect: () => ({ left: 0, top: 100 }) } };
  const img = new EventTarget() as EventTarget & Record<string, unknown>;
  img.ownerDocument = doc;
  img.naturalWidth = 2400;
  img.naturalHeight = 1600;
  img.getBoundingClientRect = () => ({ left: 18, top: 200, width: 340, height: 226, right: 358, bottom: 426 });
  return { doc, img: img as unknown as HTMLImageElement };
};

/** A touch event with these fingers down (in the frame's coordinates). */
const touch = (type: string, fingers: [number, number][], cancelable = true) => {
  const event = new Event(type, { cancelable });
  Object.defineProperty(event, "touches", { value: fingers.map(([clientX, clientY]) => ({ clientX, clientY })) });
  return event;
};

describe("a pinch begun on a picture of the page", () => {
  it("opens the viewer with the picture where the page has it, and hands the fingers on", () => {
    const { doc, img } = page();
    const opened: PictureHandover[] = [];
    bindPicturePinch(img, (handover) => {
      opened.push(handover);
      return true;
    });
    img.dispatchEvent(touch("touchstart", [[100, 300]]));
    img.dispatchEvent(touch("touchstart", [[100, 300], [200, 300]]));
    // Resting: two fingers that have not moved apart are no pinch, but no scroll either.
    const rest = touch("touchmove", [[101, 300], [201, 300]]);
    doc.dispatchEvent(rest);
    expect(rest.defaultPrevented).toBe(true);
    expect(opened).toHaveLength(0);
    const apart = touch("touchmove", [[90, 300], [210 + PINCH_START_PX, 300]]);
    doc.dispatchEvent(apart);
    expect(apart.defaultPrevented).toBe(true);
    expect(opened).toHaveLength(1);
    const [handover] = opened;
    // In the window: the frame is 100 px down.
    expect(handover.rect).toEqual({ left: 18, top: 300, width: 340, height: 226 });
    expect(handover.natural).toEqual({ width: 2400, height: 1600 });
    expect(handover.fingers).toEqual([{ x: 100, y: 400 }, { x: 200, y: 400 }]);
    const seen: (unknown[] | null)[] = [];
    handover.feed.listen((fingers) => seen.push(fingers));
    const more = touch("touchmove", [[60, 310], [260, 310]]);
    doc.dispatchEvent(more);
    expect(more.defaultPrevented).toBe(true);
    expect(seen).toEqual([[{ x: 60, y: 410 }, { x: 260, y: 410 }]]);
    // One lifts, then the other: the viewer is told, and then that it is over.
    doc.dispatchEvent(touch("touchend", [[60, 310]]));
    doc.dispatchEvent(touch("touchend", []));
    expect(seen[seen.length - 1]).toBeNull();
    expect(handover.feed.ended()).toBe(true);
    // Done with: a later move on the page is the page's.
    const later = touch("touchmove", [[10, 10], [300, 10]]);
    doc.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it("carries on with the same zoom about the same point: the viewer's first frame is the page's picture", () => {
    const { doc, img } = page();
    let handover: PictureHandover | null = null;
    bindPicturePinch(img, (given) => {
      handover = given;
      return true;
    });
    img.dispatchEvent(touch("touchstart", [[150, 300], [250, 300]]));
    doc.dispatchEvent(touch("touchmove", [[140, 300], [260, 300]]));
    expect(handover).not.toBeNull();
    const given = handover as unknown as PictureHandover;
    const room = { width: 376, height: 812 };
    const start = handoverView(given.rect, given.natural, room);
    const from = given.fingers.map((point) => fromMiddle(point, room));
    const now = (given.feed.latest() ?? []).map((point) => fromMiddle(point, room));
    const view = gestureView(start, from, now, given.natural, room);
    // 100 px apart became 120: 1.2 times the page's size, the point between the fingers kept.
    expect(view.scale).toBeCloseTo(start.scale * 1.2);
    const under = (v: typeof view, at: { x: number; y: number }) => (at.x - v.x) / v.scale;
    expect(under(view, centreOf(now))).toBeCloseTo(under(start, centreOf(from)));
  });

  it("takes a second finger that lands beside the picture", () => {
    const { doc, img } = page();
    const open = vi.fn(() => true);
    bindPicturePinch(img, open);
    img.dispatchEvent(touch("touchstart", [[100, 300]]));
    doc.dispatchEvent(touch("touchstart", [[100, 300], [330, 500]]));
    doc.dispatchEvent(touch("touchmove", [[80, 290], [350, 520]]));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("leaves one finger's scroll alone, and two fingers on a page already scrolling", () => {
    const { doc, img } = page();
    const open = vi.fn(() => true);
    bindPicturePinch(img, open);
    img.dispatchEvent(touch("touchstart", [[100, 300]]));
    const scroll = touch("touchmove", [[100, 250]]);
    doc.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);
    // A second finger on a page the browser is scrolling: its moves cannot be stopped.
    doc.dispatchEvent(touch("touchstart", [[100, 250], [200, 250]]));
    doc.dispatchEvent(touch("touchmove", [[90, 250], [230, 250]], false));
    doc.dispatchEvent(touch("touchmove", [[80, 250], [260, 250]]));
    expect(open).not.toHaveBeenCalled();
  });

  it("lets the page keep a pinch the viewer will not take", () => {
    const { doc, img } = page();
    const open = vi.fn(() => false);
    bindPicturePinch(img, open);
    img.dispatchEvent(touch("touchstart", [[100, 300], [200, 300]]));
    doc.dispatchEvent(touch("touchmove", [[80, 300], [220, 300]]));
    const next = touch("touchmove", [[60, 300], [240, 300]]);
    doc.dispatchEvent(next);
    expect(open).toHaveBeenCalledTimes(1);
    expect(next.defaultPrevented).toBe(false);
  });
});

describe("the fingers handed on", () => {
  it("are told to the viewer as they come, once over, and kept for one that mounts late", () => {
    const feed = fingerFeed();
    feed.push([{ x: 1, y: 2 }]);
    expect(feed.latest()).toEqual([{ x: 1, y: 2 }]);
    const heard: unknown[] = [];
    const stop = feed.listen((fingers) => heard.push(fingers));
    feed.push([{ x: 3, y: 4 }]);
    feed.end();
    feed.end();
    feed.push([{ x: 5, y: 6 }]);
    expect(heard).toEqual([[{ x: 3, y: 4 }], null]);
    expect(feed.ended()).toBe(true);
    stop();
  });

  it("are read in the window, and pinch once they move apart or together", () => {
    expect(fingersOf({ length: 2, 0: { clientX: 1, clientY: 2 }, 1: { clientX: 3, clientY: 4 } }, { x: 10, y: 100 })).toEqual([
      { x: 11, y: 102 },
      { x: 13, y: 104 }
    ]);
    const from = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(isPinching(from, [{ x: 5, y: 0 }, { x: 105, y: 0 }])).toBe(false);
    expect(isPinching(from, [{ x: 0, y: 0 }, { x: 100 - PINCH_START_PX, y: 0 }])).toBe(true);
    expect(isPinching(from, [{ x: 0, y: 0 }])).toBe(false);
  });
});
