/**
 * "Did you mean name@gmail.com?"
 *
 * A slip in the address at sign-up is the one mistake an account cannot get
 * over by itself: the confirmation code and every reset email go to somebody
 * else, or nowhere. Most addresses are at a handful of domains, so a domain
 * one slip away from one of those (a letter missing, doubled, wrong or
 * swapped with its neighbour) is almost always that domain mistyped.
 *
 * Only ever a suggestion. Nothing here refuses an address: plenty of real
 * domains look like typos of something.
 */

/** The domains worth guessing at. */
const COMMON = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "proton.me",
  "protonmail.com"
] as const;

/** Real mail domains that are one slip from a common one. Left alone. */
const REAL_LOOKALIKES = new Set(["mail.com", "email.com", "ymail.com"]);

/**
 * Whether `typed` is exactly one slip from `wanted`: one letter missing,
 * extra or wrong, or two neighbours swapped.
 */
const oneSlipFrom = (typed: string, wanted: string) => {
  if (typed === wanted || Math.abs(typed.length - wanted.length) > 1) {
    return false;
  }
  // Where they first differ.
  let at = 0;
  while (at < typed.length && at < wanted.length && typed[at] === wanted[at]) {
    at += 1;
  }
  const restOf = (text: string, from: number) => text.slice(from);
  if (typed.length < wanted.length) {
    return restOf(typed, at) === restOf(wanted, at + 1);
  }
  if (typed.length > wanted.length) {
    return restOf(typed, at + 1) === restOf(wanted, at);
  }
  if (restOf(typed, at + 1) === restOf(wanted, at + 1)) {
    return true;
  }
  return typed[at] === wanted[at + 1] && typed[at + 1] === wanted[at] && restOf(typed, at + 2) === restOf(wanted, at + 2);
};

/**
 * The address the reader probably meant, or null when the one typed looks
 * fine (or is nothing this can judge).
 */
export const emailHint = (address: string): string | null => {
  const typed = address.trim();
  const split = typed.lastIndexOf("@");
  if (split < 1 || /\s/.test(typed)) {
    return null;
  }
  const name = typed.slice(0, split);
  const domain = typed.slice(split + 1).toLowerCase();
  if (!domain || (COMMON as readonly string[]).includes(domain) || REAL_LOOKALIKES.has(domain)) {
    return null;
  }
  // "name@gmail", the ending never typed.
  const meant = COMMON.find((common) => common.split(".")[0] === domain) ?? COMMON.find((common) => oneSlipFrom(domain, common));
  return meant ? `${name}@${meant}` : null;
};
