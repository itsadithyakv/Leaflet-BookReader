//! Everything about a lookup that is not the network.
//!
//! The files in `fixtures/` are real answers from en.wiktionary.org and
//! en.wikipedia.org (October 2026), saved as they came; their text is the
//! projects' own, under CC BY-SA 4.0.

use super::*;

const SERENDIPITY: &str = include_str!("fixtures/definition-serendipity.json");
const HOUSES: &str = include_str!("fixtures/definition-houses.json");
const MAISON: &str = include_str!("fixtures/definition-maison.json");
const WANDERED: &str = include_str!("fixtures/definition-wandered.json");
const MARCUS_AURELIUS: &str = include_str!("fixtures/summary-marcus-aurelius.json");
const MERCURY: &str = include_str!("fixtures/summary-mercury.json");

fn en() -> Lang {
  Lang::english()
}

fn refused(raw: &str) -> bool {
  clean_term(raw) == Err(LookupError { kind: ErrorKind::Refused, message: REFUSAL.to_string() })
}

// ---- The term ----

#[test]
fn a_selection_is_tidied_into_a_term() {
  assert_eq!(clean_term("  serendipity ").unwrap(), "serendipity");
  assert_eq!(clean_term("Marcus\n   Aurelius").unwrap(), "Marcus Aurelius");
  // What a selection drags along at its ends.
  assert_eq!(clean_term("\u{201C}serendipity,\u{201D}").unwrap(), "serendipity");
  assert_eq!(clean_term("(houses).").unwrap(), "houses");
  assert_eq!(clean_term("\u{2014}ran\u{2026}").unwrap(), "ran");
  // What belongs to the word stays.
  assert_eq!(clean_term("well-known").unwrap(), "well-known");
  assert_eq!(clean_term("Caesar\u{2019}s").unwrap(), "Caesar's");
  assert_eq!(clean_term("\u{00E9}t\u{00E9}").unwrap(), "\u{00E9}t\u{00E9}");
}

#[test]
fn a_passage_or_nothing_is_refused() {
  assert!(refused(""));
  assert!(refused("   \n "));
  assert!(refused("\u{201C}\u{2026}\u{201D}"));
  assert!(refused(".."));
  assert_eq!(clean_term("one two three four five six").unwrap(), "one two three four five six");
  assert!(refused("one two three four five six seven"));
  let long = "a".repeat(81);
  assert!(refused(&long));
  assert_eq!(clean_term(&"a".repeat(80)).unwrap().len(), 80);
  // Counted in characters, not bytes.
  assert!(clean_term(&"\u{00E9}".repeat(80)).is_ok());
}

#[test]
fn the_forms_to_try_for_a_meaning() {
  assert_eq!(meaning_candidates("serendipity"), ["serendipity"]);
  assert_eq!(meaning_candidates("Serendipity"), ["Serendipity", "serendipity"]);
  assert_eq!(meaning_candidates("Houses"), ["Houses", "houses", "house", "hous"]);
  assert_eq!(meaning_candidates("Caesar's"), ["Caesar's", "caesar's", "Caesar", "caesar"]);
  assert_eq!(meaning_candidates("stories"), ["stories", "story", "storie", "stori"]);
  assert_eq!(meaning_candidates("boxes"), ["boxes", "boxe", "box"]);
  // Not plurals: a double s, and a word too short to have lost one.
  assert_eq!(meaning_candidates("glass"), ["glass"]);
  assert_eq!(meaning_candidates("is"), ["is"]);
  assert_eq!(meaning_candidates("gas"), ["gas"]);
  // A phrase is not stemmed.
  assert_eq!(meaning_candidates("Ad Hoc"), ["Ad Hoc", "ad hoc"]);
  assert_eq!(meaning_candidates("red herrings"), ["red herrings"]);
  // Never more than a handful of requests.
  assert!(meaning_candidates("Stories's").len() <= MAX_TRIES);
}

#[test]
fn the_titles_to_try_for_a_summary() {
  assert_eq!(summary_candidates("Marcus Aurelius"), ["Marcus Aurelius"]);
  assert_eq!(summary_candidates("roman empire"), ["roman empire", "Roman Empire"]);
  assert_eq!(summary_candidates("Caesar's"), ["Caesar's", "Caesar"]);
  assert_eq!(summary_candidates("serendipity"), ["serendipity"]);
  assert_eq!(summary_candidates("\u{00E9}mile zola"), ["\u{00E9}mile zola", "\u{00C9}mile Zola"]);
}

// ---- Addresses ----

/// The address as a URL parser reads it, which is what goes on the wire.
fn parsed(url: &str) -> reqwest::Url {
  reqwest::Url::parse(url).expect("a valid URL")
}

#[test]
fn a_term_is_one_segment_of_the_path() {
  assert_eq!(definition_url("ad hoc").unwrap(), "https://en.wiktionary.org/api/rest_v1/page/definition/ad%20hoc");
  assert_eq!(
    summary_url(&en(), "Marcus Aurelius").unwrap(),
    "https://en.wikipedia.org/api/rest_v1/page/summary/Marcus%20Aurelius"
  );
  assert_eq!(definition_url("\u{00E9}t\u{00E9}").unwrap(), "https://en.wiktionary.org/api/rest_v1/page/definition/%C3%A9t%C3%A9");
}

#[test]
fn hostile_text_cannot_change_the_path_or_the_host() {
  let hostile = [
    "a/b",
    "../../w/index.php",
    "a/../../secret",
    "what?action=raw",
    "a#fragment",
    "%2e%2e",
    "%2F..%2F",
    "..%2f..",
    "x\\..\\y",
    "@evil.example",
    "evil.example/path",
    "//evil.example",
    "a b\tc\nd",
    "http://evil.example/",
    "a;b=c&d=e",
    "\u{FF0F}\u{2024}\u{2024}"
  ];
  for term in hostile {
    for url in [definition_url(term).unwrap(), summary_url(&en(), term).unwrap()] {
      let url = parsed(&url);
      let host = url.host_str().unwrap();
      assert!(host == "en.wiktionary.org" || host == "en.wikipedia.org", "{term:?} changed the host to {host}");
      assert_eq!(url.scheme(), "https");
      assert_eq!(url.port(), None);
      assert_eq!(url.username(), "");
      assert_eq!(url.query(), None, "{term:?} added a query");
      assert_eq!(url.fragment(), None, "{term:?} added a fragment");
      let segments: Vec<&str> = url.path_segments().unwrap().collect();
      assert_eq!(segments.len(), 5, "{term:?} changed the path to {}", url.path());
      assert_eq!(&segments[..3], ["api", "rest_v1", "page"]);
      // And it is still the same text when the server decodes it.
      assert_eq!(urlencoding::decode(segments[4]).unwrap(), term);
    }
  }
}

#[test]
fn dots_alone_are_not_asked_for() {
  // To a URL parser these mean "here" and "one up", encoded or not.
  for term in ["", "  ", ".", "..", "..."] {
    assert_eq!(definition_url(term), None);
    assert_eq!(summary_url(&en(), term), None);
  }
  // With anything else, dots are just dots.
  let url = parsed(&definition_url("e.g.").unwrap());
  assert_eq!(url.path(), "/api/rest_v1/page/definition/e.g.");
}

#[test]
fn the_pages_for_more_are_built_from_the_title() {
  assert_eq!(wiktionary_page("ad hoc", "English"), "https://en.wiktionary.org/wiki/ad_hoc#English");
  assert_eq!(wiktionary_page("hus", "Norwegian Bokm\u{00E5}l"), "https://en.wiktionary.org/wiki/hus#Norwegian_Bokm%C3%A5l");
  assert_eq!(wikipedia_page(&en(), "Marcus Aurelius"), "https://en.wikipedia.org/wiki/Marcus_Aurelius");
  let odd = parsed(&wikipedia_page(&en(), "AC/DC? #1"));
  assert_eq!(odd.host_str(), Some("en.wikipedia.org"));
  assert_eq!(odd.path(), "/wiki/AC%2FDC%3F_%231");
  assert_eq!((odd.query(), odd.fragment()), (None, None));
}

// ---- The language ----

#[test]
fn a_books_language_becomes_a_wiki() {
  for (tag, code) in [
    (Some("en"), "en"),
    (Some("en-US"), "en"),
    (Some("en_GB"), "en"),
    (Some(" FR "), "fr"),
    (Some("pt-BR"), "pt"),
    (Some("zh-Hant-TW"), "zh"),
    (Some("eng"), "en"),
    (Some("fre"), "fr"),
    (Some("DEU"), "de"),
    (Some("ast"), "ast"),
    (Some("und"), "en"),
    (None, "en"),
    (Some(""), "en"),
    (Some("x"), "en"),
    (Some("english"), "en")
  ] {
    assert_eq!(Lang::from_book(tag).code(), code, "{tag:?}");
  }
}

#[test]
fn a_language_cannot_name_another_host() {
  for tag in ["evil.example/", "en.evil.example", "e/", "e@", "e:", "e#", "e?", "e ", "\u{0435}n", "..", "en\u{2024}x", "1e"] {
    let lang = Lang::from_book(Some(tag));
    assert!(lang.code().len() <= 3 && lang.code().chars().all(|c| c.is_ascii_lowercase()), "{tag:?} became {:?}", lang.code());
    let url = parsed(&summary_url(&lang, "x").unwrap());
    assert!(url.host_str().unwrap().ends_with(".wikipedia.org"), "{tag:?}");
    assert_eq!(url.host_str().unwrap().split('.').count(), 3, "{tag:?}");
  }
  // "en.evil.example" is not "en" followed by something: it is not a language at all.
  assert_eq!(Lang::from_book(Some("en.evil.example")).code(), "en");
}

// ---- Wiktionary's answer ----

#[test]
fn a_words_definitions_are_read_as_plain_text() {
  let found = parse_definitions(SERENDIPITY, "serendipity", &en()).unwrap().unwrap();
  assert_eq!(found.language, "English");
  assert_eq!(found.form_of, None);
  assert_eq!(
    found.entries,
    [Entry {
      part_of_speech: "Noun".to_string(),
      definitions: vec![
        "The phenomenon of making an unplanned, fortunate discovery through a combination of unexpected circumstances and insightful recognition.".to_string(),
        "An unsought, unintended or unexpected, but fortunate, discovery or learning experience that occurs by accident.".to_string(),
        "The occurrence and development of events by chance in a happy or beneficial way.".to_string()
      ]
    }]
  );
}

#[test]
fn no_markup_reaches_the_webview() {
  for (body, word) in [(SERENDIPITY, "serendipity"), (HOUSES, "houses"), (WANDERED, "wandered")] {
    let found = parse_definitions(body, word, &en()).unwrap().unwrap();
    for entry in &found.entries {
      for definition in &entry.definitions {
        assert!(!definition.contains('<') && !definition.contains('>') && !definition.contains("&amp;"), "{definition}");
      }
    }
  }
}

#[test]
fn a_plural_points_at_its_singular() {
  let found = parse_definitions(HOUSES, "houses", &en()).unwrap().unwrap();
  assert_eq!(found.form_of.as_deref(), Some("house"));
  assert_eq!(found.entries.len(), 2);
  assert_eq!(found.entries[0], Entry { part_of_speech: "Noun".to_string(), definitions: vec!["plural of house".to_string()] });
  assert_eq!(found.entries[1].definitions, ["third-person singular simple present indicative of house"]);
}

#[test]
fn a_past_tense_points_at_its_verb() {
  let found = parse_definitions(WANDERED, "wandered", &en()).unwrap().unwrap();
  assert_eq!(found.form_of.as_deref(), Some("wander"));
  assert_eq!(found.entries[0].definitions, ["simple past and past participle of wander"]);
}

#[test]
fn the_books_language_is_read_first_then_english() {
  let french = parse_definitions(MAISON, "maison", &Lang::from_book(Some("fr"))).unwrap().unwrap();
  assert_eq!(french.language, "French");
  assert_eq!(french.form_of, None);
  assert_eq!(french.entries[0], Entry { part_of_speech: "Noun".to_string(), definitions: vec!["house".to_string()] });
  assert_eq!(french.entries[1].definitions, ["homemade", "in-house", "first-rate, top-notch"]);
  // A Swedish book selecting "houses" gets the Swedish word of that spelling.
  let swedish = parse_definitions(HOUSES, "houses", &Lang::from_book(Some("sv"))).unwrap().unwrap();
  assert_eq!(swedish.language, "Swedish");
  assert_eq!(swedish.entries[0].definitions, ["indefinite genitive singular of house"]);
  // A German book has no German "serendipity": English it is.
  let fallback = parse_definitions(SERENDIPITY, "serendipity", &Lang::from_book(Some("de"))).unwrap().unwrap();
  assert_eq!(fallback.language, "English");
  // "maison" is not an English word, and Middle French is not what an English book meant.
  assert_eq!(parse_definitions(MAISON, "maison", &en()).unwrap(), None);
}

/// A body in the API's shape, with these definitions under these parts of speech.
fn body(entries: &[(&str, &str, &[&str])]) -> String {
  let entries: Vec<serde_json::Value> = entries
    .iter()
    .map(|(language, part, definitions)| {
      serde_json::json!({
        "partOfSpeech": part,
        "language": language,
        "definitions": definitions.iter().map(|d| serde_json::json!({ "definition": d })).collect::<Vec<_>>()
      })
    })
    .collect();
  serde_json::json!({ "en": entries }).to_string()
}

fn form(of: &str) -> String {
  format!("<span class=\"form-of-definition use-with-mention\">simple past of <span class=\"form-of-definition-link\"><i class=\"Latn mention\" lang=\"en\"><a rel=\"mw:WikiLink\" href=\"/wiki/{of}#English\" title=\"{of}\">{of}</a></i></span></span>")
}

#[test]
fn only_a_part_of_speech_that_is_all_forms_is_followed() {
  // "ran": a verb that is only forms, then a noun of its own.
  let (run, rin, house, set) = (form("run"), form("rin"), form("house"), form("set"));
  let ran = body(&[("English", "Verb", &[run.as_str(), rin.as_str(), run.as_str()]), ("English", "Noun", &["Yarns coiled on a winch."])]);
  let found = parse_definitions(&ran, "ran", &en()).unwrap().unwrap();
  assert_eq!(found.form_of.as_deref(), Some("run"));
  // The repeated line is listed once.
  assert_eq!(found.entries[0].definitions, ["simple past of run", "simple past of rin"]);

  // A real definition beside the form: the entry stands on its own.
  let mixed = body(&[("English", "Noun", &["A dwelling.", house.as_str()])]);
  assert_eq!(parse_definitions(&mixed, "houses", &en()).unwrap().unwrap().form_of, None);

  // The first all-forms part of speech decides, wherever it comes.
  let later = body(&[("English", "Adjective", &["Moving at a run."]), ("English", "Verb", &[run.as_str()])]);
  assert_eq!(parse_definitions(&later, "running", &en()).unwrap().unwrap().form_of.as_deref(), Some("run"));

  // A word is not followed to itself.
  let circular = body(&[("English", "Verb", &[set.as_str()])]);
  assert_eq!(parse_definitions(&circular, "set", &en()).unwrap().unwrap().form_of, None);
}

#[test]
fn what_marks_a_form() {
  assert_eq!(form_of(&form("run")).as_deref(), Some("run"));
  assert_eq!(form_of("The act of running."), None);
  // A glossary link is not the word.
  assert_eq!(form_of("<span class=\"form-of-definition\"><a href=\"/wiki/Appendix:Glossary\" title=\"Appendix:Glossary\">plural</a> of nothing</span>"), None);
  assert_eq!(
    form_of("<span class=\"form-of-definition\">plural of <span class=\"form-of-definition-link\"><a href=\"/wiki/Appendix:x\" title=\"Appendix:x\">x</a></span></span>"),
    None
  );
  let entity = "<span class=\"form-of-definition\">plural of <span class=\"form-of-definition-link\"><a href=\"/wiki/x\" title=\"rock &amp; roll\">rock &amp; roll</a></span></span>";
  assert_eq!(form_of(entity).as_deref(), Some("rock & roll"));
}

#[test]
fn definitions_are_capped_and_tidied() {
  let many = body(&[
    ("Translingual", "Symbol", &["A language code."]),
    ("English", "Noun", &["One.", "", "Two.<ol><li>A sub-sense.</li></ol>", "Three.", "Four."]),
    ("English", "Verb", &["<span class=\"maintenance-line\">(needs a definition)</span>"]),
    ("English", "Adjective", &["A."]),
    ("English", "Adverb", &["B."]),
    ("English", "Preposition", &["C."]),
    ("English", "Interjection", &["D."])
  ]);
  let found = parse_definitions(&many, "word", &en()).unwrap().unwrap();
  assert_eq!(found.language, "English");
  let parts: Vec<&str> = found.entries.iter().map(|entry| entry.part_of_speech.as_str()).collect();
  // No symbol beside real words, no part of speech with nothing to say, four at most.
  assert_eq!(parts, ["Noun", "Adjective", "Adverb", "Preposition"]);
  assert_eq!(found.entries[0].definitions, ["One.", "Two.", "Three."]);

  // A symbol on its own is still an answer.
  let symbol = body(&[("Translingual", "Symbol", &["The chemical element mercury."])]);
  let found = parse_definitions(&symbol, "Hg", &en()).unwrap().unwrap();
  assert_eq!((found.language.as_str(), found.entries.len()), ("Translingual", 1));
}

#[test]
fn an_answer_that_is_not_the_api_is_an_error() {
  assert!(parse_definitions("<html>captive portal</html>", "word", &en()).is_err());
  assert!(parse_definitions("[]", "word", &en()).is_err());
  assert_eq!(parse_definitions("{}", "word", &en()).unwrap(), None);
  assert!(parse_summary("<html>captive portal</html>", &en()).is_err());
}

// ---- Wikipedia's answer ----

#[test]
fn a_page_is_summarised() {
  let found = parse_summary(MARCUS_AURELIUS, &en()).unwrap().unwrap();
  assert_eq!(found.title, "Marcus Aurelius");
  assert_eq!(found.description.as_deref(), Some("Stoic philosopher, Roman emperor from 161 to 180"));
  assert!(found.extract.starts_with("Marcus Aurelius Antoninus was Roman emperor from 161 to 180 and a Stoic philosopher."));
  assert!(found.extract.ends_with("He served as Roman consul in 140, 145, and 161."));
  assert_eq!(found.url, "https://en.wikipedia.org/wiki/Marcus_Aurelius");
  assert!(!found.ambiguous);
  assert!(!found.extract.contains('<'));
}

#[test]
fn a_page_of_other_pages_is_ambiguous() {
  let found = parse_summary(MERCURY, &en()).unwrap().unwrap();
  assert_eq!(
    found,
    Summary {
      title: "Mercury".to_string(),
      description: None,
      // Its list of planets, elements and gods is not a summary of anything.
      extract: String::new(),
      url: "https://en.wikipedia.org/wiki/Mercury".to_string(),
      ambiguous: true
    }
  );
}

#[test]
fn a_page_with_nothing_to_say_is_no_summary() {
  assert_eq!(parse_summary(r#"{"type":"standard","title":"Stub","extract":"  "}"#, &en()).unwrap(), None);
  assert_eq!(parse_summary(r#"{"type":"no-extract","title":"File","extract":"x"}"#, &en()).unwrap(), None);
  assert_eq!(parse_summary(r#"{"type":"standard","extract":"No title."}"#, &en()).unwrap(), None);
  assert_eq!(parse_summary(r#"{"status":404,"type":"Internal error"}"#, &en()).unwrap(), None);
}

#[test]
fn a_summary_links_to_its_own_wiki_and_is_clipped() {
  let long = format!("{} End.", "A sentence of some length. ".repeat(40));
  let body = serde_json::json!({ "type": "standard", "title": "Marc Aur\u{00E8}le", "extract": long, "description": " empereur  romain " }).to_string();
  let found = parse_summary(&body, &Lang::from_book(Some("fr"))).unwrap().unwrap();
  assert_eq!(found.url, "https://fr.wikipedia.org/wiki/Marc_Aur%C3%A8le");
  assert_eq!(found.description.as_deref(), Some("empereur romain"));
  assert!(found.extract.chars().count() <= MAX_EXTRACT_CHARS);
  assert!(found.extract.ends_with("length."));
}

// ---- Which side leads ----

fn meaning() -> Meaning {
  Meaning { word: "w".to_string(), language: "English".to_string(), entries: Vec::new(), url: String::new(), root: None }
}

fn summary(ambiguous: bool) -> Summary {
  Summary { title: "W".to_string(), description: None, extract: String::new(), url: String::new(), ambiguous }
}

#[test]
fn a_plain_word_leads_with_its_meaning() {
  assert_eq!(lead("serendipity", Some(&meaning()), Some(&summary(false))), Lead::Meaning);
  assert_eq!(lead("\u{00E9}t\u{00E9}", Some(&meaning()), Some(&summary(false))), Lead::Meaning);
}

#[test]
fn a_name_or_a_phrase_leads_with_its_summary() {
  assert_eq!(lead("Paris", Some(&meaning()), Some(&summary(false))), Lead::Summary);
  assert_eq!(lead("Marcus Aurelius", Some(&meaning()), Some(&summary(false))), Lead::Summary);
  assert_eq!(lead("ad hoc", Some(&meaning()), Some(&summary(false))), Lead::Summary);
  assert_eq!(lead("\u{00C9}mile", Some(&meaning()), Some(&summary(false))), Lead::Summary);
}

#[test]
fn the_side_that_leads_has_to_be_there() {
  assert_eq!(lead("Paris", Some(&meaning()), None), Lead::Meaning);
  assert_eq!(lead("serendipity", None, Some(&summary(false))), Lead::Summary);
  // "Mercury": a page that only says the name is ambiguous goes second.
  assert_eq!(lead("Mercury", Some(&meaning()), Some(&summary(true))), Lead::Meaning);
  assert_eq!(lead("Mercury", None, Some(&summary(true))), Lead::Summary);
}

// ---- Putting the two together ----

#[test]
fn nothing_found_is_an_answer() {
  let found = combine("xyzzy".to_string(), Side::Missing, Side::Missing).unwrap();
  assert_eq!((found.meaning, found.summary, found.missed.len()), (None, None, 0));
  assert_eq!(found.term, "xyzzy");
}

#[test]
fn one_source_failing_does_not_hide_the_other() {
  let found = combine("Paris".to_string(), Side::Unreachable(ErrorKind::Offline), Side::Found(summary(false))).unwrap();
  assert_eq!(found.missed, [Source::Wiktionary]);
  assert_eq!(found.lead, Lead::Summary);
  let found = combine("word".to_string(), Side::Found(meaning()), Side::Unreachable(ErrorKind::Unavailable)).unwrap();
  assert_eq!(found.missed, [Source::Wikipedia]);
  assert_eq!(found.lead, Lead::Meaning);
}

#[test]
fn nothing_found_with_a_source_unasked_is_an_error() {
  let offline = combine("word".to_string(), Side::Unreachable(ErrorKind::Offline), Side::Unreachable(ErrorKind::Offline)).unwrap_err();
  assert_eq!(offline.kind, ErrorKind::Offline);
  assert!(offline.message.contains("Check your connection"));
  // Wikipedia had no page, Wiktionary could not be asked: "nothing found" would not be true.
  let half = combine("word".to_string(), Side::Unreachable(ErrorKind::Unavailable), Side::Missing).unwrap_err();
  assert_eq!(half.kind, ErrorKind::Unavailable);
  // Of the two reasons, being offline is the one to report.
  for (a, b) in [(ErrorKind::Offline, ErrorKind::Unavailable), (ErrorKind::Unavailable, ErrorKind::Offline)] {
    assert_eq!(combine("word".to_string(), Side::Unreachable(a), Side::Unreachable(b)).unwrap_err().kind, ErrorKind::Offline);
  }
}

// ---- What the webview is sent ----

#[test]
fn results_and_errors_are_sent_in_the_shape_the_service_reads() {
  let sent = serde_json::to_value(Lookup {
    term: "houses".to_string(),
    meaning: Some(Meaning {
      word: "houses".to_string(),
      language: "English".to_string(),
      entries: vec![Entry { part_of_speech: "Noun".to_string(), definitions: vec!["plural of house".to_string()] }],
      url: wiktionary_page("houses", "English"),
      root: Some(Root { word: "house".to_string(), entries: Vec::new(), url: wiktionary_page("house", "English") })
    }),
    summary: None,
    lead: Lead::Meaning,
    missed: vec![Source::Wikipedia]
  })
  .unwrap();
  assert_eq!(
    sent,
    serde_json::json!({
      "term": "houses",
      "meaning": {
        "word": "houses",
        "language": "English",
        "entries": [{ "partOfSpeech": "Noun", "definitions": ["plural of house"] }],
        "url": "https://en.wiktionary.org/wiki/houses#English",
        "root": { "word": "house", "entries": [], "url": "https://en.wiktionary.org/wiki/house#English" }
      },
      "summary": null,
      "lead": "meaning",
      "missed": ["wikipedia"]
    })
  );
  assert_eq!(
    serde_json::to_value(LookupError::refused()).unwrap(),
    serde_json::json!({ "kind": "refused", "message": "Select a word or a short phrase" })
  );
  assert_eq!(serde_json::to_value(ErrorKind::Offline).unwrap(), "offline");
  assert_eq!(serde_json::to_value(ErrorKind::Unavailable).unwrap(), "unavailable");
}

// ---- The real thing ----

/// Against the live APIs; not part of a normal run.
/// `cargo test --lib lookup::tests::live -- --ignored --nocapture`
#[test]
#[ignore = "talks to Wiktionary and Wikipedia"]
fn live() {
  let runtime = tokio::runtime::Runtime::new().unwrap();
  let terms = std::env::var("LEAFLET_LOOKUP_TERMS").unwrap_or_else(|_| "serendipity|houses|Marcus Aurelius".to_string());
  for term in terms.split('|') {
    let found = runtime.block_on(look_up(term, Some("en")));
    match found {
      Ok(found) => println!("{term}\n{}\n", serde_json::to_string_pretty(&found).unwrap()),
      Err(error) => println!("{term}\n{}\n", serde_json::to_string_pretty(&error).unwrap())
    }
  }
}
