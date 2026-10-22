//! Diagnostics: the interface's errors in the log, and the report for support.

use super::*;

// ---- diagnostics ----------------------------------------------------------------

/// Records an error from the webview (a crashed screen, an unhandled rejection)
/// in the log, so it survives past a devtools console the release build lacks.
#[tauri::command]
pub fn log_client_error(message: String) {
  crate::diag::write("WEB", &message);
}

/// A plain-text report for Settings → "Copy diagnostics": versions, where the
/// data lives, what is switched on, and the end of the log. No tokens, emails
/// or book contents; file paths and error messages may name book files.
#[tauri::command(async)]
pub fn diagnostics(state: State<'_, AppState>) -> Result<String, String> {
  let db = state.db.guard();
  let books = db.list_books().map(|books| books.len()).unwrap_or(0);
  let sessions = db.focus_sessions().map(|sessions| sessions.len()).unwrap_or(0);
  let folder = db.get_setting(FOLDER_SETTING).ok().flatten().filter(|value| !value.is_empty()).is_some();
  let drive = drive::load_refresh_token(&db).ok().flatten().is_some();
  let account = crate::sync::cloud::signed_in(&db);
  let schema = db.schema_version();
  // On or off only: where the copies go is the reader's business. From the
  // settings, without looking at the folder: this runs on the window's thread
  // with the database locked, and an unreachable network share is slow to answer.
  let copies = copies_on(&db);
  let data_dir = crate::storage::app_data_dir().map(|dir| dir.display().to_string()).unwrap_or_default();
  // Which library is open, and whose: the owner by its first six digits only.
  let library_dir = db.path().parent().map(|dir| dir.display().to_string()).unwrap_or_default();
  let standing = crate::sync::owner::standing(&db);
  let owner = crate::sync::owner::get(&db).map(|tag| format!("{}…", &tag[..6])).unwrap_or_else(|| "nobody".to_string());
  drop(db);
  let lines = [
    format!("Leaflet {}", env!("CARGO_PKG_VERSION")),
    format!("Build: {}", if cfg!(debug_assertions) { "debug" } else { "release" }),
    format!("System: {} {}", std::env::consts::OS, std::env::consts::ARCH),
    format!("Packaged (Microsoft Store/MSIX): {}", crate::reminders::packaged()),
    format!("Data folder: {data_dir}"),
    format!("Library: {library_dir} (owner {owner}, {standing:?})"),
    format!("Database schema: v{schema} (this build expects v{})", crate::db::SCHEMA_VERSION),
    format!("Books: {books}, focus sessions: {sessions}"),
    format!("Backup: Drive {}, folder {}, Leaflet account {}", on_off(drive), on_off(folder), on_off(account)),
    format!("Book copies in a folder: {}", on_off(copies)),
    format!("Report made: {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S %z")),
    String::new(),
    "Recent log:".to_string(),
    crate::diag::tail(200)
  ];
  Ok(lines.join("
"))
}

/// Where "Report a problem" writes: `SUPPORT_EMAIL` in `apps/src/constants/links.ts`.
const SUPPORT_EMAIL: &str = "adithyakrishnan.vinod@gmail.com";

/// The letter "Report a problem" starts: to support, with the version and the
/// platform in its subject. The diagnostics are not in it: the page has just
/// put them on the clipboard. A mail link holds only so much, and the report
/// is the reader's to look over before it goes.
pub(crate) fn problem_mail() -> String {
  let platform = if cfg!(target_os = "android") {
    "Android"
  } else if cfg!(windows) {
    "Windows"
  } else {
    std::env::consts::OS
  };
  let subject = format!("Leaflet {} problem ({platform})", env!("CARGO_PKG_VERSION"));
  // Lines in a mail link end CRLF (RFC 6068).
  let body = concat!(
    "What happened:\r\n\r\n\r\n",
    "The diagnostics are on your clipboard: paste them here.\r\n"
  );
  let (subject, body) = (urlencoding::encode(&subject), urlencoding::encode(body));
  format!("mailto:{SUPPORT_EMAIL}?subject={subject}&body={body}")
}

/// Opens the reader's mail app on that letter. The address is fixed here, as
/// the Store's review is, so this command can open nothing else.
#[tauri::command]
pub fn report_problem(app: tauri::AppHandle) -> Result<(), String> {
  tauri_plugin_opener::OpenerExt::opener(&app)
    .open_url(problem_mail(), None::<&str>)
    .map_err(|error| format!("Could not open your email app: {error}"))
}

// ---- a problem report, sent to the server ---------------------------------------
//
// "Report a problem" sends the reader's words, and the diagnostics if they
// leave them in, to the Leaflet server (`POST /v1/problems`), where the owner
// reads them in the app's Admin section. Signed in or not: signed out, an
// address for a reply may go with it. The server holds to the same limits
// as these; they are kept here as well, so a report is never refused for
// being too long after the reader has pressed Send.

/// The longest message, in characters, and the most diagnostics, in bytes.
pub(crate) const PROBLEM_MESSAGE_MAX: usize = 2000;
pub(crate) const PROBLEM_DIAGNOSTICS_MAX: usize = 64 * 1024;
/// Where the log begins in the report (`diagnostics` above).
const LOG_MARK: &str = "\nRecent log:\n";
/// What stands in for the log lines left out of a report too long to send.
const LEFT_OUT: &str = "[earlier lines left out]\n";

/// The platform as the server names it.
fn problem_platform() -> &'static str {
  match std::env::consts::OS {
    "windows" => "windows",
    "android" => "android",
    "macos" => "macos",
    _ => "linux"
  }
}

/// The diagnostics as they are sent: without control characters (but for
/// line breaks and tabs), and no more than the server takes. A report too
/// long keeps its head (versions, what is switched on) and the newest lines
/// of the log, leaving out the oldest, since the newest are what happened.
pub(crate) fn fit_diagnostics(report: &str) -> String {
  let clean: String = report
    .replace("\r\n", "\n")
    .chars()
    .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
    .collect();
  if clean.len() <= PROBLEM_DIAGNOSTICS_MAX {
    return clean;
  }
  let (head, log) = match clean.find(LOG_MARK) {
    Some(at) => clean.split_at(at + LOG_MARK.len()),
    None => ("", clean.as_str())
  };
  // A head too long by itself (it never is) gives up its end too.
  let head = cut_to(head, PROBLEM_DIAGNOSTICS_MAX / 4);
  let room = PROBLEM_DIAGNOSTICS_MAX - head.len() - LEFT_OUT.len();
  let mut start = log.len().saturating_sub(room);
  while !log.is_char_boundary(start) {
    start += 1;
  }
  // From the start of a line, so none is cut in half.
  let tail = &log[start..];
  let tail = match tail.find('\n') {
    Some(at) if start > 0 => &tail[at + 1..],
    _ => tail
  };
  format!("{head}{LEFT_OUT}{tail}")
}

/// At most `max` bytes of `text`, cut at a character.
fn cut_to(text: &str, max: usize) -> &str {
  let mut end = text.len().min(max);
  while !text.is_char_boundary(end) {
    end -= 1;
  }
  &text[..end]
}

/// Whether an address for a reply looks like one: something@something.tld.
fn looks_like_email(text: &str) -> bool {
  let Some((name, domain)) = text.split_once('@') else {
    return false;
  };
  let (host, tld) = domain.rsplit_once('.').unwrap_or(("", ""));
  text.len() <= 254
    && !text.chars().any(char::is_whitespace)
    && !name.is_empty()
    && !domain.contains('@')
    && !host.is_empty()
    && !tld.is_empty()
}

/// What a problem report sends: the message, the diagnostics when they are
/// included (fitted to the server's limit), this build's version and
/// platform, and an address for a reply only from a reader signed out (one
/// signed in is answered through their account). Refuses what the server
/// would, in the words the sheet shows.
pub(crate) fn problem_body(
  message: &str,
  diagnostics: Option<&str>,
  contact: Option<&str>,
  signed_in: bool
) -> Result<serde_json::Value, String> {
  let message = message.trim();
  if message.is_empty() {
    return Err("Say what happened first.".to_string());
  }
  if message.chars().count() > PROBLEM_MESSAGE_MAX {
    return Err(format!("That's more than {PROBLEM_MESSAGE_MAX} characters."));
  }
  let mut body = serde_json::json!({
    "message": message,
    "diagnostics": diagnostics.map(fit_diagnostics).filter(|text| !text.trim().is_empty()),
    "version": env!("CARGO_PKG_VERSION"),
    "platform": problem_platform()
  });
  let contact = contact.map(str::trim).filter(|text| !text.is_empty() && !signed_in);
  if let Some(contact) = contact {
    if !looks_like_email(contact) {
      return Err("That email address doesn't look right.".to_string());
    }
    body["contact"] = serde_json::json!(contact.to_lowercase());
  }
  Ok(body)
}

/// The diagnostics exactly as a problem report would send them, for the sheet
/// to show before it is sent.
#[tauri::command(async)]
pub fn problem_diagnostics(state: State<'_, AppState>) -> Result<String, String> {
  let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
  diagnostics(state).map(|report| fit_diagnostics(&without_home(&report, &home)))
}

/// A report sent to us says `~` for the reader's home folder, which on a
/// computer is named after them (`C:\Users\<name>`). Copied by hand, the
/// report is the reader's own and stays as it is.
pub(crate) fn without_home(report: &str, home: &str) -> String {
  let home = home.trim_end_matches(['\\', '/']);
  // A bare root ("/", "C:") would turn every path into nonsense.
  if home.len() < 4 {
    return report.to_string();
  }
  let forward = home.replace('\\', "/");
  report.replace(home, "~").replace(&forward, "~")
}

/// Sends a problem report to the Leaflet server. `diagnostics` is what the
/// sheet showed (`problem_diagnostics`), or nothing when the reader left
/// them out. Works signed out; fails, in a sentence, when there is no server,
/// it cannot be reached, is too old to take one, or says no.
#[tauri::command]
pub async fn send_problem(
  message: String,
  diagnostics: Option<String>,
  contact: Option<String>,
  state: State<'_, AppState>
) -> Result<(), String> {
  let signed_in = cloud::signed_in(&state.db.guard());
  let body = problem_body(&message, diagnostics.as_deref(), contact.as_deref(), signed_in)?;
  cloud::send_problem(&state.db, body).await.map_err(|e| e.to_string())
}

pub(crate) fn on_off(value: bool) -> &'static str {
  if value {
    "on"
  } else {
    "off"
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_report_sent_to_us_does_not_name_the_reader_by_their_home_folder() {
    let report = "Data folder: C:\\Users\\Ada\\AppData\\Roaming\\com.leaflet.app\n\
                  opened C:/Users/Ada/Books/x.epub";
    let sent = without_home(report, "C:\\Users\\Ada");
    assert!(!sent.contains("Ada"), "{sent}");
    assert!(sent.contains("~\\AppData") && sent.contains("~/Books"), "{sent}");
    assert_eq!(without_home("a /x path", "/"), "a /x path");
  }

  /// No session, no server: the body is made from what the sheet gives and
  /// this build, so a reader signed out can send one.
  #[test]
  fn a_problem_report_is_the_words_the_build_and_an_address_only_when_signed_out() {
    let body = problem_body("  It froze.  ", Some("Leaflet 1.5.7\nRecent log:\nok"), None, false)
      .expect("a body");
    assert_eq!(
      body,
      serde_json::json!({
        "message": "It froze.",
        "diagnostics": "Leaflet 1.5.7\nRecent log:\nok",
        "version": env!("CARGO_PKG_VERSION"),
        "platform": problem_platform()
      })
    );
    assert!(["windows", "android", "macos", "linux"].contains(&problem_platform()));

    // Left out, the diagnostics go as nothing.
    let bare = problem_body("It froze.", None, None, false).expect("a body");
    assert_eq!(bare["diagnostics"], serde_json::Value::Null);

    // Signed out, an address for a reply goes along, lower case.
    let reply = problem_body("It froze.", None, Some(" Me@Example.com "), false).expect("a body");
    assert_eq!(reply["contact"], "me@example.com");
    // Signed in, it does not: the account is who to answer.
    let mine = problem_body("It froze.", None, Some("me@example.com"), true).expect("a body");
    assert!(mine.get("contact").is_none(), "{mine}");
    // Nothing typed is no address.
    let blank = problem_body("It froze.", None, Some("  "), false).expect("a body");
    assert!(blank.get("contact").is_none());
  }

  #[test]
  fn a_problem_report_is_refused_here_for_what_the_server_would_refuse() {
    assert!(problem_body("   ", None, None, false).is_err());
    let longest = "x".repeat(PROBLEM_MESSAGE_MAX);
    assert!(problem_body(&longest, None, None, false).is_ok());
    let longer = format!("{longest}y");
    assert!(problem_body(&longer, None, None, false).expect_err("too long").contains("2000"));
    // Characters, not bytes: 2000 accented letters are fine.
    assert!(problem_body(&"é".repeat(PROBLEM_MESSAGE_MAX), None, None, false).is_ok());
    for address in ["me", "me@", "@example.com", "me@example", "me @example.com", "a@b@c.com"] {
      assert!(problem_body("It froze.", None, Some(address), false).is_err(), "took {address}");
    }
    // A wrong address does not matter signed in: it is not sent.
    assert!(problem_body("It froze.", None, Some("me"), true).is_ok());
  }

  /// Too long to send, a report keeps its head and its newest log lines, and
  /// fits; it never loses a character in the middle, and its control
  /// characters go, but for line breaks and tabs.
  #[test]
  fn the_diagnostics_sent_fit_the_servers_limit() {
    let head = "Leaflet 1.5.7\nBooks: 3\n";
    let line = |n: usize| format!("line {n:04} é {}", "x".repeat(20));
    let lines: Vec<String> = (0..4000).map(line).collect();
    let report = format!("{head}{}{}", LOG_MARK.trim_start_matches('\n'), lines.join("\n"));
    let fitted = fit_diagnostics(&report);
    assert!(fitted.len() <= PROBLEM_DIAGNOSTICS_MAX, "{}", fitted.len());
    assert!(fitted.starts_with(&format!("{head}Recent log:\n{LEFT_OUT}")), "{}", &fitted[..80]);
    assert!(fitted.ends_with(&lines[3999]));
    assert!(!fitted.contains("line 0000"));
    // Whole lines only, after the mark.
    let after = fitted.split(LEFT_OUT).nth(1).expect("the log");
    assert!(after.lines().all(|line| line.starts_with("line ")), "{}", &after[..60]);
    let body = problem_body("It froze.", Some(&report), None, false).expect("a body");
    assert!(body["diagnostics"].as_str().expect("text").len() <= PROBLEM_DIAGNOSTICS_MAX);

    // A short one is sent as it is, less what a terminal would act on.
    assert_eq!(fit_diagnostics("a\r\nb\tc\u{1b}[0m\u{7}"), "a\nb\tc[0m");
    // Fitted once, fitting again changes nothing: the sheet shows what goes.
    assert_eq!(fit_diagnostics(&fitted), fitted);
  }

  /// To support, with the version and the platform in the subject, and no
  /// diagnostics in the link: they go by the clipboard.
  #[test]
  fn the_problem_letter_names_the_version_and_carries_no_report() {
    let mail = problem_mail();
    let (address, query) = mail.split_once('?').expect("a subject and a body");
    assert_eq!(address, "mailto:adithyakrishnan.vinod@gmail.com");
    let field = |name: &str| {
      let key = format!("{name}=");
      let value = query.split('&').find_map(|pair| pair.strip_prefix(&key)).expect(name);
      urlencoding::decode(value).expect("encoded").into_owned()
    };
    let platform = if cfg!(windows) { "Windows" } else { std::env::consts::OS };
    let version = env!("CARGO_PKG_VERSION");
    assert_eq!(field("subject"), format!("Leaflet {version} problem ({platform})"));
    let body = field("body");
    assert!(body.ends_with("The diagnostics are on your clipboard: paste them here.\r\n"));
    assert!(!mail.contains("Recent log") && mail.len() < 300, "{mail}");
  }
}
