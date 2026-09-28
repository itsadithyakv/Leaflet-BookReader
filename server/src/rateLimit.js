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
    // Community writes (follow, kudos, duels) per account.
    social: { limit: 60, windowMs: 15 * MINUTE },
    // Handle searches per IP. Debounced typing is a handful per lookup.
    search: { limit: 120, windowMs: 5 * MINUTE }
  };
}
