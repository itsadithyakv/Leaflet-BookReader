//! The G2P on a small lexicon of its own, and (ignored) on the pack's real
//! files, writing what it says for a word list (`LEAFLET_G2P_DIR`,
//! `LEAFLET_G2P_WORDS`, `LEAFLET_G2P_OUT`).

use super::*;

const US: &str = "\
A\tg\tˈA
B\tg\tbˈi
C\tg\tsˈi
I\tg\tˈI
a\tg\tA
am\tg\tˈæm
and\tg\tænd
be\tg\tDEFAULT=bi;None=bˈi
book\tg\tbˈʊk
close\tg\tDEFAULT=klˈOs;NOUN=klˈOz;VERB=klˈOz
dark\tg\tdˈɑɹk
door\tg\tdˈɔɹ
end\tg\tˈɛnd
family\tg\tfˈæmᵊli
field\tg\tfˈild
he\tg\thi
her\tg\thɜɹ
in\tg\tɪn
it\tg\tɪt
letter\tg\tlˈɛɾəɹ
live\tg\tDEFAULT=lˈIv;VERB=lˈɪv
mister\tg\tmˈɪstəɹ
nether\tg\tnˈɛðəɹ
nineteen\tg\tnˌIntˈin
of\tg\tʌv
one\tg\twˈʌn
read\tg\tADJ=ɹˈɛd;DEFAULT=ɹˈid;VBD=ɹˈɛd;VBN=ɹˈɛd;VBP=ɹˈɛd
return\tg\tɹətˈɜɹn
said\tg\tsˈɛd
she\tg\tʃi
the\tg\tði
they\tg\tðA
thirteen\tg\tθˌɜɹtˈin
to\tg\ttu
eighteen\tg\tˌAtˈin
twenty\tg\ttwˈɛnti
used\tg\tDEFAULT=jˈuzd;VBD=jˈust
water\tg\twˈɔɾəɹ
went\tg\twˈɛnt
";

const GB: &str = "\
I\tg\tˈI
dark\tg\tdˈɑːk
family\tg\tfˈamɪli
return\tg\tɹɪtˈɜːn
the\tg\tðə
";

const CMU: &str = "bennet\tB EH1 N IH0 T\ndarcy\tD AA1 R S IY0\nwickham\tW IH1 K AH0 M\n";

fn g2p() -> EnglishG2p {
  EnglishG2p::from_parts(Parts { us: Some(US.into()), gb: Some(GB.into()), cmudict: Some(CMU.into()), model: None })
}

fn say(text: &str) -> String {
  g2p().phonemize_str(text, Accent::Us)
}

#[test]
fn words_from_each_source() {
  let g = g2p();
  assert_eq!(g.word("family", Accent::Us), ("fˈæmᵊli".into(), Source::Lexicon));
  assert_eq!(g.word("families", Accent::Us), ("fˈæmᵊliz".into(), Source::Inflected));
  assert_eq!(g.word("returned", Accent::Us), ("ɹətˈɜɹnd".into(), Source::Inflected));
  assert_eq!(g.word("returned", Accent::Gb), ("ɹɪtˈɜːnd".into(), Source::Inflected));
  assert_eq!(g.word("Bennet", Accent::Us), ("bˈɛnət".into(), Source::Cmudict));
  assert_eq!(g.word("Bennet's", Accent::Us), ("bˈɛnəts".into(), Source::Inflected));
  assert_eq!(g.word("Bennets'", Accent::Us), ("bˈɛnəts".into(), Source::Inflected));
  assert_eq!(g.word("Darcy", Accent::Gb), ("dˈɑːsi".into(), Source::Cmudict));
  assert_eq!(g.word("Netherfield", Accent::Us), ("nˈɛðəɹfˌild".into(), Source::Compound));
  assert_eq!(g.word("darkness", Accent::Us), ("dˈɑɹknəs".into(), Source::Derived));
  assert_eq!(g.word("Hermione", Accent::Us).1, Source::Override);
  // A flap is Kokoro v1.0's T.
  assert_eq!(g.word("water", Accent::Us).0, "wˈɔTəɹ");
  // No model in this G2P: an unknown word is spelt.
  assert_eq!(g.word("BBC", Accent::Us), ("bˌibˌisˈi".into(), Source::Spelled));
}

#[test]
fn function_words_by_what_follows() {
  assert_eq!(say("the dark"), "ðə dˈɑɹk");
  assert_eq!(say("the end"), "ði ˈɛnd");
  assert_eq!(say("to the"), "tə ðə");
  assert_eq!(say("I am."), "ˌI ˈæm.");
  assert_eq!(say("a book"), "ɐ bˈʊk");
  assert_eq!(say("It used to be."), "ˌɪt jˈust tə bˈi.");
}

#[test]
fn heteronyms_by_the_word_before() {
  assert_eq!(say("she read"), "ʃi ɹˈɛd");
  assert_eq!(say("to read"), "tə ɹˈid");
  assert_eq!(say("they live"), "ðA lˈɪv");
  assert_eq!(say("the close"), "ðə klˈOz");
}

#[test]
fn sentences_and_punctuation() {
  let g = g2p();
  let got = g.phonemize("\"Mr. Bennet returned,\" she said. In 1813!", Accent::Us);
  assert_eq!(got.len(), 2);
  assert_eq!(got[0].phonemes, "“mˈɪstəɹ bˈɛnət ɹətˈɜɹnd,” ʃi sˈɛd.");
  assert_eq!((got[0].start, got[0].end), (0, 32));
  assert_eq!(got[1].phonemes, "ɪn ˌAtˈin θˌɜɹtˈin!");
  // Every char is one of Kokoro's tokens.
  for sentence in &got {
    assert_eq!(token_ids(&sentence.phonemes).len(), sentence.phonemes.chars().count());
  }
}

#[test]
fn accents_from_language_tags() {
  assert_eq!(Accent::from_lang("en-GB"), Accent::Gb);
  assert_eq!(Accent::from_lang("en_gb"), Accent::Gb);
  assert_eq!(Accent::from_lang("en-US"), Accent::Us);
  assert_eq!(Accent::from_lang("en"), Accent::Us);
}

#[test]
fn long_sentences_are_cut() {
  let long = "wˈʌn, ".repeat(150);
  let pieces = cut_long(long.trim().to_string());
  assert!(pieces.len() >= 2);
  assert!(pieces.iter().all(|p| p.chars().count() <= MAX_TOKENS));
  assert!(pieces[0].ends_with(','));
}

#[test]
fn without_files_nothing_is_ready() {
  let g = EnglishG2p::open(Path::new("/nowhere/at/all"));
  assert!(!g.ready(Accent::Us));
  assert!(g.phonemize("Hello.", Accent::Us).is_empty() || g.phonemize("Hello.", Accent::Us).iter().all(|s| s.phonemes.is_empty()));
}

/// The pack's real files on a word list: `word \t source \t phonemes` per
/// line, for `scripts/g2p_eval.py`.
#[test]
#[ignore]
fn evaluate_word_list() {
  let dir = std::env::var("LEAFLET_G2P_DIR").expect("LEAFLET_G2P_DIR: a folder holding g2p/…");
  let words = std::env::var("LEAFLET_G2P_WORDS").expect("LEAFLET_G2P_WORDS: a word per line");
  let out = std::env::var("LEAFLET_G2P_OUT").expect("LEAFLET_G2P_OUT: where to write");
  let g = EnglishG2p::open(Path::new(&dir));
  let started = std::time::Instant::now();
  assert!(g.ready(Accent::Us) && g.ready(Accent::Gb));
  eprintln!("loaded in {:?}", started.elapsed());
  let started = std::time::Instant::now();
  let mut lines = Vec::new();
  for line in std::fs::read_to_string(words).unwrap().lines() {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
      continue;
    }
    if let Some(text) = line.strip_prefix("S:") {
      for accent in [Accent::Us, Accent::Gb] {
        lines.push(format!("{line}\t{accent:?}\tsentence\t{}", g.phonemize_str(text.trim(), accent)));
      }
      continue;
    }
    for accent in [Accent::Us, Accent::Gb] {
      let (ps, source) = g.word(line, accent);
      lines.push(format!("{line}\t{accent:?}\t{source:?}\t{ps}"));
    }
  }
  eprintln!("{} lines in {:?}", lines.len(), started.elapsed());
  std::fs::write(out, lines.join("\n") + "\n").unwrap();
}
