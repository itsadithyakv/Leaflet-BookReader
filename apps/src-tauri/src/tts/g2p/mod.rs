//! English text to Kokoro's phonemes, with no GPL in it: Leaflet's own G2P
//! for the Studio voice, so it no longer needs espeak-ng (sherpa-onnx 2.0
//! takes the phonemes from outside, `GenerationConfig.tokens`).
//!
//! The symbols are misaki's (Kokoro's own G2P, github.com/hexgrad/misaki),
//! the ones Kokoro v1.0 was trained on, flaps written `T` as Kokoro v1.0
//! wants them. A word is found, in order:
//!
//! 1. a few function words said by what follows (the/ði before a vowel,
//!    to, a, an, I: misaki's special cases);
//! 2. a short list of names the lexicons get wrong (`OVERRIDES`);
//! 3. misaki's gold and silver lexicons (`g2p/en-us.lex`, `g2p/en-gb.lex`,
//!    Apache-2.0), heteronyms by a guess at their part of speech;
//! 4. an inflection of a word they have (families, returned, Bennet's),
//!    with misaki's rules for the endings;
//! 5. CMUdict's 73k words misaki lacks, mostly names (`g2p/cmudict-extra.txt`,
//!    BSD-2-Clause), mapped from ARPAbet;
//! 6. a derivation or compound of known words (darkness, Netherfield);
//! 7. a small neural G2P (`g2p/g2p-en-oov.bin`, g2p_en's GRU, Apache-2.0);
//! 8. letter by letter.
//!
//! Numbers, money, times, titles (Mr.), initials and symbols are said in
//! words here (`text.rs`, `numbers.rs`); the page's clean-up runs before.

pub mod arpabet;
pub mod gru;
pub mod lexicon;
pub mod morph;
pub mod numbers;
pub mod pos;
pub mod text;

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use lexicon::{Format, Lexicon};
use text::Item;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Accent {
  Us,
  Gb,
}

impl Accent {
  /// `en-GB` (and `en-gb`, `en_GB`, `en-UK`) is British; any other English American.
  pub fn from_lang(lang: &str) -> Accent {
    let lower = lang.to_ascii_lowercase().replace('_', "-");
    if lower.ends_with("-gb") || lower.ends_with("-uk") {
      Accent::Gb
    } else {
      Accent::Us
    }
  }
}

/// One sentence of the text in Kokoro's phonemes (each char one token of
/// its `tokens.txt`), and where it lies in the text (bytes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SentencePhonemes {
  pub start: usize,
  pub end: usize,
  pub phonemes: String,
}

/// Text to the phonemes a voice is given, sentence by sentence.
pub trait Phonemizer {
  fn phonemize(&self, text: &str, accent: Accent) -> Vec<SentencePhonemes>;
}

/// Where a word's pronunciation came from (for tests and the evaluation).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
  Special,
  Override,
  Lexicon,
  Inflected,
  Cmudict,
  Derived,
  Compound,
  Model,
  Spelled,
  Unknown,
  /// Not a word: said as text (a number, an abbreviation).
  Text,
}

/// The files of the voice pack this reads (`g2p/…` in the pack folder).
pub const FILES: [&str; 5] = ["g2p/en-us.lex", "g2p/en-gb.lex", "g2p/cmudict-extra.txt", "g2p/g2p-en-oov.bin", "g2p/NOTICE.txt"];

/// Kokoro v1.0's tokens (its `tokens.txt`): every char a phoneme string may hold.
pub const KOKORO_TOKENS: &[(char, i64)] = &[
  (';', 1),
  (':', 2),
  (',', 3),
  ('.', 4),
  ('!', 5),
  ('?', 6),
  ('—', 9),
  ('…', 10),
  ('"', 11),
  ('(', 12),
  (')', 13),
  ('“', 14),
  ('”', 15),
  (' ', 16),
  ('\u{303}', 17),
  ('ʣ', 18),
  ('ʥ', 19),
  ('ʦ', 20),
  ('ʨ', 21),
  ('ᵝ', 22),
  ('ꭧ', 23),
  ('A', 24),
  ('I', 25),
  ('O', 31),
  ('Q', 33),
  ('S', 35),
  ('T', 36),
  ('W', 39),
  ('Y', 41),
  ('ᵊ', 42),
  ('a', 43),
  ('b', 44),
  ('c', 45),
  ('d', 46),
  ('e', 47),
  ('f', 48),
  ('h', 50),
  ('i', 51),
  ('j', 52),
  ('k', 53),
  ('l', 54),
  ('m', 55),
  ('n', 56),
  ('o', 57),
  ('p', 58),
  ('q', 59),
  ('r', 60),
  ('s', 61),
  ('t', 62),
  ('u', 63),
  ('v', 64),
  ('w', 65),
  ('x', 66),
  ('y', 67),
  ('z', 68),
  ('ɑ', 69),
  ('ɐ', 70),
  ('ɒ', 71),
  ('æ', 72),
  ('β', 75),
  ('ɔ', 76),
  ('ɕ', 77),
  ('ç', 78),
  ('ɖ', 80),
  ('ð', 81),
  ('ʤ', 82),
  ('ə', 83),
  ('ɚ', 85),
  ('ɛ', 86),
  ('ɜ', 87),
  ('ɟ', 90),
  ('ɡ', 92),
  ('ɥ', 99),
  ('ɨ', 101),
  ('ɪ', 102),
  ('ʝ', 103),
  ('ɯ', 110),
  ('ɰ', 111),
  ('ŋ', 112),
  ('ɳ', 113),
  ('ɲ', 114),
  ('ɴ', 115),
  ('ø', 116),
  ('ɸ', 118),
  ('θ', 119),
  ('œ', 120),
  ('ɹ', 123),
  ('ɾ', 125),
  ('ɻ', 126),
  ('ʁ', 128),
  ('ɽ', 129),
  ('ʂ', 130),
  ('ʃ', 131),
  ('ʈ', 132),
  ('ʧ', 133),
  ('ʊ', 135),
  ('ʋ', 136),
  ('ʌ', 138),
  ('ɣ', 139),
  ('ɤ', 140),
  ('χ', 142),
  ('ʎ', 143),
  ('ʒ', 147),
  ('ʔ', 148),
  ('ˈ', 156),
  ('ˌ', 157),
  ('ː', 158),
  ('ʰ', 162),
  ('ʲ', 164),
  ('↓', 169),
  ('→', 171),
  ('↗', 172),
  ('↘', 173),
  ('ᵻ', 177),
];

/// Kokoro's token ids for a phoneme string (chars it has no token for are left out).
pub fn token_ids(phonemes: &str) -> Vec<i64> {
  phonemes.chars().filter_map(|c| KOKORO_TOKENS.iter().find(|(t, _)| *t == c).map(|(_, id)| *id)).collect()
}

fn is_token(c: char) -> bool {
  KOKORO_TOKENS.iter().any(|(t, _)| *t == c)
}

/// Kokoro takes at most 510 tokens at a time; a sentence longer is cut.
pub const MAX_TOKENS: usize = 500;

/// Names the lexicons and the model get wrong, said as their readers say
/// them (US, GB). Lower case. Leaflet's own; add to it freely.
const OVERRIDES: &[(&str, &str, &str)] = &[
  ("hermione", "hɜɹmˈIəni", "hɜːmˈIəni"),
  ("luthadel", "lˈuθədˌɛl", "lˈuːθədˌɛl"),
  ("sazed", "sˈAzɛd", "sˈAzɛd"),
  ("scadrial", "skˈAdɹiəl", "skˈAdɹɪəl"),
  ("elend", "ˈɛlənd", "ˈɛlənd"),
  ("kelsier", "kˈɛlsiəɹ", "kˈɛlsɪə"),
  ("vimes", "vˈImz", "vˈImz"),
  ("tolkien", "tˈOlkin", "tˈɒlkiːn"),
  ("bourgh", "bˈɜɹɡ", "bˈɜːɡ"),
  ("meryton", "mˈɛɹɪtən", "mˈɛɹɪtən"),
  ("fagin", "fˈAɡɪn", "fˈAɡɪn"),
  ("voldemort", "vˈOldəmɔɹ", "vˈɒldəmɔː"),
  ("karenina", "kəɹˈɛnɪnə", "kəɹˈɛnɪnə"),
  ("raskolnikov", "ɹæskˈOlnɪkɔf", "ɹaskˈɒlnɪkɒf"),
  ("queequeg", "kwˈikwɛɡ", "kwˈiːkwɛɡ"),
  ("sancho", "sˈænʧO", "sˈanʧQ"),
  ("galadriel", "ɡəlˈædɹiəl", "ɡəlˈadɹɪəl"),
  ("eowyn", "ˈAəwɪn", "ˈAəwɪn"),
  ("lothlorien", "lˈOθlɔɹiən", "lˈQθlɔːɹɪən"),
  ("saruman", "sˈɑɹumən", "sˈɑːɹuːmən"),
  ("boromir", "bˈɔɹəmɪɹ", "bˈɒɹəmɪə"),
  ("isengard", "ˈIzənɡɑɹd", "ˈIzənɡɑːd"),
  ("aragorn", "ˈæɹəɡɔɹn", "ˈaɹəɡɔːn"),
  ("denethor", "dˈɛnəθɔɹ", "dˈɛnəθɔː"),
  ("nazgul", "nˈæzɡul", "nˈazɡuːl"),
  ("thranduil", "θɹˈændʊɪl", "θɹˈandʊɪl"),
  ("smaug", "smˈWɡ", "smˈWɡ"),
  ("cthulhu", "kəθˈulu", "kəθˈuːluː"),
  ("urithiru", "ˌʊɹɪθˈɪɹu", "ˌʊɹɪθˈɪəɹuː"),
  ("dalinar", "dˈælɪnɑɹ", "dˈalɪnɑː"),
  ("roshar", "ɹˈOʃɑɹ", "ɹˈQʃɑː"),
];

/// misaki's consonants (its `CONSONANTS`), for what a following word starts with.
const CONSONANTS: &str = "bdfhjklmnpstvwzðŋɡɹɾʃʒʤʧθT";

#[derive(Clone, Copy, Debug, Default)]
struct Context {
  /// Whether the next word starts with a vowel; None: nothing (or a pause) follows.
  future_vowel: Option<bool>,
  /// The next word is `to` (for "used to").
  future_to: bool,
}

/// The data, loaded when first needed (a few MB each).
struct Data {
  us: OnceLock<Option<Lexicon>>,
  gb: OnceLock<Option<Lexicon>>,
  cmu: OnceLock<Option<Lexicon>>,
  model: OnceLock<Option<gru::Model>>,
}

/// Leaflet's English G2P.
pub struct EnglishG2p {
  dir: Option<PathBuf>,
  data: Data,
}

/// Each file's contents, for a G2P made without a pack folder (tests).
#[derive(Default)]
pub struct Parts {
  pub us: Option<String>,
  pub gb: Option<String>,
  pub cmudict: Option<String>,
  pub model: Option<Vec<u8>>,
}

fn read_text(path: &Path) -> Option<String> {
  std::fs::read_to_string(path).ok()
}

impl EnglishG2p {
  /// A G2P reading the pack folder (`<pack>/g2p/…`; without `g2p/en-*.lex`,
  /// sherpa-onnx's `lexicon-us-en.txt` and `lexicon-gb-en.txt` there).
  pub fn open(pack_dir: &Path) -> EnglishG2p {
    EnglishG2p { dir: Some(pack_dir.to_path_buf()), data: Data { us: OnceLock::new(), gb: OnceLock::new(), cmu: OnceLock::new(), model: OnceLock::new() } }
  }

  pub fn from_parts(parts: Parts) -> EnglishG2p {
    let lexicon = |text: Option<String>| text.map(|t| Lexicon::parse(&t, Format::Leaflet));
    let data = Data { us: OnceLock::new(), gb: OnceLock::new(), cmu: OnceLock::new(), model: OnceLock::new() };
    let _ = data.us.set(lexicon(parts.us));
    let _ = data.gb.set(lexicon(parts.gb));
    let _ = data.cmu.set(parts.cmudict.map(|t| Lexicon::parse(&t, Format::Cmu)));
    let _ = data.model.set(parts.model.and_then(|bytes| gru::Model::parse(&bytes).ok()));
    EnglishG2p { dir: None, data }
  }

  fn lexicon(&self, accent: Accent) -> Option<&Lexicon> {
    let (cell, ours, sherpa) = match accent {
      Accent::Us => (&self.data.us, "g2p/en-us.lex", "lexicon-us-en.txt"),
      Accent::Gb => (&self.data.gb, "g2p/en-gb.lex", "lexicon-gb-en.txt"),
    };
    cell
      .get_or_init(|| {
        let dir = self.dir.as_ref()?;
        if let Some(text) = read_text(&dir.join(ours)) {
          return Some(Lexicon::parse(&text, Format::Leaflet));
        }
        read_text(&dir.join(sherpa)).map(|text| Lexicon::parse(&text, Format::Sherpa))
      })
      .as_ref()
  }

  fn cmudict(&self) -> Option<&Lexicon> {
    self.data.cmu.get_or_init(|| read_text(&self.dir.as_ref()?.join("g2p/cmudict-extra.txt")).map(|t| Lexicon::parse(&t, Format::Cmu))).as_ref()
  }

  fn model(&self) -> Option<&gru::Model> {
    self
      .data
      .model
      .get_or_init(|| {
        let bytes = std::fs::read(self.dir.as_ref()?.join("g2p/g2p-en-oov.bin")).ok()?;
        gru::Model::parse(&bytes).ok()
      })
      .as_ref()
  }

  /// Whether this can say English in `accent` (its lexicon is there).
  pub fn ready(&self, accent: Accent) -> bool {
    self.lexicon(accent).is_some()
  }

  /// One word as it stands alone (the end of a sentence after it), and where
  /// it came from.
  pub fn word(&self, word: &str, accent: Accent) -> (String, Source) {
    if !word.chars().all(|c| c.is_alphabetic() || matches!(c, '\'' | '’' | '-')) {
      return (self.phonemize_str(word, accent), Source::Text);
    }
    let folded = fold_word(word);
    let (ps, source) = self.resolve(&folded, accent, None, Context::default());
    (for_kokoro(&ps), source)
  }

  /// The phonemes of one piece of text, all its sentences in one string.
  pub fn phonemize_str(&self, text: &str, accent: Accent) -> String {
    self.phonemize(text, accent).into_iter().map(|s| s.phonemes).collect::<Vec<_>>().join(" ")
  }

  // ---- one word -------------------------------------------------------------

  /// A word in the lexicon: as written, then in lower case (or capitalised).
  fn lex_get<'a>(&'a self, accent: Accent, word: &str) -> Option<lexicon::Found<'a>> {
    let lexicon = self.lexicon(accent)?;
    if let Some(found) = lexicon.get(word) {
      return Some(found);
    }
    let lower = word.to_lowercase();
    if lower != word {
      if let Some(found) = lexicon.get(&lower) {
        return Some(found);
      }
    }
    let mut chars = lower.chars();
    let capital: String = chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default();
    if capital != word {
      return lexicon.get(&capital);
    }
    None
  }

  /// A known word's phonemes in the lexicon, no tag (for stems).
  fn lex_plain(&self, accent: Accent, word: &str) -> Option<String> {
    self.lex_get(accent, word).and_then(|found| found.for_tag(None)).map(str::to_string)
  }

  fn cmu_plain(&self, accent: Accent, word: &str) -> Option<String> {
    let lower = word.to_lowercase();
    let arpabet = self.cmudict()?.get(&lower)?.value;
    arpabet::to_misaki(&lower, arpabet, accent)
  }

  /// Letter by letter (misaki's `get_NNP`): every letter secondary but the last.
  fn spell(&self, accent: Accent, letters: &str) -> Option<String> {
    let mut joined = String::new();
    for c in letters.chars().filter(|c| c.is_ascii_alphabetic()) {
      let upper = c.to_ascii_uppercase().to_string();
      joined.push_str(self.lexicon(accent)?.get(&upper)?.for_tag(None)?);
    }
    if joined.is_empty() {
      return None;
    }
    let demoted = morph::apply_stress(&joined, Some(0.0));
    Some(match demoted.rfind('ˌ') {
      Some(at) => format!("{}ˈ{}", &demoted[..at], &demoted[at + 'ˌ'.len_utf8()..]),
      None => demoted,
    })
  }

  /// misaki's special cases: words said by what follows them.
  fn special(&self, accent: Accent, word: &str, tag: Option<&str>, ctx: Context) -> Option<String> {
    let gold = |w: &str| self.lex_plain(accent, w);
    Some(match word {
      "a" | "A" => {
        if ctx.future_vowel.is_none() && word == "A" {
          "ˈA".into()
        } else {
          "ɐ".into()
        }
      }
      "an" | "An" => "ɐn".into(),
      "I" => "ˌI".into(),
      "am" | "Am" => {
        if ctx.future_vowel.is_none() || word != "am" {
          gold("am")?
        } else {
          "ɐm".into()
        }
      }
      "to" | "To" => match ctx.future_vowel {
        None => gold("to")?,
        Some(false) => "tə".into(),
        Some(true) => "tʊ".into(),
      },
      "in" | "In" => {
        if ctx.future_vowel.is_none() {
          "ˈɪn".into()
        } else {
          "ɪn".into()
        }
      }
      "the" | "The" => {
        if ctx.future_vowel == Some(true) {
          "ði".into()
        } else {
          "ðə".into()
        }
      }
      "by" | "By" if ctx.future_vowel.is_none() => "bˈI".into(),
      "used" | "Used" => {
        let found = self.lex_get(accent, "used")?;
        let tag = if ctx.future_to { Some("VBD") } else { tag };
        found.for_tag(tag)?.to_string()
      }
      _ => return None,
    })
  }

  /// The pronunciation of a word as written (accents folded), in misaki's
  /// symbols, and where it came from.
  fn resolve(&self, word: &str, accent: Accent, tag: Option<&str>, ctx: Context) -> (String, Source) {
    if let Some(ps) = self.special(accent, word, tag, ctx) {
      return (ps, Source::Special);
    }
    let lower = word.to_lowercase();
    if let Some((_, us, gb)) = OVERRIDES.iter().find(|(w, _, _)| *w == lower) {
      return ((if accent == Accent::Gb { gb } else { us }).to_string(), Source::Override);
    }
    let letters = word.chars().filter(|c| c.is_alphabetic()).count();
    let all_caps = letters > 1 && word.chars().all(|c| !c.is_alphabetic() || c.is_uppercase());
    // misaki's stress by case: a capitalised word gets at least a secondary
    // stress, one in capitals a primary.
    let stress = if lower == word {
      None
    } else if all_caps {
      Some(2.0)
    } else {
      Some(0.5)
    };
    let with_stress = |ps: &str| morph::apply_stress(ps, stress);

    // In capitals: as written if the lexicon has it so (NASA, OK), a known
    // word said as a word (only if longer than three letters: NO, YES are
    // words, BBC is letters), else letter by letter.
    if all_caps {
      if let Some(found) = self.lexicon(accent).and_then(|l| l.get(word)) {
        if let Some(ps) = found.for_tag(tag) {
          return (with_stress(ps), Source::Lexicon);
        }
        if let Some(ps) = self.spell(accent, word) {
          return (ps, Source::Spelled);
        }
      }
      let known_word = self.lexicon(accent).and_then(|l| l.get(&lower)).is_some_and(|f| f.gold) && (letters > 3 || COMMON_SHORT_CAPS.contains(&lower.as_str()));
      if !known_word && letters <= 5 && word.chars().all(|c| c.is_ascii_alphabetic()) {
        if let Some(ps) = self.spell(accent, word) {
          return (ps, Source::Spelled);
        }
      }
    }

    if let Some(found) = self.lex_get(accent, word) {
      let tag = if ctx.future_vowel.is_none() && found.has_tag("None") { Some("None") } else { tag };
      return match found.for_tag(tag) {
        Some(ps) => (with_stress(ps), Source::Lexicon),
        // misaki's "say it letter by letter" (US as a noun: U S).
        None => self.spell(accent, word).map(|ps| (ps, Source::Spelled)).unwrap_or((String::new(), Source::Unknown)),
      };
    }
    // The Bennets' → the Bennet's; a word with an apostrophe after it.
    if let Some(stem) = lower.strip_suffix("s'") {
      let possessive = format!("{stem}'s");
      if let Some(ps) = self.lex_plain(accent, &possessive) {
        return (with_stress(&ps), Source::Lexicon);
      }
    }
    let lower = lower.trim_end_matches('\'').to_string();

    // An inflection of a word misaki has.
    let in_lexicon = |w: &str| self.lex_get(accent, w).is_some();
    if let Some(ps) = self.inflect(accent, &lower, &in_lexicon, &|w| self.lex_plain(accent, w)) {
      return (with_stress(&ps), Source::Inflected);
    }
    // CMUdict (names, mostly), and inflections of its words.
    if let Some(ps) = self.cmu_plain(accent, &lower) {
      return (with_stress(&ps), Source::Cmudict);
    }
    let known_anywhere = |w: &str| self.lex_get(accent, w).is_some() || self.cmudict().is_some_and(|c| c.contains(w));
    let plain_anywhere = |w: &str| self.lex_plain(accent, w).or_else(|| self.cmu_plain(accent, w));
    if let Some(ps) = self.inflect(accent, &lower, &known_anywhere, &plain_anywhere) {
      return (with_stress(&ps), Source::Inflected);
    }
    // Contractions of a name: Darcy'll, Kelsier'd.
    for (ending, us, gb) in [("'ll", "l", "l"), ("'re", "ɹ", "ə"), ("'ve", "v", "v"), ("'d", "d", "d"), ("n't", "nt", "nt")] {
      if let Some(base) = lower.strip_suffix(ending) {
        if base.len() >= 2 {
          let (ps, _) = self.resolve(base, accent, None, ctx);
          if !ps.is_empty() {
            return (with_stress(&format!("{ps}{}", if accent == Accent::Gb { gb } else { us })), Source::Inflected);
          }
        }
      }
    }
    // A derivation or compound of known words.
    if let Some(ps) = morph::derive(&lower, accent, &|w| self.lex_plain(accent, w).or_else(|| self.inflect(accent, w, &in_lexicon, &|s| self.lex_plain(accent, s)))) {
      return (with_stress(&ps), Source::Derived);
    }
    let gold_part = |w: &str| {
      let found = self.lexicon(accent)?.get(w)?;
      if !found.gold {
        return None;
      }
      found.for_tag(None).map(str::to_string)
    };
    // The last part may be a plural (stonebirds); the first is a word as it is.
    let tail = |w: &str| gold_part(w).or_else(|| morph::stem_s(w, &|s| gold_part(s).is_some()).and_then(|s| gold_part(&s)).map(|ps| morph::add_s(&ps, accent)));
    if let Some(ps) = morph::compound(&lower, &gold_part, &tail) {
      return (with_stress(&ps), Source::Compound);
    }
    // The model.
    if let Some(model) = self.model() {
      let clean: String = lower.chars().filter(|c| c.is_ascii_lowercase()).collect();
      if !clean.is_empty() {
        let predicted = model.predict(&clean);
        let ps = match model.output() {
          gru::Output::Arpabet => arpabet::to_misaki(&clean, &predicted, accent),
          gru::Output::Misaki => Some(predicted.replace(' ', "")),
        };
        if let Some(ps) = ps.filter(|p| !p.is_empty()) {
          return (with_stress(&ps), Source::Model);
        }
      }
    }
    match self.spell(accent, word) {
      Some(ps) => (ps, Source::Spelled),
      None => (String::new(), Source::Unknown),
    }
  }

  /// -s, -ed, -ing (and possessives) on a stem `known` knows.
  fn inflect(&self, accent: Accent, word: &str, known: &dyn Fn(&str) -> bool, plain: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    if let Some(stem) = morph::stem_s(word, known) {
      return plain(&stem).map(|ps| morph::add_s(&ps, accent));
    }
    if let Some(stem) = morph::stem_ed(word, known) {
      return plain(&stem).map(|ps| morph::add_ed(&ps, accent));
    }
    if let Some(stem) = morph::stem_ing(word, known) {
      // misaki stresses an -ing word's stem at least a little (0.5).
      return plain(&stem).and_then(|ps| morph::add_ing(&morph::apply_stress(&ps, Some(0.5)), accent));
    }
    None
  }

  // ---- a sentence -----------------------------------------------------------

  fn sentence(&self, items: &[Item], accent: Accent) -> String {
    // Right to left, as misaki does: a word is said by what follows it.
    let mut said: Vec<Option<String>> = vec![None; items.len()];
    let mut ctx = Context::default();
    for (index, item) in items.iter().enumerate().rev() {
      match item {
        Item::Punct(p) => {
          if !matches!(p, '“' | '”' | '"') {
            ctx = Context::default();
          }
        }
        Item::Letters(letters) => {
          let ps = self.spell(accent, letters).unwrap_or_default();
          ctx = context_before(&ps, false);
          said[index] = Some(ps);
        }
        Item::Word(word) => {
          let prev = items[..index].iter().rev().find_map(|i| match i {
            Item::Word(w) => Some(w.as_str()),
            Item::Letters(_) => Some(""),
            Item::Punct('“' | '”') => None,
            Item::Punct(_) => Some(""),
          });
          let next = items[index + 1..].iter().find_map(|i| match i {
            Item::Word(w) => Some(w.to_lowercase()),
            Item::Punct('“' | '”') => None,
            _ => Some(String::new()),
          });
          let prev = prev.filter(|p| !p.is_empty());
          let next = next.filter(|n| !n.is_empty());
          let tag = pos::guess(word, prev, next.as_deref());
          let (ps, _) = self.resolve(word, accent, tag, ctx);
          ctx = context_before(&ps, word.eq_ignore_ascii_case("to"));
          said[index] = Some(ps);
        }
      }
    }
    let mut out = String::new();
    let mut after_opening = true;
    for (item, ps) in items.iter().zip(said) {
      match item {
        Item::Punct(p @ ('“' | '(')) => {
          if !after_opening {
            out.push(' ');
          }
          out.push(*p);
          after_opening = true;
        }
        Item::Punct('—') => {
          out.push_str(" —");
          after_opening = false;
        }
        Item::Punct(p) => {
          out.push(*p);
          after_opening = false;
        }
        _ => {
          let ps = ps.unwrap_or_default();
          if ps.is_empty() {
            continue;
          }
          if !after_opening {
            out.push(' ');
          }
          out.push_str(&ps);
          after_opening = false;
        }
      }
    }
    for_kokoro(out.trim())
  }
}

/// A one-letter word in capitals is a word (A, I); these short words in
/// capitals are words too, not letters.
const COMMON_SHORT_CAPS: &[&str] = &["no", "yes", "oh", "ah", "go", "now", "not", "and", "but", "the", "you", "all", "why", "who", "how", "she", "him", "her", "his", "was", "did", "run", "stop", "help", "out", "off", "get", "die", "god", "hey", "my", "me", "we", "he", "be", "so", "do", "up", "on", "in", "at", "it", "is", "of", "or", "to", "an", "ow", "oi", "ha", "hah"];

/// What the word before sees of this one (misaki's `token_context`).
fn context_before(ps: &str, is_to: bool) -> Context {
  let future_vowel = ps.chars().find_map(|c| {
    if morph::is_vowel(c) {
      Some(Some(true))
    } else if CONSONANTS.contains(c) {
      Some(Some(false))
    } else if ";:,.!?—…".contains(c) {
      Some(None)
    } else {
      None
    }
  });
  Context { future_vowel: future_vowel.unwrap_or(None), future_to: is_to }
}

/// Accents folded, curly apostrophes made straight.
fn fold_word(word: &str) -> String {
  let mut out = String::with_capacity(word.len());
  for c in word.chars() {
    match c {
      '’' | '‘' | 'ʼ' => out.push('\''),
      c => {
        let folded = text::fold(c);
        if folded.is_empty() {
          out.push(c);
        } else {
          out.push_str(folded);
        }
      }
    }
  }
  out
}

/// misaki's symbols as Kokoro v1.0 takes them: a flap is `T`, a glottal stop
/// `t` (misaki does this for every model but its 2.0); nothing Kokoro has no
/// token for.
pub fn for_kokoro(ps: &str) -> String {
  ps.chars().map(|c| match c {
    'ɾ' => 'T',
    'ʔ' => 't',
    c => c,
  })
  .filter(|c| is_token(*c))
  .collect()
}

/// A long string cut where it may be (a space after punctuation, else a
/// space), each piece at most `MAX_TOKENS` chars.
fn cut_long(phonemes: String) -> Vec<String> {
  let mut out = Vec::new();
  let mut rest = phonemes.as_str();
  while rest.chars().count() > MAX_TOKENS {
    let limit = rest.char_indices().nth(MAX_TOKENS).map(|(b, _)| b).unwrap_or(rest.len());
    let head = &rest[..limit];
    let cut = head
      .char_indices()
      .rev()
      .find(|(at, c)| *c == ' ' && head[..*at].ends_with([',', ';', ':', '—']))
      .or_else(|| head.char_indices().rev().find(|(_, c)| *c == ' '))
      .map(|(at, _)| at)
      .unwrap_or(limit);
    out.push(rest[..cut].trim().to_string());
    rest = rest[cut..].trim_start();
  }
  if !rest.is_empty() {
    out.push(rest.to_string());
  }
  out
}

impl Phonemizer for EnglishG2p {
  fn phonemize(&self, text: &str, accent: Accent) -> Vec<SentencePhonemes> {
    let mut out = Vec::new();
    for sentence in text::sentences(text, accent) {
      let phonemes = self.sentence(&sentence.items, accent);
      if phonemes.chars().all(|c| !c.is_alphabetic() && !morph::is_vowel(c)) {
        continue;
      }
      for piece in cut_long(phonemes) {
        out.push(SentencePhonemes { start: sentence.start, end: sentence.end, phonemes: piece });
      }
    }
    out
  }
}

#[cfg(test)]
mod tests;
