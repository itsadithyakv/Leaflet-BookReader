import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { MongoClient } from "mongodb";
import { clientOptions } from "../db.js";
import { accountFootprint, deleteAccount } from "../deletion.js";
import { normaliseEmail } from "../routes/account.js";

/**
 * Deletes an account on request, without its password: for a reader who
 * asked by email (the deletion page promises it within 7 days). On the VM:
 *
 *   cd /opt/leaflet-api
 *   sudo node --env-file=/etc/leaflet-api.env src/tools/delete-account.js --email someone@example.com
 *   sudo node --env-file=/etc/leaflet-api.env src/tools/delete-account.js --email someone@example.com --yes
 *
 * The first only shows the account (handle, when it was made, what it has);
 * with `--yes` it deletes it, through `deleteAccount` (deletion.js), exactly
 * what DELETE /v1/account does, which also notes it in `deletions` so a
 * restore from backup deletes it again. The address is normalised the way
 * sign-up does (trimmed, lower case).
 */

if (existsSync(".env") && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(".env");
}

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, yes: { type: "boolean" } } });
  const email = normaliseEmail(values.email);
  if (!email) {
    throw new Error("give the account's address: --email someone@example.com");
  }
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGO_URI is not set (on the VM: sudo node --env-file=/etc/leaflet-api.env ...)");
  }
  const dbName = process.env.MONGO_DB || process.env.MONGODB_DB || "leaflet";
  const client = new MongoClient(uri, { ...clientOptions(process.env), appName: "leaflet-delete-account", maxPoolSize: 4 });
  try {
    await client.connect();
    const db = client.db(dbName);
    const account = await db.collection("accounts").findOne({ email });
    if (!account) {
      throw new Error(`no account with the address ${email} in "${dbName}"`);
    }
    const profile = await db.collection("profiles").findOne({ _id: account._id }, { projection: { handle: 1 } });
    console.log(`account   ${account._id.toHexString()}  ${email}`);
    console.log(`handle    ${profile?.handle ? `@${profile.handle}` : "(none)"}`);
    console.log(`made      ${account.createdAt instanceof Date ? account.createdAt.toISOString() : "(unknown)"}`);
    const footprint = await accountFootprint(db, account._id);
    const held = Object.entries(footprint).filter(([, count]) => count > 0);
    console.log(`with it   ${held.length ? held.map(([label, count]) => `${label} ${count}`).join(", ") : "nothing else"}`);
    if (!values.yes) {
      console.log("Nothing deleted. Run it again with --yes to delete this account and all of the above.");
      return;
    }
    await deleteAccount(db, account._id);
    console.log(`Deleted ${email}. (Noted in "deletions" for 45 days, so a restore from backup deletes it again.)`);
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`delete-account: ${error?.message ?? error}`);
  process.exit(1);
});
