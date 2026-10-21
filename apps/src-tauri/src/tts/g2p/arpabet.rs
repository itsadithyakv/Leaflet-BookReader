//! ARPAbet (CMUdict's phones, and what the neural fallback says) in misaki's
//! symbols, the ones Kokoro was trained on.
//!
//! The rules were fitted to the ~31k words CMUdict and misaki's gold lexicons
//! share (scripts `arpa_proto.py`): the US mapping agrees exactly with misaki
//! on 68% of them (74% ignoring stress), the British one on 48% (63%). Most of
//! the rest are a schwa against an ɪ, which a listener barely hears.

use super::Accent;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Phone<'a> {
  base: &'a str,
  /// 0, 1 or 2 for a vowel; None for a consonant.
  stress: Option<u8>,
}

const VOWELS: [&str; 15] = ["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"];

fn is_vowel(base: &str) -> bool {
  VOWELS.contains(&base)
}

fn consonant(base: &str) -> Option<&'static str> {
  Some(match base {
    "B" => "b",
    "CH" => "ʧ",
    "D" => "d",
    "DH" => "ð",
    "F" => "f",
    "G" => "ɡ",
    "HH" => "h",
    "JH" => "ʤ",
    "K" => "k",
    "L" => "l",
    "M" => "m",
    "N" => "n",
    "NG" => "ŋ",
    "P" => "p",
    "R" => "ɹ",
    "S" => "s",
    "SH" => "ʃ",
    "T" => "t",
    "TH" => "θ",
    "V" => "v",
    "W" => "w",
    "Y" => "j",
    "Z" => "z",
    "ZH" => "ʒ",
    _ => return None,
  })
}

fn parse(arpabet: &str) -> Option<Vec<Phone<'_>>> {
  let mut out = Vec::new();
  for token in arpabet.split_whitespace() {
    let (base, stress) = match token.as_bytes().last() {
      Some(digit @ b'0'..=b'2') => (&token[..token.len() - 1], Some(digit - b'0')),
      _ => (token, None),
    };
    if is_vowel(base) {
      // A vowel without a digit (g2p_en's `UW`) counts as unstressed.
      out.push(Phone { base, stress: Some(stress.unwrap_or(0)) });
    } else if consonant(base).is_some() {
      out.push(Phone { base, stress: None });
    } else {
      return None;
    }
  }
  Some(out)
}

/// The word's pronunciation in misaki's symbols (`ɾ`, not Kokoro's `T`), or
/// None when `arpabet` holds a phone that is not ARPAbet. `word` is the
/// spelling, lower case (the British mapping looks at it for `ɑː` or `ɒ`).
pub fn to_misaki(word: &str, arpabet: &str, accent: Accent) -> Option<String> {
  let phones = parse(arpabet)?;
  Some(match accent {
    Accent::Us => us(&phones),
    Accent::Gb => gb(word, &phones),
  })
}

fn mark(out: &mut String, stress: Option<u8>) {
  match stress {
    Some(1) => out.push('ˈ'),
    Some(2) => out.push('ˌ'),
    _ => {}
  }
}

fn base_at<'a>(phones: &'a [Phone<'a>], index: usize) -> Option<&'a str> {
  phones.get(index).map(|phone| phone.base)
}

/// A schwa before a final-ish l or n that misaki writes small (`ᵊ`): after a
/// consonant (for n, after t or d), with no vowel after the l or n.
fn small_schwa(phones: &[Phone], index: usize) -> bool {
  let next = base_at(phones, index + 1);
  let prev = if index > 0 { base_at(phones, index - 1) } else { None };
  let after = base_at(phones, index + 2);
  let no_vowel_after = after.is_none_or(|base| !is_vowel(base));
  match (prev, next) {
    (Some(prev), Some("L")) => !is_vowel(prev) && no_vowel_after,
    (Some("T" | "D"), Some("N")) => no_vowel_after,
    _ => false,
  }
}

fn us(phones: &[Phone]) -> String {
  let mut out = String::new();
  for (index, phone) in phones.iter().enumerate() {
    let next = phones.get(index + 1);
    let prev = if index > 0 { phones.get(index - 1) } else { None };
    if let Some(stress) = phone.stress {
      let vowel = match phone.base {
        "AH" if stress == 0 && small_schwa(phones, index) => "ᵊ",
        "AH" if stress == 0 => "ə",
        "AH" => "ʌ",
        "ER" if stress == 0 => "əɹ",
        "ER" => "ɜɹ",
        "IH" if stress == 0 => {
          let next_base = next.map(|p| p.base).unwrap_or("#");
          let last = index + 2 >= phones.len();
          if matches!(next_base, "D" | "Z") && last {
            "ᵻ"
          } else if matches!(next_base, "T" | "L" | "N" | "S" | "D" | "M" | "B" | "P" | "F") {
            "ə"
          } else {
            "ɪ"
          }
        }
        "AA" => "ɑ",
        "AE" => "æ",
        "AO" => "ɔ",
        "AW" => "W",
        "AY" => "I",
        "EH" => "ɛ",
        "EY" => "A",
        "IH" => "ɪ",
        "IY" => "i",
        "OW" => "O",
        "OY" => "Y",
        "UH" => "ʊ",
        _ => "u", // UW
      };
      mark(&mut out, Some(stress));
      out.push_str(vowel);
    } else {
      // A flap: t after a vowel (or r), before an unstressed vowel.
      let flap = phone.base == "T"
        && prev.is_some_and(|p| p.stress.is_some() || p.base == "R")
        && next.is_some_and(|p| p.stress == Some(0));
      out.push_str(if flap { "ɾ" } else { consonant(phone.base).unwrap_or("") });
    }
  }
  out
}

fn gb(word: &str, phones: &[Phone]) -> String {
  let mut out = String::new();
  // The lot vowel is spelled with an o, or an a after w or qu (watch, quality).
  let lot_spelling = word.contains('o') || word.contains("wa") || word.contains("qua");
  let mut skip_next = false;
  for (index, phone) in phones.iter().enumerate() {
    if skip_next {
      skip_next = false;
      continue;
    }
    let next = phones.get(index + 1);
    let prev = if index > 0 { phones.get(index - 1) } else { None };
    let next_is_vowel = next.is_some_and(|p| p.stress.is_some());
    if let Some(stress) = phone.stress {
      // An r after the vowel that no vowel follows: not said, the vowel long.
      let r_after = next.is_some_and(|p| p.base == "R") && phones.get(index + 2).is_none_or(|p| p.stress.is_none());
      let next_base = next.map(|p| p.base).unwrap_or("#");
      let vowel: &str = match phone.base {
        "AH" if stress == 0 && small_schwa(phones, index) => "ᵊ",
        "AH" if stress == 0 && prev.is_some() && matches!(next_base, "T" | "K" | "D" | "F") => "ɪ",
        "AH" if stress == 0 => "ə",
        "AH" => "ʌ",
        "ER" if next_is_vowel => {
          if stress == 0 {
            "əɹ"
          } else {
            "ɜːɹ"
          }
        }
        "ER" if stress == 0 => "ə",
        "ER" => "ɜː",
        "AA" if r_after => "ɑː",
        "AA" if !lot_spelling => "ɑː",
        "AA" => "ɒ",
        "AO" if !r_after && matches!(next_base, "S" | "NG" | "F" | "G" | "TH") => "ɒ",
        "AO" => "ɔː",
        "IY" if r_after => "ɪə",
        "IY" if stress != 0 => "iː",
        "IY" if next.is_none() => "i",
        "IY" if next.is_some_and(|p| p.base == "AH" && p.stress == Some(0)) => {
          skip_next = true;
          "ɪə"
        }
        "IY" => "ɪ",
        "UW" => {
          let yod = stress == 1
            && prev.is_some_and(|p| matches!(p.base, "T" | "D" | "N" | "TH"));
          if yod {
            out.push('j');
          }
          "uː"
        }
        "EH" if r_after => "ɛː",
        "IH" if r_after => "ɪə",
        "UH" if r_after => "ʊə",
        "AE" => "a",
        "AW" => "W",
        "AY" => "I",
        "EH" => "ɛ",
        "EY" => "A",
        "IH" => "ɪ",
        "OW" => "Q",
        "OY" => "Y",
        _ => "ʊ", // UH
      };
      mark(&mut out, Some(stress));
      out.push_str(vowel);
    } else if phone.base == "R" && !next_is_vowel {
      // Non-rhotic: an r no vowel follows is not said (fire, hour: a schwa).
      if prev.is_some_and(|p| matches!(p.base, "AY" | "AW")) {
        out.push('ə');
      }
    } else {
      out.push_str(consonant(phone.base).unwrap_or(""));
    }
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn american() {
    assert_eq!(to_misaki("butter", "B AH1 T ER0", Accent::Us).unwrap(), "bˈʌɾəɹ");
    assert_eq!(to_misaki("bennet", "B EH1 N IH0 T", Accent::Us).unwrap(), "bˈɛnət");
    assert_eq!(to_misaki("darcy", "D AA1 R S IY0", Accent::Us).unwrap(), "dˈɑɹsi");
    assert_eq!(to_misaki("pixel", "P IH1 K S AH0 L", Accent::Us).unwrap(), "pˈɪksᵊl");
    assert_eq!(to_misaki("boxes", "B AA1 K S IH0 Z", Accent::Us).unwrap(), "bˈɑksᵻz");
    assert_eq!(to_misaki("ring", "R IH1 NG", Accent::Us).unwrap(), "ɹˈɪŋ");
  }

  #[test]
  fn british() {
    assert_eq!(to_misaki("darcy", "D AA1 R S IY0", Accent::Gb).unwrap(), "dˈɑːsi");
    assert_eq!(to_misaki("butter", "B AH1 T ER0", Accent::Gb).unwrap(), "bˈʌtə");
    assert_eq!(to_misaki("hot", "HH AA1 T", Accent::Gb).unwrap(), "hˈɒt");
    assert_eq!(to_misaki("father", "F AA1 DH ER0", Accent::Gb).unwrap(), "fˈɑːðə");
    assert_eq!(to_misaki("fire", "F AY1 ER0", Accent::Gb).unwrap(), "fˈIə");
    assert_eq!(to_misaki("tune", "T UW1 N", Accent::Gb).unwrap(), "tjˈuːn");
    assert_eq!(to_misaki("story", "S T AO1 R IY0", Accent::Gb).unwrap(), "stˈɔːɹi");
  }

  #[test]
  fn not_arpabet() {
    assert!(to_misaki("x", "Q9", Accent::Us).is_none());
  }
}
