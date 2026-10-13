/**
 * Which of the radio's sounds seeds buy. Most are every reader's, always;
 * a few are things in Pip's shop (pip/shop.js SOUNDS, kind "sound"): bought
 * once with seeds, here in the radio's own controls, and kept.
 *
 * The rule is the catalogue's and nothing else's: a scene is locked only
 * while the catalogue lists it at a price and the reader does not own it. A
 * scene the catalogue does not list is free, so nothing a reader has can be
 * locked by a mistake here, and a new free scene needs nothing from this
 * file.
 *
 * Plain values in and out (what is owned comes from the Pip overview), so it
 * can be tested without a store.
 */
import { catalogueItem } from "../pip/shop";
import { SCENE_ORDER, type SceneId } from "./scenes";

/** What the Pip overview's `owned` list holds. */
export type OwnedThings = ReadonlyArray<{ kind: string; id: string }> | null | undefined;

/** A scene's price in seeds; 0 for the ones every reader has. */
export const scenePrice = (scene: SceneId) => catalogueItem("sound", scene)?.price ?? 0;

/** Whether the reader may play a scene: it is free, or it is theirs. */
export const sceneOpen = (scene: SceneId, owned: OwnedThings) =>
  scenePrice(scene) <= 0 || Boolean(owned?.some((thing) => thing.kind === "sound" && thing.id === scene));

/**
 * The scenes still to be bought, each with its price, in the control's
 * order. `playing` is never among them: what the radio is set to stays
 * playable whatever is known of what is owned (before the overview has
 * loaded nothing is known, and a sound is not taken away for that).
 */
export const lockedScenes = (owned: OwnedThings, playing?: SceneId | null): Map<SceneId, number> =>
  new Map(SCENE_ORDER.filter((scene) => scene !== playing && !sceneOpen(scene, owned)).map((scene) => [scene, scenePrice(scene)]));

/** How many more seeds a scene takes; 0 when it is within reach. */
export const seedsShort = (price: number, balance: number) => Math.max(0, price - balance);
