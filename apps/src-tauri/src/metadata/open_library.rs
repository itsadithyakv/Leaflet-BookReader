use anyhow::Result;
use reqwest::Client;
use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct OpenLibraryMetadata {
  pub title: String,
  pub author: Option<String>,
  pub subjects: Vec<String>,
  pub cover_url: Option<String>
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
  docs: Vec<SearchDoc>
}

#[derive(Debug, Deserialize)]
struct SearchDoc {
  title: Option<String>,
  author_name: Option<Vec<String>>,
  subject: Option<Vec<String>>,
  cover_i: Option<i64>,
  #[allow(dead_code)]
  key: Option<String>
}

/// What a search is asked to send back. Open Library's search stopped
/// including `subject` unless it is asked for by name, so every lookup came
/// back with no subjects: no book ever had a genre, and each was looked up
/// again every fourteen days for the genres it would never get.
const FIELDS: &str = "key,title,author_name,subject,cover_i";

/// The address a book is looked up at: by ISBN when the file's name gave one
/// (exact), otherwise by title and author.
fn search_url(title: &str, author: Option<&str>, isbn: Option<&str>) -> String {
  let asked = if let Some(isbn) = isbn {
    format!("isbn={}", urlencoding::encode(isbn))
  } else {
    let mut query = format!("title:{}", title);
    if let Some(author) = author {
      query.push_str(" author:");
      query.push_str(author);
    }
    format!("q={}", urlencoding::encode(&query))
  };
  format!("https://openlibrary.org/search.json?{asked}&fields={FIELDS}&limit=5")
}

pub async fn fetch_metadata(title: &str, author: Option<&str>, isbn: Option<&str>) -> Result<Option<OpenLibraryMetadata>> {
  // A hung lookup used to stall the whole metadata queue behind it.
  let client = Client::builder()
    .user_agent(crate::http::user_agent())
    .timeout(std::time::Duration::from_secs(15))
    .build()?;
  let url = search_url(title, author, isbn);

  let response: SearchResponse = client.get(url).send().await?.json().await?;
  // A search returns its best guesses, not an answer: the first result for a
  // title like "e2e" was a James Patterson thriller, and it used to be taken
  // as-is and renamed the book. An ISBN lookup is exact; a title search must
  // actually match the title (and the author, when both are known).
  let doc = if isbn.is_some() {
    response.docs.first()
  } else {
    best_match(title, author, &response.docs)
  };
  let doc = match doc {
    Some(doc) => doc,
    None => return Ok(None)
  };

  let cover_url = doc.cover_i.map(|cover_id| {
    format!("https://covers.openlibrary.org/b/id/{}-L.jpg", cover_id)
  });

  // A catalogue's subjects are half shelf marks ("nyt:hardcover-fiction=...",
  // "series:...", "Large type books"): the first eight used to be taken as
  // they came. Cleaned over a longer run, so eight real ones are left.
  let listed = doc.subject.clone().unwrap_or_default();
  let subjects = super::normalize::clean_subjects(&listed[..listed.len().min(40)]);

  Ok(Some(OpenLibraryMetadata {
    title: doc.title.clone().unwrap_or_else(|| title.to_string()),
    author: doc.author_name.as_ref().and_then(|authors| authors.first().cloned()),
    subjects,
    cover_url
  }))
}

/// The result that is the book, among a search's first five: the closest
/// title; between equals, one with a cover; and between those, the one the
/// catalogue ranked first.
///
/// It was `max_by` on the title alone, which between equals keeps the last:
/// of several works all called by the book's exact title, the one the
/// catalogue thought least likely, cover or none.
fn best_match<'a>(title: &str, author: Option<&str>, docs: &'a [SearchDoc]) -> Option<&'a SearchDoc> {
  let mut best: Option<(&SearchDoc, f64)> = None;
  for doc in docs.iter().take(5) {
    if !is_match(title, author, doc.title.as_deref(), doc.author_name.as_ref().and_then(|a| a.first()).map(String::as_str)) {
      continue;
    }
    let score = title_similarity(title, doc.title.as_deref().unwrap_or(""));
    let better = match best {
      None => true,
      Some((held, held_score)) => score > held_score || (score == held_score && doc.cover_i.is_some() && held.cover_i.is_none())
    };
    if better {
      best = Some((doc, score));
    }
  }
  best.map(|(doc, _)| doc)
}

/// Lower-case words, punctuation and a few filler words dropped.
fn words(value: &str) -> Vec<String> {
  const FILLER: [&str; 6] = ["the", "a", "an", "of", "and", "&"];
  value
    .to_lowercase()
    .split(|c: char| !c.is_alphanumeric())
    .filter(|w| !w.is_empty() && !FILLER.contains(w))
    .map(str::to_string)
    .collect()
}

/// How alike two titles are, 0..1: shared words over all words (Jaccard), so
/// a subtitle on one side ("Dune: Deluxe Edition") only costs a little.
pub(crate) fn title_similarity(a: &str, b: &str) -> f64 {
  let (a, b) = (words(a), words(b));
  if a.is_empty() || b.is_empty() {
    return 0.0;
  }
  let shared = a.iter().filter(|w| b.contains(w)).count() as f64;
  let union = (a.len() + b.len()) as f64 - shared;
  shared / union
}

/// Whether a search result is really the book: the titles must line up
/// closely, or one must begin with the other (a subtitle: "The Hobbit" and
/// "The Hobbit, or There and Back Again"); and when both sides name an
/// author, a name must be shared.
fn is_match(title: &str, author: Option<&str>, found_title: Option<&str>, found_author: Option<&str>) -> bool {
  let Some(found_title) = found_title else {
    return false;
  };
  let (mine, theirs) = (words(title), words(found_title));
  let starts = |long: &[String], short: &[String]| !short.is_empty() && long.len() >= short.len() && long[..short.len()] == *short;
  let contained = starts(&theirs, &mine) || starts(&mine, &theirs);
  if title_similarity(title, found_title) < 0.6 && !contained {
    return false;
  }
  match (author.map(words), found_author.map(words)) {
    (Some(a), Some(b)) if !a.is_empty() && !b.is_empty() => a.iter().any(|w| w.len() > 1 && b.contains(w)),
    _ => true
  }
}

#[cfg(test)]
mod tests {
  fn found(title: &str, author: &str, cover: Option<i64>) -> super::SearchDoc {
    super::SearchDoc { title: Some(title.to_string()), author_name: Some(vec![author.to_string()]), subject: None, cover_i: cover, key: None }
  }

  /// Several works can carry a book's exact title. The first the catalogue
  /// ranked is the book, unless it has no cover and an equal one has.
  #[test]
  fn between_equal_titles_the_first_ranked_is_taken_and_one_with_a_cover_before_one_without() {
    let docs = vec![
      found("The Long Field", "Mara Ellison", Some(11)),
      found("The Long Field / Other Stories", "Mara Ellison", Some(22)),
      found("The Long Field", "Mara Ellison", Some(33))
    ];
    // Was the last of the equals (33): `max_by` keeps the last.
    assert_eq!(super::best_match("The Long Field", Some("Mara Ellison"), &docs).and_then(|doc| doc.cover_i), Some(11));

    let coverless_first = vec![found("The Long Field", "Mara Ellison", None), found("The Long Field", "Mara Ellison", Some(33))];
    assert_eq!(super::best_match("The Long Field", Some("Mara Ellison"), &coverless_first).and_then(|doc| doc.cover_i), Some(33));

    // A closer title still wins over a cover, and another author's book is no match.
    let closer = vec![found("The Long Field Companion", "Mara Ellison", Some(5)), found("The Long Field", "Mara Ellison", None)];
    assert_eq!(super::best_match("The Long Field", Some("Mara Ellison"), &closer).and_then(|doc| doc.title.clone()).as_deref(), Some("The Long Field"));
    let other = vec![found("The Long Field", "Someone Else", Some(9))];
    assert!(super::best_match("The Long Field", Some("Mara Ellison"), &other).is_none());
    assert!(super::best_match("The Long Field", None, &[]).is_none());
  }

  use super::*;

  #[test]
  fn accepts_the_same_book() {
    assert!(is_match("Dune", Some("Frank Herbert"), Some("Dune"), Some("Frank Herbert")));
    assert!(is_match("The Hobbit", None, Some("The Hobbit, or There and Back Again"), Some("J.R.R. Tolkien")));
    assert!(is_match("Red Rising", Some("Pierce Brown"), Some("Red Rising"), Some("Pierce Brown")));
    assert!(is_match("Pride & Prejudice", None, Some("Pride and Prejudice"), Some("Jane Austen")));
  }

  #[test]
  fn rejects_a_loose_guess() {
    // The real case: "e2e" matched a thriller, and a test book matched a Christie.
    assert!(!is_match("e2e", None, Some("2nd Chance"), Some("James Patterson")));
    assert!(!is_match("E2E Sigil Book", Some("Leaflet QA"), Some("Sleeping Murder"), Some("Agatha Christie")));
    assert!(!is_match("Dune", Some("Frank Herbert"), Some("Children of Dune"), Some("Frank Herbert")));
    assert!(!is_match("Dark Age", Some("Pierce Brown"), Some("Dark Age"), Some("Someone Else")));
  }

  /// The bug this guards: the search was not asked for `subject`, which it no
  /// longer sends unasked, so no lookup ever gave a book a genre.
  #[test]
  fn a_search_asks_for_the_subjects_by_name() {
    let by_title = search_url("Night Ferry", Some("Mara Ellison"), None);
    assert!(by_title.starts_with("https://openlibrary.org/search.json?q=title%3ANight%20Ferry%20author%3AMara%20Ellison&"), "{by_title}");
    let by_isbn = search_url("ignored", None, Some("9780306406157"));
    assert!(by_isbn.contains("?isbn=9780306406157&"), "{by_isbn}");
    for url in [by_title, by_isbn] {
      let fields = url.split("fields=").nth(1).and_then(|rest| rest.split('&').next()).unwrap_or("");
      for needed in ["title", "author_name", "subject", "cover_i"] {
        assert!(fields.split(',').any(|field| field == needed), "{needed} in {url}");
      }
    }
    // And what comes back is read: subjects, cover and all.
    let reply = r#"{"docs":[{"key":"/works/OL1W","title":"Night Ferry","author_name":["Mara Ellison"],"cover_i":42,
      "subject":["series:Saltmarsh","genre:science fiction","Fiction"]}]}"#;
    let parsed: SearchResponse = serde_json::from_str(reply).expect("reply");
    assert_eq!(parsed.docs[0].subject.as_deref().map(<[String]>::len), Some(3));
    assert_eq!(parsed.docs[0].cover_i, Some(42));
  }

  #[test]
  fn similarity_ignores_filler_and_case() {
    assert!((title_similarity("The Great Gatsby", "great gatsby") - 1.0).abs() < 1e-9);
    assert!(title_similarity("Dune", "Children of Dune") < 0.6);
  }
}
