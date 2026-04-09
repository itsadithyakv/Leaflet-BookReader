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
  let client = Client::new();
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
  let doc = match response.docs.first() {
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
