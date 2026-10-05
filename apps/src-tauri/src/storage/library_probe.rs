//! A look at what import makes of a real library, for a person to read.
//!
//! Not a test of anything: it reads the books in `D:\Books` on the machine
//! this pass was done on, runs the same functions `import_one` runs on each,
//! and prints a table. Ignored by default and silent where that folder does
//! not exist, so it never runs in CI or on another machine:
//!
//! ```text
//! cargo test --lib real_library -- --ignored --nocapture
//! ```
//!
//! Nothing is written to the library folder or to the app's data: covers and
//! thumbnails go to a folder under the system's temporary directory.

use super::*;
use std::time::Instant;

const LIBRARY: &str = r"D:\Books";

fn clip(text: &str, max: usize) -> String {
  let mut out: String = text.chars().take(max).collect();
  if text.chars().count() > max {
    out.push('…');
  }
  out
}

fn ms(since: Instant) -> f64 {
  since.elapsed().as_secs_f64() * 1000.0
}

#[test]
#[ignore = "reads the books in D:\\Books; run by hand with --ignored --nocapture"]
fn real_library_import_table() {
  let library = Path::new(LIBRARY);
  if !library.is_dir() {
    eprintln!("{LIBRARY} is not here: nothing to look at.");
    return;
  }
  let scratch = std::env::temp_dir().join(format!("leaflet-library-probe-{}", std::process::id()));
  let _ = fs::remove_dir_all(&scratch);
  fs::create_dir_all(&scratch).expect("scratch");

  let mut files: Vec<PathBuf> = fs::read_dir(library)
    .expect("read the library")
    .flatten()
    .map(|entry| entry.path())
    .filter(|path| path.is_file())
    .collect();
  files.sort();

  for path in &files {
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("?");
    let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("Untitled");
    let size = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    println!("\n=== {}", clip(name, 90));
    println!("  file        {} bytes, name {} chars, path {} chars, supported: {}", size, name.chars().count(), path.to_string_lossy().chars().count(), crate::formats::is_supported(&crate::formats::extension_of(path)));

    let started = Instant::now();
    let hash = match hash_for_import(path) {
      Ok(hash) => hash,
      Err(error) => {
        println!("  hash        FAILED: {error}");
        continue;
      }
    };
    println!("  hash        {} in {:.0} ms", &hash[..12], ms(started));

    let started = Instant::now();
    let basic = extract_basic_metadata(path).expect("metadata never fails outright");
    let metadata_ms = ms(started);
    println!(
      "  in the file title {:?} | authors {:?} | series {:?} #{:?} | subjects {:?}{}  ({:.1} ms)",
      basic.title,
      basic.authors,
      basic.series,
      basic.series_index,
      basic.subjects,
      if basic.doubtful { " | its maker's word" } else { "" },
      metadata_ms
    );

    let identity = crate::metadata::normalize::identify(stem, &basic);
    println!("  IMPORTED AS title {:?} | author {:?} | series {:?} #{:?}", identity.title, identity.author, identity.series, identity.series_index);
    println!("  genres      {:?}", identity.genres);

    {
      let started = Instant::now();
      match embedded_cover(path, None) {
        Some(bytes) => {
          let read_ms = ms(started);
          let kind = sniff_image_mime(&bytes).unwrap_or("?");
          let cover = scratch.join(format!("{}-cover.jpg", &hash[..12]));
          fs::write(&cover, &bytes).expect("write cover");
          let shape = image::load_from_memory(&bytes).map(|image| (image.width(), image.height()));
          let started = Instant::now();
          let thumb = thumbnail_into(&scratch, &cover, &hash[..12]);
          let thumb_ms = ms(started);
          let thumb_shape = thumb
            .as_ref()
            .ok()
            .and_then(|path| fs::read(path).ok())
            .and_then(|bytes| image::load_from_memory(&bytes).ok().map(|image| (image.width(), image.height(), bytes.len())));
          println!("  cover       {kind} {} bytes {:?} read in {:.0} ms; thumbnail {:?} in {:.0} ms", bytes.len(), shape, read_ms, thumb_shape, thumb_ms);
        }
        None => println!("  cover       none in the file (looked up online after import; a PDF's first page is not used)")
      }
    }
    if normalized_ext(path) == "epub" {

      let started = Instant::now();
      match epub::sections(path) {
        Ok(sections) => {
          let total: u64 = sections.iter().map(|section| section.bytes).sum();
          let largest = sections.iter().max_by_key(|section| section.bytes);
          let empty = sections.iter().filter(|section| section.bytes == 0).count();
          let aside = sections.iter().filter(|section| !section.linear).count();
          println!(
            "  sections    {} ({} not linear, {} of size 0), total {} bytes, largest {} bytes ({:.1}%: {}), in {:.0} ms",
            sections.len(),
            aside,
            empty,
            total,
            largest.map(|section| section.bytes).unwrap_or(0),
            largest.map(|section| section.bytes as f64 * 100.0 / total.max(1) as f64).unwrap_or(0.0),
            largest.map(|section| clip(&section.href, 48)).unwrap_or_default(),
            ms(started)
          );
        }
        Err(error) => println!("  sections    FAILED: {error}")
      }
    }
  }
  let _ = fs::remove_dir_all(&scratch);
}
