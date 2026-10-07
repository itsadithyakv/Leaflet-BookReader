//! Wiktionary's definitions arrive as HTML (links, labels, nested lists of
//! sub-senses, editors' notes). The webview is only ever given plain text, so
//! the tags are taken out and the entities decoded here.

/// Elements whose contents are not part of the definition: nested lists (the
/// sub-senses, which the API also lists on their own), tables, and code.
const HIDDEN_TAGS: [&str; 7] = ["ol", "ul", "dl", "table", "style", "script", "math"];
/// Classes that mark editors' notes ("Can we add an example?") and footnotes.
const HIDDEN_CLASSES: [&str; 4] = ["maintenance-line", "mw-ref", "reference", "mw-reference-text"];
/// Elements that never have a closing tag.
const VOID_TAGS: [&str; 8] = ["br", "link", "meta", "img", "hr", "wbr", "input", "source"];
/// Elements that end a run of words: a space stands in for them.
const BREAKING_TAGS: [&str; 5] = ["br", "p", "div", "li", "dd"];

/// A piece of HTML as plain text: no tags, entities decoded, one space between
/// words.
pub fn plain(html: &str) -> String {
  let mut out = String::with_capacity(html.len());
  // The elements open at this point, and whether each hides its contents.
  let mut open: Vec<(String, bool)> = Vec::new();
  let mut hidden = 0usize;
  let mut rest = html;

  while let Some(at) = rest.find('<') {
    if hidden == 0 {
      out.push_str(&decode_entities(&rest[..at]));
    }
    let after = &rest[at + 1..];
    // A "<" that does not start a tag ("a < b") is text.
    if !after.starts_with(|c: char| c.is_ascii_alphabetic() || c == '/' || c == '!') {
      if hidden == 0 {
        out.push('<');
      }
      rest = after;
      continue;
    }
    if let Some(comment) = after.strip_prefix("!--") {
      rest = comment.find("-->").map(|end| &comment[end + 3..]).unwrap_or("");
      continue;
    }
    // A tag that never closes is dropped with everything after it, rather
    // than letting half a tag through as text.
    let Some(end) = tag_end(after) else {
      rest = "";
      break;
    };
    let tag = &after[..end];
    rest = &after[end + 1..];

    if let Some(closing) = tag.strip_prefix('/') {
      let name = tag_name(closing);
      // Closes the nearest open element of that name, and any left open inside it.
      if let Some(index) = open.iter().rposition(|(opened, _)| *opened == name) {
        for (_, hides) in open.drain(index..) {
          if hides {
            hidden -= 1;
          }
        }
      }
      continue;
    }

    let name = tag_name(tag);
    if hidden == 0 && BREAKING_TAGS.contains(&name.as_str()) {
      out.push(' ');
    }
    if tag.ends_with('/') || VOID_TAGS.contains(&name.as_str()) {
      continue;
    }
    let hides = HIDDEN_TAGS.contains(&name.as_str()) || has_class(tag, &HIDDEN_CLASSES);
    if hides {
      hidden += 1;
    }
    open.push((name, hides));
  }
  if hidden == 0 {
    out.push_str(&decode_entities(rest));
  }
  tidy(&out)
}

/// Where a tag's ">" is, counting from just after its "<". A ">" inside a
/// quoted attribute (`title="a > b"`) does not end the tag.
fn tag_end(tag: &str) -> Option<usize> {
  let mut quote: Option<char> = None;
  for (index, c) in tag.char_indices() {
    match (quote, c) {
      (Some(q), _) if c == q => quote = None,
      (Some(_), _) => {}
      (None, '"') | (None, '\'') => quote = Some(c),
      (None, '>') => return Some(index),
      _ => {}
    }
  }
  None
}

fn tag_name(tag: &str) -> String {
  tag
    .chars()
    .take_while(|c| c.is_ascii_alphanumeric())
    .collect::<String>()
    .to_ascii_lowercase()
}

/// The value of an attribute in a tag's text, as written (entities and all).
pub fn attribute<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
  let mut from = 0;
  let needle = format!("{name}=\"");
  while let Some(found) = tag[from..].find(&needle) {
    let at = from + found;
    // "title=" must not be found inside "data-title=".
    let starts_a_name = tag[..at].chars().next_back().is_none_or(|c| c.is_whitespace());
    let value = &tag[at + needle.len()..];
    if starts_a_name {
      return value.find('"').map(|end| &value[..end]);
    }
    from = at + needle.len();
  }
  None
}

fn has_class(tag: &str, classes: &[&str]) -> bool {
  attribute(tag, "class").is_some_and(|value| value.split_whitespace().any(|class| classes.contains(&class)))
}

/// `&amp;`, `&#8217;`, `&#x2019;` and the handful of names that turn up in
/// Wikimedia's HTML. An entity that is not known is left as it was written.
pub fn decode_entities(text: &str) -> String {
  if !text.contains('&') {
    return text.to_string();
  }
  let mut out = String::with_capacity(text.len());
  let mut rest = text;
  while let Some(at) = rest.find('&') {
    out.push_str(&rest[..at]);
    let after = &rest[at + 1..];
    // The longest name here is six letters; a far-off ";" is not this entity's.
    let decoded = after
      .char_indices()
      .take(10)
      .find(|(_, c)| *c == ';')
      .and_then(|(end, _)| entity(&after[..end]).map(|value| (value, end)));
    match decoded {
      Some((value, end)) => {
        out.push_str(&value);
        rest = &after[end + 1..];
      }
      None => {
        out.push('&');
        rest = after;
      }
    }
  }
  out.push_str(rest);
  out
}

fn entity(name: &str) -> Option<String> {
  if let Some(number) = name.strip_prefix('#') {
    let code = match number.strip_prefix(['x', 'X']) {
      Some(hex) => u32::from_str_radix(hex, 16).ok()?,
      None => number.parse::<u32>().ok()?
    };
    let c = char::from_u32(code)?;
    // A control character has no place in a definition.
    return Some(if c.is_control() { " ".to_string() } else { c.to_string() });
  }
  let value = match name {
    "amp" => "&",
    "lt" => "<",
    "gt" => ">",
    "quot" => "\"",
    "apos" => "'",
    "nbsp" | "ensp" | "emsp" | "thinsp" => " ",
    "ndash" => "\u{2013}",
    "mdash" => "\u{2014}",
    "hellip" => "\u{2026}",
    "lsquo" => "\u{2018}",
    "rsquo" => "\u{2019}",
    "ldquo" => "\u{201C}",
    "rdquo" => "\u{201D}",
    "laquo" => "\u{00AB}",
    "raquo" => "\u{00BB}",
    "times" => "\u{00D7}",
    "minus" => "\u{2212}",
    "deg" => "\u{00B0}",
    "middot" => "\u{00B7}",
    "prime" => "\u{2032}",
    // Soft hyphens and direction marks: nothing to show.
    "shy" | "zwj" | "zwnj" | "lrm" | "rlm" => "",
    _ => return None
  };
  Some(value.to_string())
}

/// One space between words, none at the ends.
pub fn squeeze(text: &str) -> String {
  text
    .split_whitespace()
    // Soft hyphens, zero-width spaces and direction marks, typed as characters.
    .map(|word| word.replace(['\u{00AD}', '\u{200B}', '\u{200E}', '\u{200F}', '\u{FEFF}'], ""))
    .filter(|word| !word.is_empty())
    .collect::<Vec<_>>()
    .join(" ")
}

/// Squeezed, and without the stray spaces that taking tags out leaves around
/// punctuation ("house , home" or "( obsolete )").
fn tidy(text: &str) -> String {
  let squeezed = squeeze(text);
  let mut out = String::with_capacity(squeezed.len());
  let mut chars = squeezed.chars().peekable();
  while let Some(c) = chars.next() {
    if c == ' ' {
      let before_closer = chars.peek().is_some_and(|next| matches!(next, ',' | '.' | ';' | ':' | ')' | ']'));
      let after_opener = out.ends_with(['(', '[']);
      if before_closer || after_opener {
        continue;
      }
    }
    out.push(c);
  }
  out
}

/// At most `max` characters, ending on a sentence where one ends late enough,
/// and with an ellipsis when something was cut.
pub fn clip(text: &str, max: usize) -> String {
  if text.chars().count() <= max {
    return text.to_string();
  }
  let head: String = text.chars().take(max).collect();
  let sentence = head
    .char_indices()
    .filter(|(index, c)| matches!(c, '.' | '!' | '?') && head[index + c.len_utf8()..].starts_with(' '))
    .map(|(index, c)| index + c.len_utf8())
    .next_back();
  match sentence {
    // A sentence that ends in the second half: stop there, whole.
    Some(end) if head[..end].chars().count() >= max / 2 => head[..end].to_string(),
    _ => {
      let cut = head.rfind(' ').unwrap_or(head.len());
      format!("{}\u{2026}", head[..cut].trim_end_matches([',', ';', ':']))
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn links_and_labels_become_their_words() {
    let html = "The <a rel=\"mw:WikiLink\" href=\"/wiki/phenomenon\" title=\"phenomenon\">phenomenon</a> of making an <a rel=\"mw:WikiLink\" href=\"/wiki/unplanned\" title=\"unplanned\">unplanned</a>, <a href=\"/wiki/fortunate\">fortunate</a> <a href=\"/wiki/discovery\">discovery</a>.";
    assert_eq!(plain(html), "The phenomenon of making an unplanned, fortunate discovery.");
  }

  #[test]
  fn empty_labels_leave_no_stray_space() {
    let html = "<span class=\"usage-label-sense\" about=\"#mwt33\" typeof=\"mw:Transclusion\"></span> <a href=\"/wiki/first-rate\">first-rate</a> , <a href=\"/wiki/top-notch\">top-notch</a>";
    assert_eq!(plain(html), "first-rate, top-notch");
    assert_eq!(plain("( <i>obsolete</i> ) A near relative ."), "(obsolete) A near relative.");
  }

  #[test]
  fn sub_senses_and_editors_notes_are_left_out() {
    let nested = "Moving or advancing at a run.\n<ol><li>Of a horse, having a running gait; not a <a href=\"/wiki/trotter\">trotter</a>.</li></ol>";
    assert_eq!(plain(nested), "Moving or advancing at a run.");
    let note = "Approaching; <a href=\"/wiki/about\">about</a>. <span class=\"maintenance-line\" about=\"#mwt210\">(Can we add an <a href=\"/wiki/x\">example</a> for this sense?)</span><link rel=\"mw:PageProp/Category\" href=\"./Category:Requests\">";
    assert_eq!(plain(note), "Approaching; about.");
    assert_eq!(plain("Water<sup class=\"mw-ref reference\"><a href=\"#cite\">[1]</a></sup> that falls."), "Water that falls.");
  }

  #[test]
  fn nothing_that_looks_like_markup_survives() {
    assert_eq!(plain("safe <script>alert(1)</script>words"), "safe words");
    assert_eq!(plain("safe <style>p { color: red }</style>words"), "safe words");
    assert_eq!(plain("before <!-- a comment --> after"), "before after");
    // A tag that never closes takes the rest with it.
    assert_eq!(plain("kept <a href=\"x\" onclick=\"y"), "kept");
    assert_eq!(plain("kept <img src=x onerror=alert(1)>too"), "kept too");
    // A ">" inside an attribute does not end the tag early.
    assert_eq!(plain("<a title=\"a > b\">word</a>"), "word");
    // A closing tag with no opening one changes nothing.
    assert_eq!(plain("</ol>still here"), "still here");
  }

  #[test]
  fn a_less_than_sign_in_prose_is_kept() {
    assert_eq!(plain("true when a < b and b &lt; c"), "true when a < b and b < c");
  }

  #[test]
  fn entities_are_decoded() {
    assert_eq!(decode_entities("Tom &amp; Jerry&#39;s &quot;time&quot;"), "Tom & Jerry's \"time\"");
    assert_eq!(decode_entities("it&#x2019;s 5&nbsp;&deg;C &mdash; cold"), "it\u{2019}s 5 \u{00B0}C \u{2014} cold");
    // Unknown, unfinished or far-fetched: left alone.
    assert_eq!(decode_entities("R&D; AT&T &bogus; &#xZZ; &"), "R&D; AT&T &bogus; &#xZZ; &");
    assert_eq!(decode_entities("a&#0;b"), "a b");
    // Decoded once, never twice.
    assert_eq!(decode_entities("&amp;lt;b&amp;gt;"), "&lt;b&gt;");
  }

  #[test]
  fn an_escaped_tag_is_text_not_a_tag() {
    assert_eq!(plain("the &lt;b&gt; element"), "the <b> element");
  }

  #[test]
  fn whitespace_is_squeezed() {
    assert_eq!(squeeze("  a\n\tb\u{00A0} c  "), "a b c");
    assert_eq!(squeeze("co\u{00AD}operate \u{200B} now"), "cooperate now");
  }

  #[test]
  fn attributes_are_read_by_name() {
    let tag = "a rel=\"mw:WikiLink\" data-title=\"wrong\" href=\"/wiki/house#English\" title=\"house\"";
    assert_eq!(attribute(tag, "title"), Some("house"));
    assert_eq!(attribute(tag, "href"), Some("/wiki/house#English"));
    assert_eq!(attribute(tag, "class"), None);
  }

  #[test]
  fn a_long_extract_stops_on_a_sentence() {
    let text = "One sentence here. A second one follows it. And a third that runs on and on.";
    assert_eq!(clip(text, 200), text);
    assert_eq!(clip(text, 50), "One sentence here. A second one follows it.");
    // No sentence ends late enough: cut on a word, and say so.
    assert_eq!(clip("Short. Then a very long run of words without any stop at all", 40), "Short. Then a very long run of words\u{2026}");
    assert_eq!(clip("\u{00E9}t\u{00E9} \u{00E9}t\u{00E9} \u{00E9}t\u{00E9}", 8), "\u{00E9}t\u{00E9} \u{00E9}t\u{00E9}\u{2026}");
  }
}
