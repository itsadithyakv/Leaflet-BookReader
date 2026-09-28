import express from "express";
import { errorHandler, notFound } from "./http.js";
import { defaultLimits } from "./rateLimit.js";
import { accountRoutes } from "./routes/account.js";
import { communityRoutes } from "./routes/community.js";
import { socialRoutes } from "./routes/social.js";
import { stateRoutes } from "./routes/state.js";

/**
 * Builds the Express app around an open database.
 *
 * Kept apart from `index.js` so tests can run the real app against a throwaway
 * database, with their own (tiny) rate limits, without reading the environment.
 */
export function createApp(db, { limits = defaultLimits(), corsOrigin = "" } = {}) {
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

  // No global body parser: each route parses its own body with its own limit,
  // and routes that need an account authenticate before parsing anything.
  app.use("/v1", accountRoutes(db, limits));
  app.use("/v1", stateRoutes(db));
  app.use("/v1", socialRoutes(db));
  // After socialRoutes, so `/profile/me` is matched before `/profile/:handle`.
  app.use("/v1", communityRoutes(db, limits));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
