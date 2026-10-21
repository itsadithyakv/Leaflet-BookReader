//! The covers a book has been published under, and the sets of them a series
//! can be dressed in.
//!
//! A lookup gives a book one cover: whichever the catalogue lists first for
//! the work, which for a much-reprinted book is often an ugly one, and for a
//! series is a different publisher's for each book. Open Library keeps every
//! edition of a work with its publisher and its cover, so the covers a series
//! could wear are there to be chosen from: grouped by publisher, since one
//! publisher's edition of a series is what looks like a set on a shelf.
//!
//! What a work's editions hold is not all this book, nor all in its language
//! (the catalogue is kept by many hands), so before anything is grouped:
//! audiobooks go (a square picture of the box), as do editions in another
//! language than the book's (named by the edition, or else by where its ISBN
//! was registered: a Turkish set used to be offered for an English book),
//! boxed sets and omnibuses, and an edition that is plainly another book of
//! the series ("Dune Messiah" filed under "Dune"). A publisher's imprints and
//! spellings are one house ("Tor", "Tor Books", "Tor Fantasy", "Tom Doherty
//! Associates"), and of its many printings the covers offered are one line of
//! them (the 2019 reissue of every book, not one book's from each decade).
//!
//! The parsing and the grouping are pure and tested here; the two requests a
//! book (its work, then the work's editions) are at the bottom.

use super::open_library::{title_similarity, words};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::cmp::{Ordering, Reverse};
use std::collections::{BTreeMap, HashMap, HashSet};

/// One edition's cover.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditionCover {
  /// Open Library's cover id (`covers.openlibrary.org/b/id/<id>-M.jpg`).
  pub cover_id: i64,
  /// Every publisher the edition names, as written, in its order.
  pub publishers: Vec<String>,
  pub year: Option<i32>,
  /// Open Library's code for the edition's language (`eng`, `fre`): the one
  /// it names, or else the one its ISBN says. `None` when neither does.
  pub language: Option<String>,
  /// The edition's own title, as written.
  pub title: String,
  /// Its ISBN as an ISBN-13 without the check digit: a publisher numbers the
  /// printings of one reissue together, so close numbers are one line.
  pub isbn: Option<u64>
}

#[derive(Debug, Deserialize)]
struct EditionsResponse {
  #[serde(default)]
  entries: Vec<EditionEntry>
}

#[derive(Debug, Deserialize)]
struct EditionEntry {
  #[serde(default)]
  title: Option<String>,
  #[serde(default)]
  covers: Vec<i64>,
  #[serde(default)]
  publishers: Vec<String>,
  #[serde(default)]
  publish_date: Option<String>,
  #[serde(default)]
  languages: Vec<LanguageRef>,
  #[serde(default)]
  physical_format: Option<String>,
  #[serde(default)]
  isbn_13: Vec<String>,
  #[serde(default)]
  isbn_10: Vec<String>
}

#[derive(Debug, Deserialize)]
struct LanguageRef {
  key: String
}

/// The year in a catalogue's date ("June 1, 2001", "2001", "c1954"): its
/// last run of four digits that could be a year of print.
fn year_in(date: &str) -> Option<i32> {
  let digits: Vec<char> = date.chars().collect();
  let mut found = None;
  let mut at = 0;
  while at + 4 <= digits.len() {
    if digits[at..at + 4].iter().all(char::is_ascii_digit) {
      let year: i32 = digits[at..at + 4].iter().collect::<String>().parse().unwrap_or(0);
      if (1450..=2100).contains(&year) {
        found = Some(year);
      }
      at += 4;
    } else {
      at += 1;
    }
  }
  found
}

/// An edition's first good ISBN, as an ISBN-13 without its check digit.
fn isbn_of(isbn_13: &[String], isbn_10: &[String]) -> Option<u64> {
  let bare = |raw: &String| raw.chars().filter(char::is_ascii_alphanumeric).collect::<String>();
  let thirteen = isbn_13.iter().map(bare).find(|isbn| {
    let bookland = isbn.starts_with("978") || isbn.starts_with("979");
    isbn.len() == 13 && isbn.chars().all(|c| c.is_ascii_digit()) && bookland
  });
  if let Some(isbn) = thirteen {
    return isbn[..12].parse().ok();
  }
  isbn_10
    .iter()
    .map(bare)
    .find(|isbn| isbn.len() == 10 && isbn[..9].chars().all(|c| c.is_ascii_digit()))
    .and_then(|isbn| format!("978{}", &isbn[..9]).parse().ok())
}

/// Where each ISBN group is registered, as the language most books from
/// there are in. Longer prefixes are looked at first; a group shared by
/// several languages (India's, the international one) says nothing.
const ISBN_LANGUAGES: &[(&str, &str)] = &[
  ("9798", "eng"), ("97910", "fre"), ("97911", "kor"), ("97912", "ita"),
  ("978950", "spa"), ("978956", "spa"), ("978958", "spa"), ("978968", "spa"), ("978970", "spa"),
  ("978987", "spa"), ("978607", "spa"), ("978612", "spa"), ("978972", "por"), ("978989", "por"),
  ("978951", "fin"), ("978952", "fin"), ("978960", "gre"), ("978618", "gre"), ("978963", "hun"),
  ("978615", "hun"), ("978965", "heb"), ("978966", "ukr"), ("978617", "ukr"), ("978973", "rum"),
  ("978606", "rum"), ("978975", "tur"), ("978605", "tur"), ("978954", "bul"), ("978619", "bul"),
  ("978957", "chi"), ("978986", "chi"), ("978962", "chi"), ("978988", "chi"), ("978964", "per"),
  ("978600", "per"), ("978602", "ind"), ("978979", "ind"), ("978616", "tha"), ("978974", "tha"),
  ("978604", "vie"),
  ("97880", "cze"), ("97882", "nor"), ("97883", "pol"), ("97884", "spa"), ("97885", "por"),
  ("97865", "por"), ("97887", "dan"), ("97888", "ita"), ("97889", "kor"), ("97890", "dut"),
  ("97894", "dut"), ("97891", "swe"),
  ("9780", "eng"), ("9781", "eng"), ("9782", "fre"), ("9783", "ger"), ("9784", "jpn"),
  ("9785", "rus"), ("9787", "chi")
];

/// The language an ISBN's registration group is mostly published in.
fn isbn_language(isbn: u64) -> Option<&'static str> {
  let digits = isbn.to_string();
  ISBN_LANGUAGES
    .iter()
    .filter(|(prefix, _)| digits.starts_with(prefix))
    .max_by_key(|(prefix, _)| prefix.len())
    .map(|(_, language)| *language)
}

/// Open Library's code for a language as a book names it: `en`, `en-GB`,
/// `eng` and `fra` all come to what the catalogue writes (`eng`, `fre`).
pub fn language_code(tag: &str) -> Option<String> {
  let main = tag.trim().split(['-', '_']).next()?.to_ascii_lowercase();
  let code = match main.as_str() {
    "en" => "eng", "fr" | "fra" => "fre", "de" | "deu" => "ger", "es" => "spa", "pt" => "por",
    "it" => "ita", "nl" | "nld" => "dut", "pl" => "pol", "ru" => "rus", "ja" => "jpn",
    "zh" | "zho" => "chi", "ko" => "kor", "tr" => "tur", "sv" => "swe", "da" => "dan",
    "no" | "nb" | "nn" | "nob" | "nno" => "nor", "fi" => "fin", "cs" | "ces" => "cze",
    "hu" => "hun", "ro" | "ron" => "rum", "el" | "ell" => "gre", "uk" => "ukr", "ca" => "cat",
    "ar" => "ara", "he" => "heb", "hi" => "hin", "id" => "ind", "th" => "tha", "vi" => "vie",
    "fa" | "fas" => "per", "bg" => "bul",
    other if other.len() == 3 && other.chars().all(|c| c.is_ascii_lowercase()) => other,
    _ => return None
  };
  Some(code.to_string())
}

/// An audiobook's edition: its picture is the box's, square, and no book's cover.
fn is_audio(format: Option<&str>, publishers: &[String]) -> bool {
  const FORMATS: &[&str] = &["cassette", "mp3", "cd", "audible", "playaway"];
  const HOUSES: &[&str] = &[
    "audio", "audible", "books on tape", "recorded books", "sound library", "brilliance", "tantor"
  ];
  let format = format.unwrap_or("").to_lowercase();
  let format_words: Vec<&str> = format.split(|c: char| !c.is_alphanumeric()).collect();
  format.contains("audio")
    || FORMATS.iter().any(|kind| format_words.contains(kind))
    || publishers.iter().any(|name| {
      let name = name.to_lowercase();
      HOUSES.iter().any(|house| name.contains(house))
    })
}

/// Every cover in an editions answer, one an edition (its first), each cover
/// once. An edition with no cover or no publisher is no use here: there is
/// nothing to show, or nothing to group it by; nor is an audiobook's.
pub fn covers_in(json: &str) -> Result<Vec<EditionCover>> {
  let response: EditionsResponse = serde_json::from_str(json)?;
  let mut seen = HashSet::new();
  let mut covers = Vec::new();
  for entry in response.entries {
    // Open Library writes -1 for "no cover".
    let Some(cover_id) = entry.covers.iter().copied().find(|id| *id > 0) else {
      continue;
    };
    let publishers: Vec<String> = entry
      .publishers
      .iter()
      .map(|name| name.trim().to_string())
      .filter(|name| !name.is_empty())
      .collect();
    if publishers.is_empty() || is_audio(entry.physical_format.as_deref(), &publishers) {
      continue;
    }
    if !seen.insert(cover_id) {
      continue;
    }
    let isbn = isbn_of(&entry.isbn_13, &entry.isbn_10);
    let named = entry.languages.first().and_then(|language| language.key.rsplit('/').next());
    let language = named
      .filter(|code| !code.is_empty())
      .map(str::to_string)
      .or_else(|| isbn.and_then(isbn_language).map(str::to_string));
    covers.push(EditionCover {
      cover_id,
      publishers,
      year: entry.publish_date.as_deref().and_then(year_in),
      language,
      title: entry.title.unwrap_or_default(),
      isbn
    });
  }
  Ok(covers)
}

/// Words a publisher's name is written with or without: "HarperCollins
/// Publishers Ltd" and "HarperCollins" are one house, as are "Ace Trade" and
/// "Ace Books, Inc.", and "Heyne Verlag" and "Heyne".
const HOUSE_NOISE: &[&str] = &[
  "the", "publishers", "publisher", "publishing", "publications", "pub", "books", "book", "press",
  "ltd", "limited", "inc", "llc", "corp", "corporation", "co", "company", "group", "sons",
  "imprint", "brand", "verlag", "editora", "editorial", "editions", "ediciones", "editores",
  "yayinlari", "yayinevi", "paperback", "paperbacks", "hardcover", "hardcovers", "hardback",
  "trade", "mass", "market", "usa", "uk"
];

/// What spellings of one publisher share: its name without the words above,
/// a place written before it ("New York : Tor"), a year after it, or single
/// letters ("S.A."). Tom Doherty Associates is the company Tor is.
pub fn house_key(publisher: &str) -> String {
  let key = spelt_key(publisher);
  if key.split(' ').any(|word| word == "doherty") {
    "tor".to_string()
  } else {
    key
  }
}

/// `house_key` as the name itself spells it, without a parent company's name.
fn spelt_key(publisher: &str) -> String {
  let named = publisher
    .rsplit(':')
    .map(str::trim)
    .find(|part| !part.is_empty())
    .unwrap_or(publisher);
  let cleaned: String = named
    .chars()
    .map(|c| if c.is_alphanumeric() { c.to_lowercase().next().unwrap_or(c) } else { ' ' })
    .collect();
  let words: Vec<&str> = cleaned
    .split_whitespace()
    .filter(|word| {
      let numbered = word.chars().any(|c| c.is_ascii_digit());
      !HOUSE_NOISE.contains(word) && word.chars().count() > 1 && !numbered
    })
    .collect();
  if words.is_empty() {
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
  } else {
    words.join(" ")
  }
}

/// One publisher's covers for some of a series' books.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverSet {
  /// The publisher, as most of its editions spell it.
  pub name: String,
  pub covers: Vec<SetCover>
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCover {
  pub book_id: String,
  pub cover_id: i64
}

/// One book of a series, as its covers were looked for.
#[derive(Debug, Clone)]
pub struct SeriesBook {
  pub book_id: String,
  /// The title it was looked up by.
  pub title: String,
  pub covers: Vec<EditionCover>
}

/// The most sets offered: the fullest ones.
pub const SETS_MAX: usize = 12;

/// Words in an edition's title that make it several books, not this one.
const MANY_BOOKS: &[&str] =
  &["omnibus", "trilogy", "boxed", "box", "collection", "quartet", "duology", "books", "volumes"];

/// Whether an edition is this book, as far as its title says: not a boxed
/// set, and not another book of the series that begins with this one's title
/// ("Dune Messiah" or "Children of Dune" filed under "Dune"). A title that
/// differs otherwise (a subtitle, the UK title) is still the book.
fn is_this_book(edition: &str, asked: &str, others: &[&str]) -> bool {
  let theirs = words(edition);
  if theirs.is_empty() {
    return true;
  }
  let mine = words(asked);
  if theirs.iter().any(|word| MANY_BOOKS.contains(&word.as_str()) && !mine.contains(word)) {
    return false;
  }
  !others.iter().any(|other| {
    let longer = words(other);
    let extends_mine = longer.len() > mine.len() && mine.iter().all(|word| longer.contains(word));
    extends_mine
      && longer.iter().all(|word| theirs.contains(word))
      && title_similarity(edition, other) > title_similarity(edition, asked)
  })
}

/// The covers of each book that may be offered for it: in the book's
/// language (or not saying), and this book.
fn fitting<'a>(books: &'a [SeriesBook], language: &str) -> Vec<Vec<&'a EditionCover>> {
  let titles: Vec<&str> = books.iter().map(|book| book.title.as_str()).collect();
  books
    .iter()
    .map(|book| {
      let others: Vec<&str> = titles.iter().copied().filter(|title| *title != book.title).collect();
      book
        .covers
        .iter()
        .filter(|cover| cover.language.as_deref().is_none_or(|code| code == language))
        .filter(|cover| is_this_book(&cover.title, &book.title, &others))
        .collect()
    })
    .collect()
}

/// How far apart two printings are: years first, then (for one publisher's
/// numbering) ISBNs, in orders of magnitude. Unknowns cost a little.
fn gap(a: &EditionCover, b: &EditionCover) -> (u32, u32) {
  let years = match (a.year, b.year) {
    (Some(x), Some(y)) => x.abs_diff(y),
    _ => 3
  };
  let numbers = match (a.isbn, b.isbn) {
    (Some(x), Some(y)) => (x.abs_diff(y) as f64 + 1.0).log10().round() as u32,
    _ => 13
  };
  (years, numbers)
}

/// The cover to show for each book from one house: one printing line rather
/// than each book's newest. Each cover is tried as the line's anchor, and each
/// book takes its printing nearest to it; the anchor whose set lies closest
/// together wins, then one with a known language, then the newest.
fn pick_line<'a>(
  by_book: &BTreeMap<usize, Vec<&'a EditionCover>>
) -> Vec<(usize, &'a EditionCover)> {
  type Line<'b> = Vec<(usize, &'b EditionCover)>;
  /// Years apart, covers in no known language, ISBN gaps, then the newest anchor.
  type Score = (u32, u32, u32, Reverse<Option<i32>>, i64);
  let unsure = |cover: &EditionCover| u32::from(cover.language.is_none());
  let nearest = |anchor: &EditionCover, covers: &[&'a EditionCover]| -> Option<&'a EditionCover> {
    covers.iter().copied().min_by_key(|cover| {
      let (years, numbers) = gap(anchor, cover);
      (years, unsure(cover), numbers, Reverse(cover.year), cover.cover_id)
    })
  };
  let mut best: Option<(Score, Line<'a>)> = None;
  for anchor in by_book.values().flatten() {
    let line: Line<'a> = by_book
      .iter()
      .filter_map(|(at, covers)| nearest(anchor, covers).map(|cover| (*at, cover)))
      .collect();
    let (mut years, mut unknown, mut numbers) = (0, 0, 0);
    for (_, cover) in &line {
      let (y, n) = gap(anchor, cover);
      years += y;
      numbers += n;
      unknown += unsure(cover);
    }
    let score = (years, unknown, numbers, Reverse(anchor.year), anchor.cover_id);
    if best.as_ref().is_none_or(|(held, _)| score < *held) {
      best = Some((score, line));
    }
  }
  best.map(|(_, line)| line).unwrap_or_default()
}

/// The sets a series can be dressed in: for each publisher, its cover for
/// every book it published. The publishers that cover most of the series
/// first; between equals, the one with more editions in the catalogue (the
/// better-known edition), then by name. `books` is the series in order;
/// `language` is the books' own (`eng`), and covers in another are left out.
/// A "set" of one book is no set, and is left out of a series of three or more.
pub fn cover_sets(books: &[SeriesBook], language: &str) -> Vec<CoverSet> {
  let fitting = fitting(books, language);

  // Every spelling's house, then the houses whose name begins with another's
  // ("Tor Fantasy", "Hodder & Stoughton") folded into that one ("Tor", "Hodder").
  let mut keys: HashMap<&str, String> = HashMap::new();
  for cover in fitting.iter().flatten() {
    for name in &cover.publishers {
      keys.entry(name.as_str()).or_insert_with(|| house_key(name));
    }
  }
  let all: HashSet<&str> =
    keys.values().map(String::as_str).filter(|key| !key.is_empty()).collect();
  let fold = |key: &str| -> String {
    let words: Vec<&str> = key.split(' ').collect();
    (1..=words.len())
      .map(|length| words[..length].join(" "))
      .find(|prefix| all.contains(prefix.as_str()))
      .unwrap_or_else(|| key.to_string())
  };
  let house_of: HashMap<&str, String> =
    keys.iter().filter(|(_, key)| !key.is_empty()).map(|(name, key)| (*name, fold(key))).collect();

  // An edition naming several publishers ("Gollancz", "Orion") goes to the
  // one most of the series' editions name.
  let mut named: HashMap<&str, usize> = HashMap::new();
  for cover in fitting.iter().flatten() {
    let houses: HashSet<&str> = cover
      .publishers
      .iter()
      .filter_map(|name| house_of.get(name.as_str()).map(String::as_str))
      .collect();
    for house in houses {
      *named.entry(house).or_default() += 1;
    }
  }

  // house -> book index -> that book's covers from the house
  let mut houses: BTreeMap<String, BTreeMap<usize, Vec<&EditionCover>>> = BTreeMap::new();
  let mut spellings: HashMap<&str, HashMap<&str, usize>> = HashMap::new();
  for (at, covers) in fitting.iter().enumerate() {
    for cover in covers {
      let chosen = cover
        .publishers
        .iter()
        .filter_map(|name| house_of.get(name.as_str()))
        // Between equals, the first named.
        .max_by(|a, b| named.get(a.as_str()).cmp(&named.get(b.as_str())).then(Ordering::Greater));
      let Some(house) = chosen else {
        continue;
      };
      houses.entry(house.clone()).or_default().entry(at).or_default().push(cover);
      let its = |name: &&String| house_of.get(name.as_str()) == Some(house);
      for name in cover.publishers.iter().filter(its) {
        *spellings.entry(house.as_str()).or_default().entry(name.as_str()).or_default() += 1;
      }
    }
  }

  let mut sets: Vec<(usize, usize, CoverSet)> = houses
    .into_iter()
    .map(|(house, by_book)| {
      let editions: usize = by_book.values().map(Vec::len).sum();
      // One picture is one book's: a cover filed under two books stays with the first.
      let mut used = HashSet::new();
      let covers: Vec<SetCover> = pick_line(&by_book)
        .into_iter()
        .filter(|(_, cover)| used.insert(cover.cover_id))
        .map(|(at, cover)| SetCover {
          book_id: books[at].book_id.clone(),
          cover_id: cover.cover_id
        })
        .collect();
      // Named as the house itself is spelt ("Tor", not "Tor Fantasy" nor
      // "Tom Doherty Associates"), the most used such spelling.
      let spelt = |exact: bool| {
        spellings
          .get(house.as_str())?
          .iter()
          .filter(|(name, _)| !exact || spelt_key(name) == house)
          .max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0)))
          .map(|(name, _)| name.to_string())
      };
      let name = spelt(true).or_else(|| spelt(false)).unwrap_or_else(|| house.clone());
      (covers.len(), editions, CoverSet { name, covers })
    })
    .filter(|(covered, _, _)| *covered > 1 || books.len() < 3)
    .collect();
  sets.sort_by(|a, b| {
    b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)).then_with(|| a.2.name.cmp(&b.2.name))
  });
  sets.into_iter().take(SETS_MAX).map(|(_, _, set)| set).collect()
}

/// A work's key in a search answer (`/works/OL27448W`), checked before it is
/// put into an address.
pub fn work_path(key: &str) -> Option<String> {
  let id = key.strip_prefix("/works/")?;
  (id.len() <= 20 && id.starts_with("OL") && id.ends_with('W') && id.chars().all(|c| c.is_ascii_alphanumeric())).then(|| format!("/works/{id}"))
}

/// The covers a book has been published under: the work is found as a lookup
/// finds it (`open_library::work_key`), then its editions are read. Empty
/// when the catalogue does not know the book.
pub async fn fetch(title: &str, author: Option<&str>) -> Result<Vec<EditionCover>> {
  let Some(work) = super::open_library::work_key(title, author).await?.as_deref().and_then(work_path) else {
    return Ok(Vec::new());
  };
  let client = reqwest::Client::builder()
    .user_agent(crate::http::user_agent())
    .timeout(std::time::Duration::from_secs(20))
    .build()?;
  let body = client
    .get(format!("https://openlibrary.org{work}/editions.json?limit=200"))
    .send()
    .await?
    .error_for_status()?
    .text()
    .await?;
  covers_in(&body)
}

#[cfg(test)]
mod tests;
