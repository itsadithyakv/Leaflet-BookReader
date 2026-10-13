import { describe, expect, it } from "vitest";
import { LIB } from "./index";
import "./houseArt";
import { houseItems } from "./home.js";
import { FREE_SIGNATURES, PREMIUM_MOVES } from "./shop";
import { seeded } from "./behaviour";
import { BOP, BOUNCE, KINDS, VISIT_IDS, kindOf, visitBeats, visitOf, visitOffer, type Visit } from "./furnish";

/** Things in the room that answer a tap and have Pip come over (pip/furnish.ts, `VISITS`). */

const moves = new Set(LIB.map((move) => move.id));
/** Every piece of decor: the bedroom's twenty, the house's, and the book nods. */
const pieces = new Map(houseItems().map((item) => [item.id, item]));
const sold = new Set(PREMIUM_MOVES.map((move) => move.id));
const visit = (id: string): Visit => {
  const found = visitOf(id);
  if (!found) throw new Error(`${id} is not something she visits`);
  return found;
};

describe("the things that answer a tap", () => {
  it("are each a real piece of decor, of the kind the room lays a button over", () => {
    expect(VISIT_IDS.length).toBeGreaterThanOrEqual(25);
    for (const id of VISIT_IDS) {
      expect(pieces.has(id), id).toBe(true);
      expect(pieces.get(id)?.nod, `${id} is a book nod`).toBeUndefined();
      expect(kindOf(id), id).toBe("visit");
    }
  });

  it("are all there is of that kind: every piece the room calls one says what it does", () => {
    for (const id of pieces.keys()) {
      if (kindOf(id) === "visit") expect(visitOf(id), id).not.toBeNull();
      else expect(visitOf(id), id).toBeNull();
    }
  });

  it("leave alone what was something else already, and what is hers to sit in", () => {
    // (furnish.test.ts and fridge.test.ts pin the armchair and the Retro Fridge.)
    expect(kindOf("armchair")).toBeNull();
    expect(kindOf("fridge")).toBeNull();
    expect(kindOf("bed")).toBe("bed");
    expect(kindOf("lamp")).toBe("lamp");
    expect(kindOf("bookshelf")).toBe("books");
    // The decor called "clock" and "plant" are not the room's own wall clock and houseplant, which open a card.
    expect(kindOf("wallclock")).toBe("clock");
    expect(kindOf("plantpot")).toBe("plant");
    expect(kindOf("clock")).toBe("visit");
    expect(kindOf("plant")).toBe("visit");
  });

  it("each say what choosing them does, in a sentence, and what she is doing there", () => {
    expect(KINDS.visit.how.length).toBeGreaterThan(10);
    expect(KINDS.visit.cursor).toBe("pointer");
    expect(KINDS.visit.remembers).toEqual([]);
    for (const id of VISIT_IDS) {
      const { how, label } = visit(id);
      expect(how, id).toMatch(/^Select .+\.$/);
      expect(label.length, id).toBeGreaterThan(8);
      expect(label, id).toBe(label.toLowerCase());
    }
  });

  it("use only moves she has: a dance apart, which is one of her own", () => {
    for (const id of VISIT_IDS) {
      const { beats, dance } = visit(id);
      expect(beats.length, id).toBeGreaterThan(0);
      for (const beat of beats) {
        // (A bounce is not a move either: the scene throws her up.)
        if (beat.move !== "dance" && beat.move !== BOUNCE) expect(moves.has(beat.move), `${id}: ${beat.move}`).toBe(true);
        expect(beat.bounces !== undefined, id).toBe(beat.move === BOUNCE);
        expect(beat.seconds, id).toBeGreaterThanOrEqual(1);
        expect(beat.seconds, id).toBeLessThanOrEqual(8);
        for (const line of beat.lines ?? []) expect(line, id).toBe(line.toLowerCase());
      }
      // A whole visit is a moment, not a show.
      expect(beats.reduce((sum, beat) => sum + beat.seconds, 0), id).toBeLessThanOrEqual(10);
      if (dance) expect(moves.has(dance), `${id}: ${dance}`).toBe(true);
    }
    expect(moves.has(BOP)).toBe(true);
  });

  it("never show a move the shop sells, unless it is hers", () => {
    for (const id of VISIT_IDS) {
      for (const beat of visit(id).beats) expect(sold.has(beat.move), `${id}: ${beat.move}`).toBe(false);
      for (const step of visitBeats(visit(id), [], seeded(7))) expect(sold.has(step.move), `${id}: ${step.move}`).toBe(false);
    }
    expect(sold.has(BOP)).toBe(false);
    expect(FREE_SIGNATURES.some((move) => sold.has(move))).toBe(false);
  });
});

describe("what she does at one", () => {
  it("is each beat in turn, with one of its lines", () => {
    const steps = visitBeats(visit("fireplace"), [], seeded(3));
    expect(steps.map((step) => step.move)).toEqual(["stretch", "yawn"]);
    expect(visit("fireplace").beats[0].lines).toContain(steps[0].line);
    expect(steps[1].line).toBe("...so warm.");
    // A beat with nothing to say says nothing.
    expect(visitBeats(visit("gnome"), [], seeded(3))[1].line).toBeUndefined();
  });

  it("is the same for the same dice", () => {
    for (const id of VISIT_IDS) expect(visitBeats(visit(id), ["floss", "robot"], seeded(11)), id).toEqual(visitBeats(visit(id), ["floss", "robot"], seeded(11)));
  });

  it("carries the sound of a beat that has one: the cat purrs as she fusses it", () => {
    expect(visitBeats(visit("catbed"), [], seeded(1))[0].sound).toBe("purr");
    expect(visitBeats(visit("sunflowers"), [], seeded(1))[0]).toMatchObject({ move: "water", sound: "splash" });
    expect(visitBeats(visit("aquarium"), [], seeded(1))[0].sound).toBeUndefined();
  });

  it("is a little bop at a record player, for a Pip with no dances", () => {
    expect(visitBeats(visit("recordplayer"), [], seeded(1)).map((step) => step.move)).toEqual([BOP]);
    expect(visitBeats(visit("discoball"), [], seeded(1)).map((step) => step.move)).toEqual([BOP]);
  });

  it("is one of her own dances, for a Pip who has some", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const [step] = visitBeats(visit("recordplayer"), ["floss", "tapdance"], seeded(seed));
      expect(["floss", "tapdance"]).toContain(step.move);
    }
  });

  it("is so many bounces on the trampoline, which the scene throws, and a cheer after", () => {
    const [bounce, cheer] = visitBeats(visit("trampoline"), [], seeded(2));
    expect(bounce).toMatchObject({ move: BOUNCE, bounces: 4 });
    expect(visit("trampoline").beats[0].lines).toContain(bounce.line);
    expect(cheer.move).toBe("cheer");
    expect(cheer.bounces).toBeUndefined();
    // Nothing else bounces.
    for (const id of VISIT_IDS.filter((other) => other !== "trampoline")) expect(visitBeats(visit(id), [], seeded(2)).some((step) => step.bounces), id).toBe(false);
  });

  it("is a bop at the music box whatever she owns: it is that sort of tune", () => {
    expect(visitBeats(visit("musicbox"), ["disco", "floss"], seeded(4)).map((step) => step.move)).toEqual([BOP]);
  });

  it("is the dance the thing asks for, when that is one of hers: the disco under the disco ball", () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      expect(visitBeats(visit("discoball"), ["floss", "disco"], seeded(seed))[0].move).toBe("disco");
      expect(visitBeats(visit("robotbuddy"), ["robot", "floss"], seeded(seed))[0].move).toBe("robot");
      // Not hers: another of her own.
      expect(visitBeats(visit("discoball"), ["floss"], seeded(seed))[0].move).toBe("floss");
    }
  });
});

describe("going to one of her own accord", () => {
  it("is offered by the things she goes over to, a little each", () => {
    const offer = visitOffer(visit("aquarium"));
    expect(offer).toMatchObject({ label: "watching the fish", move: "inspect", use: "answer" });
    expect(offer?.weight).toBeLessThan(1);
    for (const id of VISIT_IDS) {
      const offered = visitOffer(visit(id));
      if (!offered) continue;
      expect(moves.has(offered.move), `${id}: ${offered.move}`).toBe(true);
      expect(offered.seconds, id).toBeGreaterThan(0);
    }
  });

  it("is not offered by the music (she dances by herself already), nor by the cuckoo, which nobody goes to, nor by the trampoline", () => {
    expect(visitOffer(visit("recordplayer"))).toBeNull();
    expect(visitOffer(visit("discoball"))).toBeNull();
    expect(visitOffer(visit("clock"))).toBeNull();
    expect(visitOffer(visit("trampoline"))).toBeNull();
    // The music box and the bubbles she does go to.
    expect(visitOffer(visit("musicbox"))?.move).toBe(BOP);
    expect(visitOffer(visit("bubblemachine"))?.move).toBe("beg");
  });
});
