// A Leaflet server on this machine, on a throwaway database, for joining the
// app's request builder to the real routes (apps/src-tauri: commands::e2e).
//
//   node scripts/e2e-server.mjs   API on 127.0.0.1:18787, control on :18788
//
// The control port does what only the database can: age an account and
// confirm its email (as a week of waiting and a mailed code would), mark one
// as the admin, and stop (dropping the database).
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const server = (file) => import(new URL(`../src/${file}`, import.meta.url).href);
const { createApp } = await server("app.js");
const { connect, close, accounts, profiles } = await server("db.js");

// It empties and drops its database, so it only ever talks to one on this
// machine: never to the real one, whatever the environment says.
const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(uri)) {
  console.error("e2e-server: TEST_MONGO_URI must be a MongoDB on this machine.");
  process.exit(1);
}
const dbName = `leaflet_e2e_${randomBytes(4).toString("hex")}`;
const db = await connect(uri, dbName);
const MINUTE = 60_000;
const roomy = (windowMs) => ({ limit: 100_000, windowMs });
const app = createApp(db, {
  limits: {
    ip: roomy(15 * MINUTE),
    email: roomy(15 * MINUTE),
    signup: roomy(60 * MINUTE),
    social: roomy(15 * MINUTE),
    search: roomy(5 * MINUTE),
    visitors: roomy(15 * MINUTE),
    library: roomy(15 * MINUTE)
  }
});
const api = app.listen(18787, "127.0.0.1", () => console.log(`api up on 18787, database ${dbName}`));

const readBody = (request) =>
  new Promise((resolve) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      try {
        resolve(JSON.parse(text || "{}"));
      } catch {
        resolve({});
      }
    });
  });

const control = createServer(async (request, response) => {
  const body = await readBody(request);
  const answer = (value) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  };
  if (request.url === "/age") {
    // A month old, and its email confirmed.
    const result = await accounts(db).updateOne(
      { email: String(body.email).toLowerCase() },
      { $set: { createdAt: new Date(Date.now() - 30 * 86_400_000), emailConfirmedAt: new Date() } }
    );
    return answer({ aged: result.modifiedCount });
  }
  if (request.url === "/admin") {
    const result = await profiles(db).updateOne({ handle: String(body.handle).toLowerCase() }, { $set: { role: "admin" } });
    return answer({ admin: result.modifiedCount });
  }
  if (request.url === "/reset") {
    // Every document gone, the indexes kept: a run starts from nothing.
    for (const { name } of await db.listCollections().toArray()) {
      await db.collection(name).deleteMany({});
    }
    return answer({ reset: true });
  }
  if (request.url === "/stop") {
    answer({ stopped: true });
    await new Promise((resolve) => api.close(resolve));
    await db.dropDatabase();
    await close();
    control.close();
    console.log("stopped, database dropped");
    return;
  }
  response.writeHead(404);
  response.end();
});
control.listen(18788, "127.0.0.1", () => console.log("control up on 18788"));
