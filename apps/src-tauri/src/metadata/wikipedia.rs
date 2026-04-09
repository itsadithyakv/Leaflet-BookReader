use anyhow::Result;
use reqwest::Client;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct OpenSearchResult(
  String,
  Vec<String>,
  Vec<String>,
  Vec<String>
);

#[derive(Debug, Deserialize)]
struct SummaryResponse {
  thumbnail: Option<Thumbnail>
}

#[derive(Debug, Deserialize)]
struct Thumbnail {
  source: String
}

pub async fn fetch_cover(title: &str, author: Option<&str>) -> Result<Option<String>> {
  let client = Client::new();
  let mut query = title.to_string();
  if let Some(author) = author {
    if !author.trim().is_empty() {
      query.push_str(" ");
      query.push_str(author);
    }
  }

  let search_url = format!(
    "https://en.wikipedia.org/w/api.php?action=opensearch&search={}&limit=1&namespace=0&format=json",
    urlencoding::encode(&query)
  );

  let response: OpenSearchResult = client.get(search_url).send().await?.json().await?;
  let page_title = response.1.first().cloned();
  let page_title = match page_title {
    Some(title) => title,
    None => return Ok(None)
  };

  let summary_url = format!(
    "https://en.wikipedia.org/api/rest_v1/page/summary/{}",
    urlencoding::encode(&page_title)
  );

  let summary: SummaryResponse = client.get(summary_url).send().await?.json().await?;
  Ok(summary.thumbnail.map(|thumb| thumb.source))
}
