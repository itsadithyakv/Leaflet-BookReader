// Signs site/config.source.json into site/public/config.json.
//
// The desktop app finds Leaflet's server by reading config.json from GitHub
// Pages, so the server can move (a new domain, a new machine) without a Store
// update. The app only accepts a config signed with PaperKite's key; the public
// half is compiled into the app, so a compromised repo or a spoofed network
// cannot point readers' passwords at another server.
//
// Run locally whenever the API address changes:
//   node site/sign-config.mjs
// The private key never enters the repo. Default location:
//   %USERPROFILE%\.leaflet\config-signing-key.pem   (override: LEAFLET_SIGNING_KEY)
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const keyPath = process.env.LEAFLET_SIGNING_KEY ?? join(homedir(), ".leaflet", "config-signing-key.pem");

const source = JSON.parse(readFileSync(join(here, "config.source.json"), "utf8"));
if (typeof source.apiBase !== "string" || !source.apiBase.startsWith("https://")) {
  throw new Error("config.source.json: apiBase must be an https:// URL.");
}

const payload = {
  version: 1,
  apiBase: source.apiBase.replace(/\/+$/, ""),
  issuedAt: new Date().toISOString()
};
// The signature covers these exact bytes; the app verifies before parsing.
const bytes = Buffer.from(JSON.stringify(payload), "utf8");
const privateKey = createPrivateKey(readFileSync(keyPath));
const signature = sign(null, bytes, privateKey);

// Check it verifies with the public half before publishing anything.
if (!verify(null, bytes, createPublicKey(privateKey), signature)) {
  throw new Error("Signature did not verify; not writing config.json.");
}

const out = join(here, "public", "config.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ payload: bytes.toString("base64"), signature: signature.toString("base64") }, null, 2) + "\n");
console.log(`Signed ${payload.apiBase} → ${out}`);
