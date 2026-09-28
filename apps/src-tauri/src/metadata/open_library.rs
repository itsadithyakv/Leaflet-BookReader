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

pub async fn fetch_metadata(title: &str, author: Option<&str>, isbn: Option<&str>) -> Result<Option<OpenLibraryMetadata>> {
  // A hung lookup used to stall the whole metadata queue behind it.
  let client = Client::builder().timeout(std::time::Duration::from_secs(15)).build()?;
  let url = if let Some(isbn) = isbn {
    format!("https://openlibrary.org/search.json?isbn={}", urlencoding::encode(isbn))
  } else {
    let mut query = format!("title:{}", title);
    if let Some(author) = author {
      query.push_str(" author:");
      query.push_str(author);
    }
    format!("https://openlibrary.org/search.json?q={}", urlencoding::encode(&query))
  };

  let response: SearchResponse = client.get(url).send().await?.json().await?;
  // A search returns its best guesses, not an answer: the first result for a
  // title like "e2e" was a James Patterson thriller, and it used to be taken
  // as-is and renamed the book. An ISBN lookup is exact; a title search must
  // actually match the title (and the author, when both are known).
  let doc = if isbn.is_some() {
    response.docs.first()
  } else {
    response
      .docs
      .iter()
      .take(5)
      .filter(|doc| is_match(title, author, doc.title.as_deref(), doc.author_name.as_ref().and_then(|a| a.first()).map(String::as_str)))
      .max_by(|a, b| {
        let score = |doc: &SearchDoc| title_similarity(title, doc.title.as_deref().unwrap_or(""));
        score(a).partial_cmp(&score(b)).unwrap_or(std::cmp::Ordering::Equal)
      })
  };
  let doc = match doc {
    Some(doc) => doc,
    None => return Ok(None)
  };

  let cover_url = doc.cover_i.map(|cover_id| {
    format!("https://covers.openlibrary.org/b/id/{}-L.jpg", cover_id)
  });

  let mut subjects = doc.subject.clone().unwrap_or_default();
  subjects.truncate(8);

  Ok(Some(OpenLibraryMetadata {
    title: doc.title.clone().unwrap_or_else(|| title.to_string()),
    author: doc.author_name.as_ref().and_then(|authors| authors.first().cloned()),
    subjects,
    cover_url
  }))
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
fn title_similarity(a: &str, b: &str) -> f64 {
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

  #[test]
  fn similarity_ignores_filler_and_case() {
    assert!((title_similarity("The Great Gatsby", "great gatsby") - 1.0).abs() < 1e-9);
    assert!(title_similarity("Dune", "Children of Dune") < 0.6);
  }
}
