/**
 * How the server itself is doing, for the owner's overview
 * (`GET /v1/admin/overview`): how many requests it answered, how many of
 * them it failed (5xx), and how long they took, for each of the last 24
 * hours and for each route since it started.
 *
 * Kept in this process's memory and nowhere else: a request costs a few
 * additions here and not one trip to the database, which on a free cluster
 * is the thing to save. So it starts again from nothing at every restart,
 * and the overview says how long the server has been up beside it.
 *
 * Times are counted into fixed buckets (5 ms, 10 ms, 20 ms...) rather than
 * kept one by one, so a busy hour costs no more memory than a quiet one; a
 * percentile is the bucket it falls in, which is as exact as a glance needs.
 */

const HOUR_MS = 60 * 60 * 1000;
const HOURS = 24;
/** The upper edge of each time bucket, in milliseconds. The last catches everything slower. */
export const BOUNDS = [5, 10, 20, 35, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10_000, 30_000, Infinity];
/** More routes than the app has; past it, any new one is counted as "other" rather than grow. */
const MAX_ROUTES = 200;

/** The platforms the apps name themselves by (as problem reports do). */
export const PLATFORMS = ["windows", "android", "macos", "linux"];
export const VERSION = /^\d{1,4}(\.\d{1,4}){1,3}$/;

/**
 * What an app says it is, from `X-Leaflet-Client: 1.5.12; android`: its
 * version and platform, or null for anything else (an older app, a browser,
 * a header made up). Only these two well-formed values are ever kept.
 */
export function clientOf(header) {
  if (typeof header !== "string" || header.length > 40) {
    return null;
  }
  const [version, platform] = header.split(";").map((part) => part.trim().toLowerCase());
  return VERSION.test(version ?? "") && PLATFORMS.includes(platform) ? { version, platform } : null;
}

const emptyTimes = () => new Array(BOUNDS.length).fill(0);
const bucketOf = (ms) => BOUNDS.findIndex((bound) => ms <= bound);

/** The time below which `share` (0.5, 0.95) of the counted requests fell: a bucket's upper edge. */
export function percentile(times, share) {
  const total = times.reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return null;
  }
  let seen = 0;
  for (let index = 0; index < times.length; index += 1) {
    seen += times[index];
    if (seen >= total * share) {
      // The last bucket has no upper edge; say the one below it ("over 30 s").
      return Number.isFinite(BOUNDS[index]) ? BOUNDS[index] : BOUNDS[index - 1];
    }
  }
  return BOUNDS[BOUNDS.length - 2];
}

export class RequestStats {
  constructor(now = Date.now()) {
    this.startedAt = now;
    this.hours = new Array(HOURS).fill(null);
    this.routes = new Map();
  }

  #hour(at) {
    const hour = Math.floor(at / HOUR_MS);
    const slot = hour % HOURS;
    if (this.hours[slot]?.hour !== hour) {
      this.hours[slot] = { hour, count: 0, failed: 0, times: emptyTimes() };
    }
    return this.hours[slot];
  }

  /** Counts one answered request: its route, its status and how long it took. */
  record(route, status, ms, at = Date.now()) {
    const bucket = bucketOf(ms);
    const failed = status >= 500 ? 1 : 0;
    const hour = this.#hour(at);
    hour.count += 1;
    hour.failed += failed;
    hour.times[bucket] += 1;
    const key = this.routes.has(route) || this.routes.size < MAX_ROUTES ? route : "other";
    let entry = this.routes.get(key);
    if (!entry) {
      entry = { count: 0, failed: 0, totalMs: 0, times: emptyTimes() };
      this.routes.set(key, entry);
    }
    entry.count += 1;
    entry.failed += failed;
    entry.totalMs += ms;
    entry.times[bucket] += 1;
  }

  /**
   * What the overview shows: the last 24 hours oldest first (an hour with
   * nothing in it is there, as zeros), and the routes, the busiest and the
   * slowest (by p95, among those asked at least `least` times) first.
   */
  summary(now = Date.now(), { top = 8, least = 5 } = {}) {
    const current = Math.floor(now / HOUR_MS);
    const hours = [];
    for (let back = HOURS - 1; back >= 0; back -= 1) {
      const hour = current - back;
      const kept = this.hours[hour % HOURS];
      const found = kept?.hour === hour ? kept : null;
      hours.push({
        at: new Date(hour * HOUR_MS).toISOString(),
        requests: found?.count ?? 0,
        failed: found?.failed ?? 0,
        p50: found ? percentile(found.times, 0.5) : null,
        p95: found ? percentile(found.times, 0.95) : null
      });
    }
    const day = emptyTimes();
    for (const hour of this.hours) {
      if (hour && hour.hour > current - HOURS) {
        hour.times.forEach((count, index) => {
          day[index] += count;
        });
      }
    }
    const routes = [...this.routes].map(([route, entry]) => ({
      route,
      requests: entry.count,
      failed: entry.failed,
      meanMs: Math.round(entry.totalMs / entry.count),
      p95: percentile(entry.times, 0.95)
    }));
    return {
      startedAt: new Date(this.startedAt).toISOString(),
      uptimeSeconds: Math.max(0, Math.round((now - this.startedAt) / 1000)),
      day: {
        requests: hours.reduce((sum, hour) => sum + hour.requests, 0),
        failed: hours.reduce((sum, hour) => sum + hour.failed, 0),
        p50: percentile(day, 0.5),
        p95: percentile(day, 0.95)
      },
      hours,
      busiest: [...routes].sort((a, b) => b.requests - a.requests).slice(0, top),
      slowest: routes
        .filter((entry) => entry.requests >= least)
        .sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0) || b.meanMs - a.meanMs)
        .slice(0, top)
    };
  }
}

/**
 * The route a request was answered by, as written in the code
 * ("GET /v1/admin/problems/:id"), so that every reader's id counts as one
 * route; "(no route)" for one nothing matched, and "(turned away)" for one
 * told the server was busy before it got that far.
 */
export function routeOf(request, status) {
  const pattern = request.route?.path;
  if (typeof pattern === "string") {
    const prefix = request.originalUrl?.startsWith("/v1/") && !pattern.startsWith("/v1") ? "/v1" : "";
    return `${request.method} ${prefix}${pattern}`;
  }
  return status === 503 ? "(turned away)" : "(no route)";
}

/** Middleware: every request is counted when its answer has gone (or the client went away). */
export function countRequests(stats) {
  return (request, response, next) => {
    const began = process.hrtime.bigint();
    let counted = false;
    const done = () => {
      if (counted) {
        return;
      }
      counted = true;
      const ms = Number(process.hrtime.bigint() - began) / 1e6;
      stats.record(routeOf(request, response.statusCode), response.statusCode, ms);
    };
    response.once("finish", done);
    response.once("close", done);
    next();
  };
}
