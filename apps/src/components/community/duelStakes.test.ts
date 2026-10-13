import { describe, expect, it } from "vitest";
import type { Duel } from "../../services/socialService";
import { readStakeBook, stakeJobs, stakeText, withStep } from "./duelStakes";

const duel = (id: string, more: Partial<Duel>): Duel => ({
  id,
  weekKey: "2026-W41",
  status: "pending",
  youChallenged: true,
  weekOver: false,
  you: { handle: "adi", displayName: null, pipSeed: "adi", minutes: 0 },
  them: { handle: "maya", displayName: null, pipSeed: "maya", minutes: 0 },
  result: null,
  ...more
});

describe("seeds on a duel", () => {
  it("puts nothing down until the duel is on", () => {
    // A challenge nobody has answered, one that was declined, and one with no stake.
    const duels = [duel("a", { stake: 25 }), duel("b", { stake: 25, status: "declined" }), duel("c", { status: "accepted" }), duel("d", { stake: 0, status: "accepted" })];
    expect(stakeJobs(duels, {})).toEqual([]);
  });

  it("stakes once the duel is accepted, by whichever side", () => {
    const duels = [duel("a", { stake: 25, status: "accepted" }), duel("b", { stake: 10, status: "accepted", youChallenged: false })];
    expect(stakeJobs(duels, {})).toEqual([
      { duelId: "a", do: "stake", seeds: 25 },
      { duelId: "b", do: "stake", seeds: 10 }
    ]);
    // Done once: nothing more until it is over.
    expect(stakeJobs(duels, { a: "staked", b: "staked" })).toEqual([]);
  });

  it("says how it went once it is over, to a ledger that holds the stake", () => {
    const duels = [
      duel("won", { stake: 25, status: "finished", result: "won" }),
      duel("lost", { stake: 25, status: "finished", result: "lost" }),
      duel("tie", { stake: 25, status: "finished", result: "tie" }),
      duel("skipped", { stake: 25, status: "finished", result: "won" }),
      duel("done", { stake: 25, status: "finished", result: "won" })
    ];
    expect(stakeJobs(duels, { won: "staked", lost: "staked", tie: "staked", skipped: "skipped", done: "settled" })).toEqual([
      { duelId: "won", do: "settle", outcome: "won" },
      { duelId: "lost", do: "settle", outcome: "lost" },
      { duelId: "tie", do: "settle", outcome: "tied" }
    ]);
  });

  it("stakes first, and settles on the next pass, a duel that ended while the app was shut", () => {
    const ended = [duel("a", { stake: 25, status: "finished", result: "won" })];
    expect(stakeJobs(ended, {})).toEqual([{ duelId: "a", do: "stake", seeds: 25 }]);
    expect(stakeJobs(ended, { a: "staked" })).toEqual([{ duelId: "a", do: "settle", outcome: "won" }]);
  });

  it("keeps what has been done, and forgets the oldest duels", () => {
    expect(readStakeBook(null)).toEqual({});
    expect(readStakeBook("[]")).toEqual({});
    expect(readStakeBook('{"a":"staked","b":"nonsense","c":"settled"}')).toEqual({ a: "staked", c: "settled" });
    let book = {};
    for (let index = 0; index < 70; index += 1) {
      book = withStep(book, `duel-${index}`, "settled");
    }
    expect(Object.keys(book)).toHaveLength(60);
    expect(Object.keys(book)[0]).toBe("duel-10");
    expect(withStep({ a: "staked" }, "a", "settled")).toEqual({ a: "settled" });
  });

  it("says a stake in words", () => {
    expect(stakeText(duel("a", { stake: 25 }))).toBe("25 seeds each");
    expect(stakeText(duel("a", { stake: 1 }))).toBe("1 seed each");
    expect(stakeText(duel("a", {}))).toBeNull();
  });
});
