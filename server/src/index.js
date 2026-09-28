import { existsSync } from "node:fs";
import { createApp } from "./app.js";
import { close, connect } from "./db.js";
import { mailerFromEnv } from "./mail.js";

/**
 * Leaflet's only server: accounts, the leaderboard, and an opaque copy of each
 * reader's sync state.
 *
 * It holds the Mongo credentials (the app must never have them, or any reader
 * could read every other reader's data). Book files never come here — those go
 * to the reader's own Drive — and it never sees a Google or Drive token.
 *
 * Production runs it under systemd on a small VM, bound to 127.0.0.1 behind
 * Caddy; see server/README.md and server/deploy/.
 */

// A local `.env` for development. In production systemd supplies the
// environment (EnvironmentFile=/etc/leaflet-api.env) and no .env is deployed.
// Variables already set always win over the file.
if (existsSync(".env") && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(".env");
}

const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || "127.0.0.1";
// MONGODB_URI / MONGODB_DB are accepted for older .env files.
const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
const dbName = process.env.MONGO_DB || process.env.MONGODB_DB || "leaflet";

if (!uri) {
  console.error("MONGO_URI is not set. See server/.env.example.");
  process.exit(1);
}

// Password reset sends through a Google Apps Script web app; without its
// address and secret the reset endpoints say it is not set up.
const mailer = mailerFromEnv();
if (!mailer) {
  console.warn("[leaflet] RESET_MAIL_URL / RESET_MAIL_SECRET not set: password reset is off.");
}

const db = await connect(uri, dbName);
const app = createApp(db, { corsOrigin: process.env.CORS_ORIGIN || "", mailer });

const server = app.listen(port, host, () => {
  console.log(`Leaflet API on http://${host}:${port}`);
  // Is the reset mailer set up right? Checked in the background (it sends
  // nothing), so a wrong secret shows in the log now rather than as a reader
  // who never gets a code.
  mailer?.check?.().then(({ ok, detail }) => (ok ? console.log : console.warn)(`[leaflet] ${detail}`));
});
// Keep-alive sockets from the proxy should not hold shutdown open for long.
server.keepAliveTimeout = 65_000;
// Node requires this above keepAliveTimeout, or a reused socket can be cut
// mid-request by the header timer.
server.headersTimeout = 66_000;
// The largest request is a ~3 MB state upload; nothing legitimate takes this
// long, and a slow-drip client should not hold a socket (and its buffers)
// under a 256 MB memory cap.
server.requestTimeout = 30_000;

// Route handlers already forward rejections to the error handler (http.js).
// Anything that still escapes is a bug worth a log line, but not worth taking
// every reader's request down with it.
process.on("unhandledRejection", (reason) => {
  console.error("[leaflet] unhandled rejection:", reason);
});
// A thrown exception can leave state half-updated, so log it and exit;
// systemd restarts the service within seconds (Restart=always).
process.on("uncaughtException", (error) => {
  console.error("[leaflet] uncaught exception:", error);
  process.exit(1);
});

let stopping = false;
function shutdown(signal) {
  if (stopping) {
    return;
  }
  stopping = true;
  console.log(`[leaflet] ${signal}: shutting down`);
  // Stop accepting, let in-flight requests finish, then close Mongo. A hard
  // deadline keeps systemd from waiting on a stuck connection.
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  server.close(() => {
    close()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
  server.closeIdleConnections?.();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
