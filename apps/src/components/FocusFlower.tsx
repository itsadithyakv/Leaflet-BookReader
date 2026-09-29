import { useEffect, useState } from "react";
import { flowerStage, renderFocusFlower, type FocusFlowerKind, type FocusFlowerState } from "../pip/focusFlower.js";
import type { FlowerWilt, FocusFlower as Flower } from "../store/habitStore";
import { PixelImage } from "./pip/PixelImage";

type Props = {
  kind: FocusFlowerKind;
  /** How far the session has grown it, 0..1. */
  progress: number;
  state: FocusFlowerState;
  /** The box to fit in, in CSS pixels. */
  box: number;
  className?: string;
};

const STAGE_WORDS = ["planted", "sprouting", "growing", "in bud"];

/** "Your tulip is sprouting", "Your rose bloomed": for screen readers and titles. */
export const flowerLabel = (kind: string, progress: number, state: FocusFlowerState) =>
  state === "bloomed"
    ? `Your ${kind} bloomed`
    : state === "wilted"
      ? `Your ${kind} wilted`
      : `Your ${kind} is ${STAGE_WORDS[flowerStage(progress)]}`;

const WILT_WHY: Record<FlowerWilt, string> = {
  ended: "the session ended early",
  away: "Leaflet was left for more than 30 seconds",
  closed: "Leaflet closed mid-session",
  unlocked: "full screen was turned off"
};

/** One line under a running session's flower: how it is doing, or why it wilted. */
export const flowerCaption = (flower: Flower, progress: number) => {
  if (flower.wilted) {
    return `Your ${flower.kind} wilted: ${WILT_WHY[flower.wilted]}. The session still counts.`;
  }
  const stage = flowerStage(progress);
  return stage === 0
    ? `A ${flower.kind} is planted. Stay in full screen and it grows.`
    : stage === 3
      ? `Your ${flower.kind} is in bud. Finish the session and it blooms.`
      : `Your ${flower.kind} is ${STAGE_WORDS[stage]}.`;
};

/** Why a flower wilted, for the wrap-up. */
export const wiltReason = (reason: FlowerWilt) => WILT_WHY[reason];

/** The state to draw a session's flower in, and at what growth. */
export const flowerLook = (flower: Flower, progress: number): { state: FocusFlowerState; progress: number } =>
  flower.wilted ? { state: "wilted", progress: flower.at ?? progress } : { state: "growing", progress };

/**
 * A session's focus flower in its pot. Each new stage pops it up a little, a
 * wilt sags it, and a bloom glows and sways (the art sways; see focusFlower.js).
 */
export const FocusFlower = ({ kind, progress, state, box, className }: Props) => {
  const stage = state === "bloomed" ? 4 : flowerStage(progress);
  // Frames only for a bloom, for its sway and glint; the rest are stills.
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (state !== "bloomed") {
      return;
    }
    const timer = window.setInterval(() => setFrame((value) => value + 1), 120);
    return () => window.clearInterval(timer);
  }, [state]);

  return (
    // Keyed on the stage, so each change plays its animation once.
    <span
      key={`${state}-${stage}`}
      className={`focus-flower focus-flower-${state} ${className ?? ""}`}
      role="img"
      aria-label={flowerLabel(kind, progress, state)}
    >
      <PixelImage
        render={() => renderFocusFlower(kind, progress, state, frame)}
        drawKey={`${kind}-${state}-${stage}-${state === "bloomed" ? frame : 0}`}
        box={box}
      />
    </span>
  );
};
