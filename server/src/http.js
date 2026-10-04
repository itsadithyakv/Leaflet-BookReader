import express from "express";

/**
 * Plumbing shared by every route: typed errors, an async wrapper, per-route
 * body limits and the one error handler.
 *
 * Express 4 does not catch a rejected promise from an async handler. Without
 * the wrapper, a Mongo hiccup inside any route was an unhandled rejection —
 * which on current Node takes the whole process down.
 */

export class HttpError extends Error {
  constructor(status, message, extra = undefined) {
    super(message);
    this.status = status;
    this.extra = extra;
    this.expose = true;
  }
}

/** Forwards a rejected promise to the error handler instead of crashing. */
export const asyncHandler = (fn) => (request, response, next) => {
  Promise.resolve(fn(request, response, next)).catch(next);
};

/**
 * Body limits, by route.
 *
 * Auth and profile bodies are a few hundred bytes; only the state document is
 * large. Routes that need an account authenticate *before* parsing, so a
 * stranger cannot make the server buffer megabytes.
 */
export const smallJson = express.json({ limit: "16kb" });
// 2 MB of state is ~2.7 MB as base64, plus the envelope.
export const stateJson = express.json({ limit: "3mb" });

// The marks and overrides that turn the text after them right-to-left, and
// zero-width spaces: characters that show nothing themselves.
const INVISIBLE = /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
// Control characters (a line break, a tab, an escape).
const CONTROL = /\p{Cc}/gu;

/**
 * Text fit to show to other readers: one line, at most `max` characters.
 *
 * A name goes on every reader's board, so it cannot carry a line break, text
 * that reverses the row around it, or nothing but invisible characters (which
 * read as a blank name). Counted in whole characters, so the cut never lands
 * in the middle of an emoji.
 */
export function plainText(value, max) {
  const clean = String(value).replace(INVISIBLE, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return [...clean].slice(0, max).join("").trim();
}

export function notFound(_request, response) {
  response.status(404).json({ error: "Not found." });
}

// Express recognises an error handler by its arity, so all four are needed.
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, _request, response, _next) {
  // body-parser marks its own failures with a type and a 4xx status.
  if (error?.type === "entity.too.large") {
    response.status(413).json({ error: "That request is too large." });
    return;
  }
  if (error?.type === "entity.parse.failed") {
    response.status(400).json({ error: "That request body is not valid JSON." });
    return;
  }
  if (error instanceof HttpError) {
    if (error.status === 429 && error.extra?.retryAfter) {
      response.set("Retry-After", String(error.extra.retryAfter));
    }
    response.status(error.status).json({ error: error.message });
    return;
  }
  const status = Number(error?.status ?? error?.statusCode);
  if (status >= 400 && status < 500) {
    response.status(status).json({ error: error.expose ? error.message : "Bad request." });
    return;
  }

  console.error("[leaflet]", error);
  response.status(500).json({ error: "Something went wrong on the server." });
}
