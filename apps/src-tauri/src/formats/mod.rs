//! The single source of truth for which files Leaflet accepts and how each one
//! reaches the reader.
//!
//! This list used to be duplicated across `main.rs`, `commands`, `storage` and
//! the frontend, and the copies disagreed: imports accepted four extensions
//! while the converter only handled two, so anything else imported fine and then
//! failed to open. Everything now derives from `FORMATS`.
//!
//! The frontend mirror lives in `apps/src/constants/bookFormats.ts`; the desktop
//! file picker pulls this table over IPC so the dialog cannot drift from what
//! the backend will actually accept.

use serde::Serialize;

/// How a format gets in front of the reader, in ascending order of cost to the
/// user. Everything up to and including `Builtin` works out of the box;
/// `Convert` is the only tier that needs Calibre.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Delivery {
  /// Rendered directly by the EPUB reader.
  Epub,
  /// Page images rendered by pdf.js.
  Pdf,
  /// Page images read straight out of a comic archive.
  Comic,
  /// Converted to EPUB in-process by Leaflet, with no external dependency.
  Builtin,
  /// Handed to Calibre's `ebook-convert` and rendered as the resulting EPUB.
  Convert
}

impl Delivery {
  /// Whether opening this format can ever require installing Calibre.
  pub fn needs_external_converter(self) -> bool {
    matches!(self, Delivery::Convert)
  }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Format {
  pub extension: &'static str,
  pub label: &'static str,
  pub delivery: Delivery,
  /// One representative per family, so UI copy can say "TXT" instead of
  /// "TXT, TXTZ" and "HTML" instead of "HTML, HTM, HTMLZ, XHTML".
  pub headline: bool
}

const fn native(extension: &'static str, label: &'static str, delivery: Delivery) -> Format {
  Format { extension, label, delivery, headline: true }
}

const fn convert(extension: &'static str, label: &'static str) -> Format {
  Format { extension, label, delivery: Delivery::Convert, headline: false }
}

/// A builtin format that represents its family in UI copy.
const fn builtin_headline(extension: &'static str, label: &'static str) -> Format {
  Format { extension, label, delivery: Delivery::Builtin, headline: true }
}

/// A builtin variant covered by an earlier headline entry.
const fn builtin(extension: &'static str, label: &'static str) -> Format {
  Format { extension, label, delivery: Delivery::Builtin, headline: false }
}

/// Input formats Calibre's `ebook-convert` can read, plus the two Leaflet
/// renders itself. Ordered so the common ones surface first in the UI.
pub const FORMATS: &[Format] = &[
  native("epub", "EPUB", Delivery::Epub),
  native("pdf", "PDF", Delivery::Pdf),
  // Comics are page images, not reflowable text, so they go to the page reader
  // rather than being flattened into an EPUB.
  native("cbz", "CBZ", Delivery::Comic),
  // Handled in-process: plain markup or simple XML that needs no Calibre.
  builtin_headline("txt", "TXT"),
  builtin("txtz", "TXTZ"),
  builtin_headline("html", "HTML"),
  builtin("htm", "HTM"),
  builtin("htmlz", "HTMLZ"),
  builtin("xhtml", "XHTML"),
  builtin_headline("fb2", "FB2"),
  builtin("fbz", "FBZ"),
  // Everything below needs Calibre.
  convert("mobi", "MOBI"),
  convert("azw3", "AZW3"),
  convert("azw", "AZW"),
  convert("azw4", "AZW4"),
  convert("prc", "PRC"),
  convert("pdb", "PDB"),
  convert("lit", "LIT"),
  convert("lrf", "LRF"),
  convert("rb", "RB"),
  convert("snb", "SNB"),
  convert("tcr", "TCR"),
  convert("pml", "PML"),
  convert("pmlz", "PMLZ"),
  convert("rtf", "RTF"),
  convert("docx", "DOCX"),
  convert("odt", "ODT"),
  convert("chm", "CHM"),
  convert("cbr", "CBR"),
  convert("cbc", "CBC")
];

/// Case-insensitive lookup by file extension (without the dot).
pub fn lookup(extension: &str) -> Option<&'static Format> {
  FORMATS
    .iter()
    .find(|format| format.extension.eq_ignore_ascii_case(extension))
}

pub fn extension_of(path: &std::path::Path) -> String {
  path
    .extension()
    .and_then(|value| value.to_str())
    .unwrap_or("")
    .to_lowercase()
}

pub fn is_supported(extension: &str) -> bool {
  lookup(extension).is_some()
}

/// Human-readable list for error messages, trimmed so the full table does not
/// swamp the UI.
pub fn summary() -> String {
  let primary: Vec<&str> = FORMATS.iter().take(4).map(|format| format.label).collect();
  let rest = FORMATS.len() - primary.len();
  if rest == 0 {
    return primary.join(", ");
  }
  format!("{} and {} more formats", primary.join(", "), rest)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn extensions_are_unique_and_normalised() {
    let mut seen = std::collections::HashSet::new();
    for format in FORMATS {
      assert!(
        format.extension.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
        "{} should be lowercase",
        format.extension
      );
      assert!(seen.insert(format.extension), "duplicate entry for {}", format.extension);
    }
  }

  #[test]
  fn exactly_one_format_maps_to_each_native_reader() {
    let epub = FORMATS.iter().filter(|f| f.delivery == Delivery::Epub).count();
    let pdf = FORMATS.iter().filter(|f| f.delivery == Delivery::Pdf).count();
    assert_eq!(epub, 1);
    assert_eq!(pdf, 1);
  }

  #[test]
  fn every_builtin_format_has_a_converter() {
    for format in FORMATS.iter().filter(|f| f.delivery == Delivery::Builtin) {
      assert!(
        crate::convert::handles(format.extension),
        "{} is declared builtin but nothing converts it",
        format.extension
      );
    }
  }

  #[test]
  fn lookup_ignores_case() {
    assert_eq!(lookup("AZW3").map(|f| f.delivery), Some(Delivery::Convert));
    assert_eq!(lookup("Epub").map(|f| f.delivery), Some(Delivery::Epub));
    assert!(lookup("exe").is_none());
    assert!(lookup("").is_none());
  }

  /// The formats the app previously accepted must keep working.
  #[test]
  fn previously_supported_formats_are_still_supported() {
    for extension in ["epub", "pdf", "mobi", "azw3"] {
      assert!(is_supported(extension), "{extension} regressed");
    }
  }

  #[test]
  fn every_family_has_exactly_one_headline() {
    // Each headline label must be unique, or UI copy repeats itself.
    let mut seen = std::collections::HashSet::new();
    for format in FORMATS.iter().filter(|f| f.headline) {
      assert!(seen.insert(format.label), "duplicate headline {}", format.label);
    }
    // The variants that are not headlines must still be supported.
    for extension in ["txtz", "htm", "htmlz", "xhtml", "fbz"] {
      let format = lookup(extension).expect(extension);
      assert!(!format.headline, "{extension} should defer to its family");
      assert!(!format.delivery.needs_external_converter(), "{extension}");
    }
  }

  #[test]
  fn the_headline_set_is_short_enough_for_ui_copy() {
    let headlines: Vec<&str> = FORMATS
      .iter()
      .filter(|f| f.headline && !f.delivery.needs_external_converter())
      .map(|f| f.label)
      .collect();
    assert!(headlines.len() <= 8, "{headlines:?}");
    assert_eq!(headlines.first(), Some(&"EPUB"));
  }

  #[test]
  fn the_common_formats_need_no_external_converter() {
    for extension in ["epub", "pdf", "cbz", "txt", "html", "fb2"] {
      let format = lookup(extension).expect(extension);
      assert!(
        !format.delivery.needs_external_converter(),
        "{extension} should open without Calibre"
      );
    }
  }

  #[test]
  fn kindle_and_office_formats_still_route_to_calibre() {
    for extension in ["mobi", "azw3", "docx", "odt", "rtf", "cbr"] {
      let format = lookup(extension).expect(extension);
      assert!(
        format.delivery.needs_external_converter(),
        "{extension} has no in-process converter"
      );
    }
  }

  #[test]
  fn summary_leads_with_the_formats_that_always_work() {
    let text = summary();
    assert!(text.starts_with("EPUB, PDF"), "{text}");
    assert!(text.len() < 60, "{text}");
    // The named formats must be ones that need no external converter, or the
    // message advertises a dependency it does not mention.
    for label in text.split(" and ").next().unwrap_or("").split(", ") {
      let format = FORMATS.iter().find(|f| f.label == label).expect(label);
      assert!(!format.delivery.needs_external_converter(), "{label}");
    }
  }
}
