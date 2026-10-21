//! Text into what is said: words (abbreviations, numbers, symbols and
//! initials said in full) and the punctuation Kokoro knows (its pauses and
//! tunes), cut into sentences.
//!
//! The page's own clean-up (`speechText.ts`: drop caps, note markers,
//! dashes, Roman numerals, small caps) has already run; this does what a
//! reading voice does with the rest.

use super::numbers::{self, Currency};
use super::Accent;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Item {
  /// A word as written (its case kept: it says how to stress it).
  Word(String),
  /// A word spelt letter by letter (BBC, U.S., J.).
  Letters(String),
  /// Punctuation Kokoro has a token for: `; : , . ! ? — … ( ) “ ”`.
  Punct(char),
}

/// A sentence: its items, and where it lies in the text (bytes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sentence {
  pub items: Vec<Item>,
  pub start: usize,
  pub end: usize,
}

/// Titles and other abbreviations said in full, with the period taken.
const TITLES: &[(&str, &str)] = &[
  ("Mr", "mister"),
  ("Mrs", "missus"),
  ("Ms", "miz"),
  ("Mx", "mix"),
  ("Dr", "doctor"),
  ("Prof", "professor"),
  ("Gen", "general"),
  ("Col", "colonel"),
  ("Capt", "captain"),
  ("Cpt", "captain"),
  ("Lt", "lieutenant"),
  ("Sgt", "sergeant"),
  ("Cpl", "corporal"),
  ("Adm", "admiral"),
  ("Rev", "reverend"),
  ("Fr", "father"),
  ("Hon", "honourable"),
  ("Gov", "governor"),
  ("Sen", "senator"),
  ("Rep", "representative"),
  ("Pres", "president"),
  ("Jr", "junior"),
  ("Sr", "senior"),
  ("Mt", "mount"),
  ("Ft", "fort"),
  ("Ave", "avenue"),
  ("Blvd", "boulevard"),
  ("Rd", "road"),
  ("Ln", "lane"),
  ("Esq", "esquire"),
  ("vs", "versus"),
  ("approx", "approximately"),
  ("Vol", "volume"),
  ("vol", "volume"),
  ("Ch", "chapter"),
  ("ch", "chapter"),
  ("Fig", "figure"),
  ("fig", "figure"),
  ("Ltd", "limited"),
  ("Inc", "incorporated"),
  ("Bros", "brothers"),
  ("Dept", "department"),
  ("Univ", "university"),
  ("Messrs", "messieurs"),
  ("Mme", "madame"),
  ("Mlle", "mademoiselle"),
];

/// Written with dots, said as words.
const DOTTED: &[(&str, &[&str])] = &[
  ("e.g.", &["for", "example"]),
  ("i.e.", &["that", "is"]),
  ("etc.", &["et", "cetera"]),
  ("viz.", &["namely"]),
  ("cf.", &["compare"]),
  ("a.m.", &["A", "M"]),
  ("p.m.", &["P", "M"]),
];

fn is_apostrophe(c: char) -> bool {
  c == '\'' || c == '’' || c == '‘' || c == 'ʼ'
}

fn is_dash(c: char) -> bool {
  matches!(c, '—' | '–' | '―' | '‒')
}

/// Kokoro's own punctuation (tokens.txt), and what others become.
fn punct(c: char) -> Option<char> {
  Some(match c {
    ';' | ':' | ',' | '.' | '!' | '?' | '…' | '(' | ')' | '“' | '”' => c,
    '—' | '–' | '―' | '‒' => '—',
    '[' | '{' => '(',
    ']' | '}' => ')',
    '«' | '„' => '“',
    '»' => '”',
    '¡' | '¿' => return None,
    _ => return None,
  })
}

fn symbol_word(c: char) -> Option<&'static str> {
  Some(match c {
    '&' => "and",
    '%' => "percent",
    '+' => "plus",
    '@' => "at",
    '=' => "equals",
    '°' => "degrees",
    '§' => "section",
    '#' => "number",
    _ => return None,
  })
}

/// Accented Latin letters as plain ones, for the lexicon (café, naïve).
pub fn fold(c: char) -> &'static str {
  match c {
    'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => "a",
    'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' | 'Ā' => "A",
    'ç' | 'ć' | 'č' => "c",
    'Ç' | 'Ć' | 'Č' => "C",
    'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ę' | 'ě' => "e",
    'È' | 'É' | 'Ê' | 'Ë' | 'Ē' => "E",
    'ì' | 'í' | 'î' | 'ï' | 'ī' => "i",
    'Ì' | 'Í' | 'Î' | 'Ï' | 'Ī' => "I",
    'ñ' | 'ń' | 'ň' => "n",
    'Ñ' => "N",
    'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' => "o",
    'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' | 'Ø' | 'Ō' => "O",
    'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' => "u",
    'Ù' | 'Ú' | 'Û' | 'Ü' | 'Ū' => "U",
    'ý' | 'ÿ' => "y",
    'Ý' => "Y",
    'ß' => "ss",
    'æ' => "ae",
    'Æ' => "Ae",
    'œ' => "oe",
    'Œ' => "Oe",
    'ð' => "d",
    'þ' => "th",
    'ł' => "l",
    'Ł' => "L",
    'š' | 'ś' => "s",
    'Š' | 'Ś' => "S",
    'ž' | 'ź' | 'ż' => "z",
    'Ž' | 'Ź' | 'Ż' => "Z",
    _ => "",
  }
}

#[derive(Debug, Clone, PartialEq)]
enum Raw {
  Word(String),
  Number(String),
  Punct(char),
  /// A straight double quote: which way it faces is decided by its place.
  Quote,
  Symbol(char),
  Space,
  /// Text Kokoro says nothing for.
  Other,
}

struct Lexer<'a> {
  chars: Vec<(usize, char)>,
  at: usize,
  text: &'a str,
}

impl<'a> Lexer<'a> {
  fn peek(&self, ahead: usize) -> Option<char> {
    self.chars.get(self.at + ahead).map(|(_, c)| *c)
  }

  fn byte(&self) -> usize {
    self.chars.get(self.at).map(|(b, _)| *b).unwrap_or(self.text.len())
  }

  fn word(&mut self) -> String {
    let mut out = String::new();
    while let Some(c) = self.peek(0) {
      if c.is_alphabetic() {
        let folded = fold(c);
        if folded.is_empty() {
          out.push(c);
        } else {
          out.push_str(folded);
        }
        self.at += 1;
      } else if is_apostrophe(c)
        && !out.is_empty()
        && (self.peek(1).is_some_and(char::is_alphabetic) || (out.ends_with(['s', 'S']) && !self.peek(1).is_some_and(char::is_alphanumeric)))
      {
        // don't, Bennet's; and the Bennets' house, a plural's possessive (a
        // closing quote after an s reads the same, and is said the same).
        out.push('\'');
        self.at += 1;
      } else if c == '.' && self.peek(1).is_some_and(char::is_alphabetic) && self.peek(2) == Some('.') && out.chars().count() <= 2 {
        // U.S.A., e.g., a.m.: keep the dots, the word is read as one.
        out.push('.');
        self.at += 1;
      } else if c == '.' && out.contains('.') {
        out.push('.');
        self.at += 1;
        break;
      } else {
        break;
      }
    }
    out
  }

  fn number(&mut self) -> String {
    let mut out = String::new();
    while let Some(c) = self.peek(0) {
      if c.is_ascii_digit() || (matches!(c, ',' | '.' | ':') && self.peek(1).is_some_and(|d| d.is_ascii_digit())) {
        out.push(c);
        self.at += 1;
      } else {
        break;
      }
    }
    // A suffix: 21st, 1990s, 1990's
    let rest: String = self.chars[self.at..].iter().take(3).map(|(_, c)| c.to_ascii_lowercase()).collect();
    for suffix in ["st", "nd", "rd", "th", "'s", "s"] {
      if rest.starts_with(suffix) {
        let after = self.peek(suffix.chars().count());
        if !after.is_some_and(char::is_alphanumeric) {
          for _ in 0..suffix.chars().count() {
            out.push(self.peek(0).unwrap_or(' '));
            self.at += 1;
          }
          break;
        }
      }
    }
    out
  }
}

fn lex(text: &str) -> Vec<(Raw, usize)> {
  let mut lexer = Lexer { chars: text.char_indices().collect(), at: 0, text };
  let mut out = Vec::new();
  while let Some(c) = lexer.peek(0) {
    let at = lexer.byte();
    if c.is_alphabetic() {
      out.push((Raw::Word(lexer.word()), at));
    } else if c.is_ascii_digit() {
      out.push((Raw::Number(lexer.number()), at));
    } else if c.is_whitespace() {
      while lexer.peek(0).is_some_and(char::is_whitespace) {
        lexer.at += 1;
      }
      out.push((Raw::Space, at));
    } else if c == '.' && lexer.peek(1) == Some('.') && lexer.peek(2) == Some('.') {
      lexer.at += 3;
      out.push((Raw::Punct('…'), at));
    } else if c == '-' && lexer.peek(1) == Some('-') {
      while lexer.peek(0) == Some('-') {
        lexer.at += 1;
      }
      out.push((Raw::Punct('—'), at));
    } else if c == '-' {
      lexer.at += 1;
      let spaced_before = out.last().is_none_or(|(raw, _)| *raw == Raw::Space);
      let spaced_after = lexer.peek(0).is_none_or(char::is_whitespace);
      if lexer.peek(0).is_some_and(|d| d.is_ascii_digit()) && spaced_before {
        out.push((Raw::Word("minus".into()), at));
      } else if spaced_before && spaced_after {
        out.push((Raw::Punct('—'), at));
      } else {
        // well-known: two words.
        out.push((Raw::Space, at));
      }
    } else if c == '"' {
      lexer.at += 1;
      out.push((Raw::Quote, at));
    } else if is_apostrophe(c) {
      // A quote mark of single quotes, or a lone apostrophe: not said.
      lexer.at += 1;
      out.push((Raw::Other, at));
    } else if c == '/' {
      lexer.at += 1;
      out.push((Raw::Space, at));
    } else if let Some(p) = punct(c) {
      lexer.at += 1;
      if is_dash(c) {
        out.push((Raw::Space, at));
      }
      out.push((Raw::Punct(p), at));
      if is_dash(c) {
        out.push((Raw::Space, at));
      }
    } else {
      lexer.at += 1;
      if symbol_word(c).is_some() || Currency::from_symbol(c).is_some() {
        out.push((Raw::Symbol(c), at));
      } else {
        out.push((Raw::Other, at));
      }
    }
  }
  out
}

fn title_for(word: &str) -> Option<&'static str> {
  TITLES.iter().find(|(abbr, _)| *abbr == word).map(|(_, full)| *full)
}

fn is_initialism(word: &str) -> bool {
  // U.S. / U.S.A. / J.R.R.: letters each followed by a dot.
  let mut chars = word.chars();
  let mut count = 0;
  loop {
    match (chars.next(), chars.next()) {
      (Some(letter), Some('.')) if letter.is_alphabetic() => count += 1,
      (None, None) => return count >= 2,
      _ => return false,
    }
  }
}

fn push_words(items: &mut Vec<Item>, words: Vec<String>) {
  items.extend(words.into_iter().map(Item::Word));
}

/// The text's sentences, each a list of what is said.
pub fn sentences(text: &str, accent: Accent) -> Vec<Sentence> {
  let raw = lex(text);
  let mut out = Vec::new();
  let mut items: Vec<Item> = Vec::new();
  let mut start = 0;
  let mut i = 0;
  let next_word_is_capital = |from: usize| -> bool {
    raw[from..].iter().find_map(|(r, _)| match r {
      Raw::Word(w) => Some(w.chars().next().is_some_and(char::is_uppercase)),
      Raw::Number(_) => Some(false),
      _ => None,
    }) == Some(true)
  };
  while i < raw.len() {
    let (token, _) = &raw[i];
    let mut swallowed = false;
    let next = raw.get(i + 1).map(|(r, _)| r);
    match token {
      Raw::Word(word) => {
        let dotted = DOTTED.iter().find(|(d, _)| d.eq_ignore_ascii_case(word) || d.trim_end_matches('.').eq_ignore_ascii_case(word));
        if let Some((_, said)) = dotted {
          let mut said: Vec<Item> = said.iter().map(|w| if w.len() == 1 { Item::Letters(w.to_string()) } else { Item::Word(w.to_string()) }).collect();
          items.append(&mut said);
          // "etc." ends a sentence when one starts after it.
          if word.ends_with('.') && next == Some(&Raw::Space) && next_word_is_capital(i + 1) && word.eq_ignore_ascii_case("etc.") {
            items.push(Item::Punct('.'));
          }
          if !word.ends_with('.') && next == Some(&Raw::Punct('.')) {
            i += 1;
          swallowed = true;
          }
        } else if is_initialism(word) {
          items.push(Item::Letters(word.replace('.', "")));
        } else if word.ends_with('.') {
          // a.b. read as letters
          items.push(Item::Letters(word.replace('.', "")));
        } else if let (Some(full), Some(Raw::Punct('.'))) = (title_for(word), next) {
          let full = match word.as_str() {
            "St" if next_word_is_capital(i + 2) => "saint",
            _ => full,
          };
          items.push(Item::Word(full.into()));
          i += 1;
          swallowed = true;
        } else if word == "St" && next == Some(&Raw::Punct('.')) {
          items.push(Item::Word(if next_word_is_capital(i + 2) { "saint" } else { "street" }.into()));
          i += 1;
          swallowed = true;
        } else if (word == "No" || word == "no" || word == "Nos") && next == Some(&Raw::Punct('.')) && matches!(raw.get(i + 3).map(|(r, _)| r), Some(Raw::Number(_))) {
          items.push(Item::Word("number".into()));
          i += 1;
          swallowed = true;
        } else if word.chars().count() == 1 && word.chars().all(char::is_uppercase) && next == Some(&Raw::Punct('.')) && next_word_is_capital(i + 2) && raw.get(i + 2).is_some_and(|(r, _)| *r == Raw::Space) && i + 3 < raw.len() {
          // An initial: J. K. Rowling.
          items.push(Item::Letters(word.clone()));
          i += 1;
          swallowed = true;
        } else {
          items.push(Item::Word(word.clone()));
        }
      }
      Raw::Number(number) => {
        let currency = match i.checked_sub(1).map(|p| &raw[p].0) {
          Some(Raw::Symbol(c)) => Currency::from_symbol(*c),
          _ => None,
        };
        let percent = next == Some(&Raw::Symbol('%'));
        let words = if let Some((h, m)) = number.split_once(':').filter(|(h, m)| h.len() <= 2 && m.len() == 2 && !m.contains(':')) {
          // A time: 10:30 "ten thirty", 10:05 "ten oh five", 10:00 "ten o'clock".
          let mut words = numbers::cardinal(h.parse().unwrap_or(0), accent);
          match m.parse::<u64>().unwrap_or(0) {
            0 => words.push("o'clock".into()),
            m @ 1..=9 => {
              words.push("oh".into());
              words.extend(numbers::cardinal(m, accent));
            }
            m => words.extend(numbers::cardinal(m, accent)),
          }
          Some(words)
        } else {
          let plain = currency.is_none() && !percent;
          numbers::say(number, accent, currency, plain)
        };
        match words {
          Some(words) => push_words(&mut items, words),
          None => {
            // Not a number this knows (1.2.3): its digits and points.
            for part in number.split(['.', ',', ':']) {
              push_words(&mut items, numbers::digits(part));
            }
          }
        }
      }
      Raw::Symbol(c) => {
        if Currency::from_symbol(*c).is_some() {
          // Said after its number; a lone one is said by name.
          if !matches!(next, Some(Raw::Number(_))) {
            items.push(Item::Word(match c {
              '$' => "dollars",
              '£' => "pounds",
              _ => "euros",
            }
            .into()));
          }
        } else if let Some(word) = symbol_word(*c) {
          items.push(Item::Word(word.into()));
        }
      }
      Raw::Quote => {
        // Opening after a space (or at the start, or after an opening mark).
        let opening = i == 0 || matches!(raw[i - 1].0, Raw::Space | Raw::Other | Raw::Punct('(' | '—' | '“'));
        items.push(Item::Punct(if opening { '“' } else { '”' }));
      }
      Raw::Punct(p) => items.push(Item::Punct(*p)),
      Raw::Space | Raw::Other => {}
    }
    // A sentence ends at . ! ? … (and any closing marks after it) before a space.
    let ends = !swallowed && matches!(raw[i].0, Raw::Punct('.' | '!' | '?' | '…'));
    if ends {
      let mut j = i + 1;
      while let Some((Raw::Punct('”' | ')') | Raw::Quote, _)) = raw.get(j) {
        j += 1;
      }
      if j > i + 1 {
        // The closing marks belong to this sentence.
        while i + 1 < j {
          i += 1;
          match raw[i].0 {
            Raw::Quote => items.push(Item::Punct('”')),
            Raw::Punct(p) => items.push(Item::Punct(p)),
            _ => {}
          }
        }
      }
      // … unless the next word is in lower case ("Go!" he said).
      let next_lower = raw[i + 1..].iter().find_map(|(r, _)| match r {
        Raw::Word(w) => Some(w.chars().next().is_some_and(char::is_lowercase)),
        Raw::Space => None,
        _ => Some(false),
      }) == Some(true);
      if matches!(raw.get(i + 1), None | Some((Raw::Space, _))) && !items.is_empty() && !next_lower {
        let end = raw.get(i + 1).map(|(_, b)| *b).unwrap_or(text.len());
        out.push(Sentence { items: std::mem::take(&mut items), start, end });
        start = end;
      }
    }
    i += 1;
  }
  if !items.is_empty() {
    out.push(Sentence { items, start, end: text.len() });
  }
  // Leading spaces belong to no sentence.
  for sentence in &mut out {
    while sentence.start < sentence.end && text[sentence.start..].starts_with(char::is_whitespace) {
      sentence.start += text[sentence.start..].chars().next().map(char::len_utf8).unwrap_or(1);
    }
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  fn words(text: &str) -> Vec<String> {
    sentences(text, Accent::Us)
      .into_iter()
      .flat_map(|s| s.items)
      .map(|item| match item {
        Item::Word(w) => w,
        Item::Letters(l) => format!("<{l}>"),
        Item::Punct(p) => p.to_string(),
      })
      .collect()
  }

  #[test]
  fn words_and_punctuation() {
    assert_eq!(words("Mr. Bennet's house, in 1813!"), ["mister", "Bennet's", "house", ",", "in", "eighteen", "thirteen", "!"]);
    assert_eq!(words("\"Yes,\" she said."), ["“", "Yes", ",", "”", "she", "said", "."]);
    assert_eq!(words("a well-known man -- truly"), ["a", "well", "known", "man", "—", "truly"]);
    assert_eq!(words("the Bennets' carriage"), ["the", "Bennets'", "carriage"]);
    assert_eq!(words("It cost $5.50, or 20%."), ["It", "cost", "five", "dollars", "and", "fifty", "cents", ",", "or", "twenty", "percent", "."]);
    assert_eq!(words("the U.S. and the BBC"), ["the", "<US>", "and", "the", "BBC"]);
    assert_eq!(words("cats, e.g. lions"), ["cats", ",", "for", "example", "lions"]);
    assert_eq!(words("At 10:30 on the 21st"), ["At", "ten", "thirty", "on", "the", "twenty", "first"]);
    assert_eq!(words("J. K. Rowling"), ["<J>", "<K>", "Rowling"]);
    assert_eq!(words("St. Paul's on Baker St."), ["saint", "Paul's", "on", "Baker", "street"]);
    assert_eq!(words("café naïve"), ["cafe", "naive"]);
    assert_eq!(words("Wait... what?"), ["Wait", "…", "what", "?"]);
  }

  #[test]
  fn cut_into_sentences() {
    let text = "It was late. \"Go!\" he said. Mr. Darcy bowed";
    let got = sentences(text, Accent::Us);
    assert_eq!(got.len(), 3, "{got:?}");
    assert_eq!(&text[got[0].start..got[0].end], "It was late.");
    assert_eq!(&text[got[1].start..got[1].end], "\"Go!\" he said.");
    assert_eq!(&text[got[2].start..got[2].end], "Mr. Darcy bowed");
  }
}
