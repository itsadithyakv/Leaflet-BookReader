import express from "express";
import { BUSY, errorHandler, notFound } from "./http.js";
import { defaultLimits } from "./rateLimit.js";
import { accountRoutes } from "./routes/account.js";
import { clubRoutes } from "./routes/clubs.js";
import { communityRoomRoutes } from "./routes/communities.js";
import { communityRoutes } from "./routes/community.js";
import { giftRoutes } from "./routes/gifts.js";
import { libraryRoutes } from "./routes/library.js";
import { moderationRoutes } from "./routes/moderation.js";
import { postRoutes } from "./routes/posts.js";
import { raidRoutes } from "./routes/raids.js";
import { socialRoutes } from "./routes/social.js";
import { stateRoutes } from "./routes/state.js";

/** How many requests are worked on at once (`MAX_REQUESTS_AT_ONCE`): four for each connection of the default pool. */
const REQUESTS_AT_ONCE = 40;

/**
 * Builds the Express app around an open database.
 *
 * Kept apart from `index.js` so tests can run the real app against a throwaway
 * database, with their own (tiny) rate limits, without reading the environment.
 */
export function createApp(db, { limits = defaultLimits(), corsOrigin = "", mailer = null, suspensionSalt = "", atOnce = REQUESTS_AT_ONCE } = {}) {
  const app = express();
  app.disable("x-powered-by");
  // Nothing sends If-None-Match (the app calls from Rust), so an ETag is a
  // SHA-1 over every response body — up to a few MB for a sync state — spent
  // for nothing.
  app.set("etag", false);
  // Every query value here is a flat string. The default `qs` parser builds
  // nested objects from `?a[b][c]=`, which no route wants and which is the
  // usual way into prototype-pollution bugs.
  app.set("query parser", "simple");

  // Caddy runs on the same machine and adds X-Forwarded-For. Trusting only the
  // loopback hop means `request.ip` is the real client for rate limiting, while
  // a client cannot spoof its address by sending the header itself.
  app.set("trust proxy", "loopback");

  // A JSON-only API: nothing it returns should ever be rendered, framed,
  // sniffed into HTML or kept in a shared cache (responses carry personal data
  // and session tokens). Caddy adds HSTS; these travel with the app so they
  // hold wherever it is deployed.
  app.use((_request, response, next) => {
    response.set({
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store"
    });
    next();
  });

  // The desktop app calls from Rust, not from a browser origin, so CORS is off
  // unless explicitly configured (e.g. for testing from a browser page).
  if (corsOrigin) {
    app.use((request, response, next) => {
      response.set("Access-Control-Allow-Origin", corsOrigin);
      response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      response.set("Access-Control-Allow-Methods", "GET, PUT, POST, PATCH, DELETE, OPTIONS");
      if (request.method === "OPTIONS") {
        response.sendStatus(204);
        return;
      }
      next();
    });
  }

  app.get("/health", (_request, response) => response.json({ ok: true }));

  // So many requests are worked on at once, and no more: one that arrives
  // with that many still unanswered is told at once to come back (503,
  // `Retry-After`), which every app does at its next poll.
  //
  // A request is several trips to the database, each waiting its turn for
  // one of a few connections. With the database slow, or more arriving than
  // it can carry, nothing used to turn a request away: they piled up, each
  // taking longer than the one before (measured: half a minute for an
  // inbox, and the process past its memory limit) until the apps gave up.
  // Turned away at the door, the ones let in are answered in good time and
  // the pile is never there to hold in memory. Far above what a few hundred
  // open apps have in flight (one or two).
  let unanswered = 0;
  app.use((_request, response, next) => {
    if (unanswered >= atOnce) {
      response.set("Retry-After", "5");
      response.status(503).json({ error: BUSY });
      return;
    }
    unanswered += 1;
    let counted = true;
    const answered = () => {
      if (counted) {
        counted = false;
        unanswered -= 1;
      }
    };
    // `close` as well: a client that goes away mid-request never sees a `finish`.
    response.once("finish", answered);
    response.once("close", answered);
    next();
  });

  // No global body parser: each route parses its own body with its own limit,
  // and routes that need an account authenticate before parsing anything.
  // Tests pass only the limits they care about.
  // `suspensionSalt` is a secret the server already has, where it has one,
  // to key the hash a suspended address is remembered by (`standing.js`).
  app.use("/v1", accountRoutes(db, { ...defaultLimits(), ...limits }, mailer, suspensionSalt));
  app.use("/v1", stateRoutes(db, limits));
  app.use("/v1", socialRoutes(db, limits));
  // After socialRoutes, so `/profile/me` is matched before `/profile/:handle`.
  app.use("/v1", communityRoutes(db, limits));
  // What readers share beyond the board: a library, finished-book posts,
  // clubs, gifts and raids on each other's camps. Their paths under
  // `/profile/:handle/` are longer than the profile's own, so the order
  // among these does not matter.
  app.use("/v1", libraryRoutes(db, limits));
  app.use("/v1", postRoutes(db, limits));
  app.use("/v1", clubRoutes(db, limits));
  app.use("/v1", giftRoutes(db, limits));
  app.use("/v1", raidRoutes(db, limits));
  // The public layer: book communities and their threads, and what keeps
  // them civil (the guidelines, blocks, reports, and the admin's tools).
  app.use("/v1", communityRoomRoutes(db, limits));
  app.use("/v1", moderationRoutes(db, limits, suspensionSalt));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
