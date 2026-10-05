import { describe, expect, it } from "vitest";
import { SCENES, SCENE_ORDER, VOWELS, isSceneId, sceneGrains, sceneParams, type SceneDef, type StreamDef } from "./scenes";

const scenes = SCENE_ORDER.map((id) => SCENES[id]);

/** The controls a stream moves. */
const moved = (stream: StreamDef, scene: SceneDef): string[] => {
  if (stream.kind === "wander") {
    return [stream.param];
  }
  if (stream.kind === "swell") {
    return stream.parts.map((part) => part.param);
  }
  if (stream.kind === "talker") {
    expect(scene.layers.some((layer) => layer.id === stream.layer)).toBe(true);
    return [`${stream.layer}.gain`, `${stream.layer}.pitch`, ...stream.formants.map((index) => `${stream.layer}.f${index}`)];
  }
  return [];
};

const spans = (stream: StreamDef): Array<readonly [number, number]> => {
  if (stream.kind === "wander") {
    return [stream.range, stream.every];
  }
  if (stream.kind === "grains") {
    return [stream.gain, stream.pan, stream.speed, ...(stream.flurry ? [stream.flurry.every, stream.flurry.times] : []), ...(stream.cluster ? [stream.cluster.count, stream.cluster.gap] : [])];
  }
  if (stream.kind === "swell") {
    return [stream.every, stream.rise, stream.hold, stream.fall, ...(stream.first ? [stream.first] : []), ...(stream.rolls ? [stream.rolls] : []), ...stream.parts.map((part) => part.peak)];
  }
  return [stream.level, stream.syllables, stream.syllable, stream.pause];
};

describe("the radio's scenes", () => {
  it("offers rain, a fireplace and a cafe first, then the plainer ones, each once", () => {
    expect(SCENE_ORDER.slice(0, 3)).toEqual(["rain", "fire", "cafe"]);
    expect(new Set(SCENE_ORDER).size).toBe(SCENE_ORDER.length);
    expect([...SCENE_ORDER].sort()).toEqual(Object.keys(SCENES).sort());
    for (const scene of scenes) {
      expect(SCENES[scene.id]).toBe(scene);
      expect(scene.name.length).toBeGreaterThan(0);
      expect(scene.hint.length).toBeGreaterThan(0);
    }
  });

  it("knows a scene's name from anything else", () => {
    expect(isSceneId("rain")).toBe(true);
    expect(isSceneId("disco")).toBe(false);
    expect(isSceneId("toString")).toBe(false);
    expect(isSceneId(3)).toBe(false);
  });

  it("names every layer once, within its scene's own name", () => {
    for (const scene of scenes) {
      const ids = scene.layers.map((layer) => layer.id);
      expect(new Set(ids).size).toBe(ids.length);
      ids.forEach((id) => expect(id.startsWith(`${scene.id}.`)).toBe(true));
    }
  });

  it("keeps every layer's numbers where a speaker and a filter can use them", () => {
    for (const scene of scenes) {
      expect(scene.level).toBeGreaterThan(0);
      expect(scene.level).toBeLessThanOrEqual(2);
      for (const layer of scene.layers) {
        expect(layer.gain).toBeGreaterThanOrEqual(0);
        expect(layer.gain).toBeLessThanOrEqual(1.5);
        if (layer.pan !== undefined) {
          expect(Math.abs(layer.pan)).toBeLessThanOrEqual(1);
        }
        for (const filter of layer.filters) {
          // Under the top of what a 44.1 kHz render can hold, with room.
          expect(filter.freq).toBeGreaterThanOrEqual(20);
          expect(filter.freq).toBeLessThanOrEqual(16000);
          expect(filter.q ?? 0.7).toBeGreaterThan(0);
        }
        if ("buzz" in layer.source) {
          // The pitch of a speaking voice.
          expect(layer.source.buzz).toBeGreaterThanOrEqual(80);
          expect(layer.source.buzz).toBeLessThanOrEqual(260);
        }
      }
    }
  });

  it("has every stream move a control that exists, within spans that are the right way round", () => {
    for (const scene of scenes) {
      const params = sceneParams(scene);
      for (const stream of scene.streams) {
        for (const param of moved(stream, scene)) {
          expect(params.has(param), `${scene.id}: ${param}`).toBe(true);
        }
        for (const [low, high] of spans(stream)) {
          expect(low, `${scene.id} ${stream.kind}`).toBeLessThanOrEqual(high);
        }
      }
    }
  });

  it("never asks for something to happen every zero seconds", () => {
    for (const scene of scenes) {
      for (const stream of scene.streams) {
        if (stream.kind === "wander" || stream.kind === "swell") {
          expect(stream.every[0]).toBeGreaterThan(0);
        } else if (stream.kind === "grains") {
          expect(stream.perSecond).toBeGreaterThan(0);
          expect(stream.flurry?.times[0] ?? 1).toBeGreaterThan(0);
          expect(stream.cluster?.gap[0] ?? 1).toBeGreaterThan(0);
        } else {
          expect(stream.syllable[0]).toBeGreaterThan(0);
          expect(stream.pause[0]).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keeps wandering frequencies and levels in range", () => {
    for (const scene of scenes) {
      for (const stream of scene.streams) {
        const ranges =
          stream.kind === "wander"
            ? [{ param: stream.param, range: stream.range }]
            : stream.kind === "swell"
              ? stream.parts.map((part) => ({ param: part.param, range: [Math.min(part.rest, part.peak[0]), part.peak[1]] as const }))
              : [];
        for (const { param, range } of ranges) {
          if (param.endsWith(".gain")) {
            expect(range[0]).toBeGreaterThanOrEqual(0);
            expect(range[1]).toBeLessThanOrEqual(2);
          } else {
            expect(range[0]).toBeGreaterThanOrEqual(20);
            expect(range[1]).toBeLessThanOrEqual(16000);
          }
        }
      }
    }
  });

  it("lists the short sounds each scene needs made", () => {
    expect(sceneGrains(SCENES.rain)).toEqual(["drop"]);
    expect(sceneGrains(SCENES.fire).sort()).toEqual(["crackle", "pop"]);
    expect(sceneGrains(SCENES.cafe)).toContain("clink");
    expect(sceneGrains(SCENES.brown)).toEqual([]);
  });

  it("gives the rain a thunder that can be switched off, and nothing else a switch", () => {
    expect(SCENES.rain.options).toEqual(["thunder"]);
    expect(SCENES.rain.streams.some((stream) => stream.kind === "swell" && stream.option === "thunder")).toBe(true);
    for (const scene of scenes.filter((candidate) => candidate.id !== "rain")) {
      expect(scene.options ?? []).toEqual([]);
      expect(scene.streams.some((stream) => stream.kind === "swell" && stream.option)).toBe(false);
    }
  });

  it("makes the cafe of a murmur in several bands, several voices, cups and a machine", () => {
    const cafe = SCENES.cafe;
    expect(cafe.layers.filter((layer) => layer.id.startsWith("cafe.m")).length).toBeGreaterThanOrEqual(4);
    expect(cafe.streams.filter((stream) => stream.kind === "talker").length).toBeGreaterThanOrEqual(4);
    expect(cafe.streams.some((stream) => stream.kind === "grains" && stream.grain === "clink" && stream.cluster)).toBe(true);
    expect(cafe.streams.some((stream) => stream.kind === "swell" && stream.parts.some((part) => part.param === "cafe.steam.gain"))).toBe(true);
    expect(cafe.room).toBeDefined();
    // The others are out of doors, or a hearth: no room to echo in.
    expect(scenes.filter((scene) => scene.room).map((scene) => scene.id)).toEqual(["cafe"]);
  });

  it("gives a mouth's vowels as a low resonance and a higher one", () => {
    for (const [first, second] of VOWELS) {
      expect(first).toBeGreaterThan(200);
      expect(second).toBeGreaterThan(first);
      expect(second).toBeLessThan(2600);
    }
  });
});
