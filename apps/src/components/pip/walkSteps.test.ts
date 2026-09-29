import { describe, expect, it } from "vitest";
import { WALK, WALK_KEY, markWalkSeen, nextStep, walkSeen } from "./walkSteps";

describe("the walkthrough's steps", () => {
  it("points at seeds and mood, the shop, decorating and a plot, in that order", () => {
    expect(WALK.map((step) => step.target)).toEqual(["resources", "shop", "decorate", "plot"]);
  });

  it("keeps Pip's lines short and lowercase", () => {
    for (const step of WALK) {
      expect(step.line).toBe(step.line.toLowerCase());
      expect(step.line.length).toBeLessThanOrEqual(90);
    }
  });

  it("goes step by step, then ends", () => {
    const all = () => true;
    expect(nextStep(-1, all)).toBe(0);
    expect(nextStep(0, all)).toBe(1);
    expect(nextStep(WALK.length - 1, all)).toBeNull();
  });

  it("skips what is not there (a house without a garden)", () => {
    const noGarden = (step: (typeof WALK)[number]) => step.target !== "plot";
    expect(nextStep(2, noGarden)).toBeNull();
    const noShop = (step: (typeof WALK)[number]) => step.target !== "shop";
    expect(nextStep(0, noShop)).toBe(2);
  });
});

describe("showing it once", () => {
  it("remembers that it was seen", () => {
    const values = new Map<string, string>();
    const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
    expect(walkSeen(store)).toBe(false);
    markWalkSeen(store);
    expect(values.get(WALK_KEY)).toBe("1");
    expect(walkSeen(store)).toBe(true);
  });

  it("never nags when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    };
    expect(walkSeen(blocked)).toBe(true);
    expect(() => markWalkSeen(blocked)).not.toThrow();
  });
});
