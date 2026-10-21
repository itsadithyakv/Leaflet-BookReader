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
 * Auth and profile bodies are a few hundred bytes; only the state document
 * and a reader's library are large. Routes that need an account authenticate
 * *before* parsing, so a stranger cannot make the server buffer megabytes.
 */
export const smallJson = express.json({ limit: "16kb" });
// 2 MB of state is ~2.7 MB as base64, plus the envelope.
export const stateJson = express.json({ limit: "3mb" });
// A whole library: up to 3000 books of a key, a title, an author and two
// short fields. About 150 bytes each as a rule (under half a megabyte in
// all), but every field at its longest comes to about 1.4 MB, and a list the
// rules allow must not be refused for its size.
export const libraryJson = express.json({ limit: "2mb" });
// Up to 500 book keys of up to 160 characters: more than `smallJson` holds.
export const keysJson = express.json({ limit: "256kb" });
// A problem report: 64 KB of diagnostics, 2000 characters of message, and
// what JSON adds to them (an escaped line break is two bytes, not one).
export const problemJson = express.json({ limit: "160kb" });

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

/**
 * Text of several lines fit to show to other readers: a review, a thread, a
 * reply. Cleaned as `plainText` is, except that line breaks are kept, since
 * paragraphs are the point. At most one blank line in a row, so a post
 * cannot be made tall with nothing in it, and none at either end.
 */
export function plainLines(value, max) {
  const clean = String(value)
    .replace(INVISIBLE, "")
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .split("\n")
    .map((line) => line.replace(CONTROL, " ").replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [...clean].slice(0, max).join("").trim();
}

/** The driver's errors for "no socket came free in time" and "the cluster cannot be reached". */
const BUSY_ERRORS = new Set(["MongoWaitQueueTimeoutError", "MongoServerSelectionError"]);
/** What a request is told when the server or its database has more to do than it can: a 503, with `Retry-After`. */
export const BUSY = "Leaflet is busy just now. Try again in a moment.";

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
  // The database is busy or away: every socket of the pool was taken for as
  // long as a request may wait (`MONGO_WAIT_QUEUE_MS`), or no member of the
  // cluster could be reached. Nothing is wrong with the request, so it is
  // told to come back, not that the server broke; and one line is logged,
  // not a stack for every request caught behind the same stall.
  if (BUSY_ERRORS.has(error?.name)) {
    console.error(`[leaflet] database busy: ${error.name}`);
    response.set("Retry-After", "5");
    response.status(503).json({ error: BUSY });
    return;
  }

  console.error("[leaflet]", error);
  response.status(500).json({ error: "Something went wrong on the server." });
}
