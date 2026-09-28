/**
 * Keeps the packaged app from behaving like the browser it is built on.
 *
 * WebView2 ships Edge's defaults: F5 reloads the whole app (dropping an open
 * book and a running focus session), Ctrl+P opens a print preview of the
 * current screen, Ctrl+F a find bar, right-click a menu with "Back", "Refresh"
 * and "Save as", and the mouse's back button tries to navigate history. None of
 * that belongs in a desktop reader, so this switches those defaults off.
 *
 * Installed from main.tsx only in production Tauri builds: `tauri dev` keeps
 * reload and the inspector, and the plain-browser preview is left alone.
 *
 * Only defaults are prevented, never propagation — the app's own handlers
 * (Pip's right-click menu, the readers' arrow keys) still see every event.
 */

/** Text fields keep their native Cut/Copy/Paste menu and their own shortcuts. */
const isEditable = (target: EventTarget | null): boolean => {
  if (!target || typeof (target as Element).closest !== "function") {
    return false;
  }
  const element = target as HTMLElement;
  if (element.isContentEditable) {
    return true;
  }
  const field = element.closest("input, textarea, select");
  if (!field) {
    return false;
  }
  if (field.tagName !== "INPUT") {
    return true;
  }
  // A checkbox or a range slider has no text to cut or paste.
  const type = (field as HTMLInputElement).type;
  return !["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"].includes(type);
};

const hasTextSelection = (view: Window): boolean => {
  const selection = view.getSelection?.();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim().length > 0);
};

/**
 * Browser shortcuts with no meaning here. Matched on `event.key`, which follows
 * the active keyboard layout the same way the webview's own shortcuts do.
 * None of these has a text-editing meaning, so fields lose nothing.
 */
const isBrowserShortcut = (event: KeyboardEvent): boolean => {
  // Chromium fires key-less keydown events for autofill and some IMEs.
  const key = typeof event.key === "string" ? event.key : "";
  const ctrl = event.ctrlKey || event.metaKey;

  // Reload, caret browsing (F7 asks "Turn on caret browsing?"), and the
  // browser's own fullscreen toggle, which would fight the focus-mode
  // fullscreen that the app manages through the window instead.
  if (key === "F5" || key === "F7" || key === "F11" || key === "F3") {
    return true;
  }
  // Inspector. Release builds do not compile devtools in, but the key would
  // still be swallowed by the webview rather than reaching the page.
  if (key === "F12") {
    return true;
  }
  // Hardware browser keys found on some keyboards and mice.
  if (key === "BrowserBack" || key === "BrowserForward" || key === "BrowserRefresh" || key === "BrowserSearch") {
    return true;
  }
  // History navigation.
  if (event.altKey && !ctrl && (key === "ArrowLeft" || key === "ArrowRight" || key === "Home")) {
    return true;
  }
  if (!ctrl) {
    return false;
  }
  const lower = key.toLowerCase();
  // Reload, print, find, save page, view source, downloads, history.
  if (["r", "p", "f", "g", "s", "u", "j", "h"].includes(lower)) {
    return true;
  }
  // Page zoom. The window config already turns zoom hotkeys off; this covers
  // the numpad variants and keeps it off if that default ever changes.
  if (["=", "+", "-", "_", "0"].includes(key) || event.code === "NumpadAdd" || event.code === "NumpadSubtract") {
    return true;
  }
  // Inspector and element picker.
  if (event.shiftKey && ["i", "j", "c"].includes(lower)) {
    return true;
  }
  return false;
};

/** Mouse buttons 3 and 4 are "back" and "forward" on most mice. */
const isHistoryButton = (event: MouseEvent) => event.button === 3 || event.button === 4;

const guarded = new WeakSet<Window>();

/** Installs the guards on one window: the app's, or a book page's iframe. */
const guardWindow = (view: Window) => {
  if (guarded.has(view)) {
    return;
  }
  guarded.add(view);

  view.addEventListener(
    "keydown",
    (event) => {
      if (isBrowserShortcut(event)) {
        event.preventDefault();
      }
    },
    true
  );

  // Bubble phase, so a component that opens its own menu (Pip) has already
  // run. Text fields keep the native menu for paste; a real text selection —
  // a passage in a book — keeps it for Copy.
  view.addEventListener("contextmenu", (event) => {
    if (event.defaultPrevented || isEditable(event.target) || hasTextSelection(view)) {
      return;
    }
    event.preventDefault();
  });

  for (const type of ["mousedown", "mouseup", "auxclick"] as const) {
    view.addEventListener(
      type,
      (event) => {
        if (isHistoryButton(event)) {
          event.preventDefault();
        }
      },
      true
    );
  }

  // Dragging a cover image or a link would otherwise drag out a ghost copy
  // (and could drop a URL somewhere). Elements that opt in with
  // draggable="true" keep working.
  view.addEventListener(
    "dragstart",
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target || typeof target.closest !== "function") {
        return;
      }
      const source = target.closest("img, a");
      if (source && source.getAttribute("draggable") !== "true") {
        event.preventDefault();
      }
    },
    true
  );
};

/**
 * Book pages render in same-origin iframes (epub.js), and key and mouse events
 * inside them never reach the app's window — F5 or Ctrl+P pressed while
 * reading would slip past. `load` does not bubble, but a capturing listener on
 * the document still sees every frame finish loading, including frames the
 * reader creates long after startup.
 */
const guardFrames = () => {
  const attach = (frame: HTMLIFrameElement) => {
    try {
      const view = frame.contentWindow;
      // Throws or is null for a cross-origin frame; those are not ours to guard.
      if (view && view.document) {
        guardWindow(view);
      }
    } catch {
      // Cross-origin: leave it be.
    }
  };

  document.addEventListener(
    "load",
    (event) => {
      if (event.target instanceof HTMLIFrameElement) {
        attach(event.target);
      }
    },
    true
  );
  document.querySelectorAll("iframe").forEach(attach);
};

let installed = false;

export function installAppGuards() {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;
  guardWindow(window);
  guardFrames();
}
