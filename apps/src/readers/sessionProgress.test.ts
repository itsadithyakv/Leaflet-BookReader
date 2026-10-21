import { describe, expect, it } from "vitest";
import { shownProgress } from "./sessionProgress";

describe("a focus session's progress as the reader shows it (readers/sessionProgress.ts)", () => {
  it("moves in half percent steps, so the reader is not drawn again at every poll", () => {
    // A 25-minute session polled every 1.2 s: the value the reader holds changes about every 7.5 s.
    const polls = Array.from({ length: 1250 }, (_, i) => shownProgress((i * 1.2) / (25 * 60)));
    const changes = polls.filter((value, i) => i > 0 && value !== polls[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(200);
    expect(changes).toBeGreaterThanOrEqual(195);
    for (let i = 1; i < polls.length; i += 1) expect(polls[i]).toBeGreaterThanOrEqual(polls[i - 1]);
  });

  it("reaches the checkpoints and the end exactly when the session does", () => {
    expect(shownProgress(0.4999)).toBeLessThan(0.5);
    expect(shownProgress(0.5)).toBe(0.5);
    expect(shownProgress(0.9)).toBe(0.9);
    expect(shownProgress(0.99)).toBe(0.99);
    expect(shownProgress(0.9999)).toBeLessThan(1);
    expect(shownProgress(1)).toBe(1);
  });

  it("keeps to 0..1", () => {
    expect(shownProgress(-0.2)).toBe(0);
    expect(shownProgress(3)).toBe(1);
    expect(shownProgress(Number.NaN)).toBe(0);
  });
});
