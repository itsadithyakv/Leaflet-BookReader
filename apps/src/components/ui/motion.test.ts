import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdWhileLeaving, LEAVE_MAX_MS, leaving } from "./motion";

/**
 * A few elements, enough to stand for what React leaves behind: the test
 * runner has no DOM. They match the simple selectors motion.ts uses (a tag,
 * classes, attributes, and `a > b`).
 */
class Box {
  nodeType = 1;
  parentNode: Box | null = null;
  children: Box[] = [];
  attributes = new Map<string, string>();
  style = { transform: "" };
  classes: Set<string>;
  constructor(
    public tag: string,
    classes: string[] = [],
    attributes: Record<string, string> = {},
    children: Box[] = []
  ) {
    this.classes = new Set(classes);
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
    for (const child of children) this.insertBefore(child, null);
  }
  get isConnected(): boolean {
    return this === page || (this.parentNode?.isConnected ?? false);
  }
  get childElementCount() {
    return this.children.length;
  }
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  insertBefore(node: Box, before: Box | null) {
    node.parentNode?.children.splice(node.parentNode.children.indexOf(node), 1);
    const at = before ? this.children.indexOf(before) : -1;
    if (at >= 0) this.children.splice(at, 0, node);
    else this.children.push(node);
    node.parentNode = this;
    return node;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  private one(compound: string) {
    const parts = compound.match(/^[a-z]+|\.[\w-]+|\[[^\]]+\]/g) ?? [];
    return parts.every((part) => {
      if (part.startsWith(".")) return this.classes.has(part.slice(1));
      if (part.startsWith("[")) {
        const [, name, value] = part.match(/^\[([\w-]+)(?:='([^']*)')?\]$/) ?? [];
        return value === undefined ? this.hasAttribute(name) : this.getAttribute(name) === value;
      }
      return this.tag === part;
    });
  }
  matches(list: string): boolean {
    return list.split(",").some((selector) => {
      const steps = selector.trim().split(/\s*>\s*/);
      let at: Box | null = this;
      for (let step = steps.length - 1; step >= 0; step -= 1) {
        if (!at || !at.one(steps[step])) return false;
        at = at.parentNode;
      }
      return true;
    });
  }
  querySelectorAll(list: string): Box[] {
    const found: Box[] = [];
    const walk = (box: Box) => {
      for (const child of box.children) {
        if (child.matches(list)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
}

let page: Box;
const asNode = (box: Box) => box as unknown as Node;

beforeEach(() => {
  page = new Box("body");
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("which removed elements leave gently", () => {
  it("a dialog on its scrim, a menu, a card, a toast", () => {
    const sheet = new Box("div", ["sheet-backdrop"], {}, [new Box("div", ["modal-surface", "sheet-panel"])]);
    expect(leaving(asNode(sheet))?.kind).toBe("sheet");
    expect(leaving(asNode(new Box("div", ["modal-surface"], { role: "menu" })))?.kind).toBe("pop");
    expect(leaving(asNode(new Box("div", ["reader-lookup", "reader-panel"])))?.kind).toBe("pop");
    expect(leaving(asNode(new Box("div", ["app-toast"])))?.kind).toBe("pop");
    expect(leaving(asNode(new Box("div", ["reader-menu"])))?.kind).toBe("panel");
    expect(leaving(asNode(new Box("button", ["reader-sheet-scrim"])))?.kind).toBe("fade");
  });

  it("the one surface a positioning box held, which is what animates", () => {
    const bar = new Box("div", ["reader-selection-bar"]);
    const dock = new Box("div", ["reader-selection-dock"], {}, [bar]);
    const left = leaving(asNode(dock));
    expect(left?.root).toBe(dock);
    expect(left?.part).toBe(bar);
    // The reader's toast is a box round its glass: the glass goes.
    const pill = new Box("div");
    const toast = new Box("div", ["reader-toast"], {}, [pill]);
    expect(leaving(asNode(toast))?.part).toBe(pill);
  });

  it("not anything else, nor what is still in the page (a node React moved)", () => {
    expect(leaving(asNode(new Box("div", ["book-card"])))).toBeNull();
    expect(leaving(asNode(new Box("div", [], {}, [new Box("div"), new Box("div", ["app-toast"])])))).toBeNull();
    const moved = new Box("div", ["app-toast"]);
    page.insertBefore(moved, null);
    expect(leaving(asNode(moved))).toBeNull();
    expect(leaving({ nodeType: 3, isConnected: false } as Node)).toBeNull();
  });

  it("a sheet a finger pulled down already: its scrim fades, it stays where it was", () => {
    const panel = new Box("div", ["modal-surface", "sheet-panel"]);
    panel.style.transform = "translateY(412px)";
    expect(leaving(asNode(new Box("div", ["sheet-backdrop"], {}, [panel])))?.kind).toBe("swiped");
  });

  it("with less motion, everything just fades", () => {
    const sheet = new Box("div", ["sheet-backdrop"], {}, [new Box("div", ["sheet-panel"])]);
    expect(leaving(asNode(sheet), true)?.kind).toBe("fade");
  });

  it("not twice: the copy going away again is let go", () => {
    const toast = new Box("div", ["app-toast"], { "data-leaving": "pop" });
    expect(leaving(asNode(toast))).toBeNull();
  });
});

describe("holding a surface while it leaves", () => {
  it("puts it back where it was, inert and nameless, then takes it away", async () => {
    const before = new Box("div", ["after"]);
    page.insertBefore(before, null);
    const panel = new Box("div", ["modal-surface", "sheet-panel"], { role: "dialog", "aria-modal": "true", id: "gift-title" });
    const sheet = new Box("div", ["sheet-backdrop"], {}, [panel]);
    const left = leaving(asNode(sheet))!;
    const gone = holdWhileLeaving(left, asNode(page), asNode(before));

    expect(page.children[0]).toBe(sheet);
    expect(sheet.getAttribute("data-leaving")).toBe("sheet");
    expect(sheet.hasAttribute("inert")).toBe(true);
    expect(sheet.getAttribute("aria-hidden")).toBe("true");
    // Not taken for the dialog that may open in its place.
    expect(panel.hasAttribute("id")).toBe(false);
    expect(panel.hasAttribute("role")).toBe(false);
    expect(panel.hasAttribute("aria-modal")).toBe(false);

    vi.advanceTimersByTime(LEAVE_MAX_MS - 1);
    expect(sheet.isConnected).toBe(true);
    vi.advanceTimersByTime(1);
    await gone;
    expect(sheet.isConnected).toBe(false);
    // Once gone it is not put back again.
    expect(leaving(asNode(sheet))).toBeNull();
  });

  it("marks a wrapper and the surface in it apart", () => {
    const bar = new Box("div", ["reader-selection-bar"]);
    const dock = new Box("div", ["reader-selection-dock"], {}, [bar]);
    void holdWhileLeaving(leaving(asNode(dock))!, asNode(page), null);
    expect(dock.hasAttribute("data-leaving-root")).toBe(true);
    expect(bar.getAttribute("data-leaving")).toBe("pop");
    expect(page.children).toContain(dock);
  });

  it("goes at once when nothing is drawn for its way out", async () => {
    const toast = new Box("div", ["app-toast"]);
    Object.assign(toast, { getAnimations: () => [] });
    await holdWhileLeaving(leaving(asNode(toast))!, asNode(page), null);
    expect(toast.isConnected).toBe(false);
  });
});
