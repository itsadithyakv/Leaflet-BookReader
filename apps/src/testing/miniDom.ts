/**
 * Just enough of a browser for react-dom to mount a component in a test, so
 * that what only a real mount shows (effects, a second render once data
 * arrives, React's rules of hooks) can be checked without jsdom. Import it
 * before anything imports react-dom: react-dom decides at load whether there
 * is a DOM.
 *
 * Not a DOM: no layout, no CSS, no events beyond what is dispatched by hand,
 * and a canvas has no context (callers already cope with that).
 */

type Listener = (event: unknown) => void;

class MiniNode {
  nodeType: number;
  nodeName: string;
  ownerDocument: MiniDocument | null;
  parentNode: MiniNode | null = null;
  childNodes: MiniNode[] = [];
  private listeners = new Map<string, Set<Listener>>();
  nodeValue: string | null = null;

  constructor(nodeType: number, nodeName: string, ownerDocument: MiniDocument | null) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling(): MiniNode | null {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get parentElement(): MiniNode | null {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
  appendChild<T extends MiniNode>(child: T): T {
    child.parentNode?.removeChild(child);
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }
  insertBefore<T extends MiniNode>(child: T, before: MiniNode | null): T {
    if (!before) return this.appendChild(child);
    child.parentNode?.removeChild(child);
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild<T extends MiniNode>(child: T): T {
    const at = this.childNodes.indexOf(child);
    if (at >= 0) this.childNodes.splice(at, 1);
    child.parentNode = null;
    return child;
  }
  contains(other: MiniNode | null): boolean {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }
  get textContent(): string {
    if (this.nodeType === 3 || this.nodeType === 8) return this.nodeValue ?? "";
    return this.childNodes.map((child) => (child.nodeType === 8 ? "" : child.textContent)).join("");
  }
  set textContent(text: string) {
    if (this.nodeType === 3 || this.nodeType === 8) {
      this.nodeValue = text;
      return;
    }
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (text) this.appendChild(this.ownerDocument!.createTextNode(text));
  }
  get data() {
    return this.nodeValue ?? "";
  }
  set data(text: string) {
    this.nodeValue = text;
  }
  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  /** Bubbles from here up, as a click does; React listens at the root. */
  dispatchEvent(event: { type: string; target?: unknown; bubbles?: boolean }) {
    for (let node: MiniNode | null = this; node; node = node.parentNode) {
      for (const listener of node.listeners.get(event.type) ?? []) listener(event);
      if (event.bubbles === false) break;
    }
    return true;
  }
}

class MiniStyle {
  [name: string]: unknown;
  setProperty(name: string, value: string) {
    this[name] = value;
  }
  removeProperty(name: string) {
    delete this[name];
  }
}

class MiniElement extends MiniNode {
  tagName: string;
  namespaceURI: string;
  private attributes = new Map<string, string>();
  style = new MiniStyle();
  dataset: Record<string, string> = {};
  classList = {
    add: (...names: string[]) => this.setAttribute("class", [...new Set([...this.className.split(" "), ...names])].filter(Boolean).join(" ")),
    remove: (...names: string[]) => this.setAttribute("class", this.className.split(" ").filter((name) => name && !names.includes(name)).join(" ")),
    toggle: (name: string, force?: boolean) => {
      const on = force ?? !this.classList.contains(name);
      if (on) this.classList.add(name);
      else this.classList.remove(name);
      return on;
    },
    contains: (name: string) => this.className.split(" ").includes(name)
  };
  value = "";
  checked = false;
  disabled = false;
  selected = false;
  multiple = false;
  onclick: unknown = null;

  constructor(tag: string, ownerDocument: MiniDocument, namespaceURI = "http://www.w3.org/1999/xhtml") {
    const upper = namespaceURI === "http://www.w3.org/1999/xhtml" ? tag.toUpperCase() : tag;
    super(1, upper, ownerDocument);
    this.tagName = upper;
    this.namespaceURI = namespaceURI;
  }
  setAttribute(name: string, value: unknown) {
    this.attributes.set(name, String(value));
  }
  setAttributeNS(_ns: string | null, name: string, value: unknown) {
    this.setAttribute(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.has(name) ? this.attributes.get(name)! : null;
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  removeAttributeNS(_ns: string | null, name: string) {
    this.attributes.delete(name);
  }
  get id() {
    return this.getAttribute("id") ?? "";
  }
  get className() {
    return this.getAttribute("class") ?? "";
  }
  get options(): MiniElement[] {
    const found: MiniElement[] = [];
    const walk = (node: MiniNode) => {
      for (const child of node.childNodes) {
        if (child instanceof MiniElement && child.tagName === "OPTION") found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  blur() {
    if (this.ownerDocument && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }
  click() {
    this.dispatchEvent(makeEvent("click", this));
  }
  getContext() {
    return null;
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  scrollIntoView() {}
  /** Every element under this one that `test` accepts (a stand-in for selectors, which this does not parse). */
  findAll(test: (element: MiniElement) => boolean): MiniElement[] {
    const found: MiniElement[] = [];
    const walk = (node: MiniNode) => {
      for (const child of node.childNodes) {
        if (child instanceof MiniElement) {
          if (test(child)) found.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return found;
  }
  querySelectorAll() {
    return [];
  }
  querySelector() {
    return null;
  }
}

class MiniDocument extends MiniNode {
  documentElement: MiniElement;
  body: MiniElement;
  activeElement: MiniElement | null;
  defaultView: unknown = null;

  constructor() {
    super(9, "#document", null);
    this.documentElement = new MiniElement("html", this);
    this.body = new MiniElement("body", this);
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }
  createElement(tag: string) {
    return new MiniElement(tag, this);
  }
  createElementNS(namespaceURI: string, tag: string) {
    return new MiniElement(tag, this, namespaceURI);
  }
  createTextNode(text: string) {
    const node = new MiniNode(3, "#text", this);
    node.nodeValue = text;
    return node;
  }
  createComment(text: string) {
    const node = new MiniNode(8, "#comment", this);
    node.nodeValue = text;
    return node;
  }
  getElementById() {
    return null;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
}

const makeEvent = (type: string, target: MiniNode) => {
  let stopped = false;
  let prevented = false;
  return {
    type,
    target,
    bubbles: true,
    cancelable: true,
    timeStamp: Date.now(),
    get defaultPrevented() {
      return prevented;
    },
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
    get cancelBubble() {
      return stopped;
    }
  };
};

export type MiniDomOptions = {
  /** Media queries that match, as written in the app (`(hover: none) and (pointer: coarse)`). */
  matching?: string[];
  userAgent?: string;
};

/** The settings the next `installMiniDom` (or a change through `setMiniDom`) answers with. */
const settings: Required<MiniDomOptions> = { matching: [], userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };

export const setMiniDom = (options: MiniDomOptions) => {
  if (options.matching) settings.matching = options.matching;
  if (options.userAgent) settings.userAgent = options.userAgent;
};

/** Puts a document, a window and their usual companions on `globalThis`. Returns the document. */
export const installMiniDom = (options: MiniDomOptions = {}) => {
  setMiniDom(options);
  const document = new MiniDocument();
  const store = new Map<string, string>();
  const windowListeners = new MiniNode(1, "WINDOW", document);
  const win = globalThis as unknown as Record<string, unknown>;
  const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define("window", globalThis);
  define("self", globalThis);
  define("document", document);
  document.defaultView = globalThis;
  define("navigator", {
    get userAgent() {
      return settings.userAgent;
    },
    language: "en-GB",
    languages: ["en-GB"],
    maxTouchPoints: 0,
    clipboard: { writeText: async () => undefined }
  });
  define("localStorage", {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    }
  });
  define("sessionStorage", win.localStorage);
  define("matchMedia", (query: string) => ({
    matches: settings.matching.includes(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined
  }));
  define("addEventListener", (type: string, listener: Listener) => windowListeners.addEventListener(type, listener));
  define("removeEventListener", (type: string, listener: Listener) => windowListeners.removeEventListener(type, listener));
  define("requestAnimationFrame", (run: (time: number) => void) => setTimeout(() => run(Date.now()), 16) as unknown as number);
  define("cancelAnimationFrame", (id: number) => clearTimeout(id));
  define("getComputedStyle", () => new Proxy({}, { get: () => "" }));
  define("devicePixelRatio", 1);
  define("innerWidth", 400);
  define("innerHeight", 800);
  define("scrollTo", () => undefined);
  define("visualViewport", null);
  define("HTMLElement", MiniElement);
  define("Element", MiniElement);
  define("Node", MiniNode);
  define("HTMLIFrameElement", class HTMLIFrameElement {});
  define("HTMLInputElement", class HTMLInputElement {});
  define("HTMLTextAreaElement", class HTMLTextAreaElement {});
  define(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  define(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  define("IS_REACT_ACT_ENVIRONMENT", true);
  return document;
};

export { MiniElement, MiniNode, MiniDocument, makeEvent };
