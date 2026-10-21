#!/usr/bin/env node
/**
 * Fetches the sherpa-onnx runtime the Studio voice is built against, once,
 * into apps/src-tauri/vendor/sherpa-onnx/ (git-ignored), and checks it
 * against its pinned SHA-256. apps/src-tauri/.cargo/config.toml points
 * sherpa-onnx-sys's build script there (SHERPA_ONNX_ARCHIVE_DIR), so a build
 * never downloads anything itself, and the bytes linked are always these.
 *
 *   node apps/scripts/fetch-sherpa-onnx.mjs           (from the repo root)
 *   node apps/scripts/fetch-sherpa-onnx.mjs --check   (only checks what is there)
 *
 * When sherpa-onnx is upgraded (2.0: docs/studio-voice.md), change VERSION
 * and SHA256 here together with the crate version in Cargo.toml.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "1.13.8";
const NAME = `sherpa-onnx-v${VERSION}-win-x64-shared-MT-Release-lib.tar.bz2`;
const URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VERSION}/${NAME}`;
const SHA256 = "b8eedf41bd6d3779218887b48367bb7a3ece5aaa7667f01f69ee823a12b0a9e7";
const SIZE = 8032957;

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "src-tauri", "vendor", "sherpa-onnx");
const target = join(dir, NAME);

const sha256 = (path) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });

const main = async () => {
  if (existsSync(target)) {
    const found = await sha256(target);
    if (found === SHA256) {
      console.log(`ok: ${target}`);
      return;
    }
    if (process.argv.includes("--check")) throw new Error(`${target} does not match its SHA-256 (${found})`);
    console.log("The copy there does not match; fetching it again.");
    rmSync(target);
  } else if (process.argv.includes("--check")) {
    throw new Error(`${target} is missing: run this script without --check`);
  }
  mkdirSync(dir, { recursive: true });
  console.log(`Fetching ${URL}`);
  // A neutral User-Agent: nothing about who is building.
  const response = await fetch(URL, { headers: { "User-Agent": "Leaflet-build" }, redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${URL}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== SIZE) throw new Error(`Expected ${SIZE} bytes, got ${bytes.length}`);
  const found = createHash("sha256").update(bytes).digest("hex");
  if (found !== SHA256) throw new Error(`SHA-256 mismatch: expected ${SHA256}, got ${found}`);
  const partial = `${target}.part`;
  writeFileSync(partial, bytes);
  renameSync(partial, target);
  console.log(`ok: ${target}`);
};

main().catch((error) => {
  console.error(String(error?.message ?? error));
  process.exit(1);
});
