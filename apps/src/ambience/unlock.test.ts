import { describe, expect, it } from "vitest";
import { SOUNDS, catalogue } from "../pip/shop";
import { SCENES, SCENE_ORDER, isSceneId, type SceneId } from "./scenes";
import { lockedScenes, sceneOpen, scenePrice, seedsShort } from "./unlock";

/** The sounds every reader had before any were sold. */
const ALWAYS_FREE: SceneId[] = ["rain", "fire", "cafe", "wind", "waves", "brown"];
const BOUGHT: SceneId[] = ["crickets", "stream", "train"];

const own = (...ids: string[]) => ids.map((id) => ({ kind: "sound", id }));

describe("which sounds seeds buy", () => {
  it("leaves every sound a reader already had free, whatever they own or do not", () => {
    for (const scene of ALWAYS_FREE) {
      expect(scenePrice(scene), scene).toBe(0);
      expect(sceneOpen(scene, null), scene).toBe(true);
      expect(sceneOpen(scene, undefined), scene).toBe(true);
      expect(sceneOpen(scene, []), scene).toBe(true);
    }
    expect([...lockedScenes([]).keys()].some((scene) => ALWAYS_FREE.includes(scene))).toBe(false);
  });

  it("sells exactly the three new ones, at the catalogue's price", () => {
    expect(SCENE_ORDER.filter((scene) => scenePrice(scene) > 0)).toEqual(BOUGHT);
    expect([...lockedScenes([])]).toEqual(BOUGHT.map((scene) => [scene, 150]));
    expect(SCENE_ORDER.length).toBe(ALWAYS_FREE.length + BOUGHT.length);
  });

  it("keeps the shop's list and the radio's together: every sound for sale is a scene, under the same name", () => {
    const sold = catalogue().filter((item) => item.kind === "sound");
    expect(sold.map((item) => item.id)).toEqual(SOUNDS.map((sound) => sound.id));
    for (const sound of sold) {
      expect(isSceneId(sound.id), sound.id).toBe(true);
      expect(SCENES[sound.id as SceneId].name).toBe(sound.name);
    }
  });

  it("opens a sound once it is owned, and only that one", () => {
    expect(sceneOpen("crickets", [])).toBe(false);
    expect(sceneOpen("crickets", own("crickets"))).toBe(true);
    expect([...lockedScenes(own("crickets")).keys()]).toEqual(["stream", "train"]);
    expect(lockedScenes(own(...BOUGHT)).size).toBe(0);
  });

  it("is not fooled by another kind of thing with the same id", () => {
    expect(sceneOpen("train", [{ kind: "room", id: "train" }])).toBe(false);
  });

  it("never locks what the radio is set to, even before it knows what is owned", () => {
    expect([...lockedScenes(null, "stream").keys()]).toEqual(["crickets", "train"]);
    expect([...lockedScenes(undefined, "rain").keys()]).toEqual(BOUGHT);
  });

  it("puts the ones to buy after the free ones, so nothing a reader knew has moved", () => {
    expect(SCENE_ORDER.slice(0, ALWAYS_FREE.length)).toEqual(ALWAYS_FREE);
  });

  it("says how many more seeds one takes", () => {
    expect(seedsShort(150, 40)).toBe(110);
    expect(seedsShort(150, 150)).toBe(0);
    expect(seedsShort(150, 900)).toBe(0);
  });
});
