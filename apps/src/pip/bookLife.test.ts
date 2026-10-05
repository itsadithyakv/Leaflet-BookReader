import { describe, expect, it } from "vitest";
import { LIB } from "./index";
import {
  FRESH_READ_MIN,
  STALE_READ_MIN,
  busySeconds,
  chooseActivity,
  planActivity,
  quiltLine,
  seeded,
  shortTitle,
  weights,
  type Activity,
  type ActivityId,
  type BehaviourState,
  type Spot,
  type Step,
  type World
} from "./behaviour";
import type { GenreMood } from "./genre";

const BED: Spot = { kind: "bed", x: 34, w: 42, id: "bed" };
const BOOKS: Spot = { kind: "books", x: 184, w: 14, up: true, id: "bookstack" };
const room: Spot[] = [BOOKS, { kind: "window", x: 120, w: 36, up: true, id: "window" }, { kind: "seat", x: 120, w: 52, up: true, id: "rug" }, BED];

const state = (over: Partial<BehaviourState> = {}): BehaviourState => ({
  mood: 70,
  hour: 15,
  floor: { w: 240, garden: false, arcade: false },
  x: 120,
  spots: room,
  toys: [],
  dances: [],
  signature: "read",
  hobbies: ["jog", "rope", "tree"],
  recent: [],
  ...over
});

const reading = (mood: GenreMood | null, readAgoMin: number | null = 10): World => ({ book: { title: "The Book", mood, readAgoMin } });

/** A long run of choices, each fed the ones before it, as the house does. */
const run = (seed: number, count: number, over: Partial<BehaviourState> = {}) => {
  const rand = seeded(seed);
  const recent: ActivityId[] = [];
  const done: Activity[] = [];
  for (let index = 0; index < count; index += 1) {
    const activity = chooseActivity(state({ ...over, recent }), rand);
    done.push(activity);
    recent.unshift(activity.id);
    recent.length = Math.min(recent.length, 3);
  }
  return done;
};
const share = (done: Activity[], id: ActivityId) => done.filter((activity) => activity.id === id).length / done.length;
const moves = (activity: Activity) => activity.steps.flatMap((step) => (step.kind === "do" ? [step.move] : []));
const lines = (activity: Activity) => activity.steps.flatMap((step) => (step.kind === "do" && step.line ? [step.line] : []));
const walks = (activity: Activity) => activity.steps.filter((step): step is Extract<Step, { kind: "walk" }> => step.kind === "walk");
const many = (id: ActivityId, over: Partial<BehaviourState> = {}, count = 80) => {
  const rand = seeded(21);
  return Array.from({ length: count }, () => planActivity(id, state(over), rand));
};

const BOOKISH: ActivityId[] = ["spooked", "sleuth", "quest", "starwatch", "swoon", "hangover", "dust", "potter"];
const OF: Record<GenreMood, ActivityId> = { horror: "spooked", mystery: "sleuth", fantasy: "quest", scifi: "starwatch", romance: "swoon" };

describe("a Pip told nothing of the world", () => {
  it("does none of the bookish things, and chooses exactly as she did before", () => {
    const w = weights(state());
    for (const id of BOOKISH) expect(w[id]).toBe(0);
    for (const hour of [9, 15, 20, 23]) {
      const plain = run(3, 200, { hour }).map((activity) => activity.id);
      for (const id of BOOKISH) expect(plain).not.toContain(id);
      // An empty world is the same as none: not one choice differs.
      expect(run(3, 200, { hour, world: {} }).map((activity) => activity.id)).toEqual(plain);
      expect(run(3, 200, { hour, world: { book: null, hangover: null, dusty: null } }).map((activity) => activity.id)).toEqual(plain);
    }
  });
});

describe("the book on the go gets into her head", () => {
  it("pulls her to its own mood's thing only", () => {
    for (const mood of Object.keys(OF) as GenreMood[]) {
      const w = weights(state({ world: reading(mood) }));
      for (const other of Object.values(OF)) {
        if (other === OF[mood]) expect(w[other]).toBeGreaterThan(0);
        else expect(w[other]).toBe(0);
      }
    }
    const none = weights(state({ world: reading(null) }));
    for (const id of Object.values(OF)) expect(none[id]).toBe(0);
  });

  it("most just after reading, less the next day, a little that week, and then not at all", () => {
    const pull = (readAgoMin: number | null) => weights(state({ world: reading("mystery", readAgoMin) })).sleuth;
    expect(pull(0)).toBe(pull(FRESH_READ_MIN));
    expect(pull(FRESH_READ_MIN)).toBeGreaterThan(pull(FRESH_READ_MIN + 1));
    expect(pull(12 * 60)).toBeGreaterThan(pull(3 * 24 * 60));
    expect(pull(STALE_READ_MIN)).toBeGreaterThan(0);
    expect(pull(STALE_READ_MIN + 1)).toBe(0);
    expect(pull(null)).toBe(0);
  });

  it("is an occasional thing, never her whole day, and never twice running", () => {
    for (const mood of ["horror", "mystery", "fantasy"] as const) {
      const fresh = run(4, 600, { world: reading(mood, 5) });
      const week = run(4, 600, { world: reading(mood, 4 * 24 * 60) });
      expect(share(fresh, OF[mood])).toBeGreaterThan(0.08);
      expect(share(fresh, OF[mood])).toBeLessThan(0.3);
      expect(share(week, OF[mood])).toBeGreaterThan(0.01);
      expect(share(week, OF[mood])).toBeLessThan(share(fresh, OF[mood]));
      // A book is still what she does most.
      expect(share(fresh, "read")).toBeGreaterThan(share(fresh, OF[mood]));
      for (let index = 1; index < fresh.length; index += 1) expect(fresh[index].id).not.toBe(fresh[index - 1].id);
    }
  });

  it("keeps a quest for when she is not glum", () => {
    expect(weights(state({ mood: 5, world: reading("fantasy") })).quest).toBe(0);
    expect(weights(state({ mood: 5, world: reading("mystery") })).sleuth).toBeGreaterThan(0);
    expect(weights(state({ mood: 5, world: reading("horror") })).spooked).toBeGreaterThan(0);
  });
});

describe("a horror on the go", () => {
  it("at night sends her under the quilt, then to check beneath the bed", () => {
    for (const activity of many("spooked", { hour: 21, x: 150 })) {
      expect(activity.label).toBe("hiding under the quilt");
      expect(moves(activity)).toEqual(["glance", "underbed", "shift"]);
      const [start, walk, face, hide, turn, under] = activity.steps;
      expect(start).toMatchObject({ kind: "do", move: "glance" });
      // Over to the bed on tiptoe, on the side she is on, turned to it.
      expect(walk).toEqual({ kind: "walk", x: 66, pace: "tiptoe" });
      expect(face).toEqual({ kind: "face", dir: -1 });
      expect(hide).toMatchObject({ kind: "use", id: "bed", what: "hide" });
      const seconds = (hide as Extract<Step, { what: "sleep" | "hide" }>).seconds;
      expect(seconds).toBeGreaterThanOrEqual(8);
      // Short of the scene's first look at the clock for morning (30 s): hiding is not a night's sleep.
      expect(seconds).toBeLessThanOrEqual(13);
      // The look beneath the bed comes after the quilt, turned to the bed.
      expect(turn).toEqual({ kind: "face", dir: -1 });
      expect(under).toMatchObject({ kind: "do", move: "underbed" });
      expect(busySeconds(activity)).toBeLessThanOrEqual(26);
    }
  });

  it("by day is milder: a glance over her shoulder, and no bed", () => {
    for (const hour of [6, 9, 12, 15, 18]) {
      for (const activity of many("spooked", { hour }, 20)) {
        expect(activity.label).toBe("glancing over her shoulder");
        expect(moves(activity)).toEqual(["glance", "shift"]);
        expect(activity.steps.every((step) => step.kind === "do")).toBe(true);
        expect(busySeconds(activity)).toBeLessThanOrEqual(6);
      }
    }
  });

  it("with no bed out she only listens to the house", () => {
    for (const activity of many("spooked", { hour: 23, spots: [BOOKS] }, 20)) {
      expect(moves(activity)).toEqual(["glance", "look", "shift"]);
      expect(activity.steps.some((step) => step.kind === "use")).toBe(false);
    }
  });

  it("without motion she is simply at the bed, and still hides and checks", () => {
    for (const activity of many("spooked", { hour: 21, x: 150, reduced: true }, 20)) {
      expect(walks(activity)).toEqual([{ kind: "walk", x: 66 }]);
      expect(activity.steps.some((step) => step.kind === "use" && step.what === "hide")).toBe(true);
      expect(moves(activity)).toContain("underbed");
    }
    // And the chooser keeps that walk too, as it does the fridge's.
    const chosen = run(8, 300, { hour: 21, reduced: true, world: reading("horror") }).filter((activity) => activity.id === "spooked");
    expect(chosen.length).toBeGreaterThan(5);
    for (const activity of chosen) expect(walks(activity)).toHaveLength(1);
  });
});

describe("a mystery on the go", () => {
  it("gets the magnifying glass out and follows something along the floor", () => {
    for (const from of [30, 120, 200]) {
      for (const activity of many("sleuth", { x: from }, 30)) {
        expect(moves(activity)).toEqual(["inspect", "inspect", "idea"]);
        const [first, second] = walks(activity);
        // Bent over the glass, slowly, and a good way across the room; then part of the way back.
        expect(first).toMatchObject({ pace: "slow", as: "trail" });
        expect(second).toMatchObject({ pace: "slow", as: "trail" });
        expect(Math.abs(first.x - from)).toBeGreaterThanOrEqual(40);
        expect(Math.abs(second.x - first.x)).toBeGreaterThanOrEqual(10);
        for (const walk of [first, second]) {
          expect(walk.x).toBeGreaterThanOrEqual(18);
          expect(walk.x).toBeLessThanOrEqual(222);
        }
        expect(busySeconds(activity)).toBeLessThanOrEqual(12);
      }
    }
  });

  it("without motion is the glass and the answer, where she stands", () => {
    for (const activity of many("sleuth", { reduced: true }, 10)) {
      expect(activity.steps.every((step) => step.kind === "do")).toBe(true);
      expect(moves(activity)).toContain("inspect");
    }
  });
});

describe("a fantasy on the go", () => {
  it("is a cape and a wooden sword: an oath, a march, a fight, the sword raised", () => {
    for (const activity of many("quest")) {
      expect(moves(activity)).toEqual(["knight", "swordplay", "knight"]);
      expect(walks(activity)).toHaveLength(1);
      expect(walks(activity)[0]).toMatchObject({ as: "march" });
      expect(walks(activity)[0].pace).toBeUndefined();
      expect(busySeconds(activity)).toBeLessThanOrEqual(17);
    }
  });

  it("without motion is the pose and the oath, and no swordplay", () => {
    for (const activity of many("quest", { reduced: true }, 10)) expect(moves(activity)).toEqual(["knight"]);
  });
});

describe("the two that came cheap", () => {
  it("has her watch the sky after science fiction, at a window if there is one", () => {
    for (const activity of many("starwatch", { x: 40 }, 20)) {
      expect(activity.steps[0]).toEqual({ kind: "walk", x: 120 });
      expect(moves(activity)).toEqual(["gaze", "look"]);
    }
    for (const activity of many("starwatch", { spots: [] }, 5)) expect(activity.steps.every((step) => step.kind === "do")).toBe(true);
  });

  it("has her sigh over a romance", () => {
    for (const activity of many("swoon", {}, 20)) {
      expect(moves(activity)).toEqual(["smitten", "shift"]);
      expect(lines(activity)).toHaveLength(1);
    }
  });
});

describe("the book hangover", () => {
  const world: World = { hangover: { title: "Mistborn" } };

  it("has her on the floor now and then, for as long as the world says a book just ended", () => {
    expect(weights(state()).hangover).toBe(0);
    expect(weights(state({ world })).hangover).toBeGreaterThan(0);
    const done = run(6, 600, { world });
    expect(share(done, "hangover")).toBeGreaterThan(0.08);
    expect(share(done, "hangover")).toBeLessThan(0.3);
    for (let index = 1; index < done.length; index += 1) expect(done[index].id).not.toBe(done[index - 1].id);
    // At any hour, in any mood, and without motion (it is a still thing).
    for (const over of [{ hour: 3 }, { hour: 12 }, { mood: 5 }, { reduced: true }]) expect(weights(state({ world, ...over })).hangover).toBeGreaterThan(0);
  });

  it("is a good while flat on the floor, the owner's line among what she says, and up again", () => {
    const said = new Set<string>();
    for (const activity of many("hangover", { world }, 200)) {
      expect(activity.label).toBe("lying on the floor with a book hangover");
      expect(moves(activity)).toEqual(["hangover", "stretch"]);
      const lie = activity.steps[0] as Extract<Step, { kind: "do" }>;
      expect(lie.seconds).toBeGreaterThanOrEqual(14);
      expect(lie.seconds).toBeLessThanOrEqual(22);
      expect(lie.line).toBeTruthy();
      lines(activity).forEach((line) => said.add(line));
    }
    expect(said).toContain("it's over. what now.");
    expect(said.size).toBeGreaterThanOrEqual(5);
  });
});

describe("dusting the book left behind", () => {
  const world: World = { dusty: { title: "The Way of Kings: Book One of the Stormlight Archive", days: 20 } };

  it("happens now and then, at the books, with the title said wistfully", () => {
    expect(weights(state()).dust).toBe(0);
    expect(weights(state({ world })).dust).toBeGreaterThan(0);
    const done = run(9, 800, { world });
    expect(share(done, "dust")).toBeGreaterThan(0.03);
    expect(share(done, "dust")).toBeLessThan(0.2);
    for (const activity of many("dust", { world, x: 60 })) {
      expect(activity.steps[0]).toEqual({ kind: "walk", x: 184 });
      expect(moves(activity)).toEqual(["dust", "shift"]);
      const [first] = lines(activity);
      expect(first).toContain("the way of kings");
      expect(first).not.toContain("stormlight");
    }
  });

  it("says a long title short, in her own lower case", () => {
    expect(shortTitle("Dune")).toBe("dune");
    expect(shortTitle("The Way of Kings: Book One of the Stormlight Archive")).toBe("the way of kings");
    expect(shortTitle("Frankenstein (Annotated)")).toBe("frankenstein");
    expect(shortTitle("Mistborn - The Final Empire")).toBe("mistborn");
    const long = shortTitle("The Hitchhiker's Guide to the Galaxy");
    expect(long.length).toBeLessThanOrEqual(22);
    expect(long.endsWith("…")).toBe(true);
    expect(shortTitle(": Untitled")).toBe(": untitled");
  });
});

describe("a thing in the room that offers something", () => {
  const calendar: Spot = { kind: "thing", x: 60, w: 16, up: true, id: "bedroom/wall-1", offer: { label: "looking at the calendar", move: "pointup", seconds: 3, lines: ["three days in a row."], use: "look" } };
  const radio: Spot = { kind: "thing", x: 200, w: 12, id: "bedroom/top-2", offer: { label: "turning the radio's dial", move: "tap", seconds: 4, weight: 3 } };

  it("is gone to, used and spoken over, with nothing added to the planner", () => {
    expect(weights(state()).potter).toBe(0);
    expect(weights(state({ spots: [...room, calendar] })).potter).toBe(1);
    // Never more than a book, however much is on offer.
    expect(weights(state({ spots: [...room, calendar, radio, radio, radio] })).potter).toBe(3);
    for (const activity of many("potter", { spots: [...room, calendar], x: 150 }, 20)) {
      expect(activity.label).toBe("looking at the calendar");
      // Under a thing on the wall; the thing is told as she starts; then the move and the line.
      expect(activity.steps).toEqual([
        { kind: "walk", x: 60 },
        { kind: "use", id: "bedroom/wall-1", what: "thing", verb: "look" },
        { kind: "do", move: "pointup", seconds: 3, line: "three days in a row." }
      ]);
    }
    for (const activity of many("potter", { spots: [radio], x: 100 }, 5)) {
      expect(activity.steps).toEqual([{ kind: "walk", x: 183 }, { kind: "face", dir: 1 }, { kind: "do", move: "tap", seconds: 4, line: undefined }]);
    }
  });

  it("goes more to the thing that offers more", () => {
    const done = many("potter", { spots: [calendar, radio] }, 400);
    const toRadio = done.filter((activity) => activity.label === "turning the radio's dial").length;
    expect(toRadio).toBeGreaterThan(250);
    expect(toRadio).toBeLessThan(350);
  });

  it("is chosen among the rest, and stands still without motion", () => {
    expect(share(run(5, 400, { spots: [...room, calendar] }), "potter")).toBeGreaterThan(0.02);
    for (const activity of many("potter", { spots: [calendar], reduced: true }, 5)) expect(activity.steps.some((step) => step.kind === "walk")).toBe(false);
  });
});

describe("what she says, and does, about her books", () => {
  const worlds: Array<[ActivityId, Partial<BehaviourState>]> = [
    ["spooked", { hour: 22 }],
    ["spooked", { hour: 12 }],
    ["sleuth", {}],
    ["quest", {}],
    ["starwatch", {}],
    ["swoon", {}],
    ["hangover", { world: { hangover: { title: "Dune" } } }],
    ["dust", { world: { dusty: { title: "The Hitchhiker's Guide to the Galaxy", days: 30 } } }]
  ];

  it("is short, in her own lower case, a few ways each, and never a telling-off", () => {
    for (const [id, over] of worlds) {
      const said = new Set(many(id, over, 150).flatMap(lines));
      expect(said.size).toBeGreaterThanOrEqual(3);
      for (const line of said) {
        expect(line).toBe(line.toLowerCase());
        expect(line.length).toBeLessThanOrEqual(44);
        expect(line).not.toMatch(/should|never finish|gave up|lazy|shame|abandon/);
      }
    }
    const quilt = new Set(Array.from({ length: 40 }, ((rand) => () => quiltLine(rand))(seeded(3))));
    expect(quilt.size).toBeGreaterThanOrEqual(3);
    for (const line of quilt) expect(line.length).toBeLessThanOrEqual(44);
  });

  it("uses only moves that exist", () => {
    for (const [id, over] of worlds) {
      for (const activity of many(id, over, 30)) {
        for (const move of moves(activity)) expect(LIB.some((entry) => entry.id === move), move).toBe(true);
        for (const walk of walks(activity)) if (walk.as) expect(LIB.some((entry) => entry.id === walk.as), walk.as).toBe(true);
      }
    }
    for (const move of ["quilt-hide", "underbed", "inspect", "trail", "knight", "march", "swordplay", "hangover", "dust", "glance"]) {
      expect(LIB.some((entry) => entry.id === move), move).toBe(true);
    }
  });

  it("is the same for the same seed", () => {
    for (const [id, over] of worlds) {
      expect(planActivity(id, state(over), seeded(77))).toEqual(planActivity(id, state(over), seeded(77)));
    }
  });
});
