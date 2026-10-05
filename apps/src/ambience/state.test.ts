import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS } from "./prefs";
import {
  BLURRED_GRACE_MS,
  HIDDEN_GRACE_MS,
  away,
  engineMode,
  enterReader,
  leaveReader,
  phaseAt,
  startListening,
  startState,
  statusPhrase,
  stopListening,
  untilChange,
  wanted,
  windowSeen,
  withPrefs
} from "./state";

const off = startState({ ...DEFAULT_PREFS });
const on = startState({ ...DEFAULT_PREFS, on: true });
const inSight = { hidden: false, focused: true };

describe("when the radio sounds", () => {
  it("is silent on launch, whatever was remembered", () => {
    // The app opens on the library: no reader is open, so nothing plays even
    // when the radio was left on.
    expect(phaseAt(off, 0)).toBe("off");
    expect(phaseAt(on, 0)).toBe("ready");
    expect(engineMode(phaseAt(off, 0))).toBe("stop");
    expect(engineMode(phaseAt(on, 0))).toBe("stop");
    expect(wanted(on)).toBe(false);
  });

  it("plays while a book is open, if the reader has turned it on", () => {
    expect(phaseAt(enterReader(on), 0)).toBe("playing");
    expect(engineMode("playing")).toBe("play");
    // Opening a book does not turn it on.
    expect(phaseAt(enterReader(off), 0)).toBe("off");
  });

  it("starts when it is turned on in an open book, and stops when turned off", () => {
    const reading = enterReader(off);
    const turnedOn = withPrefs(reading, { on: true });
    expect(phaseAt(turnedOn, 0)).toBe("playing");
    expect(phaseAt(withPrefs(turnedOn, { on: false }), 0)).toBe("off");
  });

  it("stops when the book is left, and stays ready for the next", () => {
    const left = leaveReader(enterReader(on));
    expect(phaseAt(left, 0)).toBe("ready");
    expect(engineMode(phaseAt(left, 0))).toBe("stop");
    expect(phaseAt(enterReader(left), 0)).toBe("playing");
  });

  it("does not stop between one book closing and the next opening", () => {
    // The next reader is there before the last has gone.
    const both = enterReader(enterReader(on));
    expect(phaseAt(leaveReader(both), 0)).toBe("playing");
    expect(phaseAt(leaveReader(leaveReader(both)), 0)).toBe("ready");
    // Leaving more often than entering never goes below nothing.
    expect(leaveReader(leaveReader(on)).readers).toBe(0);
    expect(stopListening(off).listening).toBe(0);
  });

  it("keeps the scene and the volume through all of it", () => {
    const chosen = withPrefs(on, { scene: "cafe", volume: 0.3 });
    const later = leaveReader(enterReader(chosen));
    expect(later.prefs).toEqual({ ...DEFAULT_PREFS, on: true, scene: "cafe", volume: 0.3 });
  });
});

describe("the panel in Pip's room", () => {
  it("plays for as long as it is listening, with the radio on or off", () => {
    expect(phaseAt(startListening(off), 0)).toBe("playing");
    expect(phaseAt(stopListening(startListening(off)), 0)).toBe("off");
    expect(phaseAt(stopListening(startListening(on)), 0)).toBe("ready");
  });

  it("does not turn the radio on for reading by being listened to", () => {
    expect(startListening(off).prefs.on).toBe(false);
    expect(phaseAt(enterReader(stopListening(startListening(off))), 0)).toBe("off");
  });
});

describe("the window going away", () => {
  const reading = enterReader(on);

  it("keeps playing through a moment out of sight, then rests", () => {
    const hidden = windowSeen(reading, { hidden: true, focused: false }, 1000);
    expect(phaseAt(hidden, 1000)).toBe("playing");
    expect(phaseAt(hidden, 1000 + HIDDEN_GRACE_MS - 1)).toBe("playing");
    expect(phaseAt(hidden, 1000 + HIDDEN_GRACE_MS)).toBe("away");
    expect(engineMode("away")).toBe("rest");
  });

  it("gives a window that only lost the keyboard longer", () => {
    const blurred = windowSeen(reading, { hidden: false, focused: false }, 1000);
    expect(BLURRED_GRACE_MS).toBeGreaterThan(HIDDEN_GRACE_MS);
    expect(phaseAt(blurred, 1000 + HIDDEN_GRACE_MS)).toBe("playing");
    expect(phaseAt(blurred, 1000 + BLURRED_GRACE_MS - 1)).toBe("playing");
    expect(phaseAt(blurred, 1000 + BLURRED_GRACE_MS)).toBe("away");
  });

  it("comes back as soon as the window does", () => {
    const hidden = windowSeen(reading, { hidden: true, focused: false }, 1000);
    const back = windowSeen(hidden, inSight, 60_000);
    expect(phaseAt(back, 60_000)).toBe("playing");
    expect(back.hiddenSince).toBeNull();
    expect(back.blurredSince).toBeNull();
  });

  it("dates going away from when it was first seen, not from each look", () => {
    const hidden = windowSeen(reading, { hidden: true, focused: false }, 1000);
    const again = windowSeen(hidden, { hidden: true, focused: false }, 2500);
    expect(again).toBe(hidden);
    expect(phaseAt(again, 1000 + HIDDEN_GRACE_MS)).toBe("away");
  });

  it("counts a return to sight without the keyboard from when the keyboard went", () => {
    const hidden = windowSeen(reading, { hidden: true, focused: false }, 1000);
    const shown = windowSeen(hidden, { hidden: false, focused: false }, 4000);
    // In sight again, so the short moment no longer applies; the longer one runs from 1000.
    expect(phaseAt(shown, 4000)).toBe("playing");
    expect(phaseAt(shown, 1000 + BLURRED_GRACE_MS)).toBe("away");
  });

  it("is not 'away' when nothing wants sound", () => {
    const hidden = windowSeen(on, { hidden: true, focused: false }, 0);
    expect(away(hidden, 60_000)).toBe(true);
    expect(phaseAt(hidden, 60_000)).toBe("ready");
    // Opened in a window that has long been out of sight: it rests at once.
    expect(phaseAt(enterReader(hidden), 60_000)).toBe("away");
  });

  it("stops, not rests, when the book is left while the window is away", () => {
    const hidden = windowSeen(reading, { hidden: true, focused: false }, 0);
    expect(engineMode(phaseAt(leaveReader(hidden), 60_000))).toBe("stop");
  });

  it("rests the panel's listening too", () => {
    const listening = windowSeen(startListening(off), { hidden: true, focused: false }, 0);
    expect(phaseAt(listening, HIDDEN_GRACE_MS)).toBe("away");
  });
});

describe("how the radio stands, in words", () => {
  it("says what it is doing", () => {
    expect(statusPhrase("playing", "Rain")).toBe("playing rain");
    expect(statusPhrase("playing", "Brown noise")).toBe("playing brown noise");
    expect(statusPhrase("away", "Cafe")).toBe("resting, on cafe");
    expect(statusPhrase("ready", "Fireplace")).toBe("on for reading, fireplace");
    expect(statusPhrase("off", "Rain")).toBe("off");
  });
});

describe("when to look again", () => {
  const reading = enterReader(on);

  it("is never, while the window is in sight and in use", () => {
    expect(untilChange(windowSeen(reading, inSight, 0), 5000)).toBeNull();
  });

  it("is when the moment of grace runs out", () => {
    const hidden = windowSeen(reading, { hidden: true, focused: false }, 1000);
    expect(untilChange(hidden, 1000)).toBe(HIDDEN_GRACE_MS);
    expect(untilChange(hidden, 1500)).toBe(HIDDEN_GRACE_MS - 500);
    const blurred = windowSeen(reading, { hidden: false, focused: false }, 1000);
    expect(untilChange(blurred, 1000)).toBe(BLURRED_GRACE_MS);
  });

  it("is never once it is resting, or when nothing wants sound", () => {
    const hidden = windowSeen(reading, { hidden: true, focused: false }, 1000);
    expect(untilChange(hidden, 1000 + HIDDEN_GRACE_MS)).toBeNull();
    expect(untilChange(windowSeen(on, { hidden: true, focused: false }, 1000), 1000)).toBeNull();
  });

  it("looking then finds it resting", () => {
    const hidden = windowSeen(reading, { hidden: true, focused: false }, 1000);
    const wait = untilChange(hidden, 1200) ?? 0;
    expect(phaseAt(hidden, 1200 + wait)).toBe("away");
  });
});
