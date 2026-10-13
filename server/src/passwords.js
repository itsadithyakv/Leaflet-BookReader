import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with Node's built-in scrypt — no dependency to audit.
 *
 * Stored as `scrypt$N$r$p$salt$hash` (salt and hash base64), so the cost can
 * be raised later without invalidating existing hashes: each one carries the
 * parameters it was made with.
 *
 * N = 2^15, r = 8 needs 32 MiB per hash and takes ~50–100 ms on a small host.
 * That is the cost an attacker pays per guess, and the rate limits keep it
 * from being turned against the server.
 */

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/**
 * How many hashes are worked out at once. Each holds its 32 MiB for as long
 * as it takes, outside the heap, and Node would run four side by side: 128
 * MiB on top of everything else, in a process allowed 256 (measured with
 * `scripts/load.mjs`: two dozen sign-ins arriving together added 128 MB to
 * the server, and add 64 now). Two at a time is 64 MiB at most. The rest wait their turn, which on a
 * one-core machine costs nothing: it was never doing four at once anyway.
 */
const AT_ONCE = 2;
let working = 0;
const waiting = [];

/** Runs `work` when fewer than `AT_ONCE` are running, in the order asked. */
async function inTurn(work) {
  if (working >= AT_ONCE) {
    // Woken by the one that finishes, which hands its place straight on.
    await new Promise((resolve) => waiting.push(resolve));
  } else {
    working += 1;
  }
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) {
      next();
    } else {
      working -= 1;
    }
  }
}

function derive(password, salt, n, r, p, keyLength) {
  return inTurn(
    () =>
      new Promise((resolve, reject) => {
        scrypt(
          password.normalize("NFKC"),
          salt,
          keyLength,
          // maxmem must cover 128 * N * r, with headroom.
          { N: n, r, p, maxmem: 256 * n * r },
          (error, key) => (error ? reject(error) : resolve(key))
        );
      })
  );
}

export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, N, R, P, KEY_LENGTH);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") {
    return false;
  }
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const key = await derive(password, Buffer.from(saltB64, "base64"), Number(n), Number(r), Number(p), expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/**
 * A real hash of nothing in particular, checked against when the email is
 * unknown so a failed login takes the same time either way — otherwise the
 * response time alone would say whether an account exists.
 */
let dummyHash = null;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(String(password ?? ""), dummyHash);
  return false;
}

/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(password) {
  if (typeof password !== "string") {
    return "Enter a password.";
  }
  if (password.length < PASSWORD_MIN) {
    return `Passwords need at least ${PASSWORD_MIN} characters.`;
  }
  if (password.length > PASSWORD_MAX) {
    return `Passwords can be at most ${PASSWORD_MAX} characters.`;
  }
  return null;
}
