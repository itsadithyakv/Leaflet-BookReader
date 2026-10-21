//! A word no lexicon has, made from one it has: inflections first (misaki's
//! own rules, `en.py` `_s`/`_ed`/`_ing`, Apache-2.0, with the allomorphs
//! /s z ɪz/, /t d ɪd/), then derivations (-ly, -ness, -er, un-, …) and
//! compounds (two known words: nether + field).

use super::Accent;

/// misaki's vowels (its `VOWELS`).
pub const VOWELS: &str = "AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻ";
/// misaki's `US_TAUS`: before a t, these make it a flap.
const US_TAUS: &str = "AIOWYiuæɑəɛɪɹʊʌ";

pub fn is_vowel(c: char) -> bool {
  VOWELS.contains(c)
}

fn last(s: &str) -> Option<char> {
  s.chars().next_back()
}

fn second_last(s: &str) -> Option<char> {
  s.chars().rev().nth(1)
}

fn without_last(s: &str) -> &str {
  match s.char_indices().next_back() {
    Some((at, _)) => &s[..at],
    None => s,
  }
}

/// -s, -es, 's: /s/ after a voiceless sound, /ɪz/ after a sibilant, else /z/.
pub fn add_s(stem: &str, accent: Accent) -> String {
  match last(stem) {
    Some(c) if "ptkfθ".contains(c) => format!("{stem}s"),
    Some(c) if "szʃʒʧʤ".contains(c) => format!("{stem}{}z", if accent == Accent::Gb { 'ɪ' } else { 'ᵻ' }),
    _ => format!("{stem}z"),
  }
}

/// -ed: /t/ after a voiceless sound, /ɪd/ after t or d, else /d/.
pub fn add_ed(stem: &str, accent: Accent) -> String {
  let reduced = if accent == Accent::Gb { 'ɪ' } else { 'ᵻ' };
  match last(stem) {
    Some(c) if "pkfθʃsʧ".contains(c) => format!("{stem}t"),
    Some('d') => format!("{stem}{reduced}d"),
    Some('t') if accent == Accent::Gb || stem.chars().count() < 2 => format!("{stem}ɪd"),
    Some('t') if second_last(stem).is_some_and(|c| US_TAUS.contains(c)) => format!("{}ɾᵻd", without_last(stem)),
    Some('t') => format!("{stem}ᵻd"),
    _ => format!("{stem}d"),
  }
}

/// -ing. (misaki leaves a British stem ending in ə or ː alone: none.)
pub fn add_ing(stem: &str, accent: Accent) -> Option<String> {
  if stem.is_empty() {
    return None;
  }
  if accent == Accent::Gb {
    if last(stem).is_some_and(|c| "əː".contains(c)) {
      return None;
    }
  } else if last(stem) == Some('t') && second_last(stem).is_some_and(|c| US_TAUS.contains(c)) {
    return Some(format!("{}ɾɪŋ", without_last(stem)));
  }
  Some(format!("{stem}ɪŋ"))
}

fn doubled_before(word: &str, suffix_len: usize) -> bool {
  let bytes = word.as_bytes();
  let n = bytes.len();
  n >= suffix_len + 2 && bytes[n - suffix_len - 1] == bytes[n - suffix_len - 2] && b"bcdgklmnprstvxz".contains(&bytes[n - suffix_len - 1])
}

/// The stem of a word in -s, as misaki finds it (`stem_s`), and one more:
/// -s' (the Bennets').
pub fn stem_s(word: &str, known: &dyn Fn(&str) -> bool) -> Option<String> {
  let n = word.len();
  if n < 3 || !word.is_ascii() {
    return None;
  }
  if !word.ends_with('s') {
    return None;
  }
  if !word.ends_with("ss") && known(&word[..n - 1]) {
    return Some(word[..n - 1].into());
  }
  if (word.ends_with("'s") || (n > 4 && word.ends_with("es") && !word.ends_with("ies"))) && known(&word[..n - 2]) {
    return Some(word[..n - 2].into());
  }
  if n > 4 && word.ends_with("ies") {
    let stem = format!("{}y", &word[..n - 3]);
    if known(&stem) {
      return Some(stem);
    }
  }
  None
}

/// The stem of a word in -ed (misaki's `stem_ed`, and -ied, and a doubled
/// consonant: stopped). A bare -d only after an e (hoped), not after any
/// word (misaki would make "galad" of "gala").
pub fn stem_ed(word: &str, known: &dyn Fn(&str) -> bool) -> Option<String> {
  let n = word.len();
  if n < 4 || !word.is_ascii() || !word.ends_with('d') {
    return None;
  }
  if word.ends_with("ed") && !word.ends_with("dd") && known(&word[..n - 1]) {
    return Some(word[..n - 1].into());
  }
  if n > 4 && word.ends_with("ed") && !word.ends_with("eed") && known(&word[..n - 2]) {
    return Some(word[..n - 2].into());
  }
  if n > 4 && word.ends_with("ied") {
    let stem = format!("{}y", &word[..n - 3]);
    if known(&stem) {
      return Some(stem);
    }
  }
  if n > 5 && word.ends_with("ed") && doubled_before(word, 2) && known(&word[..n - 3]) {
    return Some(word[..n - 3].into());
  }
  None
}

/// The stem of a word in -ing (misaki's `stem_ing`).
pub fn stem_ing(word: &str, known: &dyn Fn(&str) -> bool) -> Option<String> {
  let n = word.len();
  if n < 5 || !word.is_ascii() || !word.ends_with("ing") {
    return None;
  }
  if n > 5 && known(&word[..n - 3]) {
    return Some(word[..n - 3].into());
  }
  let with_e = format!("{}e", &word[..n - 3]);
  if known(&with_e) {
    return Some(with_e);
  }
  if n > 5 && (doubled_before(word, 3) || word.ends_with("cking")) && known(&word[..n - 4]) {
    return Some(word[..n - 4].into());
  }
  None
}

/// misaki's `apply_stress`: `stress` < -1 takes all stress away; -1 makes
/// the word secondary; 0.5 gives a word with none a secondary one; 2 a
/// primary one.
pub fn apply_stress(ps: &str, stress: Option<f32>) -> String {
  let Some(stress) = stress else {
    return ps.to_string();
  };
  let has_primary = ps.contains('ˈ');
  let has_secondary = ps.contains('ˌ');
  let has_vowel = ps.chars().any(is_vowel);
  if stress < -1.0 {
    ps.replace(['ˈ', 'ˌ'], "")
  } else if stress == -1.0 || ((stress == 0.0 || stress == -0.5) && has_primary) {
    ps.replace('ˌ', "").replace('ˈ', "ˌ")
  } else if (stress == 0.0 || stress == 0.5 || stress == 1.0) && !has_primary && !has_secondary {
    if has_vowel {
      restress('ˌ', ps)
    } else {
      ps.to_string()
    }
  } else if stress >= 1.0 && !has_primary && has_secondary {
    ps.replace('ˌ', "ˈ")
  } else if stress > 1.0 && !has_primary && !has_secondary {
    if has_vowel {
      restress('ˈ', ps)
    } else {
      ps.to_string()
    }
  } else {
    ps.to_string()
  }
}

/// A stress mark put before the first vowel.
fn restress(mark: char, ps: &str) -> String {
  let mut out = String::with_capacity(ps.len() + 2);
  let mut placed = false;
  for c in ps.chars() {
    if !placed && is_vowel(c) {
      out.push(mark);
      placed = true;
    }
    out.push(c);
  }
  out
}

/// Derivational suffixes: (spelling, US, GB, stems to try: (cut, add)).
struct Suffix {
  spelling: &'static str,
  us: &'static str,
  gb: &'static str,
}

const SUFFIXES: &[Suffix] = &[
  Suffix { spelling: "ness", us: "nəs", gb: "nəs" },
  Suffix { spelling: "less", us: "ləs", gb: "ləs" },
  Suffix { spelling: "ly", us: "li", gb: "li" },
  Suffix { spelling: "ful", us: "fəl", gb: "fəl" },
  Suffix { spelling: "ment", us: "mənt", gb: "mənt" },
  Suffix { spelling: "ship", us: "ʃˌɪp", gb: "ʃˌɪp" },
  Suffix { spelling: "hood", us: "hˌʊd", gb: "hˌʊd" },
  Suffix { spelling: "dom", us: "dəm", gb: "dəm" },
  Suffix { spelling: "able", us: "əbᵊl", gb: "əbᵊl" },
  Suffix { spelling: "ish", us: "ɪʃ", gb: "ɪʃ" },
  Suffix { spelling: "est", us: "əst", gb: "ɪst" },
  Suffix { spelling: "er", us: "əɹ", gb: "ə" },
  Suffix { spelling: "ers", us: "əɹz", gb: "əz" },
];

const PREFIXES: &[(&str, &str, &str)] = &[
  ("un", "ˌʌn", "ˌʌn"),
  ("non", "nˌɑn", "nˌɒn"),
  ("dis", "dˌɪs", "dˌɪs"),
  ("mis", "mˌɪs", "mˌɪs"),
  ("re", "ɹˌi", "ɹˌiː"),
  ("pre", "pɹˌi", "pɹˌiː"),
  ("over", "ˌOvəɹ", "ˌQvə"),
  ("under", "ˌʌndəɹ", "ˌʌndə"),
  ("out", "ˌWt", "ˌWt"),
  ("half", "hˌæf", "hˌɑːf"),
  ("self", "sˌɛlf", "sˌɛlf"),
];

/// A word made with a known stem and a suffix or prefix. `lookup` gives a
/// known word's phonemes (lexicon and inflection).
pub fn derive(word: &str, accent: Accent, lookup: &dyn Fn(&str) -> Option<String>) -> Option<String> {
  if !word.is_ascii() || word.len() < 5 {
    return None;
  }
  for suffix in SUFFIXES {
    let Some(base) = word.strip_suffix(suffix.spelling) else { continue };
    if base.len() < 3 {
      continue;
    }
    let add = if accent == Accent::Gb { suffix.gb } else { suffix.us };
    // happi-ness → happy, bak-er → bake, big-g-er → big, plain stem.
    let mut stems: Vec<String> = vec![base.to_string()];
    if let Some(cut) = base.strip_suffix('i') {
      stems.push(format!("{cut}y"));
    }
    if suffix.spelling.starts_with('e') || suffix.spelling == "able" {
      stems.push(format!("{base}e"));
      let b = base.as_bytes();
      if b.len() >= 2 && b[b.len() - 1] == b[b.len() - 2] {
        stems.push(base[..base.len() - 1].to_string());
      }
    }
    if suffix.spelling == "ly" {
      // gentle → gently, probable → probably: the stem's -le.
      stems.push(format!("{base}le"));
    }
    for stem in stems {
      let Some(ps) = lookup(&stem) else { continue };
      if suffix.spelling == "ly" && stem.ends_with("le") && !base.ends_with("le") {
        // gentl(e)+y: the final ᵊl becomes l + i.
        let trimmed = ps.trim_end_matches('l').trim_end_matches(['ᵊ', 'ə']);
        return Some(format!("{trimmed}li"));
      }
      if stem.ends_with('y') && !base.ends_with('y') && ps.ends_with('i') {
        // happy → happi-ness: the i stays (hˈæpinəs).
        return Some(format!("{ps}{add}"));
      }
      return Some(format!("{ps}{add}"));
    }
  }
  for (spelling, us, gb) in PREFIXES {
    let Some(rest) = word.strip_prefix(spelling) else { continue };
    if rest.len() < 4 {
      continue;
    }
    if let Some(ps) = lookup(rest) {
      return Some(format!("{}{ps}", if accent == Accent::Gb { gb } else { us }));
    }
  }
  None
}

/// Two known words written as one: the first keeps its stress, the second's
/// becomes secondary (a compound's stress: nˈɛðəɹfˌild).
pub fn compound(word: &str, first_part: &dyn Fn(&str) -> Option<String>, last_part: &dyn Fn(&str) -> Option<String>) -> Option<String> {
  if !word.is_ascii() || word.len() < 8 {
    return None;
  }
  // The longest first part that leaves a known second part, each of four
  // letters or more (shorter ones make names of nothing: kala + din).
  for cut in (4..=word.len() - 4).rev() {
    let (head, tail) = word.split_at(cut);
    let Some(first) = first_part(head) else { continue };
    let Some(second) = last_part(tail) else { continue };
    return Some(format!("{first}{}", apply_stress(&second, Some(-1.0))));
  }
  None
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn allomorphs() {
    assert_eq!(add_s("kˈæt", Accent::Us), "kˈæts");
    assert_eq!(add_s("dˈɔɡ", Accent::Us), "dˈɔɡz");
    assert_eq!(add_s("hˈɔɹs", Accent::Us), "hˈɔɹsᵻz");
    assert_eq!(add_s("hˈɔːs", Accent::Gb), "hˈɔːsɪz");
    assert_eq!(add_ed("wˈɔk", Accent::Us), "wˈɔkt");
    assert_eq!(add_ed("plˈæn", Accent::Us), "plˈænd");
    assert_eq!(add_ed("nˈid", Accent::Us), "nˈidᵻd");
    assert_eq!(add_ed("wˈɑnt", Accent::Us), "wˈɑntᵻd");
    assert_eq!(add_ed("ɹᵻtˈɜɹn", Accent::Us), "ɹᵻtˈɜɹnd");
    assert_eq!(add_ed("wˈAt", Accent::Us), "wˈAɾᵻd");
    assert_eq!(add_ed("wˈAt", Accent::Gb), "wˈAtɪd");
    assert_eq!(add_ing("ɡˈɛt", Accent::Us).unwrap(), "ɡˈɛɾɪŋ");
    assert_eq!(add_ing("ɹˈid", Accent::Us).unwrap(), "ɹˈidɪŋ");
  }

  #[test]
  fn stems() {
    let known = |w: &str| ["family", "return", "stop", "make", "run", "box", "bennet", "carry"].contains(&w);
    assert_eq!(stem_s("families", &known).as_deref(), Some("family"));
    assert_eq!(stem_s("boxes", &known).as_deref(), Some("box"));
    assert_eq!(stem_s("bennet's", &known).as_deref(), Some("bennet"));
    assert_eq!(stem_ed("returned", &known).as_deref(), Some("return"));
    assert_eq!(stem_ed("stopped", &known).as_deref(), Some("stop"));
    assert_eq!(stem_ed("carried", &known).as_deref(), Some("carry"));
    assert_eq!(stem_ing("making", &known).as_deref(), Some("make"));
    assert_eq!(stem_ing("running", &known).as_deref(), Some("run"));
    assert_eq!(stem_ing("returning", &known).as_deref(), Some("return"));
    assert_eq!(stem_s("glass", &known), None);
  }

  #[test]
  fn stress() {
    assert_eq!(apply_stress("ænd", Some(0.5)), "ˌænd");
    assert_eq!(apply_stress("fˈild", Some(-1.0)), "fˌild");
    assert_eq!(apply_stress("bˌi", Some(2.0)), "bˈi");
    assert_eq!(apply_stress("bi", Some(2.0)), "bˈi");
    assert_eq!(apply_stress("ˈænd", Some(-2.0)), "ænd");
    assert_eq!(apply_stress("ˈænd", None), "ˈænd");
  }

  #[test]
  fn derived_and_compound() {
    let lookup = |w: &str| -> Option<String> {
      Some(
        match w {
          "dark" => "dˈɑɹk",
          "happy" => "hˈæpi",
          "gentle" => "ʤˈɛntᵊl",
          "kind" => "kˈInd",
          "nether" => "nˈɛðəɹ",
          "field" => "fˈild",
          "big" => "bˈɪɡ",
          _ => return None,
        }
        .to_string(),
      )
    };
    assert_eq!(derive("darkness", Accent::Us, &lookup).unwrap(), "dˈɑɹknəs");
    assert_eq!(derive("happiness", Accent::Us, &lookup).unwrap(), "hˈæpinəs");
    assert_eq!(derive("gently", Accent::Us, &lookup).unwrap(), "ʤˈɛntli");
    assert_eq!(derive("unkind", Accent::Us, &lookup).unwrap(), "ˌʌnkˈInd");
    assert_eq!(derive("bigger", Accent::Us, &lookup).unwrap(), "bˈɪɡəɹ");
    assert_eq!(compound("netherfield", &lookup, &lookup).unwrap(), "nˈɛðəɹfˌild");
    assert_eq!(compound("kelsier", &lookup, &lookup), None);
  }
}
