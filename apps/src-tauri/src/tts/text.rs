//! An item of text cut into what the model is given at a time: each
//! sentence (at the item's `marks`), a long one cut again where a clause
//! ends, and — the first time after play is pressed — the first clause on
//! its own, so the voice starts sooner.
//!
//! Offsets are the page's: UTF-16 code units of the item's text, as
//! JavaScript counts them, so a `boundary` lands where the page expects.

/// A sentence longer than this (UTF-16 units) is cut where a clause ends.
pub const MAX_PIECE: usize = 160;
/// The first clause is said on its own only when the sentence is longer than this.
pub const FIRST_CLAUSE_MIN_SENTENCE: usize = 60;
/// … and the clause at least this long.
pub const FIRST_CLAUSE_MIN: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Piece {
  /// What the model says.
  pub text: String,
  /// Where it starts in the item's text (UTF-16 units).
  pub at: usize,
  /// It starts a sentence (one of the item's marks): a `boundary` is said there.
  pub sentence: bool,
  /// It ends a sentence (a short gap after it, unless the item ends there).
  pub ends_sentence: bool,
  /// Nothing to say (punctuation only): no audio, only its boundary.
  pub silent: bool,
}

/// The UTF-16 offset of each char boundary, with its byte offset.
fn offsets(text: &str) -> Vec<(usize, usize)> {
  let mut out = Vec::with_capacity(text.len() + 1);
  let mut unit = 0;
  for (byte, ch) in text.char_indices() {
    out.push((unit, byte));
    unit += ch.len_utf16();
  }
  out.push((unit, text.len()));
  out
}

/// The byte offset at a UTF-16 offset (the char boundary at or before it).
fn byte_at(map: &[(usize, usize)], unit: usize) -> usize {
  match map.binary_search_by(|(u, _)| u.cmp(&unit)) {
    Ok(index) => map[index].1,
    Err(0) => 0,
    Err(index) => map[index - 1].1,
  }
}

fn unit_at(map: &[(usize, usize)], byte: usize) -> usize {
  match map.binary_search_by(|(_, b)| b.cmp(&byte)) {
    Ok(index) => map[index].0,
    Err(0) => 0,
    Err(index) => map[index - 1].0,
  }
}

pub fn utf16_len(text: &str) -> usize {
  text.encode_utf16().count()
}

/// Where a run of text may be cut after a clause: just past `,;:` or a dash, before a space.
fn clause_cuts(text: &str) -> Vec<usize> {
  let mut cuts = Vec::new();
  let chars: Vec<(usize, char)> = text.char_indices().collect();
  for (index, &(byte, ch)) in chars.iter().enumerate() {
    let next_is_space = chars.get(index + 1).is_some_and(|(_, c)| c.is_whitespace());
    if matches!(ch, ',' | ';' | ':' | '—' | '–' | ')' ) && next_is_space {
      cuts.push(byte + ch.len_utf8());
    }
  }
  cuts
}

fn has_words(text: &str) -> bool {
  text.chars().any(|c| c.is_alphanumeric())
}

/// Cuts one sentence (bytes `start..end` of `text`) into pieces of at most `MAX_PIECE`.
fn cut_sentence(text: &str, start: usize, end: usize, first_clause: bool) -> Vec<(usize, usize)> {
  let sentence = &text[start..end];
  let units = utf16_len(sentence);
  let mut spans = Vec::new();
  let mut from = 0usize;
  let cuts = clause_cuts(sentence);
  if first_clause && units > FIRST_CLAUSE_MIN_SENTENCE {
    if let Some(&cut) = cuts.iter().find(|&&cut| utf16_len(&sentence[..cut]) >= FIRST_CLAUSE_MIN && utf16_len(&sentence[..cut]) <= MAX_PIECE) {
      if has_words(&sentence[cut..]) {
        spans.push((0, cut));
        from = cut;
      }
    }
  }
  while utf16_len(&sentence[from..]) > MAX_PIECE {
    let limit = {
      // The byte at MAX_PIECE units past `from`.
      let mut units = 0;
      let mut byte = sentence.len();
      for (offset, ch) in sentence[from..].char_indices() {
        if units + ch.len_utf16() > MAX_PIECE {
          byte = from + offset;
          break;
        }
        units += ch.len_utf16();
      }
      byte
    };
    let cut = cuts
      .iter()
      .copied()
      .rfind(|&cut| cut > from && cut <= limit)
      .or_else(|| sentence[from..limit].rfind(' ').map(|space| from + space + 1).filter(|&cut| cut > from))
      .unwrap_or(limit);
    spans.push((from, cut));
    from = cut;
  }
  if from < sentence.len() {
    spans.push((from, sentence.len()));
  }
  spans.into_iter().map(|(a, b)| (start + a, start + b)).collect()
}

/// The pieces of an item. `marks`: sentence starts (UTF-16 units; 0 is assumed).
pub fn pieces(text: &str, marks: &[usize], first_clause: bool) -> Vec<Piece> {
  let map = offsets(text);
  let total_units = map.last().map(|(unit, _)| *unit).unwrap_or(0);
  let mut starts: Vec<usize> = marks.iter().copied().filter(|&mark| mark < total_units).collect();
  starts.push(0);
  starts.sort_unstable();
  starts.dedup();
  let byte_starts: Vec<usize> = starts.iter().map(|&unit| byte_at(&map, unit)).collect();
  let mut out = Vec::new();
  for (index, &start) in byte_starts.iter().enumerate() {
    let end = byte_starts.get(index + 1).copied().unwrap_or(text.len());
    if end <= start {
      continue;
    }
    let spans = cut_sentence(text, start, end, first_clause && index == 0);
    let last = spans.len().saturating_sub(1);
    for (part, (a, b)) in spans.into_iter().enumerate() {
      let raw = &text[a..b];
      let said = raw.trim();
      out.push(Piece {
        text: said.to_string(),
        at: if part == 0 { unit_at(&map, a) } else { unit_at(&map, a + (raw.len() - raw.trim_start().len())) },
        sentence: part == 0,
        ends_sentence: part == last,
        silent: !has_words(said),
      });
    }
  }
  out
}

/// No piece is cut shorter than this (UTF-16 units): a few words, not one.
pub const MIN_PIECE: usize = 16;

/// Cuts a piece in two so its first part is about `max_units` long: at the
/// last clause end before it (or the first one within twice that), else at
/// the last space before it. None when that would leave a part without words.
pub fn split_piece(piece: &Piece, max_units: usize) -> Option<(Piece, Piece)> {
  let max_units = max_units.max(MIN_PIECE);
  let text = &piece.text;
  if utf16_len(text) <= max_units + MIN_PIECE {
    return None;
  }
  let units_to = |byte: usize| utf16_len(&text[..byte]);
  let cuts = clause_cuts(text);
  let fits = |cut: &usize| units_to(*cut) >= MIN_PIECE && utf16_len(&text[*cut..]) >= MIN_PIECE;
  let cut = cuts
    .iter()
    .copied()
    .rfind(|cut| fits(cut) && units_to(*cut) <= max_units)
    .or_else(|| cuts.iter().copied().find(|cut| fits(cut) && units_to(*cut) <= max_units * 2))
    .or_else(|| {
      text
        .char_indices()
        .filter(|(byte, ch)| ch.is_whitespace() && units_to(*byte) <= max_units)
        .map(|(byte, ch)| byte + ch.len_utf8())
        .rfind(|cut| fits(cut))
    })?;
  let head = text[..cut].trim_end();
  let rest = &text[cut..];
  let tail = rest.trim_start();
  if !has_words(head) || !has_words(tail) {
    return None;
  }
  let tail_at = piece.at + units_to(cut) + utf16_len(&rest[..rest.len() - tail.len()]);
  Some((
    Piece { text: head.to_string(), at: piece.at, sentence: piece.sentence, ends_sentence: false, silent: false },
    Piece { text: tail.to_string(), at: tail_at, sentence: false, ends_sentence: piece.ends_sentence, silent: false },
  ))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn an_item_is_cut_at_its_marks() {
    let text = "It was late. The rain had stopped. Nobody came.";
    let found = pieces(text, &[0, 13, 35], false);
    let said: Vec<&str> = found.iter().map(|piece| piece.text.as_str()).collect();
    assert_eq!(said, ["It was late.", "The rain had stopped.", "Nobody came."]);
    assert_eq!(found.iter().map(|piece| piece.at).collect::<Vec<_>>(), [0, 13, 35]);
    assert!(found.iter().all(|piece| piece.sentence && piece.ends_sentence && !piece.silent));
  }

  #[test]
  fn no_marks_is_one_sentence() {
    let found = pieces("Just this.", &[], false);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].at, 0);
  }

  #[test]
  fn the_first_clause_goes_first_when_asked() {
    let text = "When the morning came at last, grey and cold over the hills, she rose and went out to the gate.";
    let found = pieces(text, &[0], true);
    assert_eq!(found[0].text, "When the morning came at last,");
    assert!(found[0].sentence && !found[0].ends_sentence);
    assert!(!found[1].sentence && found.last().unwrap().ends_sentence);
    assert_eq!(found[1].at, 31);
    // Not asked: whole.
    assert_eq!(pieces(text, &[0], false).len(), 1);
    // A short sentence stays whole even when asked.
    assert_eq!(pieces("Yes, she said.", &[0], true).len(), 1);
  }

  #[test]
  fn a_long_sentence_is_cut_where_a_clause_ends() {
    let clause = "and the wind went on over the fields, ";
    let text = format!("{}the end.", clause.repeat(12));
    let found = pieces(&text, &[0], false);
    assert!(found.len() > 1);
    for piece in &found {
      assert!(utf16_len(&piece.text) <= MAX_PIECE, "{}", piece.text.len());
    }
    assert!(found[0].text.ends_with(','));
    // Rebuilt, nothing is lost.
    let joined: String = found.iter().map(|piece| piece.text.clone()).collect::<Vec<_>>().join(" ");
    assert_eq!(joined.split_whitespace().collect::<Vec<_>>(), text.split_whitespace().collect::<Vec<_>>());
  }

  #[test]
  fn a_run_without_a_clause_is_cut_at_a_space() {
    let text = "word ".repeat(100);
    let found = pieces(&text, &[0], false);
    assert!(found.len() >= 2);
    assert!(found.iter().all(|piece| utf16_len(&piece.text) <= MAX_PIECE && !piece.text.contains("wor d")));
  }

  #[test]
  fn offsets_are_utf16_units() {
    // "é" is one unit, the emoji two, "’" one: the second sentence starts at unit 9.
    let text = "Café 😀. It’s here.";
    assert_eq!(utf16_len("Café 😀. "), 9);
    let found = pieces(text, &[9], false);
    assert_eq!(found[1].text, "It’s here.");
    assert_eq!(found[1].at, 9);
  }

  #[test]
  fn punctuation_alone_is_silent_but_keeps_its_place() {
    let found = pieces("Then. — . On.", &[0, 6, 10], false);
    assert_eq!(found.len(), 3);
    assert!(found[1].silent);
    assert_eq!(found[1].at, 6);
  }

  #[test]
  fn a_piece_is_cut_shorter_when_the_voice_has_little_ahead() {
    let text = "She went down to the gate, where the old dog lay waiting in the sun, and opened it without a word.";
    let piece = pieces(text, &[0], false).remove(0);
    let (head, tail) = split_piece(&piece, 40).unwrap();
    assert_eq!(head.text, "She went down to the gate,");
    assert!(head.sentence && !head.ends_sentence);
    assert!(!tail.sentence && tail.ends_sentence);
    assert_eq!(&text[tail.at..tail.at + 5], "where");
    // The last clause end that fits.
    let (head, _) = split_piece(&piece, 70).unwrap();
    assert_eq!(head.text, "She went down to the gate, where the old dog lay waiting in the sun,");
    // Twice as far for a clause before falling back to a space.
    let (head, _) = split_piece(&piece, 20).unwrap();
    assert_eq!(head.text, "She went down to the gate,");
    // No clause near: a space.
    let plain = pieces("one two three four five six seven eight nine ten eleven twelve thirteen", &[0], false).remove(0);
    let (head, tail) = split_piece(&plain, 20).unwrap();
    assert!(utf16_len(&head.text) <= 20 && !head.text.ends_with(' '));
    assert!(tail.text.starts_with(|c: char| c.is_alphabetic()));
    // Already short: left whole.
    assert!(split_piece(&pieces("Short enough here.", &[0], false)[0], 16).is_none());
  }

  #[test]
  fn marks_past_the_end_or_unsorted_are_tidied() {
    let found = pieces("One. Two.", &[5, 0, 5, 99], false);
    assert_eq!(found.iter().map(|piece| piece.at).collect::<Vec<_>>(), [0, 5]);
  }
}
