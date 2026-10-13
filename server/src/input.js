import { HttpError, plainLines, plainText } from "./http.js";

/**
 * Checks shared by the routes that take a reader's own words and numbers.
 *
 * Text is cleaned and cut to length (`plainText`), as a name is; what cannot
 * be cleaned into something usable is refused with a 400 that names the
 * field, never dropped quietly, so a client learns of its mistake.
 */

/** Text that has to be there: one line, at most `max` characters, not blank. */
export function requiredText(value, max, name) {
  const text = typeof value === "string" ? plainText(value, max) : "";
  if (!text) {
    throw new HttpError(400, `${name} should be text, up to ${max} characters.`);
  }
  return text;
}

/** Text of several lines that has to be there: line breaks kept, at most `max` characters, not blank. */
export function requiredLines(value, max, name) {
  const text = typeof value === "string" ? plainLines(value, max) : "";
  if (!text) {
    throw new HttpError(400, `${name} should be text, up to ${max} characters.`);
  }
  return text;
}

/** Text that may be left out: null for nothing (or for only blanks). */
export function optionalText(value, max, name) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `${name} should be text, up to ${max} characters.`);
  }
  return plainText(value, max) || null;
}

/** A whole number in [min, max], or a 400. Nothing is rounded: 2.5 is refused. */
export function wholeNumber(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, `${name} must be a whole number between ${min} and ${max}.`);
  }
  return value;
}

/** A list of at most `max`, or a 400. */
export function listOf(value, max, name) {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${name} should be a list.`);
  }
  if (value.length > max) {
    throw new HttpError(400, `${name} can hold up to ${max}.`);
  }
  return value;
}

/** A JSON object (not a list, not null), or a 400. */
export function record(value, name) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, `${name} should be an object.`);
  }
  return value;
}
