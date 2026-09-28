/**
 * Leaflet password-reset mailer — a Google Apps Script web app.
 *
 * The Leaflet API posts here and this script sends one of two fixed emails
 * from the Gmail account that owns it (MailApp: free, about 100 recipients a
 * day on a personal account):
 *
 *   {secret, kind: "code",  to, code, minutes}  the reset code
 *   {secret, kind: "limit", to, availableOn}    this year's 3 resets are used up
 *
 * It sends nothing else, so the worst a leaked secret can do is send Leaflet
 * reset emails. Step-by-step setup: docs/deploy.md, "Password-reset emails".
 *
 * After editing this script: Deploy -> Manage deployments -> edit (pencil) ->
 * Version: New version -> Deploy. The URL stays the same.
 */

var APP_NAME = "Leaflet";
// Where a reader who has used up this year's resets can write.
var SUPPORT_EMAIL = "adithyakrishnan.vinod@gmail.com";

var CODE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var DATE = /^\d{1,2} [A-Z][a-z]+ \d{4}$/;

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (error) {
    return reply({ ok: false, error: "bad request" });
  }

  var secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret || body.secret !== secret) {
    return reply({ ok: false, error: "forbidden" });
  }

  var to = String(body.to || "").trim();
  if (to.length > 254 || !EMAIL.test(to)) {
    return reply({ ok: false, error: "bad request" });
  }
  var message = body.kind === "limit" ? limitMessage(body) : codeMessage(body);
  if (!message) {
    return reply({ ok: false, error: "bad request" });
  }
  if (MailApp.getRemainingDailyQuota() < 1) {
    return reply({ ok: false, error: "daily email quota used up" });
  }

  MailApp.sendEmail({
    to: to,
    name: APP_NAME,
    subject: message.subject,
    body: message.text,
    htmlBody: wrap(message.html)
  });
  return reply({ ok: true });
}

/** The reset code. */
function codeMessage(body) {
  var code = String(body.code || "");
  if (!CODE.test(code)) {
    return null;
  }
  var minutes = Math.min(60, Math.max(5, Math.round(Number(body.minutes) || 15)));
  return {
    subject: "Your Leaflet code: " + code,
    text:
      "Here is the code to set a new password for your Leaflet account:\n\n" +
      "    " + code + "\n\n" +
      "Type it in Leaflet (Settings -> Account). It works once, for " + minutes + " minutes.\n\n" +
      "If you didn't ask for this, ignore this email; your password stays as it is.\n\n" +
      "- Leaflet",
    html:
      "<p>Here is the code to set a new password for your Leaflet account:</p>" +
      '<p style="font-size:28px;font-weight:700;letter-spacing:4px;font-family:Consolas,Menlo,monospace;' +
      'background:#eef3e8;border-radius:8px;padding:12px 16px;display:inline-block;margin:8px 0">' +
      code + "</p>" +
      "<p>Type it in Leaflet (Settings &rarr; Account). It works once, for " + minutes + " minutes.</p>" +
      '<p style="color:#5b6b5e;font-size:13px">If you didn\'t ask for this, ignore this email; ' +
      "your password stays as it is.</p>"
  };
}

/** This year's resets are used up. */
function limitMessage(body) {
  var availableOn = String(body.availableOn || "");
  if (!DATE.test(availableOn)) {
    return null;
  }
  return {
    subject: "About resetting your Leaflet password",
    text:
      "Someone asked to reset the password of the Leaflet account for this email address.\n\n" +
      "This account's password has already been reset 3 times in the last year, which is the limit, " +
      "so no code was sent. It can be reset again on " + availableOn + ".\n\n" +
      "If you're locked out before then, write to " + SUPPORT_EMAIL + " from this address.\n\n" +
      "If you didn't ask for this, ignore this email; nothing has changed.\n\n" +
      "- Leaflet",
    html:
      "<p>Someone asked to reset the password of the Leaflet account for this email address.</p>" +
      "<p>This account's password has already been reset 3 times in the last year, which is the limit, " +
      "so no code was sent. It can be reset again on <strong>" + availableOn + "</strong>.</p>" +
      "<p>If you're locked out before then, write to " +
      '<a href="mailto:' + SUPPORT_EMAIL + '">' + SUPPORT_EMAIL + "</a> from this address.</p>" +
      '<p style="color:#5b6b5e;font-size:13px">If you didn\'t ask for this, ignore this email; ' +
      "nothing has changed.</p>"
  };
}

function wrap(inner) {
  return (
    '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#1d2a20;max-width:480px">' +
    inner +
    "<p>&mdash; Leaflet</p></div>"
  );
}

/** Opening the URL in a browser shows this: a quick check that it is deployed. */
function doGet() {
  return reply({ ok: true, service: "leaflet-mailer", quotaLeft: MailApp.getRemainingDailyQuota() });
}

function reply(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
