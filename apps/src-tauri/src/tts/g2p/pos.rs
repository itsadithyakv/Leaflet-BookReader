//! A cheap guess at a word's part of speech, from the words around it: only
//! for the few hundred words said by it (read, live, wind, tear, close,
//! record, present, object, …). misaki asks spaCy; a reader cannot carry a
//! tagger, and for these words the word before says enough most of the time.
//!
//! Tags are misaki's (Penn's, and its parents VERB, NOUN, ADJ, ADV).

/// Words after which a verb comes in its plain form.
const BEFORE_BASE_VERB: &[&str] = &[
  "to", "will", "would", "shall", "should", "can", "could", "may", "might", "must", "do", "does", "don't", "doesn't", "didn't", "won't",
  "wouldn't", "can't", "cannot", "couldn't", "shouldn't", "mustn't", "let's", "please", "i'll", "you'll", "we'll", "they'll", "he'll",
  "she'll", "it'll", "i'd", "you'd", "we'd", "they'd", "he'd", "she'd", "not", "never", "always", "often", "also", "just", "ever",
];

/// After these a past participle (have read, was read).
const BEFORE_PARTICIPLE: &[&str] = &[
  "had", "has", "have", "having", "i've", "you've", "we've", "they've", "was", "were", "been", "being", "is", "are", "be", "am", "get",
  "got", "gets", "getting", "it's", "he's", "she's", "that's",
];

const SUBJECTS: &[&str] = &["i", "you", "we", "they", "he", "she", "it", "who", "which", "that", "one", "nobody", "everyone", "someone"];

/// After these a noun (or its adjective).
const DETERMINERS: &[&str] = &[
  "a", "an", "the", "this", "that", "these", "those", "my", "your", "his", "her", "its", "our", "their", "some", "any", "no", "every",
  "each", "another", "such", "what", "whose", "which", "one's", "of", "in", "on", "at", "for", "with", "from", "by", "about", "into",
  "first", "last", "next", "own", "great", "good", "long",
];

/// What a verb at the start of a sentence (an order) is followed by.
const OBJECTS: &[&str] = &["the", "a", "an", "this", "that", "these", "those", "my", "your", "his", "her", "our", "their", "it", "him", "them", "me", "us"];

/// Before these a word is likely an adjective or adverb ("close to", "live by").
const AFTER_ADJECTIVE: &[&str] = &["to", "by", "enough"];

/// The tag to say `word` by, given the word before (lower case) and after.
/// None: the word's default.
pub fn guess(word: &str, prev: Option<&str>, next: Option<&str>) -> Option<&'static str> {
  let word = word.to_ascii_lowercase();
  let after_name = prev.is_some_and(|p| p.chars().next().is_some_and(char::is_uppercase));
  let prev = prev.map(str::to_ascii_lowercase);
  let prev = prev.as_deref();
  // "used to" is its own thing (misaki: VBD before to).
  if word == "used" {
    return if next == Some("to") { Some("VBD") } else { None };
  }
  let Some(prev) = prev else {
    // At the start: "Close the door", "Read it": a verb.
    return next.is_some_and(|n| OBJECTS.contains(&n)).then_some("VB");
  };
  let ends_s = word.ends_with('s') && !word.ends_with("ss");
  if BEFORE_PARTICIPLE.contains(&prev) {
    // "was close", "is live": an adjective; "was read", "had wound": a participle.
    return Some(if word.ends_with('d') || word.ends_with("ound") || word == "read" { "VBN" } else { "JJ" });
  }
  if BEFORE_BASE_VERB.contains(&prev) {
    return Some("VB");
  }
  if SUBJECTS.contains(&prev) {
    // "she read the letter": in a story, mostly the past.
    return Some(if ends_s { "VBZ" } else { "VBD" });
  }
  if DETERMINERS.contains(&prev) {
    if next.is_some_and(|n| AFTER_ADJECTIVE.contains(&n)) {
      return Some("JJ");
    }
    return Some(if ends_s { "NNS" } else { "NN" });
  }
  // "quickly read", "Dashwood read": a name or an adverb before, in a story the past.
  if prev.ends_with("ly") || after_name {
    return Some(if ends_s { "VBZ" } else { "VBD" });
  }
  None
}

#[cfg(test)]
mod tests {
  use super::guess;

  #[test]
  fn from_the_word_before() {
    assert_eq!(guess("read", Some("to"), Some("the")), Some("VB"));
    assert_eq!(guess("read", Some("had"), None), Some("VBN"));
    assert_eq!(guess("read", Some("She"), Some("it")), Some("VBD"));
    assert_eq!(guess("lives", Some("their"), None), Some("NNS"));
    assert_eq!(guess("live", Some("they"), Some("in")), Some("VBD"));
    assert_eq!(guess("close", Some("was"), Some("to")), Some("JJ"));
    assert_eq!(guess("used", Some("he"), Some("to")), Some("VBD"));
    assert_eq!(guess("wind", None, None), None);
    assert_eq!(guess("Close", None, Some("the")), Some("VB"));
    assert_eq!(guess("read", Some("Dashwood"), Some("the")), Some("VBD"));
  }
}
