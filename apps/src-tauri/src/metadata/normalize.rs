//! What a book is called: its title, author, series and genres, from what the
//! file says about itself and, failing that, from what the file is named.
//!
//! Both are messy in the ways real libraries are. A file from the wild is
//! named for where it came from ("Dune (Frank Herbert) (z-library.sk, 1lib.sk,
//! z-lib.sk)", "Title -- Author -- 1st ed, New York, ©2008 -- Knopf -- ISBN --
//! hash -- Anna's Archive"), and the metadata inside is often the same file
//! name pasted in ("Brown, Pierce - Red Rising 02 - Golden Son 02"), an author
//! sorted for a catalogue ("Brown, Pierce", "Brandon Sanderson [Sanderson,
//! Brandon]") or a shop's listing ("Red Rising (The Red Rising Trilogy, Book
//! 1)"). The rules here undo those shapes and nothing else: a real title may
//! hold a dash, brackets, a number, "Book 1" or a subtitle, and is left whole.
//!
//! Readers cannot edit a title, so everything stored is what this file made of
//! the book; `identify_stored` applies the same rules to a book already in the
//! library.

use regex::Regex;
use std::sync::LazyLock;

#[derive(Debug, Clone)]
pub struct NormalizedQuery {
  pub title: String,
  pub author: Option<String>,
  pub isbn: Option<String>
}

/// What a book is called in the library.
#[derive(Debug, Clone, PartialEq)]
pub struct Identity {
  pub title: String,
  pub author: Option<String>,
  pub series: Option<String>,
  pub series_index: Option<f32>,
  pub genres: Vec<String>
}

// ---- text -------------------------------------------------------------------

fn collapse_spaces(input: &str) -> String {
  let mut out = String::with_capacity(input.len());
  let mut last_space = false;
  for ch in input.chars() {
    if ch.is_whitespace() {
      if !last_space {
        out.push(' ');
        last_space = true;
      }
    } else {
      out.push(ch);
      last_space = false;
    }
  }
  out.trim().to_string()
}

static ENTITY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});").expect("entity"));

/// `&amp;`, `&#8217;` and the like, left in a title by a careless export (the
/// XML parser has already undone one layer; a second is common).
fn decode_entities(text: &str) -> String {
  if !text.contains('&') {
    return text.to_string();
  }
  let once = |input: &str| {
    ENTITY
      .replace_all(input, |caps: &regex::Captures<'_>| {
        let name = &caps[1];
        let code = if let Some(hex) = name.strip_prefix("#x").or_else(|| name.strip_prefix("#X")) {
          u32::from_str_radix(hex, 16).ok()
        } else if let Some(decimal) = name.strip_prefix('#') {
          decimal.parse::<u32>().ok()
        } else {
          match name.to_ascii_lowercase().as_str() {
            "amp" => Some('&' as u32),
            "lt" => Some('<' as u32),
            "gt" => Some('>' as u32),
            "quot" => Some('"' as u32),
            "apos" => Some('\'' as u32),
            "nbsp" => Some(' ' as u32),
            "ndash" => Some(0x2013),
            "mdash" => Some(0x2014),
            "lsquo" => Some(0x2018),
            "rsquo" => Some(0x2019),
            "ldquo" => Some(0x201C),
            "rdquo" => Some(0x201D),
            "hellip" => Some(0x2026),
            "eacute" => Some(0xE9),
            _ => None
          }
        };
        code
          .and_then(char::from_u32)
          .filter(|ch| !ch.is_control())
          .map(String::from)
          .unwrap_or_else(|| caps[0].to_string())
      })
      .into_owned()
  };
  once(&once(text))
}

/// Words that stay small inside a title.
const SMALL_WORDS: [&str; 18] = [
  "a", "an", "the", "and", "but", "or", "nor", "for", "of", "in", "on", "at", "to", "by", "with", "from", "as", "vs"
];
/// Short words without a vowel that are not acronyms.
const ABBREVIATIONS: [&str; 8] = ["mr", "mrs", "ms", "dr", "st", "jr", "sr", "vs"];

/// II to XXXIX: a king's or a volume's number.
static ROMAN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^X{0,3}(?:IX|IV|V?I{0,3})$").expect("roman"));

/// "DARK AGE" as "Dark Age". Only a text written wholly in capitals is
/// touched; initials, Roman numerals and short words with no vowel (an
/// acronym: BFG, HTML) keep theirs.
fn undo_capitals(text: &str, title: bool) -> String {
  let letters: Vec<char> = text.chars().filter(|ch| ch.is_alphabetic()).collect();
  let shouting = letters.len() >= 4
    && letters.iter().any(|ch| ch.is_uppercase())
    && letters.iter().all(|ch| !ch.is_lowercase())
    && text.split_whitespace().any(|word| word.chars().filter(|ch| ch.is_alphabetic()).count() >= 3);
  if !shouting {
    return text.to_string();
  }
  let mut first = true;
  let mut after_colon = false;
  text
    .split(' ')
    .map(|word| {
      let bare: String = word.chars().filter(|ch| ch.is_alphabetic()).collect();
      let lower = bare.to_lowercase();
      let size = bare.chars().count();
      let keep = size <= 1
        || (title && size >= 2 && ROMAN.is_match(&bare))
        || (size <= 5 && !lower.chars().any(|ch| "aeiouy".contains(ch)) && !ABBREVIATIONS.contains(&lower.as_str()));
      let out = if keep {
        word.to_string()
      } else if title && !first && !after_colon && SMALL_WORDS.contains(&lower.as_str()) {
        word.to_lowercase()
      } else {
        // A capital at the start, and after a hyphen, a full stop (J.R.R.) or
        // an apostrophe that follows one letter (O'Brien).
        let mut made = String::with_capacity(word.len());
        let mut upper_next = true;
        let mut run = 0usize;
        for ch in word.chars() {
          if ch.is_alphabetic() {
            if upper_next {
              made.extend(ch.to_uppercase());
            } else {
              made.extend(ch.to_lowercase());
            }
            upper_next = false;
            run += 1;
          } else {
            upper_next = matches!(ch, '-' | '.' | '(' | '[' | '"' | '“' | '/') || (matches!(ch, '\'' | '’') && run == 1);
            run = 0;
            made.push(ch);
          }
        }
        made
      };
      after_colon = word.ends_with(':') || word.ends_with('—') || word.ends_with('–');
      if !bare.is_empty() {
        first = false;
      }
      out
    })
    .collect::<Vec<_>>()
    .join(" ")
}

// ---- where a file came from -------------------------------------------------

/// Sites that put their own name in a file's name or its metadata.
const SOURCE_WORDS: [&str; 22] = [
  "z-library", "zlibrary", "z-lib", "zlib.", "1lib", "libgen", "library genesis", "anna's archive", "anna’s archive",
  "annas archive", "pdfdrive", "oceanofpdf", "b-ok.", "bookzz", "bookfi.", "epub.pub", "ebook-hunter", "mobilism",
  "sci-hub", "dokumen.pub", "vdoc.pub", "ebookelo"
];

const TLDS: &str = "com|org|net|sk|is|se|rs|to|io|cc|me|ru|cn|info|club|xyz|pub|li|lc|gs|st|la|fm|ws|tv|app|site|online|top|vip|biz";

static DOMAIN: LazyLock<Regex> =
  LazyLock::new(|| Regex::new(&format!(r"^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:{TLDS})$")).expect("domain"));
static DOMAIN_WITHIN: LazyLock<Regex> =
  LazyLock::new(|| Regex::new(&format!(r"(?:^|[^a-z0-9.])[a-z0-9-]{{3,}}\.(?:{TLDS})(?:[^a-z]|$)")).expect("domain within"));

/// One name: a site's, or a bare web address.
fn is_source(item: &str) -> bool {
  let lower = item.trim().to_lowercase();
  !lower.is_empty() && (SOURCE_WORDS.iter().any(|word| lower.contains(word)) || lower == "zlib" || DOMAIN.is_match(&lower))
}

/// A bracket's worth of them: "z-library.sk, 1lib.sk, z-lib.sk".
fn is_source_tag(group: &str) -> bool {
  !group.trim().is_empty() && group.split(',').all(is_source)
}

/// The last bracketed group of a text that ends with one: what is before it,
/// and what is inside. Brackets inside it are stepped over ("(Brandon
/// Sanderson [Sanderson, Brandon])").
fn last_group(text: &str) -> Option<(&str, &str)> {
  let text = text.trim_end();
  let close = text.chars().last()?;
  if close != ')' && close != ']' {
    return None;
  }
  let mut depth = 0i32;
  for (at, ch) in text.char_indices().rev() {
    match ch {
      ')' | ']' => depth += 1,
      '(' | '[' => {
        depth -= 1;
        if depth == 0 {
          let inside = &text[at + ch.len_utf8()..text.len() - close.len_utf8()];
          return Some((text[..at].trim_end(), inside.trim()));
        }
      }
      _ => {}
    }
  }
  None
}

// ---- authors ----------------------------------------------------------------

/// Before a surname: "Le Guin, Ursula K." is one person, not two.
const PARTICLES: [&str; 20] = [
  "le", "la", "de", "del", "della", "di", "da", "du", "van", "von", "der", "den", "ter", "ten", "st", "st.", "mc", "al", "el", "bin"
];
const NAME_SUFFIXES: [&str; 8] = ["jr", "jr.", "sr", "sr.", "ii", "iii", "phd", "md"];
/// Written where a name was not known.
const NOT_A_NAME: [&str; 12] = [
  "unknown", "unknown author", "author", "n/a", "na", "none", "null", "unbekannt", "calibre", "anonymous author", "no author", "various authors"
];
/// Houses whose name sits where an author's would when a file's name has no author.
const PUBLISHERS: [&str; 24] = [
  "knopf", "penguin", "harpercollins", "harper collins", "random house", "vintage", "bantam", "del rey", "tor books", "orbit",
  "simon & schuster", "simon and schuster", "macmillan", "hachette", "scholastic", "doubleday", "springer", "wiley",
  "o'reilly", "packt", "apress", "gollancz", "bloomsbury", "university"
];

static LIFE_DATES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r",?\s*\(?\b\d{4}\s*-\s*(?:\d{4})?\)?").expect("dates"));

fn word_count(text: &str) -> usize {
  text.split_whitespace().count()
}

/// A text with any bracket that never opens or never closes cut away:
/// "Pierce] Pierce Brown" is "Pierce Brown".
fn drop_stray_brackets(text: &str) -> String {
  let mut text = text.to_string();
  for (open, close) in [('[', ']'), ('(', ')')] {
    if let Some(at) = text.find(close) {
      if !text[..at].contains(open) {
        text = text[at + close.len_utf8()..].to_string();
      }
    }
    if let Some(at) = text.rfind(open) {
      if !text[at..].contains(close) {
        text = text[..at].to_string();
      }
    }
  }
  text
}

/// The people in one comma-separated run: "Brown, Pierce" is one person
/// written surname first; "Neil Gaiman, Terry Pratchett" is two.
fn people_in(run: &str) -> Vec<String> {
  let parts: Vec<String> = run.split(',').map(collapse_spaces).filter(|part| !part.is_empty()).collect();
  match parts.len() {
    0 => Vec::new(),
    1 => parts,
    2 => {
      let (first, second) = (&parts[0], &parts[1]);
      if NAME_SUFFIXES.contains(&second.to_lowercase().as_str()) {
        return vec![format!("{first}, {second}")];
      }
      let particle = first.split_whitespace().next().is_some_and(|word| PARTICLES.contains(&word.to_lowercase().as_str()));
      let surname_first = word_count(first) == 1 || word_count(second) == 1 || (particle && word_count(first) <= 3);
      if surname_first {
        vec![format!("{second} {first}")]
      } else {
        parts
      }
    }
    // "Marx, Karl, Engels, Friedrich": surnames and first names in turn.
    count if count % 2 == 0 && parts.iter().all(|part| word_count(part) == 1) => {
      parts.chunks(2).map(|pair| format!("{} {}", pair[1], pair[0])).collect()
    }
    _ => parts
  }
}

/// Every person a raw author text names, tidied and each once.
fn people(raw: &str) -> Vec<String> {
  let text = collapse_spaces(&decode_entities(raw));
  if NOT_A_NAME.contains(&text.to_lowercase().as_str()) {
    return Vec::new();
  }
  // "Brandon Sanderson [Sanderson, Brandon]": the catalogue's sort form.
  let text = match last_group(&text) {
    Some((before, _)) if !before.is_empty() => before.to_string(),
    Some((_, inside)) => inside.to_string(),
    None => text
  };
  let text = drop_stray_brackets(&text);
  let text = LIFE_DATES.replace_all(&text, "").into_owned();
  let mut out: Vec<String> = Vec::new();
  for run in text.split([';', '&', '/', '|']).flat_map(|run| run.split(" and ")) {
    for person in people_in(run) {
      let person = undo_capitals(person.trim_matches(|ch: char| ch == ',' || ch == '-' || ch.is_whitespace()), false);
      let lower = person.to_lowercase();
      if person.is_empty() || !person.chars().any(char::is_alphabetic) || NOT_A_NAME.contains(&lower.as_str()) || is_source(&person) {
        continue;
      }
      if !out.iter().any(|seen| same_person(seen, &person)) {
        out.push(person);
      }
    }
  }
  out
}

/// The words of a name, lower case, in order of the alphabet, so "Brown,
/// Pierce" and "Pierce Brown" compare equal.
fn name_words(name: &str) -> Vec<String> {
  let mut words: Vec<String> = name
    .to_lowercase()
    .split(|ch: char| !ch.is_alphabetic())
    .filter(|word| !word.is_empty())
    .map(str::to_string)
    .collect();
  words.sort();
  words
}

fn same_person(a: &str, b: &str) -> bool {
  let (a, b) = (name_words(a), name_words(b));
  !a.is_empty() && a == b
}

fn join_people(people: &[String]) -> Option<String> {
  match people.len() {
    0 => None,
    1..=4 => Some(people.join(" & ")),
    _ => Some(format!("{} & others", people[..3].join(" & ")))
  }
}

/// An author as the library shows it: "Brown, Pierce" as "Pierce Brown",
/// "Brandon Sanderson [Sanderson, Brandon]" as "Brandon Sanderson", several
/// writers joined with "&", and `None` for "Unknown" or a site's name.
pub fn clean_author(raw: &str) -> Option<String> {
  join_people(&people(raw))
}

fn clean_authors(raw: &[String]) -> Option<String> {
  let mut all: Vec<String> = Vec::new();
  for person in raw.iter().flat_map(|text| people(text)) {
    if !all.iter().any(|seen| same_person(seen, &person)) {
      all.push(person);
    }
  }
  join_people(&all)
}

/// Whether the bracket before a site's tag in a file's name holds its
/// writers: names, and nothing a title's own bracket would hold (a number,
/// "Book", "Edition").
fn looks_like_people(group: &str) -> bool {
  let lower = group.to_lowercase();
  let blocked = [
    "edition", "book", "series", "trilogy", "saga", "volume", "vol.", "novel", "press", "classics", "illustrated", "version",
    "translation", "annotated", "complete", "collection", "tie-in", "abridged", "revised", "anniversary", "retail", "#"
  ];
  if group.chars().any(|ch| ch.is_ascii_digit()) || blocked.iter().any(|word| lower.contains(word)) {
    return false;
  }
  let found = people(group);
  !found.is_empty() && found.iter().all(|person| person.chars().count() <= 40 && person.chars().next().is_some_and(char::is_uppercase))
}

/// A field of an Anna's Archive name that can be the author: not the edition,
/// the publisher or its city, a year or a hash.
fn looks_like_author(candidate: &str) -> bool {
  let lower = candidate.to_lowercase();
  let blocked = ["edition", " ed,", " ed.", "1st ed", "2nd ed", "3rd ed", "series", " ser,", "volume", "new york", "london", "publish", "press", "books", "©", "copyright", "isbn", "archive"];
  if blocked.iter().any(|entry| lower.contains(entry)) || PUBLISHERS.iter().any(|house| lower.contains(house)) || is_source(candidate) || MD5.is_match(candidate) {
    return false;
  }
  let letters = candidate.chars().filter(|ch| ch.is_alphabetic()).count();
  let digits = candidate.chars().filter(char::is_ascii_digit).count();
  letters >= 2 && digits == 0 && candidate.chars().count() <= 80
}

// ---- a file's name ----------------------------------------------------------

static MD5: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-9a-fA-F]{32}$").expect("md5"));
static COUNTER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{1,3}$").expect("counter"));
static EXTENSION: LazyLock<Regex> =
  LazyLock::new(|| Regex::new(r"(?i)\.(epub|mobi|azw3?|azw4|pdf|txt|docx?|fb2|html?|rtf|lit|cbz|cbr|djvu|prc)$").expect("extension"));
/// "Red Rising 02", "Discworld #4": a series and a book's number in it.
static SERIES_NUMBER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.*\p{L}.*?)\s+#?(\d{1,3}(?:\.\d)?)$").expect("series number"));
/// "(The Red Rising Trilogy, Book 1)", "(The Expanse #1)", "[Discworld, Vol. 4]"
/// closing a title: a shop's or a catalogue's note of the series. The series
/// must be named and the number announced, so "(Book 1)", "(2nd Edition)" and
/// "(Vintage Classics 50)" are not one.
static SERIES_NOTE: LazyLock<Regex> = LazyLock::new(|| {
  Regex::new(r"(?i)^(.*\p{L}.*?)\s*[(\[]\s*([^()\[\]]*?\p{L}[^()\[\]]*?)(?:\s*,\s*|\s+)(?:#\s*|book\s+|bk\.?\s*|vol(?:ume)?\.?\s*|no\.?\s*)(\d{1,3}(?:\.\d)?)\s*[)\]]$").expect("series note")
});
static EDITION_NOTE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\b(?:ed\.|edn\.?|edition|ann?iversary)(?:\W|$)").expect("edition"));
static YEAR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b(?:1[5-9]|20)\d\d\b").expect("year"));
/// A subtitle cut off mid-phrase ends on one of these.
const DANGLING: [&str; 16] = ["the", "a", "an", "of", "in", "on", "and", "to", "for", "with", "from", "at", "by", "or", "its", "their"];

struct Parsed {
  title: String,
  author: Option<String>,
  series: Option<String>,
  series_index: Option<f32>
}

impl Parsed {
  fn titled(title: String) -> Self {
    Parsed { title, author: None, series: None, series_index: None }
  }
}

fn series_number(text: &str) -> Option<f32> {
  text.trim().parse::<f32>().ok().filter(|value| value.is_finite() && *value >= 0.0 && *value < 10_000.0)
}

/// Underscores as what they stood for. Sites write ":" (and other characters a
/// file name cannot hold) as "_", which leaves "Snakes_ Life and Language";
/// a name with no spaces at all uses them as spaces.
fn undo_underscores(text: &str) -> String {
  if !text.contains('_') {
    return text.to_string();
  }
  if !text.contains(' ') {
    return text.replace('_', " ");
  }
  let chars: Vec<char> = text.chars().collect();
  let mut out = String::with_capacity(text.len());
  for (at, ch) in chars.iter().enumerate() {
    if *ch == '_' {
      let glued = at > 0 && !chars[at - 1].is_whitespace() && chars.get(at + 1).is_some_and(|next| next.is_whitespace());
      out.push(if glued { ':' } else { ' ' });
    } else {
      out.push(*ch);
    }
  }
  out
}

/// "Author - Series 02 - Title 02", as catalogues name files (and as some then
/// paste into the title). `known` are the book's own authors: a title that
/// begins with one of them and a dash is that shape whatever follows. With no
/// author known, only the full three-part shape with a surname-first name is
/// taken, since "Paris, France - A Guide" is a title.
fn split_catalogue_name(title: &str, known: &[String]) -> Option<Parsed> {
  let parts: Vec<&str> = title.split(" - ").map(str::trim).filter(|part| !part.is_empty()).collect();
  if parts.len() < 2 {
    return None;
  }
  let numbered = |part: &str| SERIES_NUMBER.captures(part).and_then(|caps| Some((caps[1].trim().to_string(), series_number(&caps[2])?)));
  let own = known.iter().any(|author| same_person(author, parts[0]));
  let sorted_name = {
    let halves: Vec<&str> = parts[0].split(',').map(str::trim).collect();
    halves.len() == 2
      && halves.iter().all(|half| (1..=3).contains(&word_count(half)) && half.chars().next().is_some_and(char::is_uppercase) && !half.chars().any(|ch| ch.is_ascii_digit()))
  };
  if !own && !(sorted_name && parts.len() == 3 && numbered(parts[1]).is_some()) {
    return None;
  }
  let rest = &parts[1..];
  if rest.len() == 2 {
    if let Some((series, index)) = numbered(rest[0]) {
      // The number is often repeated after the title.
      let title = match numbered(rest[1]) {
        Some((bare, again)) if again == index => bare,
        _ => rest[1].to_string()
      };
      return Some(Parsed { title, author: clean_author(parts[0]), series: Some(series), series_index: Some(index) });
    }
  }
  Some(Parsed { title: rest.join(" - "), author: clean_author(parts[0]), series: None, series_index: None })
}

/// A file's name (without its extension) as a title and, where the name
/// holds one, an author.
fn from_file_name(stem: &str) -> Parsed {
  let text = collapse_spaces(&undo_underscores(&decode_entities(stem)));

  // Anna's Archive: "Title -- Author -- edition, place, year -- publisher --
  // ISBN -- hash -- Anna's Archive".
  if text.contains(" -- ") {
    let fields: Vec<&str> = text.split(" -- ").map(str::trim).filter(|field| !field.is_empty()).collect();
    let mut parsed = Parsed::titled(fields.first().map(|field| field.to_string()).unwrap_or_default());
    parsed.author = fields.get(1).filter(|field| looks_like_author(field)).and_then(|field| clean_author(field));
    // The site cuts a long title short, mid-subtitle.
    if let Some((main, subtitle)) = parsed.title.split_once(": ") {
      let last = subtitle.split_whitespace().last().unwrap_or("").to_lowercase();
      if DANGLING.contains(&last.as_str()) && !main.trim().is_empty() {
        parsed.title = main.trim().to_string();
      }
    }
    return parsed;
  }

  // Z-Library and its kin: "Title (Author) (z-library.sk, 1lib.sk, z-lib.sk)",
  // then the browser's "(1)" for a second download.
  let mut rest = text.as_str();
  let mut tagged = false;
  let mut first = true;
  while let Some((before, inside)) = last_group(rest) {
    if before.is_empty() {
      break;
    }
    if is_source_tag(inside) {
      tagged = true;
    } else if !(first && COUNTER.is_match(inside)) {
      break;
    }
    rest = before;
    first = false;
  }
  // "... - libgen.li"
  if let Some((before, after)) = rest.rsplit_once(" - ") {
    if is_source(after) && !before.trim().is_empty() {
      rest = before.trim_end();
      tagged = true;
    }
  }
  let mut parsed = Parsed::titled(rest.to_string());
  if tagged {
    if let Some((before, inside)) = last_group(rest) {
      if !before.is_empty() && looks_like_people(inside) {
        parsed.author = clean_author(inside);
        parsed.title = before.to_string();
      }
    }
    // "(upd. expanded 10th aniversary ed. 2017)": the site's note of which
    // printing this is, with its year. A bare "(2nd Edition)" is left: for a
    // textbook it is part of what the book is called.
    if let Some((before, inside)) = last_group(&parsed.title) {
      if !before.is_empty() && EDITION_NOTE.is_match(inside) && YEAR.is_match(inside) {
        parsed.title = before.to_string();
      }
    }
  }
  parsed
}

/// Whether a title is a file's name rather than a title: it ends in a book's
/// extension, carries a site's name, has Anna's Archive's fields, or is words
/// joined by underscores.
///
/// This used to be "contains ` ed`, ` ser`, `anna` or `_`, or is long", which
/// made "The Education of Little Tree - A Novel" a file name, cut at its dash,
/// with the author "A Novel".
pub fn is_noisy_title(title: &str) -> bool {
  let lower = title.to_lowercase();
  EXTENSION.is_match(title)
    || lower.matches(" -- ").count() >= 2
    || SOURCE_WORDS.iter().any(|word| lower.contains(word))
    || last_group(title).is_some_and(|(_, inside)| is_source_tag(inside))
    || (title.contains('_') && (!title.contains(' ') || lower.contains("_ ")))
}

/// Written where a title was not known.
fn is_placeholder(title: &str) -> bool {
  let lower = title.trim().to_lowercase();
  lower.is_empty() || ["unknown", "untitled", "no title", "[no title]", "title", "none", "null", "unnamed", "unbekannt"].contains(&lower.as_str())
}

/// The last touches every title gets: "Alchemist, The" the right way round,
/// capitals undone, loose punctuation off the ends.
fn tidy_title(title: &str) -> String {
  let mut title = collapse_spaces(title)
    .trim_matches(|ch: char| ch == '-' || ch == '–' || ch == '—' || ch == ',' || ch == ';' || ch.is_whitespace())
    .to_string();
  for article in ["The", "A", "An"] {
    let suffix = format!(", {article}");
    if title.len() > suffix.len() && title.to_lowercase().ends_with(&suffix.to_lowercase()) && title.is_char_boundary(title.len() - suffix.len()) {
      title = format!("{article} {}", &title[..title.len() - suffix.len()]);
      break;
    }
  }
  undo_capitals(&title, true)
}

// ---- what the program that made a file called it ----------------------------

/// What programs call a document nobody named, or name after themselves.
static TOOL_TITLE: LazyLock<Regex> = LazyLock::new(|| {
  Regex::new(
    r"(?i)^(?:microsoft (?:word|powerpoint|excel|office)\b.*|powerpoint presentation|untitled.*|unbenannt.*|sans titre.*|no ?name|new document|slide ?\d+|document ?\d*|doc\d+|scan(?:ned)?(?: document| image)?[ _-]*\d*|layout ?\d+|print(?:ed)?|full page fax print|pdf|e?book|cover|title|.*\b(?:acrobat|distiller|indesign|quarkxpress|pdfcreator|ghostscript)\b.*|\d+)$"
  )
  .expect("tool title")
});
/// A document's name on its maker's disk.
static WORKING_FILE: LazyLock<Regex> = LazyLock::new(|| {
  Regex::new(r"(?i)\.(?:docx?|rtf|indd|qx[dp]|dvi|tex|ps|pm\d?|fm|pages|odt|wpd|pptx?|xlsx?|txt|pdf|epub|mobi|html?)$|^[a-z]:[\\/]|\\|^/|://").expect("working file")
});
/// "(2006)" closing a title: the year it was printed, as a catalogue notes it.
static YEAR_NOTE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*\((?:1[5-9]|20)\d\d\)$").expect("year note"));
/// Who a computer says wrote a document when nobody told it: the account's name.
static ACCOUNT_NAME: LazyLock<Regex> = LazyLock::new(|| {
  Regex::new(
    r"(?i)^(?:administrator|admin|user|owner|default|root|guest|pc|home|test|customer|student|staff|library|office|scanner|(?:preferred|valued) customer|(?:registered|authori[sz]ed) user|dell|hp|lenovo|acer|asus|toshiba|sony|samsung|compaq|gateway|microsoft.*|adobe.*|.*\b(?:acrobat|distiller|indesign|quark|latex|ocr|abbyy|pdf)\b.*|\S+@\S+)$"
  )
  .expect("account name")
});

/// The words a title is known by: lower case, three letters or more, not the small ones.
fn telling_words(title: &str) -> Vec<String> {
  title
    .to_lowercase()
    .split(|ch: char| !ch.is_alphanumeric())
    .filter(|word| word.chars().count() >= 3 && !SMALL_WORDS.contains(word))
    .map(str::to_string)
    .collect()
}

/// Whether the title a PDF's maker wrote into it is the book's: not a
/// program's name for an unnamed document, not a working file's name or its
/// path, and, where the file's own name is clearly a title (two telling words
/// or more), one that shares a word with it. A report's Info says "Chapter 1"
/// or the name of the template it was typed into more often than a novel's
/// says the novel.
fn tool_title_usable(title: &str, name_title: &str) -> bool {
  if is_placeholder(title) || title.chars().count() > 250 || !title.chars().any(char::is_alphabetic) {
    return false;
  }
  if TOOL_TITLE.is_match(title.trim()) || WORKING_FILE.is_match(title.trim()) {
    return false;
  }
  let named = telling_words(name_title);
  let said = telling_words(title);
  named.len() < 2 || named.iter().any(|word| said.contains(word))
}

/// Whether an author a PDF's maker wrote into it is a person: not the name of
/// the account or the computer it was made on, nor of the program.
fn tool_author_usable(author: &str) -> bool {
  let found = people(author);
  !found.is_empty()
    && found
      .iter()
      .all(|person| !ACCOUNT_NAME.is_match(person) && person.chars().next().is_some_and(char::is_uppercase) && !person.chars().any(|ch| ch.is_ascii_digit()))
}

/// Whether two titles are one title written twice, as a file's name writes it
/// (no colon, cut short) and as the book does: the words of one begin the
/// other's. A year noted after either is not a word.
pub fn is_same_title(a: &str, b: &str) -> bool {
  let words = |title: &str| -> Vec<String> {
    YEAR_NOTE
      .replace(title.trim(), "")
      .to_lowercase()
      .split(|ch: char| !ch.is_alphanumeric())
      .filter(|word| !word.is_empty())
      .map(str::to_string)
      .collect()
  };
  let (a, b) = (words(a), words(b));
  let (short, long) = if a.len() <= b.len() { (&a, &b) } else { (&b, &a) };
  !short.is_empty() && long[..short.len()] == short[..]
}

// ---- genres -----------------------------------------------------------------

/// Subjects that say nothing about what kind of book it is.
const NOT_A_GENRE: [&str; 30] = [
  "general", "ebook", "ebooks", "e-book", "e-books", "book", "books", "kindle", "epub", "retail", "unknown", "calibre", "overdrive",
  "new york times bestseller", "new york times reviewed", "large type books", "accessible book", "protected daisy", "in library",
  "open library staff picks", "long now manual for civilization", "internet archive wishlist", "lending library", "text",
  "amerikanisches englisch", "english language", "reading", "literature", "media tie-in", "uncategorized"
];
const NOT_A_GENRE_START: [&str; 5] = ["translations into", "reading level", "for national curriculum", "nyt ", "open library"];
const NOT_A_GENRE_WITHIN: [&str; 6] = ["(imaginary place)", "(fictitious character)", "(imaginary organization)", "(fictional character)", "bestseller", "best seller"];

static BISAC_CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Z]{3}\d{6}\s*").expect("bisac"));
/// "series:Red Rising Saga", "nyt:hardcover-fiction=2019-08-18": a catalogue's own tags.
static MACHINE_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([a-z_]+):(\S.*)$").expect("machine tag"));

/// A book's genres from the subjects its file or a catalogue lists: codes,
/// catalogue tags, sites' names and shelf marks dropped, "FIC055000 Fiction /
/// Dystopian" as "Fiction" and "Dystopian", each once, eight at most.
pub fn clean_subjects(raw: &[String]) -> Vec<String> {
  let mut out: Vec<String> = Vec::new();
  let mut seen: Vec<String> = Vec::new();
  for subject in raw {
    let subject = collapse_spaces(&decode_entities(subject));
    let subject = BISAC_CODE.replace(&subject, "").into_owned();
    let subject = match MACHINE_TAG.captures(&subject) {
      Some(caps) if &caps[1] == "genre" => caps[2].to_string(),
      Some(_) => continue,
      None => subject
    };
    for part in subject.split(" / ").flat_map(|part| part.split(" -- ")).flat_map(|part| part.split(';')) {
      let part = part.trim().trim_matches(|ch: char| ch == ',' || ch == '.' || ch == '/').trim();
      let lower = part.to_lowercase();
      let count = part.chars().count();
      if !(2..=40).contains(&count)
        || part.contains('=')
        || !part.chars().any(char::is_alphabetic)
        || NOT_A_GENRE.contains(&lower.as_str())
        || NOT_A_GENRE_START.iter().any(|start| lower.starts_with(start))
        || NOT_A_GENRE_WITHIN.iter().any(|within| lower.contains(within))
        || is_source(part)
        || DOMAIN_WITHIN.is_match(&lower)
      {
        continue;
      }
      let key: String = lower.chars().map(|ch| if ch == '-' { ' ' } else { ch }).collect();
      if seen.contains(&key) {
        continue;
      }
      seen.push(key);
      // "FICTION" and "science fiction" as "Fiction" and "Science fiction".
      let shouting = count > 4 && part.chars().filter(|ch| ch.is_alphabetic()).all(char::is_uppercase);
      let part = if shouting { part.to_lowercase() } else { part.to_string() };
      let mut chars = part.chars();
      let named: String = match chars.next() {
        Some(first) if first.is_lowercase() => first.to_uppercase().chain(chars).collect(),
        _ => part.clone()
      };
      out.push(named);
      if out.len() == 8 {
        return out;
      }
    }
  }
  out
}

/// Genres a lookup found, added after the ones the book already has.
pub fn merge_genres(own: &[String], found: &[String]) -> Vec<String> {
  let both: Vec<String> = own.iter().chain(found).cloned().collect();
  clean_subjects(&both)
}

// ---- putting it together ----------------------------------------------------

/// A book's title, author, series and genres from what its file says about
/// itself (`basic`) and what the file is called.
pub fn identify(file_stem: &str, basic: &crate::storage::BasicMetadata) -> Identity {
  let own_authors: Vec<String> = basic.authors.iter().flat_map(|author| people(author)).collect();
  let embedded = basic
    .title
    .as_deref()
    .map(|title| collapse_spaces(&decode_entities(title)))
    .filter(|title| !is_placeholder(title));
  // A PDF's title is its maker's word: believed only when it reads like one,
  // and like this file's.
  let named = basic.doubtful.then(|| from_file_name(file_stem));
  let embedded = match &named {
    Some(named) => embedded.map(|title| YEAR_NOTE.replace(&title, "").into_owned()).filter(|title| tool_title_usable(title, &named.title)),
    None => embedded
  };

  let mut parsed = match embedded {
    Some(title) if is_noisy_title(&title) => from_file_name(&EXTENSION.replace(&title, "")),
    Some(title) => Parsed::titled(title),
    None => from_file_name(file_stem)
  };
  if let Some(split) = split_catalogue_name(&parsed.title, &own_authors) {
    parsed = Parsed { author: split.author.or(parsed.author), ..split };
  }
  // A series noted in brackets after the title belongs with the series.
  let noted = SERIES_NOTE
    .captures(&parsed.title)
    .and_then(|caps| Some((caps[1].trim().to_string(), caps[2].trim().to_string(), series_number(&caps[3])?)));
  if let Some((title, series, index)) = noted {
    parsed.title = title;
    if parsed.series.is_none() {
      parsed.series = Some(series);
      parsed.series_index = Some(index);
    }
  }

  let mut title = tidy_title(&parsed.title);
  if is_placeholder(&title) {
    title = tidy_title(&from_file_name(file_stem).title);
  }
  if is_placeholder(&title) {
    title = "Untitled".to_string();
  }

  // What the book says of its series wins over what its title let slip.
  let stated = basic.series.as_deref().map(|series| collapse_spaces(&decode_entities(series))).filter(|series| !series.is_empty());
  let (series, series_index) = match stated {
    Some(series) => (Some(series), basic.series_index.or(parsed.series_index)),
    None => (parsed.series, parsed.series_index)
  };

  // The book's own word on its author first; then its title's; then, for a
  // book that names no one, its file's.
  let author = match named {
    // For a PDF the file's name comes first: a site's catalogue knows who
    // wrote a book better than the computer it was typeset on.
    Some(named) => named.author.or(parsed.author).or_else(|| clean_authors(&basic.authors).filter(|author| tool_author_usable(author))),
    None => clean_authors(&basic.authors).or(parsed.author).or_else(|| from_file_name(file_stem).author)
  };

  Identity { title, author, series, series_index, genres: clean_subjects(&basic.subjects) }
}

/// The same rules for a book already in the library, whose stored title and
/// author are whatever an earlier version made of it.
pub fn identify_stored(title: &str, author: Option<&str>) -> Identity {
  identify(
    title,
    &crate::storage::BasicMetadata {
      title: Some(title.to_string()),
      authors: author.map(|author| vec![author.to_string()]).unwrap_or_default(),
      subjects: Vec::new(),
      series: None,
      series_index: None,
      doubtful: false
    }
  )
}

// ---- what to ask a catalogue --------------------------------------------------

fn isbn_checks(digits: &str) -> bool {
  let values: Vec<u32> = digits.chars().map(|ch| if ch == 'X' { 10 } else { ch.to_digit(10).unwrap_or(0) }).collect();
  match values.len() {
    10 => values.iter().enumerate().map(|(at, value)| (10 - at as u32) * value).sum::<u32>() % 11 == 0,
    13 => {
      (digits.starts_with("978") || digits.starts_with("979"))
        && values.iter().enumerate().map(|(at, value)| if at % 2 == 0 { *value } else { 3 * value }).sum::<u32>() % 10 == 0
    }
    _ => false
  }
}

/// The first ISBN in a text: ten or thirteen digits (hyphens allowed) whose
/// check digit is right, so a hash or a phone number is not taken for one.
fn extract_isbn(raw: &str) -> Option<String> {
  let mut token = String::new();
  for ch in raw.chars().chain(std::iter::once(' ')) {
    if ch.is_ascii_digit() || ch == 'X' || ch == 'x' || ch == '-' {
      token.push(ch);
      continue;
    }
    let cleaned: String = token.chars().filter(|ch| *ch != '-').collect::<String>().to_uppercase();
    token.clear();
    if isbn_checks(&cleaned) && !cleaned[..cleaned.len() - 1].contains('X') {
      return Some(cleaned);
    }
  }
  None
}

/// What to look a book up by: its title without subtitle or brackets, its
/// first author without initials (a catalogue that files "Daniel Leonard
/// Everett" finds nothing for "Daniel L. Everett"), and an ISBN if the name
/// holds one.
pub fn normalize_query(raw_title: &str, raw_author: Option<&str>) -> NormalizedQuery {
  let isbn = extract_isbn(raw_title);
  let identity = identify_stored(raw_title, raw_author);
  let mut title = identity.title.clone();
  while let Some((before, _)) = last_group(&title) {
    if before.is_empty() {
      break;
    }
    title = before.to_string();
  }
  for separator in [" -- ", " — ", " – ", " - ", " | ", " :: "] {
    let cut = title.split_once(separator).map(|(before, _)| before.trim().to_string()).filter(|before| !before.is_empty());
    if let Some(before) = cut {
      title = before;
    }
  }
  let author = identity.author.as_deref().map(|author| {
    let first = author.split(" & ").next().unwrap_or(author);
    let named: Vec<&str> = first.split_whitespace().filter(|word| word.trim_matches('.').chars().count() > 1).collect();
    if named.is_empty() {
      first.to_string()
    } else {
      named.join(" ")
    }
  });
  NormalizedQuery { title, author, isbn }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::storage::BasicMetadata;

  fn book(title: Option<&str>, authors: &[&str]) -> BasicMetadata {
    BasicMetadata {
      title: title.map(str::to_string),
      authors: authors.iter().map(|author| author.to_string()).collect(),
      subjects: Vec::new(),
      series: None,
      series_index: None,
      doubtful: false
    }
  }

  /// A PDF: what its maker wrote into it, and what the file is called.
  fn pdf(stem: &str, title: Option<&str>, author: Option<&str>) -> (String, Option<String>) {
    let says = BasicMetadata { doubtful: true, ..book(title, &author.into_iter().collect::<Vec<_>>()) };
    let identity = identify(stem, &says);
    (identity.title, identity.author)
  }

  #[test]
  fn a_pdf_s_own_title_is_used_when_it_is_one() {
    // The title has the colon the file's name lost; the year after it is a note.
    assert_eq!(
      pdf(
        "The Tide Table A New Way to Understand Why Harbours Rise and Fall (Mara Ellison) (z-library.sk, 1lib.sk, z-lib.sk)",
        Some("The Tide Table: A New Way to Understand Why Harbours Rise and Fall (2006)"),
        Some("Mara Ellison")
      ),
      pair("The Tide Table: A New Way to Understand Why Harbours Rise and Fall", "Mara Ellison")
    );
    assert_eq!(pdf("Night Ferry (Mara Ellison) (z-lib.org)", Some(" Night Ferry"), Some("Mara Ellison")), pair("Night Ferry", "Mara Ellison"));
    // A file whose name says nothing takes the PDF's word whole.
    assert_eq!(pdf("scan0001", Some("Night Ferry: A Life"), Some("Ellison, Mara")), pair("Night Ferry: A Life", "Mara Ellison"));
    assert_eq!(pdf("ferry", Some("The Night Ferry"), None), ("The Night Ferry".to_string(), None));
    // Nothing inside: as before.
    assert_eq!(pdf("Night Ferry (Mara Ellison) (z-lib.org)", None, None), pair("Night Ferry", "Mara Ellison"));
  }

  #[test]
  fn a_pdf_s_title_that_is_its_maker_s_is_not_believed() {
    for made_up in [
      "Microsoft Word - draft3.doc",
      "Microsoft Word - Night Ferry final",
      "untitled",
      "Untitled-1",
      "Document1",
      "Slide 1",
      "PowerPoint Presentation",
      "night_ferry_final.indd",
      "Night Ferry.pdf",
      "C:\\Users\\mara\\Desktop\\Night Ferry",
      "/home/mara/night ferry",
      "file:///night/ferry",
      "scan0001",
      "20110304",
      "Adobe InDesign CS3 (5.0)",
      "   "
    ] {
      assert_eq!(pdf("Night Ferry (Mara Ellison) (z-lib.org)", Some(made_up), Some("Mara Ellison")), pair("Night Ferry", "Mara Ellison"), "{made_up}");
      assert_eq!(pdf("scan0001", Some(made_up), None).0, "scan0001", "{made_up}");
    }
    // A real title, but not this file's: the template's, or a chapter's.
    assert_eq!(pdf("Night Ferry (Mara Ellison) (z-lib.org)", Some("Annual Report"), None).0, "Night Ferry");
    assert_eq!(pdf("Night Ferry (Mara Ellison) (z-lib.org)", Some("Chapter 1"), None).0, "Night Ferry");
    // One shared word is enough: a file's name is cut short and respelt.
    assert_eq!(pdf("Night Ferry (Mara Ellison) (z-lib.org)", Some("The Ferry by Night"), None).0, "The Ferry by Night");
    // A title that only looks like a path is a title.
    assert_eq!(pdf("either or", Some("Either/Or: A Fragment of Life"), None).0, "Either/Or: A Fragment of Life");
  }

  #[test]
  fn a_pdf_s_author_is_a_person_or_no_one() {
    for account in ["Administrator", "user", "Owner", "Dell", "jsmith", "Preferred Customer", "Adobe Acrobat 7.0", "mara@example.org", "PC", "Scanner 3"] {
      assert_eq!(pdf("Night Ferry", Some("Night Ferry"), Some(account)).1, None, "{account}");
    }
    assert_eq!(pdf("Night Ferry", Some("Night Ferry"), Some("Mara Ellison; Tobias Wren")).1.as_deref(), Some("Mara Ellison & Tobias Wren"));
    // The file's name knows better than the typesetter's computer.
    assert_eq!(pdf("Night Ferry (Mara Ellison) (z-lib.org)", Some("Night Ferry"), Some("Tobias Wren")).1.as_deref(), Some("Mara Ellison"));
  }

  #[test]
  fn one_title_written_twice_is_known_for_one() {
    assert!(is_same_title("The Tide Table A New Way to Understand", "The Tide Table: A New Way to Understand Why Harbours Rise (2006)"));
    assert!(is_same_title("Night Ferry", "NIGHT FERRY"));
    assert!(is_same_title("Night Ferry (2011)", "Night Ferry: A Life"));
    assert!(!is_same_title("Night Ferry", "The Night Ferry"));
    assert!(!is_same_title("Night Ferry", "Ferry by Night"));
    assert!(!is_same_title("", "Night Ferry"));
  }

  fn named(stem: &str) -> (String, Option<String>) {
    let identity = identify(stem, &book(None, &[]));
    (identity.title, identity.author)
  }

  fn pair(title: &str, author: &str) -> (String, Option<String>) {
    (title.to_string(), Some(author.to_string()))
  }

  #[test]
  fn a_site_s_tag_and_the_author_come_off_a_file_s_name() {
    assert_eq!(named("The Hollow Orchard (Mara Ellison) (z-library.sk, 1lib.sk, z-lib.sk)"), pair("The Hollow Orchard", "Mara Ellison"));
    assert_eq!(named("Night Ferry (Ellison, Mara) (Z-Library) (1)"), pair("Night Ferry", "Mara Ellison"));
    assert_eq!(
      named("The Glass Road Saltmarsh Triology (Book 1) (Tobias Wren [Wren, Tobias]) (z-library.sk, 1lib.sk, z-lib.sk)"),
      pair("The Glass Road Saltmarsh Triology (Book 1)", "Tobias Wren")
    );
    assert_eq!(named("Night Ferry (Mara Ellison, Tobias Wren) (z-lib.org)"), pair("Night Ferry", "Mara Ellison & Tobias Wren"));
    // A shape these rules do not know is left for a person to read.
    assert_eq!(named("Mara Ellison - Night Ferry (2011, Saltmarsh Press) - libgen.li"), ("Mara Ellison - Night Ferry (2011, Saltmarsh Press)".to_string(), None));
    // A second download of a file with no tag at all.
    assert_eq!(named("Night Ferry (1)"), ("Night Ferry".to_string(), None));
    // The site's note of the printing, year and misspelling and all.
    assert_eq!(
      named("Salt After Rain The History of the World’s Smallest Harbour (upd. expanded 10th aniversary ed. 2017) (Mara Ellison) (z-library.sk, 1lib.sk, z-lib.sk)"),
      pair("Salt After Rain The History of the World’s Smallest Harbour", "Mara Ellison")
    );
    assert_eq!(named("Night Ferry (2nd Edition) (Mara Ellison) (z-lib.org)"), pair("Night Ferry (2nd Edition)", "Mara Ellison"));
    assert_eq!(named("Night Ferry (Letters 1914-1918) (Mara Ellison) (z-lib.org)"), pair("Night Ferry (Letters 1914-1918)", "Mara Ellison"));
  }

  #[test]
  fn a_title_s_own_brackets_are_not_taken_for_an_author() {
    // With a site's tag but no author: the bracket left is the title's.
    assert_eq!(named("Night Ferry (Illustrated Edition) (z-lib.org)"), ("Night Ferry (Illustrated Edition)".to_string(), None));
    assert_eq!(named("Night Ferry (Book 2) (z-lib.org)"), ("Night Ferry (Book 2)".to_string(), None));
    // With no tag, nothing says the bracket is a person.
    assert_eq!(named("Night Ferry (Mara Ellison)"), ("Night Ferry (Mara Ellison)".to_string(), None));
    assert_eq!(named("Emma (Penguin Classics)"), ("Emma (Penguin Classics)".to_string(), None));
  }

  #[test]
  fn an_annas_archive_name_gives_its_first_two_fields() {
    let identity = identify(
      "Don't Wake, There Are Wolves_ Notes and Letters from the -- Ellison, Mara Louise -- Saltmarsh Departures Ser, 1st ed, New York, ©2008 -- Saltmarsh -- 9780306406157 -- 7fff2ab34520a7987d32e504b67f9910 -- Anna’s Archive",
      &book(None, &[])
    );
    // The subtitle was cut off mid-phrase, so it goes.
    assert_eq!(identity.title, "Don't Wake, There Are Wolves");
    assert_eq!(identity.author.as_deref(), Some("Mara Louise Ellison"));

    assert_eq!(
      named("Night Ferry -- Mara] Mara Ellison -- 2015 -- shuwu5_com 万千书友聚集地 -- ab34131e18de03bd5d1ea465bd907597 -- Anna’s Archive"),
      pair("Night Ferry", "Mara Ellison")
    );
    // No author field: an edition or a publisher is not a person.
    assert_eq!(named("Night Ferry -- 2nd edition, 2015 -- Saltmarsh Press -- Anna’s Archive").1, None);
    assert_eq!(named("Night Ferry -- Knopf Doubleday -- 9780306406157 -- Anna’s Archive").1, None);
    // A whole subtitle stays.
    assert_eq!(named("Night Ferry_ A Life at Sea -- Mara Ellison -- 2015 -- Anna’s Archive").0, "Night Ferry: A Life at Sea");
  }

  #[test]
  fn a_series_noted_after_the_title_moves_to_the_series() {
    let identity = identify(
      "Night Ferry (The Saltmarsh Trilogy, Book 1) -- Mara Ellison -- First edition, 2014 -- Saltmarsh;Tide -- d712733956c783a2999b463ce40f45be -- Anna’s Archive",
      &book(None, &[])
    );
    assert_eq!((identity.title.as_str(), identity.series.as_deref(), identity.series_index), ("Night Ferry", Some("The Saltmarsh Trilogy"), Some(1.0)));
    assert_eq!(identity.author.as_deref(), Some("Mara Ellison"));

    let identity = identify("x", &book(Some("Shallow Water (Saltmarsh, #2.5)"), &["Mara Ellison"]));
    assert_eq!((identity.title.as_str(), identity.series.as_deref(), identity.series_index), ("Shallow Water", Some("Saltmarsh"), Some(2.5)));

    // What the book states wins; the note still comes off the title.
    let mut stated = book(Some("Shallow Water (Saltmarsh #2)"), &["Mara Ellison"]);
    stated.series = Some("The Saltmarsh Cycle".to_string());
    stated.series_index = Some(2.0);
    let identity = identify("x", &stated);
    assert_eq!((identity.title.as_str(), identity.series.as_deref(), identity.series_index), ("Shallow Water", Some("The Saltmarsh Cycle"), Some(2.0)));
  }

  #[test]
  fn a_real_title_is_left_whole() {
    for title in [
      "The Night Ferry in Plain and Simple English (A Modern Translation and the Original Version)",
      "Night Ferry: A Novel",
      "Catch-22",
      "Spider-Man - Blue",
      "Fahrenheit 451",
      "The Hunger Games: Book 1",
      "Night Ferry (Book 1)",
      "Concerto (Piano 5)",
      "Paris, France - A Guide",
      "Anna Karenina",
      "The Education of Little Tree - A Novel",
      "The Serpent and the Rainbow",
      "Apollo 13 - Lost Moon",
      "Night Ferry (2nd Edition)",
      "Night Ferry (Vintage Classics 50)",
      "Boxed Set: A Game of Chairs, a Clash of Spoons, a Storm of Forks, and a Feast for Cooks",
      "Mr. Mercedes",
      "It"
    ] {
      let identity = identify("some file", &book(Some(title), &["Mara Ellison"]));
      assert_eq!(identity.title, title);
      assert_eq!(identity.series, None, "{title}");
      assert!(!is_noisy_title(title), "{title}");
    }
  }

  #[test]
  fn a_title_that_is_the_file_s_name_is_read_as_one() {
    // A catalogue's file name pasted into the title, author and all.
    let identity = identify("ignored", &book(Some("Ellison, Mara - Saltmarsh 02 - Night Ferry 02"), &["Ellison, Mara"]));
    assert_eq!(identity.title, "Night Ferry");
    assert_eq!(identity.author.as_deref(), Some("Mara Ellison"));
    assert_eq!((identity.series.as_deref(), identity.series_index), (Some("Saltmarsh"), Some(2.0)));

    // The same in a file's name, with nothing inside the book.
    let identity = identify("Ellison, Mara - Saltmarsh 02 - Night Ferry", &book(None, &[]));
    assert_eq!((identity.title.as_str(), identity.author.as_deref(), identity.series.as_deref()), ("Night Ferry", Some("Mara Ellison"), Some("Saltmarsh")));

    // Its own author and a dash: the rest is the title.
    let identity = identify("ignored", &book(Some("Mara Ellison - Night Ferry"), &["Mara Ellison"]));
    assert_eq!((identity.title.as_str(), identity.series), ("Night Ferry", None));
    let identity = identify("ignored", &book(Some("Mara Ellison - Night Ferry - A Novel"), &["Ellison, Mara"]));
    assert_eq!((identity.title.as_str(), identity.series), ("Night Ferry - A Novel", None));

    assert_eq!(identify("ignored", &book(Some("night_ferry_final.epub"), &[])).title, "night ferry final");
    assert_eq!(
      identify("ignored", &book(Some("Night Ferry (Mara Ellison) (Z-Library)"), &[])),
      Identity { title: "Night Ferry".into(), author: Some("Mara Ellison".into()), series: None, series_index: None, genres: vec![] }
    );
    // Nothing inside: the file's name stands in.
    assert_eq!(identify("Night Ferry", &book(Some("Unknown"), &["Unknown"])), Identity { title: "Night Ferry".into(), author: None, series: None, series_index: None, genres: vec![] });
    assert_eq!(identify("", &book(Some(" "), &[])).title, "Untitled");
  }

  #[test]
  fn titles_are_tidied_without_being_rewritten() {
    let titled = |title: &str| identify("x", &book(Some(title), &["Mara Ellison"])).title;
    assert_eq!(titled("Orchard, The"), "The Orchard");
    assert_eq!(titled("  Night   Ferry "), "Night Ferry");
    assert_eq!(titled("Salt &amp; Iron"), "Salt & Iron");
    assert_eq!(titled("The Ferryman&#8217;s Daughter"), "The Ferryman’s Daughter");
    assert_eq!(titled("NIGHT FERRY: THE LAST CROSSING OF THE BAY"), "Night Ferry: The Last Crossing of the Bay");
    assert_eq!(titled("HENRY IV AND THE BFG"), "Henry IV and the BFG");
    assert_eq!(titled("MR. MERCEDES"), "Mr. Mercedes");
    // Not all capitals: left as written.
    assert_eq!(titled("NIGHT FERRY: The Complete Collection"), "NIGHT FERRY: The Complete Collection");
    assert_eq!(titled("QED"), "QED");
    assert_eq!(titled("1984"), "1984");
  }

  #[test]
  fn authors_are_shown_first_name_first() {
    assert_eq!(clean_author("Brown, Pierce").as_deref(), Some("Pierce Brown"));
    assert_eq!(clean_author("Everett, Daniel Leonard").as_deref(), Some("Daniel Leonard Everett"));
    assert_eq!(clean_author("Tolkien, J. R. R.").as_deref(), Some("J. R. R. Tolkien"));
    assert_eq!(clean_author("Le Guin, Ursula K.").as_deref(), Some("Ursula K. Le Guin"));
    assert_eq!(clean_author("Conan Doyle, Arthur").as_deref(), Some("Arthur Conan Doyle"));
    assert_eq!(clean_author("Doyle, Arthur Conan, 1859-1930").as_deref(), Some("Arthur Conan Doyle"));
    assert_eq!(clean_author("Brandon Sanderson [Sanderson, Brandon]").as_deref(), Some("Brandon Sanderson"));
    assert_eq!(clean_author("[Sanderson, Brandon]").as_deref(), Some("Brandon Sanderson"));
    assert_eq!(clean_author("Pierce] Pierce Brown").as_deref(), Some("Pierce Brown"));
    assert_eq!(clean_author("Martin Luther King, Jr.").as_deref(), Some("Martin Luther King, Jr."));
    assert_eq!(clean_author("PIERCE BROWN").as_deref(), Some("Pierce Brown"));
    assert_eq!(clean_author("J.R.R. TOLKIEN").as_deref(), Some("J.R.R. Tolkien"));
    assert_eq!(clean_author("FLANN O'BRIEN").as_deref(), Some("Flann O'Brien"));
    assert_eq!(clean_author("George R. R. Martin").as_deref(), Some("George R. R. Martin"));
    assert_eq!(clean_author("Madonna").as_deref(), Some("Madonna"));
  }

  #[test]
  fn several_authors_are_each_kept_once() {
    assert_eq!(clean_author("Neil Gaiman, Terry Pratchett").as_deref(), Some("Neil Gaiman & Terry Pratchett"));
    assert_eq!(clean_author("Marx, Karl; Engels, Friedrich").as_deref(), Some("Karl Marx & Friedrich Engels"));
    assert_eq!(clean_author("Marx, Karl, Engels, Friedrich").as_deref(), Some("Karl Marx & Friedrich Engels"));
    assert_eq!(clean_author("Gaiman, Neil & Pratchett, Terry").as_deref(), Some("Neil Gaiman & Terry Pratchett"));
    assert_eq!(clean_author("Pierce Brown; Brown, Pierce").as_deref(), Some("Pierce Brown"));
    let both = book(Some("A Manifesto"), &["Karl Marx", "Friedrich Engels"]);
    assert_eq!(identify("x", &both).author.as_deref(), Some("Karl Marx & Friedrich Engels"));
    // A site's name listed as a second author.
    let sited = book(Some("Night Ferry"), &["Mara Ellison [Ellison, Mara]", "shuwu5.com"]);
    assert_eq!(identify("x", &sited).author.as_deref(), Some("Mara Ellison"));
    let many = book(Some("An Anthology"), &["Ada One", "Ben Two", "Cy Three", "Di Four", "Ed Five"]);
    assert_eq!(identify("x", &many).author.as_deref(), Some("Ada One & Ben Two & Cy Three & others"));
  }

  #[test]
  fn an_author_that_is_no_one_is_none() {
    for nobody in ["Unknown", "unknown author", "N/A", "", "  ", "calibre", "z-lib.org", "Z-Library", "1234"] {
      assert_eq!(clean_author(nobody), None, "{nobody:?}");
    }
    // Real, if unhelpful.
    assert_eq!(clean_author("Anonymous").as_deref(), Some("Anonymous"));
    assert_eq!(clean_author("Various").as_deref(), Some("Various"));
    // The file's name fills in for a book that names no one.
    let identity = identify("Night Ferry (Mara Ellison) (z-lib.org)", &book(Some("The Night Ferry"), &["Unknown"]));
    assert_eq!((identity.title.as_str(), identity.author.as_deref()), ("The Night Ferry", Some("Mara Ellison")));
    let identity = identify("Night Ferry (Mara Ellison) (z-lib.org)", &book(None, &["Unknown"]));
    assert_eq!(identity.author.as_deref(), Some("Mara Ellison"));
  }

  #[test]
  fn subjects_become_genres() {
    let genres = |subjects: &[&str]| clean_subjects(&subjects.iter().map(|subject| subject.to_string()).collect::<Vec<_>>());
    assert_eq!(genres(&["FIC055000 Fiction / Dystopian"]), ["Fiction", "Dystopian"]);
    assert_eq!(genres(&["Mobilism"]), Vec::<String>::new());
    assert_eq!(
      genres(&["Fantasy", "Epic", "Fiction", "General", "Media Tie-In", "Fantasy Fiction", "Epic fiction", "Seven Bays (Imaginary Place)"]),
      ["Fantasy", "Epic", "Fiction", "Fantasy Fiction", "Epic fiction"]
    );
    // A catalogue's tags: only the genre is one.
    assert_eq!(
      genres(&[
        "franchise:Saltmarsh",
        "series:Saltmarsh Saga",
        "form:novel",
        "genre:science fiction",
        "nyt:hardcover-fiction=2019-08-18",
        "New York Times bestseller",
        "Science-fiction",
        "Science fiction",
        "Large type books",
        "Translations into Indonesian",
        "FICTION / Literary",
        "shuwu5.com沉金书屋",
        "Fiction, science fiction, general"
      ]),
      ["Science fiction", "Fiction", "Literary", "Fiction, science fiction, general"]
    );
    assert_eq!(genres(&["YA", "SF", "x", "&amp;"]), ["YA", "SF"]);
    let many: Vec<String> = (0..20).map(|n| format!("Genre number {n}")).collect();
    assert_eq!(clean_subjects(&many).len(), 8);
    // What the book has comes first; a lookup adds to it.
    assert_eq!(merge_genres(&["Apocalyptic".to_string()], &["genre:science fiction".to_string(), "apocalyptic".to_string()]), ["Apocalyptic", "Science fiction"]);
  }

  #[test]
  fn a_lookup_asks_by_the_plain_title_and_first_author() {
    let query = normalize_query("Don't Sleep, There Are Wolves", Some("Daniel L. Ellison"));
    assert_eq!((query.title.as_str(), query.author.as_deref()), ("Don't Sleep, There Are Wolves", Some("Daniel Ellison")));
    let query = normalize_query("A Manifesto in Plain English (A Modern Translation)", Some("Karl Marx & Friedrich Engels"));
    assert_eq!((query.title.as_str(), query.author.as_deref()), ("A Manifesto in Plain English", Some("Karl Marx")));
    let query = normalize_query("Night Ferry (Mara Ellison) (z-library.sk, 1lib.sk, z-lib.sk)", None);
    assert_eq!((query.title.as_str(), query.author.as_deref(), query.isbn), ("Night Ferry", Some("Mara Ellison"), None));
    let query = normalize_query("The Hobbit", Some("J. R. R. Tolkien"));
    assert_eq!(query.author.as_deref(), Some("Tolkien"));
  }

  #[test]
  fn only_a_real_isbn_is_taken_for_one() {
    assert_eq!(extract_isbn("Night Ferry -- Saltmarsh -- 9780306406157 -- hash").as_deref(), Some("9780306406157"));
    assert_eq!(extract_isbn("978-0-306-40615-7").as_deref(), Some("9780306406157"));
    assert_eq!(extract_isbn("0-306-40615-2").as_deref(), Some("0306406152"));
    assert_eq!(extract_isbn("080442957X").as_deref(), Some("080442957X"));
    // Ten digits that do not check, a year range, a hash.
    assert_eq!(extract_isbn("call 5551234567 now"), None);
    assert_eq!(extract_isbn("Letters 1914-1918"), None);
    assert_eq!(extract_isbn("7fff2ab34520a7987d32e504b67f9910"), None);
    assert_eq!(extract_isbn("9780306406158"), None);
  }

  #[test]
  fn a_stored_title_from_an_older_version_is_cleaned_the_same_way() {
    let identity = identify_stored("Night Ferry (Mara Ellison) (z-library.sk, 1lib.sk, z-lib.sk)", None);
    assert_eq!((identity.title.as_str(), identity.author.as_deref()), ("Night Ferry", Some("Mara Ellison")));
    let identity = identify_stored("Ellison, Mara - Saltmarsh 02 - Night Ferry 02", Some("Ellison, Mara"));
    assert_eq!((identity.title.as_str(), identity.author.as_deref(), identity.series.as_deref()), ("Night Ferry", Some("Mara Ellison"), Some("Saltmarsh")));
    let identity = identify_stored("Night Ferry", Some("Mara] Mara Ellison"));
    assert_eq!((identity.title.as_str(), identity.author.as_deref()), ("Night Ferry", Some("Mara Ellison")));
    // A clean book comes back as it went in.
    let identity = identify_stored("The Night Ferry", Some("Mara Ellison"));
    assert_eq!((identity.title.as_str(), identity.author.as_deref(), identity.series), ("The Night Ferry", Some("Mara Ellison"), None));
  }
}
