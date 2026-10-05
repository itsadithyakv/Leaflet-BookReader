import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { PipSprite } from "../components/PipSprite";
import { newBrain, pose, reduce, signShowing, type Ask, type Brain, type Happening } from "./brain";
import { artPx, frameFor } from "./geometry";
import type { DesktopPipHost, HostEvent, Look } from "./host";
import { MENU_CLOSED, menuItems, menuStep, type Menu, type MenuAction, type MenuEvent } from "./menu";
import { dayKey, writeHiddenOn } from "./setting";

/**
 * Desktop Pip's page: all that her window holds.
 *
 * The window is only as large as what is drawn here (Rust sizes it from the
 * frame this page asks for, in art pixels, and keeps it centred on her feet),
 * so everything is laid out from the bottom middle: Pip stands on the bottom
 * edge, the sign's board sits on top of her sprite, the menu opens above.
 *
 * What she does is `brain.ts`'s to decide and Rust's to carry out; this file
 * only joins them up: the host's events and the hand's go into the brain, the
 * brain's pose goes to the sprite, what it asks goes to the host. A pose that
 * is still is drawn once and left: standing, sitting or asleep, the page does
 * no work at all, and its only timer is the one for her next thought.
 */

/** Held this long without moving, a press opens the menu (a right click does at once). */
const LONG_PRESS_MS = 600;
/** Moved this far (CSS pixels on the screen) with the button down, a press is a carry. */
const CARRY_PX = 4;

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** The reader's reduced-motion setting, followed while the page is open. */
const useReducedMotion = () => {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    let query: MediaQueryList;
    try {
      query = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return;
    }
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
};

/**
 * The display's scale, followed as it changes: she can be carried to a
 * monitor with another, which fires no resize of its own.
 */
const useDeviceRatio = () => {
  const [ratio, setRatio] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    let query: MediaQueryList | null = null;
    const update = () => {
      setRatio(window.devicePixelRatio || 1);
      query?.removeEventListener("change", update);
      try {
        query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
        query.addEventListener("change", update);
      } catch {
        query = null;
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      query?.removeEventListener("change", update);
    };
  }, []);
  return ratio;
};

type Press = { id: number; x: number; y: number; carried: boolean; long: boolean; timer: number };

export const DesktopPip = ({ host }: { host: DesktopPipHost }) => {
  const reduced = useReducedMotion();
  const ratio = useDeviceRatio();
  const [brain, setBrain] = useState<Brain>(() => newBrain(prefersReducedMotion()));
  const brainRef = useRef(brain);
  const [menu, setMenu] = useState<Menu>(MENU_CLOSED);
  const menuRef = useRef(menu);
  // Null until the reader's Pip is known: she is not drawn as someone else first.
  const [look, setLook] = useState<Look | null>(null);
  const press = useRef<Press | null>(null);
  const longPressAt = useRef(0);

  const happenRef = useRef<(happening: Happening) => void>(() => undefined);
  const happen = useCallback((happening: Happening) => happenRef.current(happening), []);

  const ask = useCallback(
    (wanted: Ask) => {
      switch (wanted.type) {
        case "stroll":
          void host
            .stroll(wanted.roll, wanted.turn)
            .then((facing) => happen(facing === null ? { type: "arrived" } : { type: "walking", facing }))
            .catch(() => happen({ type: "arrived" }));
          return;
        case "halt":
          host.halt();
          return;
        case "hold":
          // If she cannot be taken (the window is on its way out), she is put down again.
          void host
            .hold()
            .then((held) => {
              if (!held) happen({ type: "landed", impact: 0, flat: false });
            })
            .catch(() => happen({ type: "landed", impact: 0, flat: false }));
          return;
        case "release":
          host.release();
      }
    },
    [host, happen]
  );

  happenRef.current = (happening) => {
    const step = reduce(brainRef.current, happening, Date.now());
    if (step.brain !== brainRef.current) {
      brainRef.current = step.brain;
      setBrain(step.brain);
    }
    step.asks.forEach(ask);
  };

  const moveMenu = useCallback(
    (event: MenuEvent) => {
      const before = menuRef.current;
      const next = menuStep(before, event, Date.now());
      if (next === before) {
        return;
      }
      menuRef.current = next;
      setMenu(next);
      if (next.open !== before.open) {
        happen({ type: "menu", open: next.open });
      }
    },
    [happen]
  );

  const refreshLook = useCallback(() => {
    void host
      .look()
      .then(setLook)
      .catch(() => undefined);
  }, [host]);
  useEffect(refreshLook, [refreshLook]);

  // Ready to be seen once she is drawn as the reader's own Pip: the host
  // shows the window when it hears from the page, and not before.
  const dressed = look !== null;
  useEffect(() => {
    if (!dressed) {
      return;
    }
    let live = true;
    const onEvent = (event: HostEvent) => {
      if (!live) {
        return;
      }
      if (event.type === "look") {
        refreshLook();
      } else {
        happen(event);
      }
    };
    void host
      .attach(reduced, onEvent)
      .then((snapshot) => {
        if (!live || !snapshot) {
          return;
        }
        brainRef.current = { ...brainRef.current, facing: snapshot.facing < 0 ? -1 : 1 };
        happen({ type: "still", on: reduced });
        happen({ type: "world", night: snapshot.night, quiet: snapshot.quiet });
        happen({ type: "sign", text: snapshot.sign });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [host, dressed, reduced, happen, refreshLook]);

  // Her next thought. The only timer the page keeps while she stands about.
  useEffect(() => {
    if (brain.thinkAt === null) {
      return;
    }
    const timer = window.setTimeout(() => happen({ type: "think" }), Math.max(0, brain.thinkAt - Date.now()) + 5);
    return () => window.clearTimeout(timer);
  }, [brain.thinkAt, happen]);

  useEffect(() => {
    if (menu.closeAt === null) {
      return;
    }
    const timer = window.setTimeout(() => moveMenu({ type: "tick" }), Math.max(0, menu.closeAt - Date.now()) + 5);
    return () => window.clearTimeout(timer);
  }, [menu.closeAt, moveMenu]);

  const carried = brain.act.kind === "held" || brain.act.kind === "fall";
  const signUp = signShowing(brain);
  const frame = frameFor({ sign: signUp, menu: menu.open, carried });
  useEffect(() => {
    host.frame({ width: frame.width, height: frame.height });
  }, [host, frame.width, frame.height]);

  /** The sign, or her under it, was clicked: Leaflet, at the last book. */
  const followSign = () => {
    host.act("continue");
    happen({ type: "sign", text: null });
  };

  const pick = (action: MenuAction) => {
    moveMenu({ type: "pick" });
    if (action === "today") {
      // Kept where the main window will find it at the next launch.
      writeHiddenOn(dayKey());
    }
    if (action === "putDown") {
      happen({ type: "sign", text: null });
    }
    host.act(action);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || press.current) {
      return;
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Without capture a fast drag can outrun her; the host still lets go when the button comes up.
    }
    happen({ type: "press" });
    const timer = window.setTimeout(() => {
      const current = press.current;
      if (current && !current.carried) {
        current.long = true;
        longPressAt.current = Date.now();
        moveMenu({ type: "press" });
      }
    }, LONG_PRESS_MS);
    // Screen coordinates: the window itself may still be moving under the pointer.
    press.current = { id: event.pointerId, x: event.screenX, y: event.screenY, carried: false, long: false, timer };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = press.current;
    if (!current || current.id !== event.pointerId || current.carried || current.long) {
      return;
    }
    if (Math.hypot(event.screenX - current.x, event.screenY - current.y) < CARRY_PX) {
      return;
    }
    window.clearTimeout(current.timer);
    current.carried = true;
    moveMenu({ type: "carried" });
    happen({ type: "grab" });
  };

  const endPress = (event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const current = press.current;
    if (!current || current.id !== event.pointerId) {
      return;
    }
    press.current = null;
    window.clearTimeout(current.timer);
    if (current.carried) {
      happen({ type: "drop" });
    } else if (!cancelled && !current.long) {
      if (signShowing(brainRef.current)) {
        followSign();
      } else {
        happen({ type: "poke" });
      }
    }
  };

  const drawn = pose(brain);
  const style = { "--art": `${artPx(ratio)}px` } as CSSProperties;

  return (
    <div
      className="dp-stage"
      style={style}
      onPointerLeave={() => moveMenu({ type: "leave" })}
      // The webview's own menu (Back, Reload) has no business on the desktop.
      onContextMenu={(event) => event.preventDefault()}
    >
      {menu.open && (
        <div className="dp-menu" role="menu" aria-label="Pip" onPointerEnter={() => moveMenu({ type: "enter" })}>
          {menuItems(signUp).map((item) => (
            <button key={item.id} type="button" role="menuitem" className="dp-menu-item" title={item.hint} onClick={() => pick(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      )}
      {signUp && !menu.open && (
        <button type="button" className="dp-sign" aria-label={`${brain.sign ?? ""} Open Leaflet at your book.`} onClick={followSign}>
          {brain.sign}
        </button>
      )}
      {look && (
        <button
          type="button"
          className={`dp-pip${drawn.flip ? " dp-flip" : ""}`}
          aria-label="Pip. Click to poke her, drag to carry her, right-click for her menu."
          aria-haspopup="menu"
          aria-expanded={menu.open}
          data-move={drawn.move}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => endPress(event, false)}
          onPointerCancel={(event) => endPress(event, true)}
          onLostPointerCapture={(event) => endPress(event, true)}
          onContextMenu={(event) => {
            event.preventDefault();
            // A long press has just opened it: the touch's own context-menu event is the same gesture.
            if (Date.now() - longPressAt.current > 800) {
              moveMenu({ type: "toggle" });
            }
          }}
        >
          <PipSprite
            move={drawn.move}
            size={64}
            skin={look.skin}
            outfit={look.outfit}
            loops={drawn.loops}
            playKey={drawn.key}
            still={drawn.still}
            onDone={drawn.loops ? () => happen({ type: "done" }) : undefined}
          />
        </button>
      )}
    </div>
  );
};
