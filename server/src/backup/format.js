import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes
} from "node:crypto";
import { readFileSync } from "node:fs";
import { Transform } from "node:stream";

/**
 * The encrypted backup file, format LFBK1. Only node:crypto.
 *
 *   "LFBK1"            5 bytes, ASCII: what this is, and which version
 *   key length         2 bytes, big-endian: n (512 for an RSA-4096 key)
 *   wrapped key        n bytes: a random 32-byte key, encrypted with the
 *                      owner's RSA public key (RSA-OAEP, SHA-256)
 *   IV                 12 bytes, random
 *   ciphertext         the gzipped NDJSON dump, AES-256-GCM, with all of the
 *                      above as additional authenticated data
 *   tag                16 bytes: GCM's, checked before anything is trusted
 *
 * The VM has only the public key: it can make a backup and never read one.
 * The private key stays with the owner (`keygen.js`). The file is then cut
 * into parts of at most 8 MB (`part-000`, `part-001`, ...); put back
 * together in order, they are this file again.
 */

export const MAGIC = Buffer.from("LFBK1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const OAEP = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" };

/** A refusal with a one-line reason, for the CLIs to print as it is. */
export class BackupError extends Error {}

/** The owner's public key, from a PEM file. Refuses a private key: the VM must never have one. */
export function loadPublicKey(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new BackupError(`cannot read the public key ${path}: ${error.code ?? error.message}`);
  }
  if (/PRIVATE KEY/.test(text)) {
    throw new BackupError(`${path} is a PRIVATE key. The server must only ever have the public one (the .pub keygen wrote).`);
  }
  let key;
  try {
    key = createPublicKey(text);
  } catch {
    throw new BackupError(`${path} is not a PEM public key`);
  }
  if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails.modulusLength < 2048) {
    throw new BackupError(`${path} is not an RSA key of 2048 bits or more`);
  }
  return key;
}

/** The owner's private key, from a PEM file. */
export function loadPrivateKey(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new BackupError(`cannot read the private key ${path}: ${error.code ?? error.message}`);
  }
  try {
    return createPrivateKey(text);
  } catch {
    throw new BackupError(`${path} is not a PEM private key`);
  }
}

/** A stream that encrypts what goes through it into an LFBK1 file. */
export function encryptor(publicKey) {
  const key = randomBytes(32);
  const iv = randomBytes(IV_BYTES);
  const wrapped = publicEncrypt({ key: publicKey, ...OAEP }, key);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(wrapped.length);
  const header = Buffer.concat([MAGIC, length, wrapped, iv]);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  let started = false;
  return new Transform({
    transform(chunk, _encoding, done) {
      if (!started) {
        started = true;
        this.push(header);
      }
      done(null, cipher.update(chunk));
    },
    flush(done) {
      if (!started) {
        this.push(header);
      }
      this.push(cipher.final());
      done(null, cipher.getAuthTag());
    }
  });
}

/**
 * A stream that decrypts an LFBK1 file. The last 16 bytes (the tag) are held
 * back until the end, and the stream fails there if anything was changed. What
 * it lets through before that is not yet proven: restore.js reads the whole
 * file once to check it before it writes anything from a second read.
 */
export function decryptor(privateKey) {
  let head = Buffer.alloc(0);
  let decipher = null;
  let tail = Buffer.alloc(0);
  return new Transform({
    transform(chunk, _encoding, done) {
      try {
        if (!decipher) {
          head = Buffer.concat([head, chunk]);
          if (head.length < MAGIC.length + 2) {
            return done();
          }
          if (!head.subarray(0, MAGIC.length).equals(MAGIC)) {
            throw new BackupError("this is not a Leaflet backup (no LFBK1 at the start), or its first part is missing");
          }
          const keyLength = head.readUInt16BE(MAGIC.length);
          const headerLength = MAGIC.length + 2 + keyLength + IV_BYTES;
          if (head.length < headerLength) {
            return done();
          }
          const wrapped = head.subarray(MAGIC.length + 2, MAGIC.length + 2 + keyLength);
          const iv = head.subarray(headerLength - IV_BYTES, headerLength);
          let key;
          try {
            key = privateDecrypt({ key: privateKey, ...OAEP }, wrapped);
          } catch {
            throw new BackupError("this private key does not open this backup (a different key made it, or its start is damaged)");
          }
          decipher = createDecipheriv("aes-256-gcm", key, iv);
          decipher.setAAD(head.subarray(0, headerLength));
          chunk = head.subarray(headerLength);
          head = null;
        }
        const data = tail.length ? Buffer.concat([tail, chunk]) : chunk;
        if (data.length <= TAG_BYTES) {
          tail = Buffer.from(data);
          return done();
        }
        tail = Buffer.from(data.subarray(data.length - TAG_BYTES));
        done(null, decipher.update(data.subarray(0, data.length - TAG_BYTES)));
      } catch (error) {
        done(error);
      }
    },
    flush(done) {
      if (!decipher || tail.length < TAG_BYTES) {
        return done(new BackupError("the backup is cut short (a part is missing or incomplete)"));
      }
      try {
        decipher.setAuthTag(tail);
        done(null, decipher.final());
      } catch {
        done(new BackupError("the backup does not pass its encryption check: a byte was changed or a part is missing or out of order"));
      }
    }
  });
}
