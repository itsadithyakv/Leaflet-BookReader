#[derive(Debug, Clone)]
pub struct NormalizedQuery {
  pub title: String,
  pub author: Option<String>,
  pub isbn: Option<String>
}

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

fn split_by_known_separators(input: &str) -> Vec<String> {
  let separators = [" -- ", " — ", " – ", " - ", " | ", " :: "];
  for sep in separators.iter() {
    if input.contains(sep) {
      return input
        .split(sep)
        .map(|part| collapse_spaces(part))
        .filter(|part| !part.is_empty())
        .collect();
    }
  }
  vec![collapse_spaces(input)]
}

fn looks_like_author(candidate: &str) -> bool {
  let lower = candidate.to_lowercase();
  let blocked = [
    "edition", "ed.", "series", "ser", "volume", "vol", "new york", "publisher",
    "press", "©", "copyright", "isbn", "archive", "annas archive", "anna", "knopf"
  ];
  if blocked.iter().any(|entry| lower.contains(entry)) {
    return false;
  }
  let has_letters = candidate.chars().any(|ch| ch.is_alphabetic());
  has_letters && candidate.len() <= 60
}

fn normalize_author_name(candidate: &str) -> String {
  let cleaned = collapse_spaces(candidate);
  if let Some((last, first)) = cleaned.split_once(',') {
    let last = collapse_spaces(last);
    let first = collapse_spaces(first);
    if !first.is_empty() && !last.is_empty() {
      return format!("{} {}", first, last);
    }
  }
  cleaned
}

fn extract_isbn(raw: &str) -> Option<String> {
  let mut token = String::new();
  let mut found: Option<String> = None;
  let flush = |tok: &mut String, found: &mut Option<String>| {
    if tok.is_empty() {
      return;
    }
    let cleaned: String = tok.chars().filter(|ch| ch.is_ascii_digit() || *ch == 'X' || *ch == 'x').collect();
    if cleaned.len() == 10 || cleaned.len() == 13 {
      *found = Some(cleaned.to_uppercase());
    }
    tok.clear();
  };

  for ch in raw.chars() {
    if ch.is_ascii_digit() || ch == 'X' || ch == 'x' || ch == '-' {
      token.push(ch);
    } else {
      flush(&mut token, &mut found);
      if found.is_some() {
        break;
      }
    }
  }
  if found.is_none() {
    flush(&mut token, &mut found);
  }
  found
}

pub fn normalize_query(raw_title: &str, raw_author: Option<&str>) -> NormalizedQuery {
  let mut title = raw_title.replace('_', " ");
  title = collapse_spaces(&title);

  let isbn = extract_isbn(&title);
  let parts = split_by_known_separators(&title);
  let base_title = parts.first().cloned().unwrap_or_else(|| title.clone());

  let mut author = raw_author.map(normalize_author_name).filter(|value| !value.is_empty());
  if author.is_none() {
    for part in parts.iter().skip(1) {
      if looks_like_author(part) {
        author = Some(normalize_author_name(part));
        break;
      }
    }
  }

  NormalizedQuery {
    title: base_title,
    author,
    isbn
  }
}

pub fn is_noisy_title(title: &str) -> bool {
  let lower = title.to_lowercase();
  if lower.contains(" -- ")
    || lower.contains("anna")
    || lower.contains("archive")
    || lower.contains("isbn")
    || lower.contains("©")
    || lower.contains("_")
    || lower.contains(" ser")
    || lower.contains(" ed")
  {
    return true;
  }
  title.len() > 120
}
