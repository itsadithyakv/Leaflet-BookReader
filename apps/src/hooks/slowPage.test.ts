import { describe, expect, it } from "vitest";
import { SLOW_PAGE_CAP_MS, noteBeat, pageTurned, pageUp, type DayTime, type PageStretch } from "./slowPage";

const TICK = 15_000;
const IDLE = 90_000;
const DAY: string = "2026-10-05";

/**
 * The heartbeat as it runs: a beat every 15 s from the page coming up at 0,
 * counted while the last input is no more than 90 s old, quiet after, and
 * forgotten while Leaflet is away. `inputs` are the times anything was
 * touched; `away` the spans with Leaflet not in front; `dayOf` names the day.
 */
const read = (
  untilMs: number,
  { inputs = [0], away = [] as Array<[number, number]>, dayOf = (_at: number) => DAY } = {}
): { stretch: PageStretch; counted: number } => {
  let stretch = pageUp(0);
  let counted = 0;
  for (let at = TICK; at <= untilMs; at += TICK) {
    const lastInput = Math.max(...inputs.filter((time) => time <= at));
    const gone = away.some(([from, to]) => at > from && at <= to);
    const kind = gone ? "away" : at - lastInput > IDLE ? "quiet" : "counted";
    if (kind === "counted") {
      counted += TICK;
    }
    stretch = noteBeat(stretch, kind, TICK, at, dayOf(at));
  }
  return { stretch, counted };
};

const sum = (claim: DayTime[]) => claim.reduce((all, time) => all + time.ms, 0);

describe("a page read slowly, then turned", () => {
  it("claims nothing when the page was turned within the time that counts anyway", () => {
    const { stretch, counted } = read(60_000);
    expect(counted).toBe(60_000);
    expect(pageTurned(stretch, 60_000).claim).toEqual([]);
  });

  it("claims the quiet half-minute of a page turned at two minutes", () => {
    const { stretch, counted } = read(120_000);
    // The heartbeat counted the first 90 s by itself.
    expect(counted).toBe(90_000);
    const { claim } = pageTurned(stretch, 120_000);
    expect(claim).toEqual([{ dateKey: DAY, ms: 30_000 }]);
    expect(counted + sum(claim)).toBe(120_000);
  });

  it("credits the whole of a page turned a second inside the cap", () => {
    // 239 s: fifteen whole beats (225 s), and the beat in progress is the heartbeat's own.
    const { stretch, counted } = read(239_000);
    const { claim } = pageTurned(stretch, 239_000);
    expect(counted + sum(claim)).toBe(225_000);
  });

  it("stops at the cap for a page turned after it", () => {
    const { stretch, counted } = read(241_000);
    const { claim } = pageTurned(stretch, 241_000);
    expect(counted + sum(claim)).toBe(SLOW_PAGE_CAP_MS);
  });

  it("credits four minutes, not twenty, for a book left open and then turned", () => {
    const { stretch, counted } = read(20 * 60_000);
    const { claim } = pageTurned(stretch, 20 * 60_000);
    expect(counted).toBe(90_000);
    expect(sum(claim)).toBe(150_000);
    expect(counted + sum(claim)).toBe(SLOW_PAGE_CAP_MS);
  });

  it("gives a second turn straight after nothing more", () => {
    const { stretch } = read(180_000);
    const first = pageTurned(stretch, 180_000);
    expect(sum(first.claim)).toBe(90_000);
    const second = pageTurned(first.next, 180_400);
    expect(second.claim).toEqual([]);
    // Nor does a third, a held key later.
    expect(pageTurned(second.next, 180_550).claim).toEqual([]);
  });

  it("never claims the time Leaflet was not in front", () => {
    // Up for four minutes, of which 100 s to 190 s were spent in another window.
    const { stretch, counted } = read(240_000, { away: [[100_000, 190_000]] });
    const { claim } = pageTurned(stretch, 240_000);
    // Quiet beats: 105 s is away, so 195..240 only (four beats) count as quiet.
    expect(counted).toBe(90_000);
    expect(sum(claim)).toBe(60_000);
    expect(counted + sum(claim)).toBeLessThanOrEqual(240_000 - 90_000);
  });

  it("claims no more than the time that has really passed since anything was counted", () => {
    // Quiet remembered from earlier on the page, then the reader moves the
    // mouse and reading counts again: a turn two seconds after the last
    // counted beat has two seconds to claim, whatever was quiet before.
    let stretch = pageUp(0);
    stretch = noteBeat(stretch, "counted", TICK, 15_000, DAY);
    stretch = noteBeat(stretch, "quiet", TICK, 120_000, DAY);
    stretch = noteBeat(stretch, "quiet", TICK, 135_000, DAY);
    stretch = noteBeat(stretch, "counted", TICK, 150_000, DAY);
    expect(sum(pageTurned(stretch, 152_000).claim)).toBe(2_000);
  });

  it("does not top a page up past the cap when most of it counted anyway", () => {
    // Touched again at 100 s and at 200 s: 90 + 90 + 40 counted to 290 s... the cap is already passed.
    const { stretch, counted } = read(300_000, { inputs: [0, 100_000, 200_000] });
    expect(counted).toBeGreaterThanOrEqual(SLOW_PAGE_CAP_MS);
    expect(pageTurned(stretch, 300_000).claim).toEqual([]);
  });

  it("credits a page begun before midnight to the day each part was read on", () => {
    // The page comes up at 23:57:00; midnight is 180 s in; turned at 23:57 + 225 s.
    const dayOf = (at: number) => (at <= 180_000 ? "2026-10-05" : "2026-10-06");
    const { stretch, counted } = read(225_000, { dayOf });
    const { claim } = pageTurned(stretch, 225_000);
    expect(counted).toBe(90_000);
    expect(claim).toEqual([
      { dateKey: "2026-10-05", ms: 90_000 },
      { dateKey: "2026-10-06", ms: 45_000 }
    ]);
  });

  it("keeps the newest quiet time when there is more than a page can claim", () => {
    const dayOf = (at: number) => (at <= 600_000 ? "2026-10-05" : "2026-10-06");
    const { stretch } = read(700_000, { dayOf });
    const { claim } = pageTurned(stretch, 700_000);
    // 150 s to claim: the last 90 s fell after midnight (beats at 615..690), 60 s before it.
    expect(claim).toEqual([
      { dateKey: "2026-10-05", ms: 60_000 },
      { dateKey: "2026-10-06", ms: 90_000 }
    ]);
  });

  it("starts the next page afresh", () => {
    const { stretch } = read(200_000);
    const { next } = pageTurned(stretch, 200_000);
    expect(next).toEqual(pageUp(200_000));
  });
});
