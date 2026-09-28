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
 * Tests pass their own.
 */

export function appsScriptMailer({ url, secret, timeoutMs = 15_000 }) {
  return async (message) => {
    // Apps Script answers a POST with a redirect to the script's output, which
    // fetch follows as a GET (as the web app expects).
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, ...message }),
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    let reply = null;
    try {
      reply = JSON.parse(text);
    } catch {
      // Apps Script shows an HTML page when the deployment is wrong (not
      // "Anyone" access, or the URL of an old version).
    }
    if (!response.ok || !reply?.ok) {
      throw new Error(`mailer refused: ${reply?.error ?? `HTTP ${response.status}`}`);
    }
  };
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
