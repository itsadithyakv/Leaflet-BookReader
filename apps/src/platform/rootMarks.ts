import { useLayoutEffect } from "react";

/**
 * What the app's state is, as attributes on `<html>`, for the shell's stylesheets to key on:
 *
 *   html[data-reading]          a book is open (ReaderView, PageReaderView)
 *   html[data-pip-page="home"]  Pip's tab is up, at home or out in the Hollow (PipPage)
 *   html[data-pip-fill]         and her house fills the window (PipPage)
 *   html[data-pip-out]          Pip is out of her logo, in the app (PipHome)
 *
 * (The book being read's bar and the header's state are on `.app-shell` itself, from App.tsx,
 * and an open sheet is `html[data-sheet-open]`, components/ui/motion.ts.)
 *
 * They were `html:has(.reader-scope)`, `.app-shell:has(> .reader-scope)`, `.app-shell:has(.pip-house-page)`
 * and the like, which made the browser restyle the whole document every time any element was added or
 * removed anywhere (a row of covers as the library scrolls, Pip's speech, a toast): about 10 ms each time
 * on a desktop, 90 to 200 ms on a phone. A test keeps such `:has()` out (styles/hasSelectors.test.ts).
 *
 * Each is set in a layout effect: in the commit that mounts what it stands for, before that frame is
 * painted, as `:has()` was.
 */

const held = new Map<string, Map<symbol, string>>();

const write = (root: HTMLElement, name: string) => {
  const values = held.get(name);
  const value = values && values.size ? Array.from(values.values()).pop()! : null;
  if (value === null) {
    if (name in root.dataset) delete root.dataset[name];
  } else if (root.dataset[name] !== value) {
    root.dataset[name] = value;
  }
};

/** Holds `html[data-<name>="<value>"]` until the returned function is called (several holders: the last one's value). */
export const holdRootMark = (name: string, value: string, root: HTMLElement = document.documentElement) => {
  const key = Symbol(name);
  let values = held.get(name);
  if (!values) held.set(name, (values = new Map()));
  values.set(key, value);
  write(root, name);
  return () => {
    held.get(name)?.delete(key);
    write(root, name);
  };
};

/** `html[data-<name>]` (camelCase, as `dataset`) while mounted and `value` is a string; none while it is null. */
export const useRootMark = (name: string, value: string | null | undefined) => {
  useLayoutEffect(() => (typeof value === "string" ? holdRootMark(name, value) : undefined), [name, value]);
};

/** In a reader: `html[data-reading]` while it is mounted. */
export const useReadingMark = () => useRootMark("reading", "");
