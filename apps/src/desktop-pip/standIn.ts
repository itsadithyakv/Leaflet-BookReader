/**
 * A stand-in for Rust, for opening `desktop-pip.html` in a browser tab (the
 * dev server, a test). Nothing moves a window here: a stroll is a wait that
 * ends in "arrived", letting go is a short fall. Loaded only outside Tauri
 * (`window.tsx`), so none of it reaches the app.
 *
 * `window.__desktopPip` is the bench: `log` is every call the page made, and
 * `tell` plays an event from Rust (night falling, a sign, the pointer near).
 */
import { DEFAULT_LOOK, type DesktopPipHost, type HostEvent, type Look, type Snapshot } from "./host";

type Call = { call: string; at: number; [detail: string]: unknown };

export type Bench = {
  log: Call[];
  tell: (event: HostEvent) => void;
  /** What `attach` answers and `look` returns: set before the page loads its look. */
  snapshot: Snapshot;
  look: Look;
};

declare global {
  interface Window {
    __desktopPip?: Bench;
  }
}

export const standInHost = (): DesktopPipHost => {
  let listener: (event: HostEvent) => void = () => undefined;
  let facing = -1;
  let still = false;
  let walk = 0;
  const bench: Bench = {
    log: [],
    tell: (event) => listener(event),
    snapshot: { night: false, quiet: false, facing, sign: null },
    look: DEFAULT_LOOK
  };
  window.__desktopPip = bench;
  const note = (call: string, detail: Record<string, unknown> = {}) => bench.log.push({ call, at: Date.now(), ...detail });

  return {
    async attach(reduced, onEvent) {
      note("attach", { still: reduced });
      still = reduced;
      listener = onEvent;
      return bench.snapshot;
    },
    async stroll(roll, turn) {
      note("stroll", { roll, turn });
      if (still) {
        return null;
      }
      facing = turn ? -facing : facing;
      window.clearTimeout(walk);
      const going = facing;
      window.setTimeout(() => listener({ type: "walking", facing: going }), 0);
      walk = window.setTimeout(() => listener({ type: "arrived" }), 600 + roll * 1000);
      return facing;
    },
    halt() {
      note("halt");
      window.clearTimeout(walk);
    },
    async hold() {
      note("hold");
      window.clearTimeout(walk);
      return true;
    },
    release() {
      note("release");
      if (still) {
        listener({ type: "landed", impact: 0, flat: false });
        return;
      }
      listener({ type: "falling", tossed: false });
      window.setTimeout(() => listener({ type: "landed", impact: 180, flat: false }), 300);
    },
    frame(frame) {
      note("frame", { width: frame.width, height: frame.height });
    },
    act(action) {
      note("act", { action });
      if (action === "continue" || action === "putDown") {
        listener({ type: "sign", text: null });
      }
    },
    async look() {
      note("look");
      return bench.look;
    }
  };
};
