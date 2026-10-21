import { afterEach, describe, expect, it, vi } from "vitest";
import { readShape, shellShape, type HeightMemory, type ShapeReading } from "./shape";

const finger = () => {
  const memory: HeightMemory = { width: 0, height: 0 };
  return (width: number, height: number, screenUpright?: boolean) =>
    readShape(memory, { width, height, touch: true, screenUpright } satisfies ShapeReading);
};

describe("the window's shape", () => {
  it("is upright, sideways or wide by the window's size", () => {
    expect(shellShape(412, 915)).toBe("upright");
    expect(shellShape(360, 800)).toBe("upright");
    expect(shellShape(915, 412)).toBe("sideways");
    expect(shellShape(740, 360)).toBe("sideways");
    expect(shellShape(767, 521)).toBe("upright");
    expect(shellShape(768, 521)).toBe("wide");
    expect(shellShape(1280, 800)).toBe("wide");
    expect(shellShape(800, 1280)).toBe("wide");
    // The desktop app's smallest window, short and narrow: sideways, the rail (as it always was).
    expect(shellShape(380, 480)).toBe("sideways");
  });

  it("stays upright on a phone while the keyboard is up", () => {
    const shape = finger();
    expect(shape(412, 915)).toBe("upright");
    // The keyboard: the window ends at it, 412 x 450, and is not a phone on its side.
    expect(shape(412, 450)).toBe("upright");
    // The suggestions strip, an emoji panel: shorter again.
    expect(shape(412, 380)).toBe("upright");
    expect(shape(412, 915)).toBe("upright");
    // Another app's keyboard over a notification: wider than tall.
    expect(shape(360, 740)).toBe("upright");
    expect(shape(360, 330)).toBe("upright");
  });

  it("follows a real turn of the phone (a new width)", () => {
    const shape = finger();
    expect(shape(412, 915, true)).toBe("upright");
    expect(shape(915, 412, false)).toBe("sideways");
    // Sideways with the keyboard up: still sideways.
    expect(shape(915, 190, false)).toBe("sideways");
    expect(shape(915, 412, false)).toBe("sideways");
    expect(shape(412, 915, true)).toBe("upright");
  });

  it("takes the screen's word for upright when it turns back with the keyboard still up", () => {
    const shape = finger();
    expect(shape(915, 190, false)).toBe("sideways");
    // The first height seen at the new width is the keyboard's; the screen says it is upright.
    expect(shape(412, 450, true)).toBe("upright");
    expect(shape(412, 915, true)).toBe("upright");
    // Without a word from the screen, the height measured is all there is.
    expect(finger()(412, 450)).toBe("sideways");
  });

  it("keeps a tablet a tablet with the keyboard up", () => {
    const shape = finger();
    expect(shape(1280, 800, false)).toBe("wide");
    expect(shape(1280, 450, false)).toBe("wide");
    expect(shape(800, 1280, true)).toBe("wide");
    expect(shape(800, 700, true)).toBe("wide");
  });

  it("follows a desktop window made shorter: a mouse has no keyboard over it", () => {
    const memory: HeightMemory = { width: 0, height: 0 };
    const mouse = (width: number, height: number) => readShape(memory, { width, height, touch: false });
    expect(mouse(1000, 800)).toBe("wide");
    expect(mouse(1000, 480)).toBe("sideways");
    expect(mouse(1000, 800)).toBe("wide");
  });
});

describe("html[data-shape]", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("is set at start and kept steady through the keyboard, and turns with the phone", async () => {
    const listeners = new Map<string, Array<() => void>>();
    const win = {
      innerWidth: 412,
      innerHeight: 915,
      addEventListener: (type: string, listener: () => void) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
      removeEventListener: () => undefined,
      matchMedia: (query: string) => ({ matches: query === "(hover: none) and (pointer: coarse)", addEventListener: () => undefined })
    };
    const root = { dataset: {} as Record<string, string> };
    const orientation = { type: "portrait-primary", addEventListener: () => undefined };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("screen", { width: 412, height: 915, orientation });
    const { installShellShape } = await import("./shape");
    const resize = (width: number, height: number, type = orientation.type) => {
      win.innerWidth = width;
      win.innerHeight = height;
      orientation.type = type;
      for (const listener of listeners.get("resize") ?? []) listener();
    };

    installShellShape();
    expect(root.dataset.shape).toBe("upright");
    resize(412, 450);
    expect(root.dataset.shape).toBe("upright");
    resize(915, 412, "landscape-primary");
    expect(root.dataset.shape).toBe("sideways");
    resize(412, 915, "portrait-primary");
    expect(root.dataset.shape).toBe("upright");
  });
});

/** A phone's window, its screen and <html>, stubbed; `resize` sends what a turn sends. */
const phone = async (width: number, height: number, type: string, touch = true) => {
  const listeners = new Map<string, Array<() => void>>();
  const win = {
    innerWidth: width,
    innerHeight: height,
    addEventListener: (event: string, listener: () => void) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
    removeEventListener: () => undefined,
    matchMedia: (query: string) => ({ matches: touch && query === "(hover: none) and (pointer: coarse)", addEventListener: () => undefined })
  };
  const root = { dataset: {} as Record<string, string> };
  const orientation = { type, addEventListener: () => undefined };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("screen", { width, height, orientation });
  const shape = await import("./shape");
  shape.installShellShape();
  const resize = (w: number, h: number, screenType = orientation.type) => {
    win.innerWidth = w;
    win.innerHeight = h;
    orientation.type = screenType;
    for (const listener of listeners.get("resize") ?? []) listener();
  };
  return { shape, root, resize };
};

describe("a turn of the phone: the shape put on once it has landed", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("does not lay out the sizes a turn passes through", async () => {
    vi.useFakeTimers();
    const { shape, root, resize } = await phone(412, 915, "portrait-primary");
    expect(root.dataset.shape).toBe("upright");
    // Half-way round, the screen still saying upright: a sideways size for a moment.
    resize(800, 412);
    expect(root.dataset.shape).toBe("upright");
    expect(shape.shownShellShape()).toBe("upright");
    vi.advanceTimersByTime(shape.SHAPE_SETTLE_MS - 40);
    // And back: it never turned.
    resize(412, 915);
    vi.advanceTimersByTime(1000);
    expect(root.dataset.shape).toBe("upright");
  });

  it("puts the new shape on at once when the screen says the same, or once the window is still", async () => {
    vi.useFakeTimers();
    const { shape, root, resize } = await phone(412, 915, "portrait-primary");
    resize(915, 412, "landscape-primary");
    expect(root.dataset.shape).toBe("sideways");
    // The screen's word late: the window on its side, held still long enough, is on its side.
    resize(412, 915, "portrait-primary");
    resize(915, 412, "portrait-primary");
    expect(root.dataset.shape).toBe("upright");
    vi.advanceTimersByTime(shape.SHAPE_SETTLE_MS - 1);
    expect(root.dataset.shape).toBe("upright");
    vi.advanceTimersByTime(1);
    expect(root.dataset.shape).toBe("sideways");
  });

  it("coming back upright from Pip: the rail is not drawn while the screen turns, and the sideways frames are not laid out", async () => {
    vi.useFakeTimers();
    // Pip's tab, held sideways.
    const { shape, root, resize } = await phone(915, 412, "landscape-primary");
    expect(root.dataset.shape).toBe("sideways");
    // Pip's hold let go (the library): the phone's to say which way up.
    shape.expectTurn(null);
    expect(root.dataset.turning).toBe("any");
    // What the window passes through: the new width at a short height, the screen's word, then the whole height.
    vi.advanceTimersByTime(60);
    resize(412, 360, "landscape-primary");
    vi.advanceTimersByTime(60);
    resize(412, 360, "portrait-primary");
    expect(root.dataset.turning).toBe("any");
    vi.advanceTimersByTime(60);
    resize(412, 915, "portrait-primary");
    expect(root.dataset.shape).toBe("upright");
    expect(root.dataset.turning).toBeUndefined();
  });

  it("a hold let go with the phone already that way up: the rail is back once the window has kept still", async () => {
    vi.useFakeTimers();
    const { shape, root } = await phone(915, 412, "landscape-primary");
    shape.expectTurn(null);
    vi.advanceTimersByTime(shape.TURN_IDLE_MS - 1);
    expect(root.dataset.turning).toBe("any");
    vi.advanceTimersByTime(1);
    expect(root.dataset.turning).toBeUndefined();
    expect(root.dataset.shape).toBe("sideways");
  });

  it("turning the way the app asked: a window still the other way about is not taken for the new shape", async () => {
    vi.useFakeTimers();
    const { shape, root, resize } = await phone(915, 412, "landscape-primary");
    shape.expectTurn("portrait");
    expect(root.dataset.turning).toBe("portrait");
    // Taller than sideways, but still wider than tall, and the screen's word already in: a frame of the turn.
    resize(640, 600, "portrait-primary");
    vi.advanceTimersByTime(shape.SHAPE_SETTLE_MS * 2);
    expect(root.dataset.shape).toBe("sideways");
    resize(412, 915, "portrait-primary");
    expect(root.dataset.shape).toBe("upright");
    expect(root.dataset.turning).toBeUndefined();
  });

  it("gives up waiting for a turn that does not come", async () => {
    vi.useFakeTimers();
    const { shape, root, resize } = await phone(915, 412, "landscape-primary");
    shape.expectTurn("portrait");
    for (let step = 0; step < 5; step += 1) {
      vi.advanceTimersByTime(300);
      resize(915 - step, 412);
    }
    // Held upright, the window still on its side is still turning (a slow phone) ...
    expect(root.dataset.turning).toBe("portrait");
    // ... until the wait is up.
    vi.advanceTimersByTime(shape.TURN_WAIT_MS);
    expect(root.dataset.turning).toBeUndefined();
    expect(root.dataset.shape).toBe("sideways");
  });

  it("a hold the screen will turn for: a slow start is waited for, not taken for a phone that was that way up", async () => {
    vi.useFakeTimers();
    const { shape, root, resize } = await phone(412, 915, "portrait-primary");
    // Pip's tab held sideways: nothing moves for a second (arm64 under translation).
    shape.expectTurn("landscape");
    vi.advanceTimersByTime(1100);
    expect(root.dataset.turning).toBe("landscape");
    expect(root.dataset.shape).toBe("upright");
    resize(915, 412, "landscape-primary");
    expect(root.dataset.shape).toBe("sideways");
    expect(root.dataset.turning).toBeUndefined();
  });

  it("leaving Pip on a phone: upright is the guess, and the sideways frames on the way are not laid out", async () => {
    vi.useFakeTimers();
    const { shape, root, resize } = await phone(915, 412, "landscape-primary");
    shape.expectTurn("portrait", { guess: true });
    // A slow start: past TURN_IDLE_MS, still waited for.
    vi.advanceTimersByTime(shape.TURN_IDLE_MS + 100);
    expect(root.dataset.turning).toBe("portrait");
    // A frame of the turn, wider than tall: not taken for a shape.
    resize(640, 600, "portrait-primary");
    vi.advanceTimersByTime(shape.SHAPE_SETTLE_MS * 2);
    expect(root.dataset.shape).toBe("sideways");
    resize(412, 915, "portrait-primary");
    expect(root.dataset.shape).toBe("upright");
    expect(root.dataset.turning).toBeUndefined();
  });

  it("leaving Pip with the phone kept on its side: the guess is let go", async () => {
    vi.useFakeTimers();
    const { shape, root } = await phone(915, 412, "landscape-primary");
    shape.expectTurn("portrait", { guess: true });
    vi.advanceTimersByTime(shape.TURN_GUESS_IDLE_MS - 1);
    expect(root.dataset.turning).toBe("portrait");
    vi.advanceTimersByTime(1);
    expect(root.dataset.turning).toBeUndefined();
    expect(root.dataset.shape).toBe("sideways");
  });

  it("a hold the window already keeps is no turn: the rail is not taken away", async () => {
    vi.useFakeTimers();
    const { shape, root } = await phone(915, 412, "landscape-primary");
    shape.expectTurn("landscape");
    expect(root.dataset.turning).toBeUndefined();
    expect(root.dataset.shape).toBe("sideways");
  });

  it("lays a mouse's window out as it is, at once", async () => {
    vi.useFakeTimers();
    const { root, resize } = await phone(1000, 800, "landscape-primary", false);
    expect(root.dataset.shape).toBe("wide");
    resize(1000, 480);
    expect(root.dataset.shape).toBe("sideways");
  });
});

/** A small stand-in for the page's elements: enough for the veil (a class list, a parent to leave). */
class FakeNode {
  className = "";
  attributes: Record<string, string> = {};
  parent: FakeBody | null = null;
  classList = {
    add: (name: string) => {
      if (!this.className.split(" ").includes(name)) this.className = [this.className, name].join(" ").trim();
    },
    remove: (name: string) => {
      this.className = this.className
        .split(" ")
        .filter((part) => part !== name)
        .join(" ");
    },
    contains: (name: string) => this.className.split(" ").includes(name)
  };
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
}
class FakeBody {
  children: FakeNode[] = [];
  appendChild(node: FakeNode) {
    node.parent = this;
    this.children.push(node);
    return node;
  }
}

/** A phone as `phone` stubs it, with a body for the veil and the insets as the Android side sends them. */
const phoneWithPage = async (width: number, height: number, type: string) => {
  const listeners = new Map<string, Array<() => void>>();
  const win = {
    innerWidth: width,
    innerHeight: height,
    addEventListener: (event: string, listener: () => void) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
    removeEventListener: () => undefined,
    matchMedia: (query: string) => ({ matches: query === "(hover: none) and (pointer: coarse)", addEventListener: () => undefined })
  } as Record<string, unknown> & { innerWidth: number; innerHeight: number };
  const props = new Map<string, string>();
  const root = {
    dataset: {} as Record<string, string>,
    style: { setProperty: (name: string, value: string) => props.set(name, value), getPropertyValue: (name: string) => props.get(name) ?? "" }
  };
  const body = new FakeBody();
  const orientation = { type, addEventListener: () => undefined };
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Linux; Android 16)" });
  vi.stubGlobal("document", { documentElement: root, body, createElement: () => new FakeNode() });
  vi.stubGlobal("screen", { width, height, orientation });
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => setTimeout(run, 16));
  const device = await import("./device");
  const shape = await import("./shape");
  device.installDeviceSignals();
  shape.installShellShape();
  const resize = (w: number, h: number, screenType = orientation.type) => {
    win.innerWidth = w;
    win.innerHeight = h;
    orientation.type = screenType;
    for (const listener of listeners.get("resize") ?? []) listener();
  };
  const veil = () => body.children.find((child) => child.className.includes("turn-veil")) ?? null;
  const send = (insets: { top: number; right: number; bottom: number; left: number }) => (win.__leafletInsets as (insets: unknown) => void)(insets);
  return { shape, root, props, resize, veil, send };
};

describe("the veil over a turn the app makes", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("leaving Pip: down at once, and lifted only once the library is upright with its own insets", async () => {
    vi.useFakeTimers();
    const page = await phoneWithPage(412, 915, "portrait-primary");
    // The library, upright, before Pip; then Pip's tab on its side.
    page.send({ top: 52, right: 0, bottom: 24, left: 0 });
    page.resize(915, 412, "landscape-primary");
    page.send({ top: 28.19, right: 0, bottom: 24, left: 51.81 });
    vi.advanceTimersByTime(2000);
    expect(page.root.dataset.shape).toBe("sideways");
    expect(page.veil()).toBeNull();

    // Back from the Hollow to the library.
    page.shape.expectTurn("portrait", { guess: true });
    expect(page.veil()).not.toBeNull();
    expect(page.veil()?.classList.contains("is-lifting")).toBe(false);
    // The window lays the library out on its side for a while (0.8 s on the emulator): still covered.
    vi.advanceTimersByTime(800);
    expect(page.root.dataset.shape).toBe("sideways");
    expect(page.veil()?.classList.contains("is-lifting")).toBe(false);
    // Upright: the shape is on, and the stale sideways insets are not laid out (the upright ones are held).
    page.resize(412, 915, "portrait-primary");
    expect(page.root.dataset.shape).toBe("upright");
    expect(page.props.get("--inset-top")).toBe("52px");
    expect(page.props.get("--inset-left")).toBe("0px");
    // Still covered: the insets for it have not come.
    vi.advanceTimersByTime(100);
    expect(page.veil()?.classList.contains("is-lifting")).toBe(false);
    page.send({ top: 52, right: 0, bottom: 24, left: 0 });
    // Two frames to draw the page in its shape, then the soft lift, then gone.
    vi.advanceTimersByTime(40);
    expect(page.veil()?.classList.contains("is-lifting")).toBe(true);
    vi.advanceTimersByTime(page.shape.VEIL_LIFT_MS + 50);
    expect(page.veil()).toBeNull();
  });

  it("does not wait for ever for insets that do not come", async () => {
    vi.useFakeTimers();
    const page = await phoneWithPage(412, 915, "portrait-primary");
    page.send({ top: 52, right: 0, bottom: 24, left: 0 });
    page.shape.expectTurn("landscape");
    page.resize(915, 412, "landscape-primary");
    expect(page.root.dataset.shape).toBe("sideways");
    vi.advanceTimersByTime(page.shape.INSETS_WAIT_MS - 10);
    expect(page.veil()?.classList.contains("is-lifting")).toBe(false);
    vi.advanceTimersByTime(60);
    expect(page.veil()?.classList.contains("is-lifting")).toBe(true);
  });

  it("is not put down for a hold the window already keeps", async () => {
    vi.useFakeTimers();
    const page = await phoneWithPage(915, 412, "landscape-primary");
    page.shape.expectTurn("landscape");
    expect(page.veil()).toBeNull();
  });
});
