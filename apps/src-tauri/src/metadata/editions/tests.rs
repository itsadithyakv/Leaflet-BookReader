use super::*;

/// Real answers from Open Library (`/works/<id>/editions.json`), cut down to a
/// few editions each and the fields read: Mistborn's first two books, as
/// they were in October 2026. Tor's 2023 reissue, its 2019 mass market, its
/// first printings, Gollancz's; a Turkish, a Spanish and a Japanese edition
/// that name no language; a Portuguese and a German that do; audiobooks.
const FINAL_EMPIRE: &str = include_str!("../fixtures/editions-final-empire.json");
const WELL_OF_ASCENSION: &str = include_str!("../fixtures/editions-well-of-ascension.json");

fn cover(id: i64, publisher: &str, year: Option<i32>, language: Option<&str>) -> EditionCover {
  EditionCover {
    cover_id: id,
    publishers: vec![publisher.to_string()],
    year,
    language: language.map(str::to_string),
    title: String::new(),
    isbn: None
  }
}

/// An English edition with a year.
fn eng(id: i64, publisher: &str, year: i32) -> EditionCover {
  cover(id, publisher, Some(year), Some("eng"))
}

fn titled(mut edition: EditionCover, title: &str) -> EditionCover {
  edition.title = title.to_string();
  edition
}

fn book(id: &str, title: &str, covers: Vec<EditionCover>) -> SeriesBook {
  SeriesBook { book_id: id.to_string(), title: title.to_string(), covers }
}

/// The sets as (name, [(book, cover)]), to compare whole.
fn shown(sets: &[CoverSet]) -> Vec<(&str, Vec<(&str, i64)>)> {
  sets
    .iter()
    .map(|set| {
      let covers = set.covers.iter().map(|cover| (cover.book_id.as_str(), cover.cover_id));
      (set.name.as_str(), covers.collect())
    })
    .collect()
}

#[test]
fn an_editions_answer_gives_one_cover_an_edition() {
  let json = r#"{ "entries": [
    { "covers": [101, 102], "publishers": ["HarperCollins"], "publish_date": "June 1, 2001",
      "languages": [{ "key": "/languages/eng" }], "title": "The Hobbit",
      "isbn_13": ["978-0-261-10221-7"] },
    { "covers": [-1], "publishers": ["Nobody"] },
    { "publishers": ["No Cover House"], "publish_date": "1999" },
    { "covers": [103], "publishers": [] },
    { "covers": [101], "publishers": ["HarperCollins again"] },
    { "covers": [-1, 104], "publishers": ["  ", "Gramedia"], "publish_date": "c2002",
      "languages": [{ "key": "/languages/ind" }] },
    { "covers": [105], "publishers": ["Recorded Books"], "physical_format": "Audio cassette" },
    { "covers": [106], "publishers": ["Ithaki"], "isbn_10": ["605375479X"] }
  ] }"#;
  let hobbit = EditionCover {
    cover_id: 101,
    publishers: vec!["HarperCollins".to_string()],
    year: Some(2001),
    language: Some("eng".to_string()),
    title: "The Hobbit".to_string(),
    isbn: Some(978_026_110_221)
  };
  let gramedia = cover(104, "Gramedia", Some(2002), Some("ind"));
  // No language named: the ISBN was registered in Turkey.
  let ithaki = EditionCover {
    isbn: Some(978_605_375_479),
    ..cover(106, "Ithaki", None, Some("tur"))
  };
  assert_eq!(covers_in(json).expect("parsed"), vec![hobbit, gramedia, ithaki]);
  assert_eq!(covers_in("{}").expect("empty"), Vec::new());
  assert!(covers_in("not json").is_err());
}

#[test]
fn a_year_is_read_out_of_a_catalogues_date() {
  assert_eq!(year_in("June 1, 2001"), Some(2001));
  assert_eq!(year_in("c1954"), Some(1954));
  assert_eq!(year_in("1954-1955"), Some(1955));
  assert_eq!(year_in("9780261102354"), None);
  assert_eq!(year_in("undated"), None);
}

#[test]
fn an_isbn_says_where_an_edition_was_published() {
  let isbn = |text: &str| isbn_of(&[text.to_string()], &[]).expect("an ISBN");
  assert_eq!(isbn_language(isbn("9780765311788")), Some("eng"));
  assert_eq!(isbn_language(isbn("979-8-88-645123-4")), Some("eng"));
  assert_eq!(isbn_language(isbn("9786052382462")), Some("tur"));
  assert_eq!(isbn_language(isbn("9788413143194")), Some("spa"));
  assert_eq!(isbn_language(isbn("9784150204952")), Some("jpn"));
  assert_eq!(isbn_language(isbn("9783453523364")), Some("ger"));
  assert_eq!(isbn_language(isbn("9785170103560")), Some("rus"));
  // India publishes in English and in many other languages: it says nothing.
  assert_eq!(isbn_language(isbn("9788172234980")), None);
  // An ISBN-10 is read as the ISBN-13 it is.
  assert_eq!(isbn_of(&[], &["0-7653-5038-6".to_string()]), Some(978_076_535_038));
  assert_eq!(isbn_of(&["not one".to_string()], &["123".to_string()]), None);
}

#[test]
fn a_books_language_is_written_as_the_catalogue_writes_it() {
  assert_eq!(language_code("en").as_deref(), Some("eng"));
  assert_eq!(language_code(" en-GB ").as_deref(), Some("eng"));
  assert_eq!(language_code("fra").as_deref(), Some("fre"));
  assert_eq!(language_code("tr").as_deref(), Some("tur"));
  assert_eq!(language_code("ger").as_deref(), Some("ger"));
  assert_eq!(language_code("").as_deref(), None);
  assert_eq!(language_code("English").as_deref(), None);
}

#[test]
fn one_publisher_spelt_many_ways_is_one_house() {
  let key = house_key("HarperCollins");
  assert_eq!(key, "harpercollins");
  assert_eq!(house_key("HarperCollins Publishers Ltd."), key);
  assert_eq!(house_key("The HARPERCOLLINS Publishing Group"), key);
  assert_ne!(house_key("Houghton Mifflin"), key);
  // A name made only of such words is kept whole rather than emptied.
  assert_eq!(house_key("The Book Company"), "the book company");
  // Tor, as Open Library has it for Mistborn.
  for tor in ["Tor", "Tor Books", "Tor Publishing Group", "Doherty Associates, LLC, Tom"] {
    assert_eq!(house_key(tor), "tor", "{tor}");
  }
  assert_eq!(house_key("Ace Books, Inc."), house_key("Ace Trade"));
  assert_eq!(house_key("Gollancz Paperback"), "gollancz");
  // A place before the name and a year after it, in a catalogue's mangled spelling.
  let hayakawa = house_key("ToÌ\"kyoÌ\" : Hayakawa ShoboÌ\", 2009.");
  assert_eq!(hayakawa, house_key("ToÌ„kyoÌ„ : Hayakawa ShoboÌ„, 2010."));
  assert!(hayakawa.starts_with("hayakawa"), "{hayakawa}");
}

/// The owner's report: Mistborn offered "Akilcelen Kitaplar 7 of 7" (Turkish)
/// beside Tor's, Tor's set mixed its printings, and audiobooks came along.
#[test]
fn mistborn_is_offered_tors_and_gollanczs_sets_in_english_one_printing_each() {
  let books = vec![
    book("final-empire", "The Final Empire", covers_in(FINAL_EMPIRE).expect("parsed")),
    book("well", "The Well of Ascension", covers_in(WELL_OF_ASCENSION).expect("parsed"))
  ];
  // Audiobooks never come in at all.
  for audio in [14837620, 10508308, 14838159, 10622604] {
    let offered = books.iter().flat_map(|book| &book.covers).any(|cover| cover.cover_id == audio);
    assert!(!offered, "{audio}");
  }
  let sets = cover_sets(&books, "eng");
  assert_eq!(
    shown(&sets),
    vec![
      // Tor's 2023 reissue of both (one line: neighbouring ISBNs), not the
      // newest of each book; named as Tor spells itself, not "Tor Fantasy".
      ("Tor", vec![("final-empire", 15158368), ("well", 13849916)]),
      // Gollancz's 2009 paperbacks, not its 2001-dated collector's edition.
      ("Gollancz", vec![("final-empire", 15101787), ("well", 15217275)])
    ]
  );

  // A Turkish reader is offered the Turkish set, and nothing in English.
  let turkish = cover_sets(&books, "tur");
  let akilcelen = vec![("final-empire", 10852405), ("well", 12119190)];
  assert_eq!(shown(&turkish), vec![("Akilcelen Kitaplar", akilcelen)]);
}

/// Open Library files one book's editions under another's work now and then.
/// "Dune Messiah" begins with "Dune": an edition of it under "Dune" is not
/// Dune. A title that only differs ("Chapter House Dune") is still the book.
#[test]
fn an_edition_of_another_book_of_the_series_is_not_offered() {
  let books = vec![
    book(
      "dune",
      "Dune",
      vec![
        titled(eng(1, "Ace", 2019), "Dune"),
        titled(eng(2, "Ace", 2019), "Dune Messiah"),
        titled(eng(3, "Ace", 2019), "Children of Dune"),
        titled(eng(4, "Ace", 2019), "Dune: Deluxe Edition")
      ]
    ),
    book("messiah", "Dune Messiah", vec![titled(eng(5, "Ace", 2019), "Dune Messiah")]),
    book("children", "Children of Dune", vec![titled(eng(6, "Ace", 2019), "Children of Dune")]),
    book(
      "chapterhouse",
      "Chapterhouse: Dune",
      vec![titled(eng(7, "Gollancz", 1985), "Chapter House Dune")]
    )
  ];
  let fit = fitting(&books, "eng");
  let ids = |at: usize| fit[at].iter().map(|cover| cover.cover_id).collect::<Vec<_>>();
  assert_eq!(ids(0), vec![1, 4]);
  assert_eq!(ids(1), vec![5]);
  assert_eq!(ids(3), vec![7]);
}

/// The work found for a book called just "Mistborn" is Open Library's boxed
/// sets of the trilogy (real titles): none of them is the book.
#[test]
fn a_boxed_set_is_not_the_book() {
  let sets = [
    "Mistborn Trilogy",
    "Mistborn Trilogy TPB Boxed Set: Mistborn, The Well of Ascension, and The Hero of Ages",
    "Mistborn Boxed Set",
    "Dune Ebook Collection",
    "Dune Complete Series, 6 Books"
  ];
  for title in sets {
    let asked = if title.contains("Dune") { "Dune" } else { "Mistborn" };
    assert!(!is_this_book(title, asked, &[]), "{title}");
  }
  let others = ["The Well of Ascension"];
  assert!(is_this_book("Mistborn: The Final Empire", "The Final Empire", &others));
  assert!(is_this_book("The Final Empire (Mistborn, Book 1)", "The Final Empire", &[]));
  // The series' own title may say trilogy.
  assert!(is_this_book("The Lord of the Rings Trilogy", "The Lord of the Rings Trilogy", &[]));
}

#[test]
fn an_imprint_is_its_house_and_an_edition_naming_two_goes_to_the_better_known() {
  let mut both = eng(30, "Orion Publishing Group, Limited", 2021);
  both.publishers.push("Gollancz".to_string());
  let books = vec![
    book("one", "One", vec![eng(10, "Tor Fantasy", 2019), eng(20, "Gollancz", 2009)]),
    book("two", "Two", vec![eng(11, "Tor", 2019), eng(21, "Gollancz", 2009)]),
    book("three", "Three", vec![eng(12, "Tor Teen", 2019), both])
  ];
  assert_eq!(
    shown(&cover_sets(&books, "eng")),
    vec![
      ("Gollancz", vec![("one", 20), ("two", 21), ("three", 30)]),
      ("Tor", vec![("one", 10), ("two", 11), ("three", 12)])
    ]
  );
}

/// Of a house's many printings, one line: the books' covers closest together
/// in time, rather than each book's newest.
#[test]
fn a_houses_covers_are_one_printing_line() {
  let books = vec![
    book("one", "One", vec![eng(1, "Ace", 1990), eng(2, "Ace", 2019), eng(3, "Ace", 2024)]),
    book("two", "Two", vec![eng(4, "Ace", 1991), eng(5, "Ace", 2019)]),
    book("three", "Three", vec![eng(6, "Ace", 1992), eng(7, "Ace", 2020)])
  ];
  let line = vec![("one", 2), ("two", 5), ("three", 7)];
  assert_eq!(shown(&cover_sets(&books, "eng")), vec![("Ace", line)]);
  // The same answer whatever order the editions came in.
  let mut turned = books.clone();
  for book in &mut turned {
    book.covers.reverse();
  }
  assert_eq!(cover_sets(&turned, "eng"), cover_sets(&books, "eng"));
}

#[test]
fn a_set_is_counted_by_its_books_and_never_shows_one_picture_twice() {
  let books = vec![
    book("one", "One", vec![eng(1, "Ace", 2019), eng(9, "Bantam", 2001)]),
    // A cover filed under two books' works: it stays with the first.
    book("two", "Two", vec![eng(1, "Ace", 2019)]),
    book("three", "Three", vec![eng(3, "Ace", 2019)])
  ];
  // Bantam has one book of three: no set, and left out.
  assert_eq!(shown(&cover_sets(&books, "eng")), vec![("Ace", vec![("one", 1), ("three", 3)])]);
  assert!(cover_sets(&[], "eng").is_empty());
}

#[test]
fn only_the_fullest_sets_are_offered() {
  // "House ab", "House ac"...
  let letter = |at: i64| (b'a' + at as u8) as char;
  let name = |id: i64| format!("House {}{}", letter(id / 26), letter(id % 26));
  let covers: Vec<EditionCover> = (1..=30).map(|id| cover(id, &name(id), None, None)).collect();
  let sets = cover_sets(&[book("one", "One", covers)], "eng");
  assert_eq!(sets.len(), SETS_MAX);
  assert_eq!(sets[0].name, "House ab");
}

#[test]
fn a_works_key_is_checked_before_it_goes_into_an_address() {
  assert_eq!(work_path("/works/OL27448W").as_deref(), Some("/works/OL27448W"));
  assert_eq!(work_path("/works/OL27448W/../../account"), None);
  assert_eq!(work_path("/books/OL1M"), None);
  assert_eq!(work_path("/works/"), None);
}

