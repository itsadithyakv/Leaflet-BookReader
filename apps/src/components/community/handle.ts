/**
 * Handles: the rules, in one place for every field that takes one (the
 * sign-up form, the profile card, reader search).
 *
 * A handle is how readers find and name each other, written with an "@" in
 * front wherever it is shown (`at` in `format.ts`). The "@" is only ever
 * drawn: what is typed, stored and sent is the bare handle. The server has
 * the last word (`handleProblem` in `server/src/routes/social.js`: the same
 * shape, plus the names it reserves and the ones already taken).
 */

export const HANDLE_MAX = 24;
/** The server's `HANDLE_PATTERN`. Keep the two the same. */
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])$/;

/**
 * What was typed or pasted, as a handle: lower case, and without the "@"
 * (or spaces) a reader may well type because that is how handles are shown.
 */
export const cleanHandle = (typed: string) =>
  typed
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^@+/, "")
    .slice(0, HANDLE_MAX);

/** Why a handle cannot be used, in the server's words, or null when it can. */
export const handleProblem = (handle: string): string | null => {
  if (HANDLE_PATTERN.test(handle)) {
    return null;
  }
  if (/^[a-z0-9_-]{3,24}$/.test(handle)) {
    return "A handle starts and ends with a letter or a number.";
  }
  return "Handles are 3–24 characters: letters, numbers, hyphens and underscores.";
};

/** Letters and numbers only, joined by underscores: "Ada Lovelace" → "ada_lovelace". */
const slug = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, HANDLE_MAX)
    .replace(/_+$/, "");

/**
 * A handle to start the field with: from the name, else from the part of the
 * email before the "@". Only a suggestion, shown in the field for the reader
 * to change; empty when neither makes a usable one.
 */
export const suggestHandle = (name: string, email: string) => {
  for (const source of [name, email.split("@")[0] ?? ""]) {
    const handle = slug(source);
    if (handleProblem(handle) === null) {
      return handle;
    }
  }
  return "";
};
