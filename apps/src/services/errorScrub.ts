/**
 * What an error report may say (`errorReports.ts`): an error's kind, with
 * everything that could be the reader's taken out. The same rules as the
 * server's (`server/src/errorKinds.js`), which scrubs again whatever it is
 * sent: paths and file names, addresses, emails, long ids, numbers, and
 * anything in quotes (where a book's title is, when a message has one).
 * What is left says which error and where in the code, and never what was
 * being read, by whom, or on which computer.
 */

export const NAME_MAX = 60;
export const MESSAGE_MAX = 200;
export const FRAMES_MAX = 5;
export const FRAME_MAX = 80;

export type ErrorKind = { name: string; message: string; frames: string[] };

const CONTROL = /[\p{Cc}​-‏‪-‮⁦-⁩﻿]/gu;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const URL_LIKE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>)]+/gi;
const WINDOWS_PATH = /(?:\b[a-z]:|\\\\[^\s\\]+)\\[^\s"'`<>|]*/gi;
const UNIX_PATH = /(?:~|\.{1,2})?\/[^\s"'`<>/]+(?:\/[^\s"'`<>/]*)+/g;
const FILE =
  /[^\s"'`<>/\\]+\.(?:epub|pdf|mobi|azw3?|kfx|cbz|cbr|cb7|fb2|djvu|txt|rtf|docx?|odt|html?|xhtml|zip|rar|7z|png|jpe?g|webp|gif|svg|json|db|sqlite|log|ttf|otf)\b/gi;
// A single quote only opens after something that is not a letter, and only
// closes before one, so "couldn't" and "the reader's" are words, not quotes.
const QUOTED =
  /"[^"]*"|(?<![\p{L}\p{N}])'(?:[^']|'(?=\p{L}))*'(?![\p{L}\p{N}])|`[^`]*`|“[^”]*”|(?<![\p{L}\p{N}])‘(?:[^’]|’(?=\p{L}))*’(?![\p{L}\p{N}])|«[^»]*»/gu;
const TOKEN = /\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}\b/g;
const NUMBER = /\b0x[0-9a-f]+\b|\d+(?:[.,:]\d+)*/gi;

const cut = (text: string, max: number) => [...text].slice(0, max).join("").trim();

/** A message, a name or a context as reported: one line, nothing of the reader's. */
export function scrubText(value: unknown, max = MESSAGE_MAX): string {
  const text = String(value ?? "")
    .replace(CONTROL, " ")
    .replace(EMAIL, "<email>")
    .replace(URL_LIKE, "<url>")
    .replace(WINDOWS_PATH, "<path>")
    .replace(UNIX_PATH, "<path>")
    .replace(FILE, "<file>")
    .replace(QUOTED, "<q>")
    .replace(TOKEN, "<id>")
    .replace(NUMBER, "#")
    .replace(/\s+/g, " ")
    .trim();
  return cut(text, max);
}

/**
 * One place in the code ("openBook@assets/LibraryPage-Dx81aQzz.js:1:2345")
 * as reported: the function's name, unless the build shortened it past
 * meaning, and the file without the build's hash, line or column, which move
 * with every release ("openBook@assets/LibraryPage.js").
 */
export function scrubFrame(value: unknown): string {
  const frame = String(value ?? "").replace(CONTROL, " ").trim();
  const [fn = "", file = ""] = frame.split("@");
  const where = file
    .replace(/[?#].*$/, "")
    .replace(/(?::\d+)+$/, "")
    .replace(/-[A-Za-z0-9_]{6,12}(?=\.[a-z]+$)/, "");
  const name = fn.replace(/[^\p{L}\p{N}_$.<> ]/gu, "").trim();
  const place = /^[\p{L}\p{N}_$./-]+$/u.test(where) && !/\d{3,}/.test(where) ? where.split("/").slice(-3).join("/") : where ? "<path>" : "";
  return cut(`${name && name.length > 2 ? name : "?"}${place ? `@${place}` : ""}`, FRAME_MAX);
}

/** The app's own pages are served from these; a frame from anywhere else says only that it was elsewhere. */
const OWN = /^(?:https?:\/\/(?:tauri|asset)\.localhost|https?:\/\/localhost(?::\d+)?|https?:\/\/127\.0\.0\.1(?::\d+)?|tauri:\/\/localhost|asset:\/\/localhost)\/?/i;

/** A place from a stack trace's line, as "function@file:line:col" before scrubbing; null for a line that is not one. */
function frameOf(line: string): string | null {
  const trimmed = line.trim();
  // Chromium (Windows' WebView2, Android's WebView): "at fn (url:1:2)" or "at url:1:2".
  const v8 = /^at (?:async )?(?:(.+?) \()?(.+?)\)?$/.exec(trimmed);
  // WebKit (macOS): "fn@url:1:2".
  const webkit = !v8 ? /^(.*?)@(.+)$/.exec(trimmed) : null;
  const found = v8 ? [v8[1] ?? "", v8[2]] : webkit ? [webkit[1], webkit[2]] : null;
  if (!found) return null;
  const [fn, url] = found;
  const local = OWN.test(url) ? url.replace(OWN, "") : /^[a-z]+:\/\//i.test(url) ? "elsewhere" : url;
  return `${fn.replace(/^new /, "").replace(/^Object\./, "")}@${local}`;
}

/** The top few places of a stack trace, scrubbed. */
export function framesOf(stack: unknown): string[] {
  if (typeof stack !== "string") return [];
  return stack
    .split("\n")
    .map(frameOf)
    .filter((frame): frame is string => frame !== null)
    .slice(0, FRAMES_MAX)
    .map(scrubFrame)
    .filter(Boolean);
}

/** An error the interface logged (`diagnosticsService.logError`), as its kind. */
export function kindOf(context: string, error: unknown): ErrorKind {
  if (error instanceof Error) {
    return {
      name: scrubText(error.name || "Error", NAME_MAX) || "Error",
      message: scrubText(`${context}: ${error.message}`),
      frames: framesOf(error.stack)
    };
  }
  let said: string;
  try {
    said = typeof error === "string" ? error : JSON.stringify(error) ?? String(error);
  } catch {
    said = String(error);
  }
  return { name: "Error", message: scrubText(`${context}: ${said}`), frames: [] };
}

/** A panic noted by the Rust side (`take_panic_reports`): its message and its place in the crate. */
export const panicKind = (message: string, place: string): ErrorKind => ({
  name: "Panic",
  message: scrubText(message),
  frames: place ? [scrubFrame(`panic@${place}`)] : []
});

/** What makes two reports the same kind. */
export const kindKey = (kind: ErrorKind) => [kind.name, kind.message, ...kind.frames].join("\n");
