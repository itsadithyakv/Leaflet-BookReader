//! Numbers as words, the way a person reading aloud says them: cardinals,
//! ordinals (21st), years (1813, 1990s), decimals, money, percentages and
//! times. Words come out one per entry (`twenty`, `three`), ready for the
//! lexicon.

use super::Accent;

const ONES: [&str; 20] = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS: [&str; 10] = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [&str; 7] = ["", "thousand", "million", "billion", "trillion", "quadrillion", "quintillion"];

fn below_hundred(n: u64, out: &mut Vec<String>) {
  if n < 20 {
    out.push(ONES[n as usize].into());
  } else {
    out.push(TENS[(n / 10) as usize].into());
    if !n.is_multiple_of(10) {
      out.push(ONES[(n % 10) as usize].into());
    }
  }
}

/// 1–999. `and` before the tens is British ("one hundred and five").
fn below_thousand(n: u64, accent: Accent, out: &mut Vec<String>) {
  let hundreds = n / 100;
  let rest = n % 100;
  if hundreds > 0 {
    out.push(ONES[hundreds as usize].into());
    out.push("hundred".into());
    if rest > 0 && accent == Accent::Gb {
      out.push("and".into());
    }
  }
  if rest > 0 {
    below_hundred(rest, out);
  }
}

pub fn cardinal(n: u64, accent: Accent) -> Vec<String> {
  let mut out = Vec::new();
  if n == 0 {
    out.push("zero".into());
    return out;
  }
  let mut groups = Vec::new();
  let mut rest = n;
  while rest > 0 {
    groups.push(rest % 1000);
    rest /= 1000;
  }
  for (scale, &group) in groups.iter().enumerate().rev() {
    if group == 0 {
      continue;
    }
    // British: "one thousand and five" (the last group, under a hundred).
    if scale == 0 && accent == Accent::Gb && groups.len() > 1 && group < 100 {
      out.push("and".into());
    }
    below_thousand(group, accent, &mut out);
    if scale > 0 {
      out.push(SCALES[scale].into());
    }
  }
  out
}

fn ordinal_word(word: &str) -> String {
  match word {
    "one" => "first".into(),
    "two" => "second".into(),
    "three" => "third".into(),
    "five" => "fifth".into(),
    "eight" => "eighth".into(),
    "nine" => "ninth".into(),
    "twelve" => "twelfth".into(),
    w if w.ends_with('y') => format!("{}ieth", &w[..w.len() - 1]),
    w => format!("{w}th"),
  }
}

pub fn ordinal(n: u64, accent: Accent) -> Vec<String> {
  let mut words = cardinal(n, accent);
  if let Some(last) = words.last_mut() {
    *last = ordinal_word(last);
  }
  words
}

/// A year: 1813 "eighteen thirteen", 1900 "nineteen hundred", 1905
/// "nineteen oh five", 2000 "two thousand", 2009 "two thousand nine" (GB
/// "and nine"), 2015 "twenty fifteen". `plural` makes the last word a plural
/// (the 1990s: "nineteen nineties").
pub fn year(n: u64, accent: Accent, plural: bool) -> Vec<String> {
  let mut words = Vec::new();
  let high = n / 100;
  let low = n % 100;
  if !(1000..10000).contains(&n) || n.is_multiple_of(1000) || (n % 1000 < 10 && n / 1000 != 1) || (2000..2010).contains(&n) {
    words = cardinal(n, accent);
  } else {
    below_hundred(high, &mut words);
    match low {
      0 => words.push("hundred".into()),
      1..=9 => {
        words.push("oh".into());
        below_hundred(low, &mut words);
      }
      _ => below_hundred(low, &mut words),
    }
  }
  if plural {
    if let Some(last) = words.last_mut() {
      *last = plural_of(last);
    }
  }
  words
}

fn plural_of(word: &str) -> String {
  match word {
    w if w.ends_with('y') => format!("{}ies", &w[..w.len() - 1]),
    "six" => "sixes".into(),
    w => format!("{w}s"),
  }
}

/// Each digit said on its own ("point one four", a phone number).
pub fn digits(text: &str) -> Vec<String> {
  text.chars().filter_map(|c| c.to_digit(10)).map(|d| ONES[d as usize].to_string()).collect()
}

fn parse_int(text: &str) -> Option<u64> {
  let clean: String = text.chars().filter(|c| *c != ',').collect();
  if clean.is_empty() || clean.len() > 19 || !clean.bytes().all(|b| b.is_ascii_digit()) {
    return None;
  }
  clean.parse().ok()
}

/// Commas only where thousands are grouped (`1,000,000`), never `1,00`.
fn well_grouped(text: &str) -> bool {
  if !text.contains(',') {
    return true;
  }
  let parts: Vec<&str> = text.split(',').collect();
  !parts[0].is_empty() && parts[0].len() <= 3 && parts[1..].iter().all(|p| p.len() == 3)
}

pub enum Currency {
  Dollar,
  Pound,
  Euro,
}

impl Currency {
  pub fn from_symbol(c: char) -> Option<Currency> {
    match c {
      '$' => Some(Currency::Dollar),
      '£' => Some(Currency::Pound),
      '€' => Some(Currency::Euro),
      _ => None,
    }
  }

  fn units(&self) -> (&'static str, &'static str, &'static str, &'static str) {
    match self {
      Currency::Dollar => ("dollar", "dollars", "cent", "cents"),
      Currency::Pound => ("pound", "pounds", "penny", "pence"),
      Currency::Euro => ("euro", "euros", "cent", "cents"),
    }
  }
}

/// A number as written (`1,234`, `3.14`, `21st`, `1990s`, `007`), its words;
/// None when it is not one this knows.
pub fn say(text: &str, accent: Accent, currency: Option<Currency>, plain_context: bool) -> Option<Vec<String>> {
  let lower = text.to_ascii_lowercase();
  // An ordinal: 1st 2nd 3rd 4th 21st
  for suffix in ["st", "nd", "rd", "th"] {
    if let Some(number) = lower.strip_suffix(suffix) {
      if let Some(n) = parse_int(number) {
        return Some(ordinal(n, accent));
      }
    }
  }
  // A decade: 1990s, 90s, 1990's
  if let Some(number) = lower.strip_suffix("'s").or_else(|| lower.strip_suffix('s')) {
    if !number.contains(',') {
      if let Some(n) = parse_int(number) {
        if number.len() == 4 {
          return Some(year(n, accent, true));
        }
        let mut words = cardinal(n, accent);
        if let Some(last) = words.last_mut() {
          *last = plural_of(last);
        }
        return Some(words);
      }
    }
  }
  if let Some(money) = currency {
    let (one, many, small_one, small_many) = money.units();
    let (whole, cents) = match text.split_once('.') {
      Some((whole, cents)) if cents.len() == 2 && cents.bytes().all(|b| b.is_ascii_digit()) => (whole, Some(cents)),
      Some(_) => return None,
      None => (text, None),
    };
    let whole_n = if whole.is_empty() { Some(0) } else { parse_int(whole) }?;
    let cents_n = cents.and_then(|c| c.parse::<u64>().ok()).unwrap_or(0);
    let mut words = Vec::new();
    if whole_n > 0 || cents_n == 0 {
      words.extend(cardinal(whole_n, accent));
      words.push((if whole_n == 1 { one } else { many }).into());
    }
    if cents_n > 0 {
      if !words.is_empty() {
        words.push("and".into());
      }
      words.extend(cardinal(cents_n, accent));
      words.push((if cents_n == 1 { small_one } else { small_many }).into());
    }
    return Some(words);
  }
  if let Some((whole, fraction)) = text.split_once('.') {
    if fraction.is_empty() || !fraction.bytes().all(|b| b.is_ascii_digit()) || !well_grouped(whole) {
      return None;
    }
    let mut words = if whole.is_empty() { Vec::new() } else { cardinal(parse_int(whole)?, accent) };
    words.push("point".into());
    words.extend(digits(fraction));
    return Some(words);
  }
  if !well_grouped(text) {
    return None;
  }
  let n = parse_int(text)?;
  // A leading zero (007, 0800): digit by digit.
  if text.len() > 1 && text.starts_with('0') {
    return Some(digits(text).into_iter().map(|d| if d == "zero" { "oh".into() } else { d }).collect());
  }
  // Four digits with no comma, where a year can be (not 1,813): a year.
  if plain_context && text.len() == 4 && (1100..2100).contains(&n) {
    return Some(year(n, accent, false));
  }
  Some(cardinal(n, accent))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn s(words: Vec<String>) -> String {
    words.join(" ")
  }

  #[test]
  fn cardinals() {
    assert_eq!(s(cardinal(0, Accent::Us)), "zero");
    assert_eq!(s(cardinal(21, Accent::Us)), "twenty one");
    assert_eq!(s(cardinal(105, Accent::Us)), "one hundred five");
    assert_eq!(s(cardinal(105, Accent::Gb)), "one hundred and five");
    assert_eq!(s(cardinal(1005, Accent::Gb)), "one thousand and five");
    assert_eq!(s(cardinal(1_234_567, Accent::Us)), "one million two hundred thirty four thousand five hundred sixty seven");
  }

  #[test]
  fn ordinals_and_years() {
    assert_eq!(s(ordinal(21, Accent::Us)), "twenty first");
    assert_eq!(s(ordinal(12, Accent::Us)), "twelfth");
    assert_eq!(s(ordinal(40, Accent::Us)), "fortieth");
    assert_eq!(s(year(1813, Accent::Us, false)), "eighteen thirteen");
    assert_eq!(s(year(1900, Accent::Us, false)), "nineteen hundred");
    assert_eq!(s(year(1905, Accent::Us, false)), "nineteen oh five");
    assert_eq!(s(year(2000, Accent::Us, false)), "two thousand");
    assert_eq!(s(year(2009, Accent::Gb, false)), "two thousand and nine");
    assert_eq!(s(year(2015, Accent::Us, false)), "twenty fifteen");
    assert_eq!(s(year(1990, Accent::Us, true)), "nineteen nineties");
  }

  #[test]
  fn as_written() {
    let say = |t: &str| say(t, Accent::Us, None, true).map(s);
    assert_eq!(say("21st").unwrap(), "twenty first");
    assert_eq!(say("1813").unwrap(), "eighteen thirteen");
    assert_eq!(say("1,813").unwrap(), "one thousand eight hundred thirteen");
    assert_eq!(say("3.14").unwrap(), "three point one four");
    assert_eq!(say("007").unwrap(), "oh oh seven");
    assert_eq!(say("1990s").unwrap(), "nineteen nineties");
    assert_eq!(say("1,00"), None);
    let money = |t: &str, c: char| super::say(t, Accent::Us, Currency::from_symbol(c), true).map(s).unwrap();
    assert_eq!(money("5", '$'), "five dollars");
    assert_eq!(money("1", '$'), "one dollar");
    assert_eq!(money("5.50", '$'), "five dollars and fifty cents");
    assert_eq!(money("0.99", '£'), "ninety nine pence");
    assert_eq!(money("2,000", '£'), "two thousand pounds");
  }
}
