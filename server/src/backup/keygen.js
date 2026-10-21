import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BackupError } from "./format.js";

/**
 * Makes the backups' key pair, once, on the owner's PC:
 *
 *   node src/backup/keygen.js C:\Users\Adi\.leaflet\backup-private.pem
 *
 * RSA-4096, for encryption (backups are encrypted to the public key; only
 * the private key opens them). Writes the private key (PEM, PKCS#8,
 * unencrypted, mode 600 where the system has modes) and the public key
 * beside it with `.pub` for `.pem` (backup-private.pub), and prints the public
 * one. Refuses to overwrite either: a new key would not open the backups made
 * with the old one.
 *
 * Lose the private key and every backup is unreadable: keep a second copy
 * off this PC (docs/backups.md).
 */

export function publicPathOf(privatePath) {
  return privatePath.replace(/\.pem$/i, "") + ".pub";
}

export function keygen(privatePath, { bits = 4096 } = {}) {
  if (!privatePath) {
    throw new BackupError("give the path to write the private key to, e.g. C:\\Users\\Adi\\.leaflet\\backup-private.pem");
  }
  const publicPath = publicPathOf(privatePath);
  for (const path of [privatePath, publicPath]) {
    if (existsSync(path)) {
      throw new BackupError(`${path} already exists; a new key would not open the backups made with it. Pick another path.`);
    }
  }
  mkdirSync(dirname(resolve(privatePath)), { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: bits,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  writeFileSync(privatePath, privateKey, { flag: "wx", mode: 0o600 });
  try {
    chmodSync(privatePath, 0o600);
  } catch {
    // Windows has no such modes; the file is in the user's own folder.
  }
  writeFileSync(publicPath, publicKey, { flag: "wx", mode: 0o644 });
  return { privatePath, publicPath, publicKey };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { privatePath, publicPath, publicKey } = keygen(process.argv[2]);
    console.error(`private key: ${privatePath}  (keep a second copy off this PC; never put it on the server)`);
    console.error(`public key:  ${publicPath}  (goes to /etc/leaflet-backup.pub on the VM)`);
    process.stdout.write(publicKey);
  } catch (error) {
    console.error(`keygen refused: ${error.message}`);
    process.exit(1);
  }
}
