//! Looking up a word or a name selected in a book: its meaning from Wiktionary
//! and a short summary from Wikipedia, in one call.
//!
//! It happens here rather than in the webview because the release build's
//! Content-Security-Policy does not let the webview reach the internet.
//!
//! What leaves the device is the selected words and nothing else: not the
//! book, not the sentence around them, no account. Nothing is logged.

mod text;

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

/// A selection longer than this is a passage, not something to look up.
const MAX_WORDS: usize = 6;
const MAX_CHARS: usize = 80;
/// What the card has room for.
const MAX_ENTRIES: usize = 4;
const MAX_DEFINITIONS: usize = 3;
const MAX_EXTRACT_CHARS: usize = 700;
/// Tries per source: a word that is not there is asked for in a few other
/// forms, each a request.
const MAX_TRIES: usize = 5;
/// A lookup is something the reader waits on with the book open.
const TIMEOUT: Duration = Duration::from_secs(7);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

pub const REFUSAL: &str = "Select a word or a short phrase";

// ---- What a lookup returns ----

/// A part of speech and its first few definitions, as plain text.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
  pub part_of_speech: String,
  pub definitions: Vec<String>
}

/// The word a form points at ("houses" is the plural of "house"), with its
/// own meaning.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
  pub word: String,
  pub entries: Vec<Entry>,
  pub url: String
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Meaning {
  /// The form that was found, which may not be the form selected ("Serendipity" finds "serendipity").
  pub word: String,
  /// The language the word is in, as Wiktionary names it ("English").
  pub language: String,
  pub entries: Vec<Entry>,
  pub url: String,
  pub root: Option<Root>
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
  pub title: String,
  /// A few words on what it is ("Roman emperor from 161 to 180").
  pub description: Option<String>,
  /// Empty when `ambiguous`.
  pub extract: String,
  pub url: String,
  /// Several pages share the name; there is no one summary to give.
  pub ambiguous: bool
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Lead {
  Meaning,
  Summary
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
  Wiktionary,
  Wikipedia
}

/// Everything found for a term. Finding nothing is an answer, not an error:
/// both sides are then `None`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lookup {
  /// The term as it was looked up: trimmed, without the quotation marks or
  /// the comma the selection caught.
  pub term: String,
  pub meaning: Option<Meaning>,
  pub summary: Option<Summary>,
  /// Which of the two to show first.
  pub lead: Lead,
  /// A source that could not be reached while the other answered.
  pub missed: Vec<Source>
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
  /// Nothing was asked: the selection is empty or too long.
  Refused,
  /// Neither source could be reached (offline, or a request timed out).
  Offline,
  /// A source answered, but not with anything usable.
  Unavailable
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupError {
  pub kind: ErrorKind,
  pub message: String
}

impl LookupError {
  fn refused() -> Self {
    Self { kind: ErrorKind::Refused, message: REFUSAL.to_string() }
  }

  fn unreachable(kind: ErrorKind) -> Self {
    let message = match kind {
      ErrorKind::Offline => "Couldn't reach Wiktionary or Wikipedia. Check your connection and try again.",
      _ => "Wiktionary and Wikipedia didn't answer as expected. Try again in a moment."
    };
    Self { kind, message: message.to_string() }
  }
}

// ---- The term ----

/// The selection as a term: one space between words, and without the
/// punctuation a selection picks up at its ends (quotation marks, a comma, a
/// full stop). Empty and over-long selections are refused before any request.
pub fn clean_term(raw: &str) -> Result<String, LookupError> {
  // A book's typographic apostrophe; page titles use the plain one.
  let straight = raw.replace(['\u{2019}', '\u{02BC}', '\u{2018}'], "'");
  let squeezed = text::squeeze(&straight);
  let term = squeezed.trim_matches(|c: char| !c.is_alphanumeric()).to_string();
  if term.is_empty() || term.split(' ').count() > MAX_WORDS || term.chars().count() > MAX_CHARS {
    return Err(LookupError::refused());
  }
  Ok(term)
}

fn push_new(list: &mut Vec<String>, value: String) {
  if !value.is_empty() && !list.contains(&value) {
    list.push(value);
  }
}

fn without_possessive(term: &str) -> &str {
  term.strip_suffix("'s").or_else(|| term.strip_suffix("'S")).unwrap_or(term)
}

/// The forms to ask Wiktionary for, in order, until one has an entry: as
/// selected, lower-cased (a sentence's first word), without a possessive, and
/// for a single word, without a plural ending.
///
/// As selected comes first on purpose, and it has a cost. Wiktionary's titles
/// are case-sensitive, and many common words are also names with a page of
/// their own: "Hope" at the start of a sentence finds the given name and the
/// surname, not the feeling. Trying the lower-case form first would fix
/// that and break the opposite case, which is worse: "German" and "Polish"
/// would be answered with "german" (a near relative) and "polish". A reader
/// who selects a capitalised word gets the capitalised word; the summary
/// beside it (which leads for a capitalised word) usually covers the rest.
/// Leave the order alone unless both forms are fetched and shown.
pub fn meaning_candidates(term: &str) -> Vec<String> {
  let mut list = Vec::new();
  let lower = term.to_lowercase();
  push_new(&mut list, term.to_string());
  push_new(&mut list, lower.clone());
  push_new(&mut list, without_possessive(term).to_string());
  let base = without_possessive(&lower).to_string();
  push_new(&mut list, base.clone());
  if !base.contains(' ') && base.chars().count() > 3 && !base.ends_with("ss") {
    if let Some(stem) = base.strip_suffix("ies") {
      push_new(&mut list, format!("{stem}y"));
    }
    if let Some(stem) = base.strip_suffix('s') {
      push_new(&mut list, stem.to_string());
    }
    if let Some(stem) = base.strip_suffix("es") {
      push_new(&mut list, stem.to_string());
    }
  }
  list.truncate(MAX_TRIES);
  list
}

/// The titles to ask Wikipedia for: as selected, without a possessive, and
/// with each word capitalised (its titles are case-sensitive after the first
/// letter, so "roman empire" is not a page and "Roman Empire" is).
pub fn summary_candidates(term: &str) -> Vec<String> {
  let mut list = Vec::new();
  let base = without_possessive(term);
  push_new(&mut list, term.to_string());
  push_new(&mut list, base.to_string());
  if base.contains(' ') {
    let titled = base
      .split(' ')
      .map(|word| {
        let mut chars = word.chars();
        match chars.next() {
          Some(first) => first.to_uppercase().chain(chars).collect::<String>(),
          None => String::new()
        }
      })
      .collect::<Vec<_>>()
      .join(" ");
    push_new(&mut list, titled);
  }
  list
}

// ---- The language ----

/// A language as a wiki's subdomain: two or three lower-case letters and
/// nothing else, so that whatever a book claims its language is can never
/// change the host a request goes to.
#[derive(Debug, Clone, PartialEq)]
pub struct Lang(String);

impl Lang {
  /// From a book's language tag ("en-US", "fr", "eng"); English when there is
  /// none or it is not one.
  pub fn from_book(tag: Option<&str>) -> Self {
    let primary = tag
      .unwrap_or("")
      .trim()
      .split(['-', '_'])
      .next()
      .unwrap_or("")
      .to_ascii_lowercase();
    if !primary.chars().all(|c| c.is_ascii_lowercase()) {
      return Self::english();
    }
    let code = match primary.len() {
      2 => primary.as_str(),
      // Older books name their language with three letters.
      3 => match primary.as_str() {
        "eng" => "en",
        "fre" | "fra" => "fr",
        "ger" | "deu" => "de",
        "spa" => "es",
        "ita" => "it",
        "por" => "pt",
        "dut" | "nld" => "nl",
        "rus" => "ru",
        "lat" => "la",
        "swe" => "sv",
        "dan" => "da",
        "nor" => "no",
        "fin" => "fi",
        "pol" => "pl",
        "jpn" => "ja",
        "chi" | "zho" => "zh",
        "gre" | "ell" => "el",
        // Undetermined, several, or none at all.
        "und" | "mul" | "zxx" => "en",
        other => other
      },
      _ => "en"
    };
    Self(code.to_string())
  }

  pub fn english() -> Self {
    Self("en".to_string())
  }

  pub fn code(&self) -> &str {
    &self.0
  }

  fn is_english(&self) -> bool {
    self.0 == "en"
  }
}

// ---- Addresses ----

/// The term as one segment of a URL's path. It is the reader's text, so
/// everything but letters, digits and `-_.~` is percent-encoded: a slash, `?`
/// or `#` in it cannot start a new segment, a query or a fragment. A segment
/// of only dots would mean "this folder" or "the one above" to a URL parser,
/// and has no page; there is nothing to ask for.
fn path_segment(term: &str) -> Option<String> {
  let term = term.trim();
  if term.is_empty() || term.chars().all(|c| c == '.') {
    return None;
  }
  Some(urlencoding::encode(term).into_owned())
}

/// Where Wiktionary's definitions of a term are. Only the English Wiktionary
/// answers this (the others reply 501); its entries cover words of every
/// language, grouped by language.
fn definition_url(term: &str) -> Option<String> {
  path_segment(term).map(|segment| format!("https://en.wiktionary.org/api/rest_v1/page/definition/{segment}"))
}

fn summary_url(lang: &Lang, title: &str) -> Option<String> {
  path_segment(title).map(|segment| format!("https://{}.wikipedia.org/api/rest_v1/page/summary/{segment}", lang.code()))
}

/// The pages a reader is sent to for more. Built here from the title, never
/// taken from a response.
fn wiktionary_page(word: &str, language: &str) -> String {
  let page = urlencoding::encode(&word.replace(' ', "_")).into_owned();
  let section = urlencoding::encode(&language.replace(' ', "_")).into_owned();
  format!("https://en.wiktionary.org/wiki/{page}#{section}")
}

fn wikipedia_page(lang: &Lang, title: &str) -> String {
  format!("https://{}.wikipedia.org/wiki/{}", lang.code(), urlencoding::encode(&title.replace(' ', "_")))
}

// ---- Reading Wiktionary's answer ----

#[derive(Debug, Deserialize)]
struct RawEntry {
  #[serde(rename = "partOfSpeech", default)]
  part_of_speech: String,
  #[serde(default)]
  language: String,
  #[serde(default)]
  definitions: Vec<RawDefinition>
}

#[derive(Debug, Deserialize)]
struct RawDefinition {
  #[serde(default)]
  definition: String
}

/// A word's entries in one language, and the word they point at if they only
/// say "plural of X".
#[derive(Debug, PartialEq)]
struct Definitions {
  language: String,
  entries: Vec<Entry>,
  form_of: Option<String>
}

/// The word a definition is a form of, when that is all it says ("plural of
/// house", "simple past of run"). Wiktionary marks these, and the word they
/// point at, with classes of their own.
fn form_of(definition: &str) -> Option<String> {
  if !definition.contains("form-of-definition") {
    return None;
  }
  let link = &definition[definition.find("form-of-definition-link")?..];
  let anchor = &link[link.find("<a ")?..];
  let tag = &anchor[..anchor.find('>')?];
  let word = text::decode_entities(text::attribute(tag, "title")?);
  let word = word.trim();
  // A title with a namespace ("Appendix:Glossary") is not a word.
  (!word.is_empty() && !word.contains(':')).then(|| word.to_string())
}

/// The entries for the book's language, or failing that for English. A word
/// that exists only in some third language is not what the reader selected.
fn parse_definitions(body: &str, word: &str, lang: &Lang) -> Result<Option<Definitions>, serde_json::Error> {
  let sections: HashMap<String, Vec<RawEntry>> = serde_json::from_str(body)?;
  for code in [lang.code(), "en"] {
    let Some(raw) = sections.get(code) else {
      continue;
    };
    // "Translingual" entries (a symbol, a language code) share the English
    // section; they are only worth showing when there is nothing else.
    let has_words = raw.iter().any(|entry| entry.language != "Translingual");
    let mut entries = Vec::new();
    let mut target = None;
    for entry in raw.iter().filter(|entry| !has_words || entry.language != "Translingual") {
      let mut definitions = Vec::new();
      let mut forms = Vec::new();
      for item in &entry.definitions {
        let plain = text::plain(&item.definition);
        // Sub-senses come through as empty lines of their own.
        if plain.is_empty() || definitions.contains(&plain) {
          continue;
        }
        forms.push(form_of(&item.definition));
        definitions.push(plain);
      }
      if definitions.is_empty() {
        continue;
      }
      // The first part of speech that is nothing but "a form of X" names
      // the word to follow.
      if target.is_none() && forms.iter().all(Option::is_some) {
        target = forms.into_iter().flatten().find(|found| found != word);
      }
      definitions.truncate(MAX_DEFINITIONS);
      entries.push(Entry { part_of_speech: text::squeeze(&entry.part_of_speech), definitions });
    }
    if entries.is_empty() {
      continue;
    }
    entries.truncate(MAX_ENTRIES);
    let language = raw
      .iter()
      .map(|entry| entry.language.as_str())
      .find(|name| !name.is_empty() && (!has_words || *name != "Translingual"))
      .unwrap_or("English");
    return Ok(Some(Definitions { language: text::squeeze(language), entries, form_of: target }));
  }
  Ok(None)
}

// ---- Reading Wikipedia's answer ----

#[derive(Debug, Deserialize)]
struct RawSummary {
  #[serde(rename = "type", default)]
  kind: String,
  #[serde(default)]
  title: String,
  #[serde(default)]
  description: Option<String>,
  #[serde(default)]
  extract: String
}

/// A page's summary. A page that only lists other pages of the same name is
/// reported as ambiguous, without its list; a page with nothing to say is no
/// summary at all.
fn parse_summary(body: &str, lang: &Lang) -> Result<Option<Summary>, serde_json::Error> {
  let raw: RawSummary = serde_json::from_str(body)?;
  let title = text::squeeze(&raw.title);
  if title.is_empty() {
    return Ok(None);
  }
  let url = wikipedia_page(lang, &title);
  if raw.kind == "disambiguation" {
    return Ok(Some(Summary { title, description: None, extract: String::new(), url, ambiguous: true }));
  }
  let extract = text::clip(&text::squeeze(&raw.extract), MAX_EXTRACT_CHARS);
  if raw.kind != "standard" || extract.is_empty() {
    return Ok(None);
  }
  let description = raw.description.map(|value| text::squeeze(&value)).filter(|value| !value.is_empty());
  Ok(Some(Summary { title, description, extract, url, ambiguous: false }))
}

// ---- Which side leads ----

/// A name or a phrase is something to read about; a plain word is something
/// to define. Several words, or a capital letter, make it the former. Either
/// way the side that leads has to exist, and a page that only says "this name
/// is ambiguous" does not go ahead of a real meaning.
fn lead(term: &str, meaning: Option<&Meaning>, summary: Option<&Summary>) -> Lead {
  let about_first = term.contains(' ') || term.chars().next().is_some_and(char::is_uppercase);
  match (meaning, summary) {
    (Some(_), None) => Lead::Meaning,
    (None, Some(_)) => Lead::Summary,
    (Some(_), Some(found)) if found.ambiguous => Lead::Meaning,
    _ if about_first => Lead::Summary,
    _ => Lead::Meaning
  }
}

// ---- The network ----

enum Fetched {
  Found(String),
  /// The source answered that it has no such page.
  Missing,
  Unreachable(ErrorKind)
}

/// What one source had: something, nothing, or no answer.
#[derive(Debug, PartialEq)]
enum Side<T> {
  Found(T),
  Missing,
  Unreachable(ErrorKind)
}

fn client() -> Result<&'static Client, LookupError> {
  static CLIENT: OnceLock<Client> = OnceLock::new();
  if let Some(client) = CLIENT.get() {
    return Ok(client);
  }
  let built = Client::builder()
    // Wikimedia asks API users to say who is calling and how to reach them.
    .user_agent(crate::http::user_agent())
    .timeout(TIMEOUT)
    .connect_timeout(CONNECT_TIMEOUT)
    .https_only(true)
    // A redirect (to a page's proper title) stays with the two sources.
    .redirect(reqwest::redirect::Policy::custom(|attempt| {
      let stays = attempt.url().host_str().is_some_and(|host| host.ends_with(".wikipedia.org") || host.ends_with(".wiktionary.org"));
      if stays && attempt.previous().len() < 4 {
        attempt.follow()
      } else {
        attempt.stop()
      }
    }))
    .build()
    .map_err(|_| LookupError::unreachable(ErrorKind::Unavailable))?;
  Ok(CLIENT.get_or_init(|| built))
}

async fn get(client: &Client, url: &str) -> Fetched {
  let response = match client.get(url).send().await {
    Ok(response) => response,
    Err(_) => return Fetched::Unreachable(ErrorKind::Offline)
  };
  match response.status() {
    StatusCode::OK => match response.text().await {
      Ok(body) => Fetched::Found(body),
      Err(_) => Fetched::Unreachable(ErrorKind::Offline)
    },
    // No such page; a title the API will not take is no page either.
    StatusCode::NOT_FOUND | StatusCode::BAD_REQUEST => Fetched::Missing,
    _ => Fetched::Unreachable(ErrorKind::Unavailable)
  }
}

async fn definitions_of(client: &Client, word: &str, lang: &Lang) -> Side<Definitions> {
  let Some(url) = definition_url(word) else {
    return Side::Missing;
  };
  match get(client, &url).await {
    Fetched::Found(body) => match parse_definitions(&body, word, lang) {
      Ok(Some(found)) => Side::Found(found),
      Ok(None) => Side::Missing,
      Err(_) => Side::Unreachable(ErrorKind::Unavailable)
    },
    Fetched::Missing => Side::Missing,
    Fetched::Unreachable(kind) => Side::Unreachable(kind)
  }
}

async fn find_meaning(client: &Client, term: &str, lang: &Lang) -> Side<Meaning> {
  for word in meaning_candidates(term) {
    match definitions_of(client, &word, lang).await {
      Side::Found(found) => {
        // "houses" says only "plural of house": one hop, so the reader gets
        // what a house is as well. One hop and no further.
        let root = match &found.form_of {
          Some(target) => match definitions_of(client, target, lang).await {
            Side::Found(of) => Some(Root { word: target.clone(), url: wiktionary_page(target, &of.language), entries: of.entries }),
            _ => None
          },
          None => None
        };
        return Side::Found(Meaning {
          url: wiktionary_page(&word, &found.language),
          word,
          language: found.language,
          entries: found.entries,
          root
        });
      }
      Side::Missing => continue,
      // No answer: asking again in another form would only wait again.
      Side::Unreachable(kind) => return Side::Unreachable(kind)
    }
  }
  Side::Missing
}

async fn find_summary(client: &Client, term: &str, lang: &Lang) -> Side<Summary> {
  // The Wikipedia in the book's language first, then the English one.
  let mut wikis = vec![lang.clone()];
  if !lang.is_english() {
    wikis.push(Lang::english());
  }
  let last = wikis.len() - 1;
  'wikis: for (index, wiki) in wikis.iter().enumerate() {
    for title in summary_candidates(term) {
      let Some(url) = summary_url(wiki, &title) else {
        continue;
      };
      match get(client, &url).await {
        Fetched::Found(body) => match parse_summary(&body, wiki) {
          Ok(Some(found)) => return Side::Found(found),
          Ok(None) => continue,
          Err(_) if index < last => continue 'wikis,
          Err(_) => return Side::Unreachable(ErrorKind::Unavailable)
        },
        Fetched::Missing => continue,
        // A language with no Wikipedia of its own fails here; English may still answer.
        Fetched::Unreachable(_) if index < last => continue 'wikis,
        Fetched::Unreachable(kind) => return Side::Unreachable(kind)
      }
    }
  }
  Side::Missing
}

/// Puts the two sides together. One source failing does not hide what the
/// other found; it is an error only when nothing was found and a source
/// could not be asked, since "nothing found" would not be true.
fn combine(term: String, meaning: Side<Meaning>, summary: Side<Summary>) -> Result<Lookup, LookupError> {
  let mut missed = Vec::new();
  let mut failure = None;
  let meaning = match meaning {
    Side::Found(found) => Some(found),
    Side::Missing => None,
    Side::Unreachable(kind) => {
      missed.push(Source::Wiktionary);
      failure = Some(kind);
      None
    }
  };
  let summary = match summary {
    Side::Found(found) => Some(found),
    Side::Missing => None,
    Side::Unreachable(kind) => {
      missed.push(Source::Wikipedia);
      // "Offline" is the more useful thing to be told of the two.
      if failure != Some(ErrorKind::Offline) {
        failure = Some(kind);
      }
      None
    }
  };
  if meaning.is_none() && summary.is_none() {
    if let Some(kind) = failure {
      return Err(LookupError::unreachable(kind));
    }
  }
  let lead = lead(&term, meaning.as_ref(), summary.as_ref());
  Ok(Lookup { term, meaning, summary, lead, missed })
}

/// Looks a selection up: both sources at once, each trying a few forms of
/// the term in turn.
pub async fn look_up(selection: &str, language: Option<&str>) -> Result<Lookup, LookupError> {
  let term = clean_term(selection)?;
  let lang = Lang::from_book(language);
  let client = client()?;
  let (meaning, summary) = tokio::join!(find_meaning(client, &term, &lang), find_summary(client, &term, &lang));
  combine(term, meaning, summary)
}

#[cfg(test)]
mod tests;
