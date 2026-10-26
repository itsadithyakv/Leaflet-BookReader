/**
 * Fixed-window counters, in memory.
 *
 * Deliberately simple: one process, one Map. That is the limitation to know
 * about — run two instances behind a load balancer and each keeps its own
 * counts, so the effective limit doubles. For more than one instance, move the
 * counters to a shared store (a Mongo collection with a TTL index works).
 */
export class RateLimiter {
  constructor({ limit, windowMs, maxKeys = 50_000 }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.buckets = new Map();
  }

  #bucket(key, now) {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt > now) {
      return bucket;
    }
    return null;
  }

  /** Seconds until `key` may try again, or 0 when it may try now. */
  blockedFor(key, now = Date.now()) {
    const bucket = this.#bucket(key, now);
    if (!bucket || bucket.count < this.limit) {
      return 0;
    }
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  }

  /** Counts one attempt. */
  hit(key, now = Date.now()) {
    let bucket = this.#bucket(key, now);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) {
        this.sweep(now);
      }
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
  }

  reset(key) {
    this.buckets.delete(key);
  }

  /** Drops expired windows; if that frees nothing, starts over rather than grow. */
  sweep(now = Date.now()) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
    if (this.buckets.size >= this.maxKeys) {
      this.buckets.clear();
    }
  }
}

const MINUTE = 60_000;

/** The defaults. Tests pass their own. */
export function defaultLimits() {
  return {
    // Every signup/login request from one address.
    ip: { limit: 30, windowMs: 15 * MINUTE },
    // Failed password checks against one email (or account), from anywhere.
    email: { limit: 10, windowMs: 15 * MINUTE },
    // New accounts from one address.
    signup: { limit: 5, windowMs: 60 * MINUTE },
    // Community writes (follow, kudos, duels, posts, clubs, gifts, raids) per account.
    social: { limit: 60, windowMs: 15 * MINUTE },
    // Likes and dislikes per account. One tap each, and a reader going down
    // a feed taps often, so far more than other writes; still bounded, so a
    // script cannot swing every score in sight.
    react: { limit: 300, windowMs: 15 * MINUTE },
    // Whole-library uploads per account. Each is up to a megabyte or two to
    // parse and store, and the app sends one when the library changes.
    library: { limit: 20, windowMs: 15 * MINUTE },
    // Handle searches per IP. Debounced typing is a handful per lookup.
    search: { limit: 120, windowMs: 5 * MINUTE },
    // Browsing readers, suggestions and the lists of followers and following
    // (`routes/people.js`), per account (per address signed out): a page of
    // twenty each, so a hundred and twenty pages in five minutes is far past
    // any reader scrolling, and a script reads the directory no faster.
    people: { limit: 120, windowMs: 5 * MINUTE },
    // "Which friends read today" per account. The app asks every ten minutes
    // while the Pip tab is open.
    visitors: { limit: 30, windowMs: 15 * MINUTE },
    // Saves of a reader's own profile per account. An app sends one a minute
    // at its most eager (a book or the board open), and one more after each
    // sync, so this is some ten times what any app does: a ceiling on a
    // client gone wrong, each of whose saves is a few writes.
    profile: { limit: 300, windowMs: 15 * MINUTE },
    // Fetches of the sync document per account, and writes of it, each
    // counted on its own. An app syncs after a book is closed and after each
    // highlight, a fetch and a write a time; the document is the largest
    // thing sent either way (megabytes at its most).
    state: { limit: 300, windowMs: 15 * MINUTE },
    // Password-reset emails: per address asking, and per email address asked
    // about. Each one is a real email from a Gmail with a daily quota.
    resetIp: { limit: 10, windowMs: 60 * MINUTE },
    resetEmail: { limit: 3, windowMs: 60 * MINUTE },
    // Confirmation emails: per account asking (a new code, or a change of
    // address), and per address written to. The one sent at sign-up counts.
    confirmAccount: { limit: 5, windowMs: 60 * MINUTE },
    confirmEmail: { limit: 3, windowMs: 60 * MINUTE },
    // Problem reports per address, signed in or not (per account it is
    // five a UTC day, in `tallies`). Ten, so two readers behind one router
    // can each send their five.
    problems: { limit: 10, windowMs: 24 * 60 * MINUTE },
    // Error reports per address: an app sends one small batch a session at
    // most, so six an hour is a household of readers opening Leaflet a few
    // times each, and a script gets no further than that.
    errors: { limit: 6, windowMs: 60 * MINUTE }
  };
}
