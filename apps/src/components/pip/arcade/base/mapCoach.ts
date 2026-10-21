/**
 * Three pointers, once, to the Hollow as it is laid out since 1.5.8: the
 * picture can be dragged about (on a phone, where it is larger than the
 * screen), a building tapped has its sheet, and the acorns chip says what
 * acorns are for. Small bubbles of Pip's paper, gone at a tap, and never
 * again on any device (kept in the camp's `taught`, as Pip's tips are).
 *
 * Not while Pip's guided first visit is on (it says everything then), nor in
 * a camp that has asked for no tips.
 */
import { tutorialRunning } from "../../../../pip/base/ladder";
import type { BaseState } from "../../../../pip/base/rules";

export const MAP_COACH = "mapCoach";

export type CoachStep = { id: "drag" | "tap" | "acorns"; text: string };

const STEPS: readonly CoachStep[] = [
  { id: "drag", text: "Drag to look around" },
  { id: "tap", text: "Tap a building to see what it does and upgrade it" },
  { id: "acorns", text: "Tap 🌰 to see what acorns are for" }
];

/** The steps, for a picture that can be moved about or not. */
export const coachSteps = (pannable: boolean): CoachStep[] => STEPS.filter((step) => pannable || step.id !== "drag");

/** Whether the pointers are still to be shown in this camp. */
export const coachDue = (base: BaseState | null): boolean =>
  Boolean(base && !base.taught.includes(MAP_COACH) && !base.taught.includes("none") && !tutorialRunning(base) && base.welcome?.tutorial?.done !== false);
