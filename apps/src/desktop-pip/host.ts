/**
 * What desktop Pip's page asks of its host, and is told by it.
 *
 * In the app the host is Rust (`src-tauri/src/desktop_pip/runtime.rs`): it
 * owns the window and moves it. The page never moves anything itself; it says
 * "a stroll", "the hand has her", "the window must hold this much", and hears
 * back "walking, this way", "landed". In a browser tab there is no such host,
 * so `standIn.ts` plays one for trying the page out.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import type { Frame } from "./geometry";
import type { MenuAction } from "./menu";

/** Mirrors `desktop_pip::runtime::HostEvent`. */
export type HostEvent =
  | { type: "world"; night: boolean; quiet: boolean }
  | { type: "walking"; facing: number }
  | { type: "arrived" }
  | { type: "falling"; tossed: boolean }
  | { type: "landed"; impact: number; flat: boolean }
  | { type: "glance"; side: number; up: boolean; near: boolean }
  | { type: "sign"; text: string | null }
  /** The reader has left Leaflet's window: her look may have changed there. */
  | { type: "look" };

/** Mirrors `desktop_pip::runtime::Snapshot`. */
export type Snapshot = { night: boolean; quiet: boolean; facing: number; sign: string | null };

/** What she wears: the skin and the accessories equipped on the Pip tab. */
export type Look = { skin: string; outfit: string[] };
export const DEFAULT_LOOK: Look = { skin: "sprout", outfit: [] };

/** Mirrors `desktop_pip::runtime::Action`: the menu's choices, and a click on the sign. */
export type HostAction = MenuAction | "continue";

export interface DesktopPipHost {
  /**
   * The page is ready to draw her. `still` is reduced motion. Events arrive
   * through `onEvent` from then on; null means there is no Pip to draw (the
   * window is on its way out).
   */
  attach(still: boolean, onEvent: (event: HostEvent) => void): Promise<Snapshot | null>;
  /** A stroll. Resolves with the way she is now walking, or null if she stays put. */
  stroll(roll: number, turn: boolean): Promise<number | null>;
  halt(): void;
  /** The hand has her: the window follows the pointer. False if she could not be taken. */
  hold(): Promise<boolean>;
  release(): void;
  /** What the window must hold, in art pixels. */
  frame(frame: Frame): void;
  act(action: HostAction): void;
  /** The reader's Pip, as equipped on the Pip tab. */
  look(): Promise<Look>;
}

/** The part of Pip's overview her page reads (`pip_state_get`). */
type Overview = { state?: { variant?: unknown; outfit?: unknown } };

export const lookOf = (overview: Overview | null | undefined): Look => {
  const variant = overview?.state?.variant;
  const outfit = overview?.state?.outfit;
  return {
    skin: typeof variant === "string" && variant ? variant : DEFAULT_LOOK.skin,
    outfit: Array.isArray(outfit) ? outfit.filter((item): item is string => typeof item === "string") : []
  };
};

/** A call whose failure changes nothing: she just does not do the thing. */
const tell = (command: string, args?: Record<string, unknown>) => {
  void invoke(command, args).catch(() => undefined);
};

/**
 * The host in the app. Events come down a channel handed over with `attach`
 * rather than as Tauri events, so her window needs no permission of its own.
 */
export const tauriHost = (): DesktopPipHost => ({
  async attach(still, onEvent) {
    const channel = new Channel<HostEvent>();
    channel.onmessage = onEvent;
    return (await invoke<Snapshot | null>("desktop_pip_attach", { channel, still })) ?? null;
  },
  async stroll(roll, turn) {
    return (await invoke<number | null>("desktop_pip_stroll", { roll, turn })) ?? null;
  },
  halt: () => tell("desktop_pip_halt"),
  hold: () => invoke<boolean>("desktop_pip_hold").catch(() => false),
  release: () => tell("desktop_pip_release"),
  frame: (frame) => tell("desktop_pip_frame", { width: frame.width, height: frame.height }),
  act: (action) => tell("desktop_pip_act", { action }),
  look: () =>
    invoke<Overview>("pip_state_get")
      .then(lookOf)
      .catch(() => DEFAULT_LOOK)
});
