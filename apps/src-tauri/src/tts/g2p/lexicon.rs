//! A pronouncing lexicon held as one string and a sorted index (a few MB,
//! no allocation per word), looked up by binary search.
//!
//! Two formats are read:
//!   - Leaflet's (`g2p/en-us.lex`, from misaki's gold and silver lexicons):
//!     `word \t g|s \t phonemes`, where phonemes is either a string or, for a
//!     word said by its part of speech, `DEFAULT=…;VERB=…;None=…` (an empty
//!     value: say it letter by letter). Lines starting `#` are comments.
//!   - sherpa-onnx's Kokoro lexicon (`lexicon-us-en.txt`): `word p h o n e s`.
//!   - CMUdict's (`g2p/cmudict-extra.txt`): `word \t ARPAbet`.

use std::cmp::Ordering;

#[derive(Clone, Copy)]
struct Span {
  start: u32,
  len: u32,
}

impl Span {
  fn of<'a>(&self, text: &'a str) -> &'a str {
    &text[self.start as usize..(self.start + self.len) as usize]
  }
}

#[derive(Clone, Copy)]
struct Row {
  key: Span,
  value: Span,
  gold: bool,
}

pub struct Lexicon {
  text: String,
  rows: Vec<Row>,
}

/// An entry as found.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Found<'a> {
  pub value: &'a str,
  /// From misaki's gold lexicon (hand-checked), not its silver one.
  pub gold: bool,
}

impl<'a> Found<'a> {
  /// The phonemes for a part of speech (misaki's tags: `VBD`, `NOUN`, …;
  /// `None` for a word with nothing after it in its sentence). Some(None):
  /// say it letter by letter.
  pub fn for_tag(&self, tag: Option<&str>) -> Option<&'a str> {
    if !self.value.contains('=') {
      return Some(self.value);
    }
    let lookup = |want: &str| {
      self.value.split(';').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == want).then_some(value)
      })
    };
    let value = tag
      .and_then(|tag| lookup(tag).or_else(|| parent_tag(tag).and_then(lookup)))
      .or_else(|| lookup("DEFAULT"))?;
    (!value.is_empty()).then_some(value)
  }

  pub fn has_tag(&self, tag: &str) -> bool {
    self.value.split(';').any(|pair| pair.split_once('=').is_some_and(|(key, _)| key == tag))
  }
}

/// misaki's `get_parent_tag`.
pub fn parent_tag(tag: &str) -> Option<&'static str> {
  if tag.starts_with("VB") {
    Some("VERB")
  } else if tag.starts_with("NN") {
    Some("NOUN")
  } else if tag.starts_with("RB") || tag.starts_with("ADV") {
    Some("ADV")
  } else if tag.starts_with("JJ") || tag.starts_with("ADJ") {
    Some("ADJ")
  } else {
    None
  }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Format {
  /// `word \t g|s \t phonemes`
  Leaflet,
  /// `word p h o n e s` (sherpa-onnx's Kokoro lexicons)
  Sherpa,
  /// `word \t ARPA BET` (one pronunciation per word)
  Cmu,
}

impl Lexicon {
  pub fn parse(source: &str, format: Format) -> Lexicon {
    let mut text = String::with_capacity(source.len());
    let mut rows = Vec::new();
    for line in source.lines() {
      if line.is_empty() || line.starts_with('#') {
        continue;
      }
      let (key, gold, value): (&str, bool, String) = match format {
        Format::Leaflet => {
          let mut parts = line.splitn(3, '\t');
          let (Some(key), Some(tier), Some(value)) = (parts.next(), parts.next(), parts.next()) else { continue };
          (key, tier == "g", value.to_string())
        }
        Format::Cmu => {
          let Some((key, value)) = line.split_once('\t') else { continue };
          (key, false, value.to_string())
        }
        Format::Sherpa => {
          let mut parts = line.split_whitespace();
          let Some(key) = parts.next() else { continue };
          (key, true, parts.collect::<String>())
        }
      };
      if key.is_empty() || value.is_empty() {
        continue;
      }
      let key_span = Span { start: text.len() as u32, len: key.len() as u32 };
      text.push_str(key);
      let value_span = Span { start: text.len() as u32, len: value.len() as u32 };
      text.push_str(&value);
      rows.push(Row { key: key_span, value: value_span, gold });
    }
    rows.sort_by(|a, b| a.key.of(&text).cmp(b.key.of(&text)));
    // The first of a repeated word wins (CMUdict's first pronunciation).
    rows.dedup_by(|later, earlier| later.key.of(&text) == earlier.key.of(&text));
    Lexicon { text, rows }
  }

  pub fn len(&self) -> usize {
    self.rows.len()
  }

  pub fn is_empty(&self) -> bool {
    self.rows.is_empty()
  }

  pub fn get(&self, word: &str) -> Option<Found<'_>> {
    let index = self.rows.binary_search_by(|row| row.key.of(&self.text).cmp(word)).ok()?;
    let row = self.rows[index];
    Some(Found { value: row.value.of(&self.text), gold: row.gold })
  }

  pub fn contains(&self, word: &str) -> bool {
    self.get(word).is_some()
  }

  /// Every word that starts with `prefix` (for tests and tools).
  pub fn with_prefix<'a>(&'a self, prefix: &'a str) -> impl Iterator<Item = (&'a str, Found<'a>)> + 'a {
    let start = self.rows.partition_point(|row| row.key.of(&self.text).cmp(prefix) == Ordering::Less);
    self.rows[start..]
      .iter()
      .map(|row| (row.key.of(&self.text), Found { value: row.value.of(&self.text), gold: row.gold }))
      .take_while(move |(key, _)| key.starts_with(prefix))
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  const SAMPLE: &str = "# a comment\nread\tg\tADJ=ɹˈɛd;DEFAULT=ɹˈid;VBD=ɹˈɛd;VBN=ɹˈɛd;VBP=ɹˈɛd\nfamily\tg\tfˈæmᵊli\nUS\tg\tDEFAULT=ˌʌs;NOUN=\nbe\tg\tDEFAULT=bi;None=bˈi\nzebra\ts\tzˈibɹə\n";

  #[test]
  fn plain_and_tagged() {
    let lexicon = Lexicon::parse(SAMPLE, Format::Leaflet);
    assert_eq!(lexicon.len(), 5);
    assert_eq!(lexicon.get("family").unwrap().for_tag(None), Some("fˈæmᵊli"));
    let read = lexicon.get("read").unwrap();
    assert_eq!(read.for_tag(None), Some("ɹˈid"));
    assert_eq!(read.for_tag(Some("VBD")), Some("ɹˈɛd"));
    assert_eq!(read.for_tag(Some("VB")), Some("ɹˈid"));
    assert_eq!(lexicon.get("US").unwrap().for_tag(Some("NNP")), None);
    assert_eq!(lexicon.get("be").unwrap().for_tag(Some("None")), Some("bˈi"));
    assert!(lexicon.get("be").unwrap().has_tag("None"));
    assert!(!lexicon.get("zebra").unwrap().gold);
    assert!(lexicon.get("Family").is_none());
  }

  #[test]
  fn sherpa_and_cmu() {
    let sherpa = Lexicon::parse("abandon ə b ˈ æ n d ə n\nkokoro k ˈ O k ə ɹ O\n", Format::Sherpa);
    assert_eq!(sherpa.get("abandon").unwrap().value, "əbˈændən");
    let cmu = Lexicon::parse("bennet\tB EH1 N IH0 T\nbennet\tB EH0 N EH1 T\n", Format::Cmu);
    assert_eq!(cmu.len(), 1);
    assert_eq!(cmu.get("bennet").unwrap().value, "B EH1 N IH0 T");
    assert_eq!(cmu.with_prefix("ben").count(), 1);
  }
}
