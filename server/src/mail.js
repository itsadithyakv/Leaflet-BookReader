/**
 * Sends password-reset codes.
 *
 * Through a Google Apps Script web app (deploy/password-reset-mailer.gs) that
 * sends from the owner's Gmail with MailApp: free, about 100 emails a day,
 * and no mail server to run. The server holds only a shared secret for that
 * script, not a Gmail password; the script sends two fixed messages and nothing
 * else, so a leaked secret can at worst send Leaflet reset emails.
 *
 * A mailer is `async (message) => void`, throwing on failure, where message is
 * `{ kind: "code", to, code, minutes }` (a reset code) or
 * `{ kind: "limit", to, availableOn }` (this year's resets are used up).
 * Tests pass their own. The Apps Script mailer also has `check()`, run when
 * the server starts (see index.js).
 */

// Apps Script is slow and uneven: a run takes 1 to 10 s (now and then far
// more) and reading its output as long again, sometimes failing first. The
// email goes out after the reader has had their answer, so waiting costs
// nobody anything.
const POST_TIMEOUT_MS = 60_000;
const READ_TIMEOUT_MS = 30_000;
const READ_TRIES = 4;
const READ_PAUSE_MS = 1_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * How a web app call works: the POST runs the script (the email is sent then)
 * and answers with a redirect to a googleusercontent.com page holding the
 * script's output. Reading that page now and then fails with Google's "unable
 * to open the file" page. So the two steps are taken by hand: the POST once,
 * never again (a second POST would send a second email), and only the read is
 * retried. When the output still cannot be read, the email was most likely
 * sent, so that is a warning, not a failure.
 */
export function appsScriptMailer({ url, secret, log = console, readPauseMs = READ_PAUSE_MS }) {
  /** One call: the POST, then the reply behind its redirect (read up to READ_TRIES times). */
  const call = async (body) => {
    const sent = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, ...body }),
      redirect: "manual",
      signal: AbortSignal.timeout(POST_TIMEOUT_MS)
    });
    const output = sent.status >= 300 && sent.status < 400 ? sent.headers.get("location") : null;
    if (!output) {
      // Answered directly: a deployment problem shows Google's HTML page here.
      const reply = parse(await sent.text());
      if (!reply) {
        throw new Error(`HTTP ${sent.status}: check the web app URL, and that the deployment's access is "Anyone"`);
      }
      return { ran: true, reply };
    }
    for (let attempt = 0; attempt < READ_TRIES; attempt += 1) {
      if (attempt > 0) {
        await sleep(readPauseMs * attempt);
      }
      try {
        const read = await fetch(new URL(output, url), { redirect: "follow", signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
        const reply = parse(await read.text());
        if (reply) {
          return { ran: true, reply };
        }
      } catch {
        // Tried again, up to READ_TRIES.
      }
    }
    // The redirect only comes once the script has run.
    return { ran: true, reply: null };
  };

  const send = async (message) => {
    // Never repeated: the POST is the email.
    const { reply } = await call(message);
    if (!reply) {
      log.warn("[leaflet] reset email: the script ran but its reply could not be read, so it could not be confirmed");
      return;
    }
    if (!reply.ok) {
      throw new Error(`mailer refused: ${reply.error ?? "no reason given"}`);
    }
  };

  /**
   * Whether the script is reachable and takes our secret, without sending
   * anything, so it can be tried as often as it takes to get an answer.
   * Resolves to a line for the log.
   */
  send.check = async (tries = 4) => {
    let last = "no answer";
    for (let attempt = 0; attempt < tries; attempt += 1) {
      try {
        const { reply } = await call({ kind: "ping" });
        if (reply?.ok) {
          return { ok: true, detail: `reset mailer ready (${reply.quotaLeft ?? "?"} emails left today)` };
        }
        if (reply) {
          return {
            ok: false,
            detail:
              reply.error === "forbidden"
                ? "reset mailer refused the secret: RESET_MAIL_SECRET must equal the script's SECRET property"
                : `reset mailer answered: ${reply.error ?? "not ok"} (is the script's latest version deployed?)`
          };
        }
        last = "the script ran but its reply could not be read";
      } catch (error) {
        last = error?.message ?? String(error);
      }
    }
    return { ok: false, detail: `reset mailer could not be checked: ${last}` };
  };

  return send;
}

/** The mailer the environment configures, or null when reset is not set up. */
export function mailerFromEnv(env = process.env) {
  const url = env.RESET_MAIL_URL?.trim();
  const secret = env.RESET_MAIL_SECRET?.trim();
  if (!url || !secret) {
    return null;
  }
  if (!url.startsWith("https://script.google.com/")) {
    throw new Error("RESET_MAIL_URL should be the Apps Script web app's https://script.google.com/... URL.");
  }
  return appsScriptMailer({ url, secret });
}
