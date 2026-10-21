import { describe, expect, it } from "vitest";
import { CARD_GAP, CARD_HEIGHT, CARD_MIN_HEIGHT, cardCeiling, placeCard, placeNoteCard, selectedTextBox, type Box, BAR_GAP, placeBar } from "./lookupPlacement";

/** A 1280x800 window: toolbar to 76, the selection bar's top at 700, centred. */
const room = { barTop: 700, barCentre: 640, ceiling: 84, cardWidth: 400, windowWidth: 1280 };
const line = (top: number, left = 500, right = 780): Box => ({ top, bottom: top + 24, left, right });

/** The card's own box, as the place puts it. */
const cardBox = (place: ReturnType<typeof placeCard>, from = room) => {
  const bottom = from.barTop - place.lift;
  const left = from.barCentre - from.cardWidth / 2 + place.shift;
  return { top: bottom - place.height, bottom, left, right: left + from.cardWidth };
};

const overlaps = (a: Box, b: Box) => a.top < b.bottom && b.top < a.bottom && a.left < b.right && b.left < a.right;

describe("placing the lookup card", () => {
  it("sits just above the bar, at its full height", () => {
    expect(placeCard(room)).toEqual({ height: CARD_HEIGHT, lift: CARD_GAP, shift: 0 });
    expect(placeCard({ ...room, selection: null })).toEqual({ height: CARD_HEIGHT, lift: CARD_GAP, shift: 0 });
  });

  it("stays put when the selected text is clear of it", () => {
    const usual = placeCard(room);
    // High on the page, well above the card.
    expect(placeCard({ ...room, selection: line(150) })).toEqual(usual);
    // In the margin beside it.
    expect(placeCard({ ...room, selection: line(500, 80, 200) })).toEqual(usual);
    // Behind the bar itself.
    expect(placeCard({ ...room, selection: line(705) })).toEqual(usual);
  });

  it("is shortened to fit under text it would have covered", () => {
    const selection = line(400);
    const place = placeCard({ ...room, selection });
    expect(place.lift).toBe(CARD_GAP);
    expect(place.height).toBe(700 - CARD_GAP - (424 + CARD_GAP));
    expect(place.height).toBeGreaterThanOrEqual(CARD_MIN_HEIGHT);
    expect(overlaps(cardBox(place), selection)).toBe(false);
  });

  it("goes above text that is too near the bar to fit under", () => {
    const selection = line(560);
    const place = placeCard({ ...room, selection });
    expect(place.height).toBe(CARD_HEIGHT);
    const box = cardBox(place);
    expect(box.bottom).toBe(560 - CARD_GAP);
    expect(box.top).toBeGreaterThanOrEqual(room.ceiling);
    expect(overlaps(box, selection)).toBe(false);
  });

  it("is shortened above the text when the toolbar is close", () => {
    const selection = line(560);
    const place = placeCard({ ...room, ceiling: 300, selection });
    expect(place.height).toBe(560 - CARD_GAP - 300);
    expect(cardBox(place).top).toBe(300);
    expect(overlaps(cardBox(place), selection)).toBe(false);
  });

  it("keeps its usual place when the text cannot be cleared", () => {
    // A selection running from near the toolbar to near the bar.
    const tall: Box = { top: 150, bottom: 640, left: 300, right: 980 };
    expect(placeCard({ ...room, selection: tall })).toEqual(placeCard(room));
  });

  it("never covers the text when there was room not to", () => {
    for (let top = 90; top < 700; top += 7) {
      const selection = line(top);
      const place = placeCard({ ...room, selection });
      const under = room.barTop - CARD_GAP - (selection.bottom + CARD_GAP);
      const over = selection.top - CARD_GAP - room.ceiling;
      if (under >= CARD_MIN_HEIGHT || over >= CARD_MIN_HEIGHT) {
        expect(overlaps(cardBox(place), selection), `text at ${top}`).toBe(false);
      }
      expect(cardBox(place).top, `text at ${top}`).toBeGreaterThanOrEqual(room.ceiling);
      expect(place.height).toBeGreaterThanOrEqual(CARD_MIN_HEIGHT);
      expect(place.height).toBeLessThanOrEqual(CARD_HEIGHT);
    }
  });

  it("is as tall as a short window allows, and no shorter than can be read", () => {
    expect(placeCard({ ...room, barTop: 400 }).height).toBe(400 - CARD_GAP - 84);
    expect(placeCard({ ...room, barTop: 200 }).height).toBe(CARD_MIN_HEIGHT);
  });

  it("stays inside a narrow window", () => {
    // The bar is centred in a reader pushed right by the chapter list.
    const narrow = { ...room, windowWidth: 700, barCentre: 520 };
    const box = cardBox(placeCard(narrow), narrow);
    expect(box.right).toBe(700 - CARD_GAP);
    const left = { ...room, windowWidth: 700, barCentre: 150 };
    expect(cardBox(placeCard(left), left).left).toBe(CARD_GAP);
    // A card as wide as the window: flush with the left gap, never off it.
    const phone = { ...room, windowWidth: 380, barCentre: 190, cardWidth: 364 };
    expect(cardBox(placeCard(phone), phone).left).toBe(CARD_GAP);
  });
});

describe("finding the selected text", () => {
  const frame = (top: number, left: number, text: Partial<DOMRect> | null, collapsed = false) => ({
    window: {
      frameElement: { getBoundingClientRect: () => ({ top, left }) },
      getSelection: () =>
        text === null
          ? null
          : { isCollapsed: collapsed, rangeCount: 1, getRangeAt: () => ({ getBoundingClientRect: () => text }) }
    }
  });
  const rect = { top: 900, bottom: 924, left: 40, right: 240, width: 200, height: 24 };

  it("adds the frame's place to the text's place inside it", () => {
    // A scrolled chapter: its frame starts 600px above the window.
    expect(selectedTextBox([frame(-600, 320, rect)])).toEqual({ top: 300, bottom: 324, left: 360, right: 560 });
  });

  it("looks through every frame for the one with a selection", () => {
    const found = selectedTextBox([frame(0, 0, null), frame(0, 0, rect, true), frame(100, 10, rect)]);
    expect(found).toEqual({ top: 1000, bottom: 1024, left: 50, right: 250 });
  });

  it("is null when there is nothing to measure", () => {
    expect(selectedTextBox([])).toBeNull();
    expect(selectedTextBox(undefined)).toBeNull();
    expect(selectedTextBox([null, {}, frame(0, 0, null)])).toBeNull();
    expect(selectedTextBox([frame(0, 0, { ...rect, width: 0, height: 0 })])).toBeNull();
    const gone = { window: { getSelection: () => { throw new Error("frame gone"); } } };
    expect(selectedTextBox([gone])).toBeNull();
  });
});

describe("the selection bar and the words it is for", () => {
  // A window of 768: the bar 41 px high, its foot at 704, 310 to 714 across.
  const room = { usualFoot: 704, barHeight: 41, barLeft: 310, barRight: 714, ceiling: 86 };

  it("keeps its place at the foot when the selected words are higher up the page", () => {
    expect(placeBar({ ...room, selection: { top: 300, bottom: 320, left: 400, right: 520 } })).toBe(704);
    expect(placeBar({ ...room, selection: null })).toBe(704);
  });

  it("goes just above words selected on the last lines, which it used to cover", () => {
    // The word at 658 to 678, the bar at 663 to 704.
    const foot = placeBar({ ...room, selection: { top: 658, bottom: 678, left: 420, right: 500 } });
    expect(foot).toBe(658 - BAR_GAP);
    expect(foot).toBeLessThan(658);
  });

  it("stays put for words beside it, or below it", () => {
    expect(placeBar({ ...room, selection: { top: 670, bottom: 690, left: 120, right: 300 } })).toBe(704);
    expect(placeBar({ ...room, selection: { top: 720, bottom: 740, left: 420, right: 500 } })).toBe(704);
  });

  it("goes above the whole of a selection that runs down to the foot", () => {
    expect(placeBar({ ...room, selection: { top: 400, bottom: 700, left: 150, right: 820 } })).toBe(390);
  });

  it("keeps its place when the selection fills the page and there is nowhere above it", () => {
    expect(placeBar({ ...room, selection: { top: 100, bottom: 700, left: 150, right: 820 } })).toBe(704);
  });
});

describe("cardCeiling", () => {
  const bar = (top: number, bottom: number, left = 0, right = 360): Box => ({ top, bottom, left, right });

  it("is under a toolbar across the top of the window", () => {
    expect(cardCeiling(bar(0, 76, 0, 1280), 1280)).toBe(76 + CARD_GAP);
  });

  it("ignores an upright phone's bar at the foot, and keeps under the status bar", () => {
    // The bar along the bottom of a 360x740 phone: its foot was taken for the ceiling, and the card squeezed to 190.
    expect(cardCeiling(bar(660, 740), 360, 32)).toBe(32 + CARD_GAP);
    const place = placeCard({ barTop: 564, barCentre: 180, ceiling: cardCeiling(bar(660, 740), 360, 32), cardWidth: 344, windowWidth: 360 });
    expect(place.height).toBe(CARD_HEIGHT);
  });

  it("ignores a sideways phone's strip down the right edge", () => {
    expect(cardCeiling(bar(0, 390, 788, 844), 844, 0)).toBe(CARD_GAP);
  });

  it("ignores a toolbar slid away above the window", () => {
    expect(cardCeiling(bar(-76, 0, 0, 1280), 1280)).toBe(CARD_GAP);
    expect(cardCeiling(null, 1280, 24)).toBe(24 + CARD_GAP);
  });
});

describe("placing the highlight card", () => {
  /** An upright phone, 412 x 900: the status bar's 32 px, the bar's top at 820. */
  const phone = { barTop: 820, barCentre: 206, ceiling: 40, cardWidth: 396, windowWidth: 412, tallest: 440 };

  it("is as tall as it may be where there is room", () => {
    expect(placeNoteCard({ ...phone, typing: false })).toEqual({ height: 440, lift: CARD_GAP, shift: 0 });
  });

  it("is never taller than the room between the bar and the ceiling", () => {
    // Sideways, 915 x 412, the chrome up: 300 px over the bar.
    const sideways = { ...phone, barTop: 330, ceiling: 22, cardWidth: 416, barCentre: 457, windowWidth: 915 };
    const place = placeNoteCard({ ...sideways, typing: false });
    expect(place.height).toBe(330 - CARD_GAP - 22);
    // Less room than a lookup card's least: still inside it, not over the top.
    const tight = placeNoteCard({ ...sideways, barTop: 170, typing: true });
    expect(tight.height).toBe(170 - CARD_GAP - 22);
    expect(tight.height).toBeLessThan(CARD_MIN_HEIGHT);
  });

  it("keeps off the highlighted words, but not while its note is typed", () => {
    const words = line(600, 40, 380);
    const reading = placeNoteCard({ ...phone, selection: words, typing: false });
    expect(reading.lift).toBeGreaterThan(CARD_GAP);
    expect(cardBox(reading, phone).top).toBeGreaterThanOrEqual(phone.ceiling);
    expect(overlaps(cardBox(reading, phone), words)).toBe(false);
    // The keyboard up, 412 x 560: all the room over the bar, at the bar.
    const typing = placeNoteCard({ ...phone, barTop: 552, selection: words, typing: true });
    expect(typing).toEqual({ height: 440, lift: CARD_GAP, shift: 0 });
    const short = placeNoteCard({ ...phone, barTop: 400, selection: words, typing: true });
    expect(short).toEqual({ height: 400 - CARD_GAP - 40, lift: CARD_GAP, shift: 0 });
  });

  it("goes above the words, the keyboard away, when what it holds does not fit under them", () => {
    // 412 x 915 with the system's bars away: the note just written, 300 px of card in all,
    // and the highlight at 447 with the bar's top at 698. Under the words it was 211 px
    // tall and the note was cut in half in its scrolling middle.
    const after = { ...phone, barTop: 698, ceiling: 8, selection: line(447, 30, 120) };
    const squeezed = placeNoteCard({ ...after, typing: false });
    expect(squeezed.height).toBeLessThan(300);
    const whole = placeNoteCard({ ...after, typing: false, wanted: 300 });
    expect(whole.height).toBeGreaterThanOrEqual(300);
    expect(overlaps(cardBox(whole, after), after.selection)).toBe(false);
    expect(cardBox(whole, after).top).toBeGreaterThanOrEqual(after.ceiling);
  });

  it("stays under the words when what it holds fits there, or there is no more room above", () => {
    const after = { ...phone, barTop: 698, ceiling: 8, selection: line(447, 30, 120) };
    const under = placeNoteCard({ ...after, typing: false });
    expect(placeNoteCard({ ...after, typing: false, wanted: 200 })).toEqual(under);
    // Halfway up: less room over the words than under them, though neither holds it all.
    const high = { ...after, selection: line(300, 30, 120) };
    expect(placeNoteCard({ ...high, typing: false, wanted: 600 }).lift).toBe(CARD_GAP);
  });

  it("leaves the lookup card's own height as it was", () => {
    expect(placeCard(room).height).toBe(CARD_HEIGHT);
  });
});
