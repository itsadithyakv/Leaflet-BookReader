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
//! The parsing and the grouping are pure and tested here; the two requests a
//! book (its work, then the work's editions) are at the bottom.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

/// One edition's cover.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditionCover {
  /// Open Library's cover id (`covers.openlibrary.org/b/id/<id>-M.jpg`).
  pub cover_id: i64,
  pub publisher: String,
  pub year: Option<i32>,
  /// `eng`, `fre`... where the edition says.
  pub language: Option<String>
}

#[derive(Debug, Deserialize)]
struct EditionsResponse {
  #[serde(default)]
  entries: Vec<EditionEntry>
}

#[derive(Debug, Deserialize)]
struct EditionEntry {
  #[serde(default)]
  covers: Vec<i64>,
  #[serde(default)]
  publishers: Vec<String>,
  #[serde(default)]
  publish_date: Option<String>,
  #[serde(default)]
  languages: Vec<LanguageRef>
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

/// Every cover in an editions answer, one an edition (its first), each cover
/// once. An edition with no cover or no publisher is no use here: there is
/// nothing to show, or nothing to group it by.
pub fn covers_in(json: &str) -> Result<Vec<EditionCover>> {
  let response: EditionsResponse = serde_json::from_str(json)?;
  let mut seen = HashSet::new();
  let mut covers = Vec::new();
  for entry in response.entries {
    // Open Library writes -1 for "no cover".
    let Some(cover_id) = entry.covers.iter().copied().find(|id| *id > 0) else {
      continue;
    };
    let Some(publisher) = entry.publishers.iter().map(|name| name.trim()).find(|name| !name.is_empty()) else {
      continue;
    };
    if !seen.insert(cover_id) {
      continue;
    }
    covers.push(EditionCover {
      cover_id,
      publisher: publisher.to_string(),
      year: entry.publish_date.as_deref().and_then(year_in),
      language: entry.languages.first().and_then(|language| language.key.rsplit('/').next()).map(str::to_string)
    });
  }
  Ok(covers)
}

/// Words a publisher's name is written with or without: "HarperCollins
/// Publishers Ltd" and "HarperCollins" are one house.
const HOUSE_NOISE: [&str; 14] = [
  "the", "publishers", "publisher", "publishing", "publications", "books", "book", "press", "ltd", "limited", "inc", "co", "company", "group"
];

/// What two spellings of one publisher share.
pub fn house_key(publisher: &str) -> String {
  let cleaned: String = publisher
    .chars()
    .map(|c| if c.is_alphanumeric() { c.to_lowercase().next().unwrap_or(c) } else { ' ' })
    .collect();
  let words: Vec<&str> = cleaned.split_whitespace().filter(|word| !HOUSE_NOISE.contains(word)).collect();
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

/// The most sets offered: the fullest ones.
pub const SETS_MAX: usize = 12;

/// The cover to show for one book from one publisher: an English edition
/// before another (most of the catalogue is English, and a set should not mix
/// languages by accident), then the newest, then the lowest id so the choice
/// never flips.
fn pick<'a>(covers: &[&'a EditionCover]) -> Option<&'a EditionCover> {
  covers
    .iter()
    .copied()
    .max_by(|a, b| {
      let english = |cover: &EditionCover| cover.language.as_deref() == Some("eng");
      english(a)
        .cmp(&english(b))
        .then_with(|| a.year.unwrap_or(0).cmp(&b.year.unwrap_or(0)))
        .then_with(|| b.cover_id.cmp(&a.cover_id))
    })
}

/// The sets a series can be dressed in: for each publisher, its cover for
/// every book it published. The publishers that cover most of the series
/// first; between equals, the one with more editions in the catalogue (the
/// better-known edition), then by name. `books` is the series in order.
pub fn cover_sets(books: &[(String, Vec<EditionCover>)]) -> Vec<CoverSet> {
  // house -> book index -> that book's covers from the house
  let mut houses: BTreeMap<String, BTreeMap<usize, Vec<&EditionCover>>> = BTreeMap::new();
  let mut spellings: HashMap<String, HashMap<&str, usize>> = HashMap::new();
  for (at, (_, covers)) in books.iter().enumerate() {
    for cover in covers {
      let key = house_key(&cover.publisher);
      if key.is_empty() {
        continue;
      }
      houses.entry(key.clone()).or_default().entry(at).or_default().push(cover);
      *spellings.entry(key).or_default().entry(cover.publisher.as_str()).or_default() += 1;
    }
  }
  let mut sets: Vec<(usize, usize, CoverSet)> = houses
    .into_iter()
    .map(|(key, by_book)| {
      let editions: usize = by_book.values().map(Vec::len).sum();
      let covers: Vec<SetCover> = by_book
        .iter()
        .filter_map(|(at, covers)| pick(covers).map(|cover| SetCover { book_id: books[*at].0.clone(), cover_id: cover.cover_id }))
        .collect();
      let name = spellings
        .get(&key)
        .and_then(|counts| counts.iter().max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0))).map(|(name, _)| name.to_string()))
        .unwrap_or(key);
      (covers.len(), editions, CoverSet { name, covers })
    })
    .collect();
  sets.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)).then_with(|| a.2.name.cmp(&b.2.name)));
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
mod tests {
  use super::*;

  fn cover(id: i64, publisher: &str, year: Option<i32>, language: Option<&str>) -> EditionCover {
    EditionCover { cover_id: id, publisher: publisher.to_string(), year, language: language.map(str::to_string) }
  }

  #[test]
  fn an_editions_answer_gives_one_cover_an_edition() {
    let json = r#"{ "entries": [
      { "covers": [101, 102], "publishers": ["HarperCollins"], "publish_date": "June 1, 2001", "languages": [{ "key": "/languages/eng" }] },
      { "covers": [-1], "publishers": ["Nobody"] },
      { "publishers": ["No Cover House"], "publish_date": "1999" },
      { "covers": [103], "publishers": [] },
      { "covers": [101], "publishers": ["HarperCollins again"] },
      { "covers": [-1, 104], "publishers": ["  ", "Gramedia"], "publish_date": "c2002", "languages": [{ "key": "/languages/ind" }] }
    ] }"#;
    assert_eq!(
      covers_in(json).expect("parsed"),
      vec![cover(101, "HarperCollins", Some(2001), Some("eng")), cover(104, "Gramedia", Some(2002), Some("ind"))]
    );
    assert_eq!(covers_in("{}").expect("empty"), Vec::new());
    assert!(covers_in("not json").is_err());
  }

  #[test]
  fn a_year_is_read_out_of_a_catalogues_date() {
    assert_eq!(year_in("June 1, 2001"), Some(2001));
    assert_eq!(year_in("c1954"), Some(1954));
    assert_eq!(year_in("1954-1955"), Some(1955));
    assert_eq!(year_in("9780261102354"), None);
    assert_eq!(year_in("undated"), None);
  }

  #[test]
  fn one_publisher_spelt_three_ways_is_one_house() {
    let key = house_key("HarperCollins");
    assert_eq!(key, "harpercollins");
    assert_eq!(house_key("HarperCollins Publishers Ltd."), key);
    assert_eq!(house_key("The HARPERCOLLINS Publishing Group"), key);
    assert_ne!(house_key("Houghton Mifflin"), key);
    // A name made only of such words is kept whole rather than emptied.
    assert_eq!(house_key("The Book Company"), "the book company");
  }

  /// The reported case: a trilogy whose three covers came from three places.
  #[test]
  fn a_series_is_offered_each_publishers_covers_the_fullest_set_first() {
    let books = vec![
      ("fellowship".to_string(), vec![cover(1, "HarperCollins", Some(1991), Some("eng")), cover(2, "HarperCollins Publishers", Some(2012), Some("eng")), cover(3, "Gramedia", Some(2002), Some("ind")), cover(4, "Ballantine Books", Some(1965), Some("eng"))]),
      ("towers".to_string(), vec![cover(5, "HarperCollins", Some(2012), Some("eng")), cover(6, "Gramedia", Some(2002), Some("ind"))]),
      ("king".to_string(), vec![cover(7, "HarperCollins", Some(2012), None), cover(8, "HarperCollins", Some(1980), Some("eng")), cover(9, "Ballantine", Some(1965), Some("eng"))])
    ];
    let sets = cover_sets(&books);
    let shown: Vec<(&str, Vec<(&str, i64)>)> = sets
      .iter()
      .map(|set| (set.name.as_str(), set.covers.iter().map(|cover| (cover.book_id.as_str(), cover.cover_id)).collect()))
      .collect();
    assert_eq!(
      shown,
      vec![
        // All three books; the newest English edition of each (for the third, English before newer).
        ("HarperCollins", vec![("fellowship", 2), ("towers", 5), ("king", 8)]),
        // Two books each: the house with more editions listed would come first; equal here, so by name.
        ("Ballantine", vec![("fellowship", 4), ("king", 9)]),
        ("Gramedia", vec![("fellowship", 3), ("towers", 6)])
      ]
    );
    // The same answer whatever order the editions came in.
    let mut turned = books.clone();
    for (_, covers) in &mut turned {
      covers.reverse();
    }
    assert_eq!(cover_sets(&turned), sets);
    assert!(cover_sets(&[]).is_empty());
  }

  #[test]
  fn only_the_fullest_sets_are_offered() {
    let covers: Vec<EditionCover> = (1..=30).map(|id| cover(id, &format!("House {id:02}"), None, None)).collect();
    let sets = cover_sets(&[("one".to_string(), covers)]);
    assert_eq!(sets.len(), SETS_MAX);
    assert_eq!(sets[0].name, "House 01");
  }

  #[test]
  fn a_works_key_is_checked_before_it_goes_into_an_address() {
    assert_eq!(work_path("/works/OL27448W").as_deref(), Some("/works/OL27448W"));
    assert_eq!(work_path("/works/OL27448W/../../account"), None);
    assert_eq!(work_path("/books/OL1M"), None);
    assert_eq!(work_path("/works/"), None);
  }
}
