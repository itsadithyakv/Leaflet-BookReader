import { describe, expect, it } from "vitest";
import { createSchedule, GRAIN_VARIANTS, type GrainEvent, type RampEvent, type SceneEvent } from "./schedule";
import { SCENES, SCENE_ORDER, sceneParams, type GrainsDef, type SceneDef, type TalkerDef } from "./scenes";

const isGrain = (event: SceneEvent): event is GrainEvent => event.kind === "grain";
const isRamp = (event: SceneEvent): event is RampEvent => event.kind === "ramp";

/** A scene with one stream, to look at that stream alone. */
const only = (scene: SceneDef, index: number): SceneDef => ({ ...scene, streams: [scene.streams[index]] });
const streamIndex = (scene: SceneDef, test: (kind: SceneDef["streams"][number]) => boolean) => scene.streams.findIndex(test);

describe("a scene's schedule", () => {
  it("gives the same events for the same seed", () => {
    for (const id of SCENE_ORDER) {
      expect(createSchedule(SCENES[id], 11).until(60)).toEqual(createSchedule(SCENES[id], 11).until(60));
    }
  });

  it("gives other events for another seed", () => {
    for (const id of SCENE_ORDER) {
      expect(createSchedule(SCENES[id], 11).until(60)).not.toEqual(createSchedule(SCENES[id], 12).until(60));
    }
  });

  it("hands out the same events whether asked a little at a time or all at once", () => {
    for (const id of SCENE_ORDER) {
      const whole = createSchedule(SCENES[id], 5).until(40);
      const piecemeal = createSchedule(SCENES[id], 5);
      const pieces: SceneEvent[] = [];
      for (let time = 0.5; time <= 40; time += 0.5) {
        pieces.push(...piecemeal.until(time));
      }
      const order = (a: SceneEvent, b: SceneEvent) => a.at - b.at || JSON.stringify(a).localeCompare(JSON.stringify(b));
      expect([...pieces].sort(order)).toEqual([...whole].sort(order));
    }
  });

  it("hands each event out once, in order, and nothing from before the start", () => {
    const schedule = createSchedule(SCENES.rain, 3);
    const first = schedule.until(10);
    const second = schedule.until(20);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(schedule.until(20)).toEqual([]);
    for (const events of [first, second]) {
      events.forEach((event) => expect(event.at).toBeGreaterThanOrEqual(0));
      for (let index = 1; index < events.length; index += 1) {
        expect(events[index].at).toBeGreaterThanOrEqual(events[index - 1].at);
      }
    }
    // What starts in the second stretch was not handed out in the first.
    const starts = second.filter(isGrain).map((event) => event.at);
    expect(Math.min(...starts)).toBeGreaterThanOrEqual(10);
  });

  it("only moves controls the scene has, to values a filter and a speaker can take", () => {
    for (const id of SCENE_ORDER) {
      const params = sceneParams(SCENES[id]);
      // A level from nothing to twice over; a frequency a 44.1 kHz render can hold.
      const fits = (event: RampEvent) =>
        params.has(event.param) &&
        event.tau > 0 &&
        Number.isFinite(event.to) &&
        (event.param.endsWith(".gain") ? event.to >= 0 && event.to <= 2 : event.to >= 20 && event.to <= 16000);
      const ramps = createSchedule(SCENES[id], 21).until(300).filter(isRamp);
      expect(ramps.length).toBeGreaterThan(0);
      expect(ramps.filter((event) => !fits(event))).toEqual([]);
    }
  });

  it("keeps every short sound inside its stream's loudness, place and speed", () => {
    for (const id of SCENE_ORDER) {
      const defs = SCENES[id].streams.filter((stream): stream is GrainsDef => stream.kind === "grains");
      for (const event of createSchedule(SCENES[id], 8).until(300).filter(isGrain)) {
        const fits = defs.some(
          (def) =>
            def.grain === event.grain &&
            event.gain >= def.gain[0] &&
            event.gain <= def.gain[1] &&
            event.pan >= def.pan[0] &&
            event.pan <= def.pan[1] &&
            event.speed >= def.speed[0] * 0.97 &&
            event.speed <= def.speed[1] * 1.03
        );
        expect(fits, `${id}: ${JSON.stringify(event)}`).toBe(true);
        expect(event.variant).toBeGreaterThanOrEqual(0);
        expect(event.variant).toBeLessThan(GRAIN_VARIANTS);
      }
    }
  });
});

describe("rain", () => {
  const drops = (seed: number, seconds: number) => createSchedule(SCENES.rain, seed).until(seconds).filter(isGrain);

  it("drops at about the rate it is set to, over a long stretch", () => {
    const def = SCENES.rain.streams.find((stream): stream is GrainsDef => stream.kind === "grains");
    const perSecond = drops(1, 600).length / 600;
    // The rate comes and goes (a flurry is from half to nearly twice it), around the set one.
    expect(perSecond).toBeGreaterThan((def?.perSecond ?? 0) * 0.6);
    expect(perSecond).toBeLessThan((def?.perSecond ?? 0) * 1.5);
  });

  it("never falls into a rhythm: the gaps between drops are all different lengths", () => {
    const times = drops(2, 60).map((event) => event.at);
    const gaps = times.slice(1).map((time, index) => time - times[index]);
    expect(new Set(gaps.map((gap) => gap.toFixed(4))).size).toBeGreaterThan(gaps.length * 0.9);
    // Short waits are common and long ones happen.
    expect(Math.min(...gaps)).toBeLessThan(0.03);
    expect(Math.max(...gaps)).toBeGreaterThan(0.5);
  });

  it("keeps most drops quiet and a few loud, on both sides", () => {
    const all = drops(4, 300);
    const loud = all.filter((event) => event.gain > 0.2).length / all.length;
    expect(loud).toBeGreaterThan(0.01);
    expect(loud).toBeLessThan(0.25);
    expect(all.some((event) => event.pan < -0.5)).toBe(true);
    expect(all.some((event) => event.pan > 0.5)).toBe(true);
  });

  const thunderAt = (seed: number, seconds: number, muted: boolean) =>
    createSchedule(SCENES.rain, seed, muted ? ["thunder"] : [])
      .until(seconds)
      .filter(isRamp)
      .filter((event) => event.param === "rain.thunder.gain");

  it("thunders rarely: a few times in ten minutes, never in the first twenty seconds", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const ramps = thunderAt(seed, 600, false);
      // Each roll of thunder ends by going back to nothing.
      const rolls = ramps.filter((event) => event.to === 0).length;
      expect(rolls).toBeGreaterThanOrEqual(2);
      expect(rolls).toBeLessThanOrEqual(9);
      expect(Math.min(...ramps.map((event) => event.at))).toBeGreaterThanOrEqual(20);
    }
  });

  it("rises to a peak and always ends at rest", () => {
    const ramps = thunderAt(6, 600, false);
    expect(Math.max(...ramps.map((event) => event.to))).toBeGreaterThan(0.5);
    expect(ramps[ramps.length - 1].to).toBe(0);
  });

  it("has no thunder at all with thunder off, and the same rain", () => {
    expect(thunderAt(6, 600, true)).toEqual([]);
    const withThunder = createSchedule(SCENES.rain, 6).until(300).filter(isGrain);
    const without = createSchedule(SCENES.rain, 6, ["thunder"]).until(300).filter(isGrain);
    expect(without).toEqual(withThunder);
  });

  it("can have its thunder switched off and on part-way through", () => {
    const schedule = createSchedule(SCENES.rain, 6);
    schedule.until(100);
    schedule.mute("thunder", true);
    expect(schedule.until(400).filter((event) => isRamp(event) && event.param.startsWith("rain.thunder"))).toEqual([]);
    schedule.mute("thunder", false);
    expect(schedule.until(1200).some((event) => isRamp(event) && event.param === "rain.thunder.gain")).toBe(true);
    expect(schedule.paramsOf("thunder").sort()).toEqual(["rain.thunder.f0", "rain.thunder.gain"]);
  });
});

describe("the fireplace", () => {
  it("crackles in fits and starts: busy seconds and nearly empty ones", () => {
    const crackles = createSchedule(SCENES.fire, 3)
      .until(120)
      .filter(isGrain)
      .filter((event) => event.grain === "crackle");
    const perSecond = Array.from({ length: 120 }, (_, second) => crackles.filter((event) => Math.floor(event.at) === second).length);
    expect(Math.max(...perSecond)).toBeGreaterThanOrEqual(15);
    expect(Math.min(...perSecond)).toBeLessThanOrEqual(2);
  });

  it("pops now and then, far less often than it crackles", () => {
    const events = createSchedule(SCENES.fire, 3).until(300).filter(isGrain);
    const pops = events.filter((event) => event.grain === "pop").length;
    expect(pops).toBeGreaterThan(20);
    expect(pops).toBeLessThan(events.length / 10);
  });
});

describe("the cafe", () => {
  const cafe = SCENES.cafe;

  it("has people talking in phrases, with silences between", () => {
    const index = streamIndex(cafe, (stream) => stream.kind === "talker");
    const def = cafe.streams[index] as TalkerDef;
    const ramps = createSchedule(only(cafe, index), 9).until(120).filter(isRamp);
    const gain = ramps.filter((event) => event.param.endsWith(".gain"));
    // A phrase ends by falling silent; the next begins after a pause.
    const ends = gain.filter((event) => event.to === 0).map((event) => event.at);
    expect(ends.length).toBeGreaterThan(8);
    for (let phrase = 1; phrase < ends.length; phrase += 1) {
      const between = gain.filter((event) => event.at > ends[phrase - 1] && event.at < ends[phrase]);
      // Each syllable lifts the level and lets it fall.
      expect(between.length).toBeGreaterThanOrEqual(def.syllables[0] * 2);
      expect(between.length).toBeLessThanOrEqual(def.syllables[1] * 2);
      const pause = between[0].at - ends[phrase - 1];
      expect(pause).toBeGreaterThanOrEqual(def.pause[0]);
      expect(pause).toBeLessThanOrEqual(def.pause[1]);
    }
  });

  it("moves the mouth with each syllable and lets the pitch come down through a phrase", () => {
    const index = streamIndex(cafe, (stream) => stream.kind === "talker");
    const ramps = createSchedule(only(cafe, index), 9).until(300).filter(isRamp);
    const first = ramps.filter((event) => event.param.endsWith(".f1")).map((event) => event.to);
    const second = ramps.filter((event) => event.param.endsWith(".f2")).map((event) => event.to);
    expect(new Set(first.map((value) => Math.round(value / 50))).size).toBeGreaterThan(4);
    expect(Math.min(...first)).toBeGreaterThan(200);
    expect(Math.max(...second)).toBeLessThan(2600);
    const pitches = ramps.filter((event) => event.param.endsWith(".pitch")).map((event) => event.to);
    expect(Math.min(...pitches)).toBeGreaterThan(80);
    expect(Math.max(...pitches)).toBeLessThan(300);
  });

  it("starts its talkers at different moments", () => {
    const starts = cafe.streams
      .map((stream, index) => (stream.kind === "talker" ? createSchedule(only(cafe, index), 9 + index).until(30)[0]?.at : null))
      .filter((at): at is number => typeof at === "number");
    expect(new Set(starts.map((at) => at.toFixed(2))).size).toBe(starts.length);
  });

  it("clinks cups a few times a minute, sometimes several strokes together", () => {
    const clinks = createSchedule(cafe, 14)
      .until(600)
      .filter(isGrain)
      .filter((event) => event.grain === "clink");
    expect(clinks.length).toBeGreaterThan(60);
    expect(clinks.length).toBeLessThan(600);
    const close = clinks.slice(1).filter((event, index) => event.at - clinks[index].at < 0.4).length;
    expect(close).toBeGreaterThan(10);
  });

  it("runs the machine now and then, for a few seconds, and stops it", () => {
    const steam = createSchedule(cafe, 14)
      .until(900)
      .filter(isRamp)
      .filter((event) => event.param === "cafe.steam.gain");
    const starts = steam.filter((event) => event.to > 0);
    const stops = steam.filter((event) => event.to === 0);
    expect(starts.length).toBeGreaterThanOrEqual(5);
    expect(starts.length).toBeLessThanOrEqual(20);
    expect(stops.length).toBe(starts.length);
    starts.forEach((start, index) => {
      expect(stops[index].at - start.at).toBeGreaterThan(1.5);
      expect(stops[index].at - start.at).toBeLessThan(5);
    });
  });
});

describe("waves", () => {
  it("come in one after another, each over before the next begins", () => {
    const surf = createSchedule(SCENES.waves, 2)
      .until(300)
      .filter(isRamp)
      .filter((event) => event.param === "waves.surf.gain");
    const rises = surf.filter((event) => event.to > 0.3).map((event) => event.at);
    expect(rises.length).toBeGreaterThan(20);
    expect(rises.length).toBeLessThan(45);
    const gaps = rises.slice(1).map((at, index) => at - rises[index]);
    expect(Math.min(...gaps)).toBeGreaterThan(5);
    expect(Math.max(...gaps)).toBeLessThan(20);
    // No two the same, and some much longer than others: a sea, not a metronome.
    expect(new Set(gaps.map((gap) => gap.toFixed(4))).size).toBe(gaps.length);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(2);
  });
});

describe("brown noise", () => {
  it("has no events to speak of: a level that barely moves", () => {
    const events = createSchedule(SCENES.brown, 1).until(600);
    expect(events.every(isRamp)).toBe(true);
    expect(events.length).toBeLessThan(80);
    const levels = events.filter(isRamp).map((event) => event.to);
    expect(Math.max(...levels) / Math.min(...levels)).toBeLessThan(1.15);
  });
});
