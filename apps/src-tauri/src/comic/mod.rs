//! Comic archives as page images.
//!
//! A CBZ is a zip of page scans. Flattening it into an EPUB would turn a comic
//! into a broken text document, so the pages are served one at a time to the
//! same page reader that renders PDFs.

use anyhow::Result;
use std::cmp::Ordering;
use std::io::Read;
use std::path::Path;

const IMAGE_EXTENSIONS: [&str; 7] = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"];

fn is_page_image(name: &str) -> bool {
  let lowered = name.to_lowercase();
  // Archive tools and macOS leave metadata directories behind that would
  // otherwise show up as unreadable pages.
  if lowered.starts_with("__macosx/") || lowered.contains("/.") || lowered.starts_with('.') {
    return false;
  }
  IMAGE_EXTENSIONS
    .iter()
    .any(|extension| lowered.ends_with(&format!(".{extension}")))
}

/// Orders `page2` before `page10`, which a plain lexicographic sort would not.
pub fn natural_cmp(left: &str, right: &str) -> Ordering {
  let mut a = left.chars().peekable();
  let mut b = right.chars().peekable();

  loop {
    match (a.peek().copied(), b.peek().copied()) {
      (None, None) => return Ordering::Equal,
      (None, Some(_)) => return Ordering::Less,
      (Some(_), None) => return Ordering::Greater,
      (Some(x), Some(y)) => {
        if x.is_ascii_digit() && y.is_ascii_digit() {
          let mut left_digits = String::new();
          while let Some(c) = a.peek().copied() {
            if !c.is_ascii_digit() {
              break;
            }
            left_digits.push(c);
            a.next();
          }
          let mut right_digits = String::new();
          while let Some(c) = b.peek().copied() {
            if !c.is_ascii_digit() {
              break;
            }
            right_digits.push(c);
            b.next();
          }
          // Compare numerically; fall back to length for numbers too long to fit.
          let left_value = left_digits.trim_start_matches('0');
          let right_value = right_digits.trim_start_matches('0');
          let order = left_value
            .len()
            .cmp(&right_value.len())
            .then_with(|| left_value.cmp(right_value));
          if order != Ordering::Equal {
            return order;
          }
        } else {
          let order = x.to_ascii_lowercase().cmp(&y.to_ascii_lowercase());
          if order != Ordering::Equal {
            return order;
          }
          a.next();
          b.next();
        }
      }
    }
  }
}

/// Page entry names in reading order.
pub fn list_pages(archive_path: &Path) -> Result<Vec<String>> {
  let file = std::fs::File::open(archive_path)?;
  let mut archive = zip::ZipArchive::new(file)?;
  let mut names = Vec::new();
  for index in 0..archive.len() {
    let entry = archive.by_index(index)?;
    if entry.is_file() && is_page_image(entry.name()) {
      names.push(entry.name().to_string());
    }
  }
  if names.is_empty() {
    return Err(anyhow::anyhow!("this archive contains no page images"));
  }
  names.sort_by(|a, b| natural_cmp(a, b));
  Ok(names)
}

pub fn mime_for(name: &str) -> &'static str {
  let lowered = name.to_lowercase();
  if lowered.ends_with(".png") {
    "image/png"
  } else if lowered.ends_with(".gif") {
    "image/gif"
  } else if lowered.ends_with(".webp") {
    "image/webp"
  } else if lowered.ends_with(".bmp") {
    "image/bmp"
  } else if lowered.ends_with(".avif") {
    "image/avif"
  } else {
    "image/jpeg"
  }
}

/// Raw bytes of one page.
pub fn read_page(archive_path: &Path, entry_name: &str) -> Result<Vec<u8>> {
  let file = std::fs::File::open(archive_path)?;
  let mut archive = zip::ZipArchive::new(file)?;
  let mut entry = archive.by_name(entry_name)?;
  let mut bytes = Vec::new();
  entry.read_to_end(&mut bytes)?;
  Ok(bytes)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn pages_sort_numerically_not_lexicographically() {
    let mut names = vec!["page10.jpg", "page2.jpg", "page1.jpg"];
    names.sort_by(|a, b| natural_cmp(a, b));
    assert_eq!(names, vec!["page1.jpg", "page2.jpg", "page10.jpg"]);
  }

  #[test]
  fn zero_padding_does_not_change_the_order() {
    let mut names = vec!["p008.jpg", "p10.jpg", "p9.jpg"];
    names.sort_by(|a, b| natural_cmp(a, b));
    assert_eq!(names, vec!["p008.jpg", "p9.jpg", "p10.jpg"]);
  }

  #[test]
  fn nested_chapter_directories_stay_grouped() {
    let mut names = vec!["ch2/p1.jpg", "ch10/p1.jpg", "ch1/p2.jpg", "ch1/p10.jpg"];
    names.sort_by(|a, b| natural_cmp(a, b));
    assert_eq!(
      names,
      vec!["ch1/p2.jpg", "ch1/p10.jpg", "ch2/p1.jpg", "ch10/p1.jpg"]
    );
  }

  #[test]
  fn comparison_is_case_insensitive_but_total() {
    assert_eq!(natural_cmp("Page1.jpg", "page1.jpg"), Ordering::Equal);
    assert_eq!(natural_cmp("a", "b"), Ordering::Less);
    assert_eq!(natural_cmp("", ""), Ordering::Equal);
  }

  #[test]
  fn archive_metadata_is_not_treated_as_a_page() {
    assert!(!is_page_image("__MACOSX/._page1.jpg"));
    assert!(!is_page_image(".hidden/page1.jpg"));
    assert!(!is_page_image("ComicInfo.xml"));
    assert!(!is_page_image("thumbs.db"));
  }

  #[test]
  fn common_image_types_are_recognised() {
    for name in ["p.jpg", "p.JPEG", "p.png", "p.webp", "sub/dir/p.gif"] {
      assert!(is_page_image(name), "{name}");
    }
  }

  #[test]
  fn mime_types_follow_the_extension() {
    assert_eq!(mime_for("a.png"), "image/png");
    assert_eq!(mime_for("a.WEBP"), "image/webp");
    assert_eq!(mime_for("a.jpg"), "image/jpeg");
    assert_eq!(mime_for("a.unknown"), "image/jpeg");
  }
}
