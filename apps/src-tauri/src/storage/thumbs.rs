//! Small copies of each book's cover, at the sizes the library draws them.
//!
//! A grid card on an upright phone is about 175 px wide, so at the phone's
//! pixel density (2.5 to 3) it wants a picture about 480 px across; a desktop
//! card at 1x, a row's little cover, a series strip or a search result wants
//! 240. Covers are kept up to 2000 px (`sweep::fit_cover`), and drawing one of
//! those in a card made the web view decode about 10 MB of pixels for every
//! card scrolled past. So each cover is decoded here once and written at both
//! widths, beside it in `covers/`:
//!
//!   `<hash>-thumb-240.jpg`, `<hash>-thumb-480.jpg`
//!
//! A pair is fresh while it is newer than the cover it was made from; a cover
//! saved again (a chosen one, a real one in place of a PDF's page, one made
//! smaller by the sweep) leaves the pair stale and the next look makes it
//! again. They go with the book (`remove_book_extras`), and the sweep takes the
//! pair of a book that is gone like any other cover file of it.
//!
//! They are made off the window's thread: in a background worker after a
//! cover is saved (import, a lookup), and on first display for a library
//! from before there were thumbnails, which meanwhile is shown its full cover
//! (`cover_protocol`).

use anyhow::{anyhow, Result};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// The widths written, smallest first. The page asks for one of these
/// (`srcset`), and the web view picks by the card's size and the screen's density.
pub const WIDTHS: [u32; 2] = [240, 480];
/// Plenty for a picture this small; the 480 one is about 40 to 70 KB.
const QUALITY: u8 = 80;
/// Longer than any cover's shape (a 1:3 strip at most): a wider picture is
/// fitted by its width, a strangely tall one by this many widths of height.
const TALLEST: u32 = 3;

/// The 1.5.x thumbnail, one size (360 px), made before there were two. Taken
/// away when the new pair is made, and by the sweep.
pub const LEGACY_SUFFIX: &str = "-thumb.jpg";

/// The largest cover that is opened at all: past this many pixels it is not a
/// cover but a mistake or a trap (a small file that decodes to gigabytes).
const MAX_SIDE: u32 = 16_384;
const MAX_DECODE_BYTES: u64 = 512 * 1024 * 1024;

pub fn file_name(hash: &str, width: u32) -> String {
  format!("{hash}-thumb-{width}.jpg")
}

pub fn path_in(dir: &Path, hash: &str, width: u32) -> PathBuf {
  dir.join(file_name(hash, width))
}

/// The width of the thumbnail to serve for a width asked for: the smallest
/// that is at least as wide, else the widest.
pub fn width_for(asked: u32) -> u32 {
  WIDTHS.iter().copied().find(|width| *width >= asked).unwrap_or(WIDTHS[WIDTHS.len() - 1])
}

/// When a file was last written or made, whichever is later: a cover copied
/// in keeps the original's modified time on Windows, the made time is new.
fn changed_at(path: &Path) -> Option<SystemTime> {
  let meta = fs::metadata(path).ok()?;
  let modified = meta.modified().ok();
  match (modified, meta.created().ok()) {
    (Some(a), Some(b)) => Some(a.max(b)),
    (a, b) => a.or(b)
  }
}

/// The thumbnail of `width` for `cover`, if one is there and was made after
/// the cover last changed.
pub fn fresh(dir: &Path, cover: &Path, hash: &str, width: u32) -> Option<PathBuf> {
  let thumb = path_in(dir, hash, width);
  let made = fs::metadata(&thumb).ok()?.modified().ok()?;
  let cover_changed = changed_at(cover)?;
  (made >= cover_changed).then_some(thumb)
}

/// Every thumbnail of a book: both widths, the old single one, and any left half written.
pub fn drop_all(dir: &Path, hash: &str) {
  for width in WIDTHS {
    let _ = fs::remove_file(path_in(dir, hash, width));
    let _ = fs::remove_file(dir.join(format!("{hash}-thumb-{width}.part")));
  }
  let _ = fs::remove_file(dir.join(format!("{hash}{LEGACY_SUFFIX}")));
  let _ = fs::remove_file(dir.join(format!("{hash}-thumb.part")));
}

/// Decodes a cover with limits, so a broken or hostile file fails quickly
/// instead of taking the phone's memory.
fn decode(bytes: &[u8]) -> Result<image::DynamicImage> {
  let mut reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
  let mut limits = image::Limits::default();
  limits.max_image_width = Some(MAX_SIDE);
  limits.max_image_height = Some(MAX_SIDE);
  limits.max_alloc = Some(MAX_DECODE_BYTES);
  reader.limits(limits);
  let image = reader.decode()?;
  if image.width() == 0 || image.height() == 0 {
    return Err(anyhow!("cover has no pixels"));
  }
  Ok(image)
}

fn encode(image: &image::DynamicImage) -> Result<Vec<u8>> {
  let mut bytes = Vec::new();
  let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, QUALITY);
  // JPEG has no transparency: a see-through cover is laid on white, as a page would show it.
  let rgb = if image.color().has_alpha() {
    let rgba = image.to_rgba8();
    let mut flat = image::RgbImage::new(rgba.width(), rgba.height());
    for (to, from) in flat.pixels_mut().zip(rgba.pixels()) {
      let alpha = from[3] as u32;
      for channel in 0..3 {
        to[channel] = ((from[channel] as u32 * alpha + 255 * (255 - alpha)) / 255) as u8;
      }
    }
    flat
  } else {
    image.to_rgb8()
  };
  rgb.write_with_encoder(encoder)?;
  Ok(bytes)
}

fn write_atomically(dir: &Path, hash: &str, width: u32, bytes: &[u8]) -> Result<PathBuf> {
  let dest = path_in(dir, hash, width);
  let staging = dir.join(format!("{hash}-thumb-{width}.part"));
  fs::write(&staging, bytes)?;
  if let Err(error) = fs::rename(&staging, &dest) {
    let _ = fs::remove_file(&staging);
    return Err(error.into());
  }
  Ok(dest)
}

/// Makes the book's thumbnails from its cover (one decode for both widths)
/// unless they are fresh already, and returns them smallest first. A cover
/// narrower than a width is kept at its own size there: never enlarged.
pub fn make(dir: &Path, cover: &Path, hash: &str) -> Result<Vec<PathBuf>> {
  if let Some(made) = WIDTHS.iter().map(|width| fresh(dir, cover, hash, *width)).collect::<Option<Vec<_>>>() {
    return Ok(made);
  }
  fs::create_dir_all(dir)?;
  let image = decode(&fs::read(cover)?)?;
  // Widest first, each from the one before: the second costs a fraction of the first.
  let mut made = Vec::with_capacity(WIDTHS.len());
  let mut source = image;
  for width in WIDTHS.iter().rev().copied() {
    let small = if source.width() > width || source.height() > width * TALLEST {
      source.thumbnail(width, width * TALLEST)
    } else {
      source.clone()
    };
    made.push(write_atomically(dir, hash, width, &encode(&small)?)?);
    source = small;
  }
  made.reverse();
  // The one-size thumbnail of 1.5.9 and before is not asked for again.
  let _ = fs::remove_file(dir.join(format!("{hash}{LEGACY_SUFFIX}")));
  Ok(made)
}

/// The thumbnail to show at `width`, made now if it has to be. For a caller
/// already off the window's thread (`cover_data`).
pub fn get(dir: &Path, cover: &Path, hash: &str, width: u32) -> Result<PathBuf> {
  let width = width_for(width);
  if let Some(path) = fresh(dir, cover, hash, width) {
    return Ok(path);
  }
  make(dir, cover, hash)?;
  fresh(dir, cover, hash, width).ok_or_else(|| anyhow!("thumbnail was not made"))
}

// ---- The background worker ----------------------------------------------------

/// Covers waiting for their thumbnails, made one at a time by one worker
/// thread, so a library's worth asked for at once (an import of fifty books,
/// a fling through a library from before thumbnails) never decodes more than
/// one cover at a time beside the reader.
pub struct Queue {
  waiting: std::sync::Mutex<std::collections::VecDeque<Job>>,
  ready: std::sync::Condvar
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Job {
  pub dir: PathBuf,
  pub cover: PathBuf,
  pub hash: String
}

/// The longest the queue gets: past it the oldest asks are dropped (they are
/// asked again the next time their card is drawn).
const QUEUE_CAP: usize = 4096;

impl Queue {
  pub const fn new() -> Queue {
    Queue { waiting: std::sync::Mutex::new(std::collections::VecDeque::new()), ready: std::sync::Condvar::new() }
  }

  /// Adds a job unless the same book's is already waiting. Whether it was added.
  pub fn push(&self, job: Job) -> bool {
    let mut waiting = self.waiting.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if waiting.iter().any(|queued| queued.hash == job.hash && queued.dir == job.dir) {
      return false;
    }
    if waiting.len() >= QUEUE_CAP {
      waiting.pop_front();
    }
    waiting.push_back(job);
    self.ready.notify_one();
    true
  }

  /// The next job, waiting for one. (The worker's: unit tests drain instead.)
  #[cfg_attr(test, allow(dead_code))]
  fn next(&self) -> Job {
    let mut waiting = self.waiting.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    loop {
      if let Some(job) = waiting.pop_front() {
        return job;
      }
      waiting = self.ready.wait(waiting).unwrap_or_else(std::sync::PoisonError::into_inner);
    }
  }

  /// Runs every job waiting now, on this thread.
  #[cfg(test)]
  pub fn drain(&self) -> usize {
    let mut done = 0;
    loop {
      let job = self.waiting.lock().unwrap_or_else(std::sync::PoisonError::into_inner).pop_front();
      let Some(job) = job else {
        return done;
      };
      run(&job);
      done += 1;
    }
  }

  #[cfg(test)]
  pub fn len(&self) -> usize {
    self.waiting.lock().unwrap_or_else(std::sync::PoisonError::into_inner).len()
  }
}

impl Default for Queue {
  fn default() -> Self {
    Queue::new()
  }
}

fn run(job: &Job) {
  // A cover that has gone (the book removed meanwhile) or cannot be read is let be.
  if job.cover.is_file() {
    if let Err(error) = make(&job.dir, &job.cover, &job.hash) {
      crate::diag::warn(&format!("no thumbnail for a cover ({error})"));
    }
  }
}

static QUEUE: Queue = Queue::new();
static WORKER: std::sync::Once = std::sync::Once::new();

/// Asks for a book's thumbnails to be made in the background. Nothing waits
/// for them: the next card drawn for the book finds them.
pub fn request(dir: &Path, cover: &Path, hash: &str) {
  if WIDTHS.iter().all(|width| fresh(dir, cover, hash, *width).is_some()) {
    return;
  }
  QUEUE.push(Job { dir: dir.to_path_buf(), cover: cover.to_path_buf(), hash: hash.to_string() });
  // Unit tests drain a queue of their own; the app's worker starts with its first job.
  #[cfg(not(test))]
  WORKER.call_once(|| {
    let _ = std::thread::Builder::new().name("cover-thumbs".into()).spawn(|| loop {
      let job = QUEUE.next();
      run(&job);
    });
  });
  #[cfg(test)]
  let _ = &WORKER;
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::Duration;

  fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("leaflet-thumbs-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("dir");
    dir
  }

  fn cover(dir: &Path, name: &str, width: u32, height: u32, colour: [u8; 3]) -> PathBuf {
    let path = dir.join(name);
    let image = image::RgbImage::from_fn(width, height, |x, y| image::Rgb([colour[0], (x % 256) as u8, (y % 256) as u8 ^ colour[2]]));
    let mut bytes = Vec::new();
    image.write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Jpeg).expect("encode");
    fs::write(&path, bytes).expect("write");
    path
  }

  fn shape(path: &Path) -> (u32, u32) {
    let image = image::load_from_memory(&fs::read(path).expect("read")).expect("decode");
    (image.width(), image.height())
  }

  /// Later than the file's last change, as a cover written a moment after its thumbnails would be.
  fn touch_later(path: &Path) {
    let bytes = fs::read(path).expect("read");
    std::thread::sleep(Duration::from_millis(30));
    fs::write(path, bytes).expect("rewrite");
  }

  #[test]
  fn a_cover_is_made_into_both_widths_keeping_its_shape() {
    let dir = scratch("widths");
    let full = cover(&dir, "h-cover.jpg", 1333, 2000, [180, 60, 40]);
    let made = make(&dir, &full, "h").expect("thumbnails");
    assert_eq!(made, vec![dir.join("h-thumb-240.jpg"), dir.join("h-thumb-480.jpg")]);
    assert_eq!(shape(&made[0]), (240, 360));
    assert_eq!(shape(&made[1]), (480, 720));
    for path in &made {
      let bytes = fs::read(path).expect("read");
      assert_eq!(crate::storage::sniff_image_mime(&bytes), Some("image/jpeg"));
    }
    assert!(fs::metadata(&made[1]).expect("meta").len() < fs::metadata(&full).expect("meta").len(), "smaller than the cover");
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_small_cover_is_never_enlarged() {
    let dir = scratch("small");
    let full = cover(&dir, "h-cover.jpg", 200, 300, [10, 200, 90]);
    let made = make(&dir, &full, "h").expect("thumbnails");
    assert_eq!(shape(&made[0]), (200, 300));
    assert_eq!(shape(&made[1]), (200, 300));
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_strange_shape_is_fitted_and_a_see_through_cover_laid_on_white() {
    let dir = scratch("shapes");
    // A wide banner keeps its width; a very tall strip is held to three widths of height.
    let wide = cover(&dir, "w-cover.jpg", 2000, 500, [1, 2, 3]);
    assert_eq!(shape(&make(&dir, &wide, "w").expect("wide")[1]), (480, 120));
    let tall = cover(&dir, "t-cover.jpg", 300, 4000, [1, 2, 3]);
    let thumbs = make(&dir, &tall, "t").expect("tall");
    assert_eq!(shape(&thumbs[0]).1, 240 * 3);
    assert_eq!(shape(&thumbs[1]).1, 480 * 3);
    let png = dir.join("p-cover.jpg");
    image::RgbaImage::from_pixel(600, 900, image::Rgba([0, 0, 0, 0])).save_with_format(&png, image::ImageFormat::Png).expect("png");
    let made = make(&dir, &png, "p").expect("png thumbs");
    let pixel = image::load_from_memory(&fs::read(&made[0]).expect("read")).expect("decode").to_rgb8().get_pixel(10, 10).0;
    assert!(pixel.iter().all(|channel| *channel > 245), "clear is white, not black: {pixel:?}");
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn thumbnails_are_made_once_and_again_when_the_cover_changes() {
    let dir = scratch("fresh");
    let full = cover(&dir, "h-cover.jpg", 900, 1350, [100, 100, 100]);
    assert!(fresh(&dir, &full, "h", 240).is_none(), "none before the first look");
    let made = make(&dir, &full, "h").expect("first");
    let stamp = fs::metadata(&made[1]).expect("meta").modified().expect("time");
    // Asked again: the same files, not written again.
    std::thread::sleep(Duration::from_millis(30));
    assert_eq!(make(&dir, &full, "h").expect("again"), made);
    assert_eq!(fs::metadata(&made[1]).expect("meta").modified().expect("time"), stamp);
    assert_eq!(get(&dir, &full, "h", 300).expect("get"), made[1], "300 wide is served the 480");
    assert_eq!(get(&dir, &full, "h", 100).expect("get"), made[0]);
    // The cover saved again (a new picture under the same name): stale, made again from it.
    let _ = cover(&dir, "h-cover.jpg", 600, 600, [250, 0, 0]);
    touch_later(&full);
    assert!(fresh(&dir, &full, "h", 480).is_none(), "a thumbnail older than its cover is not served");
    let remade = get(&dir, &full, "h", 480).expect("remade");
    assert_eq!(shape(&remade), (480, 480));
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn the_old_single_thumbnail_goes_when_the_pair_is_made_and_all_go_with_the_book() {
    let dir = scratch("drop");
    let full = cover(&dir, "h-cover.jpg", 900, 1350, [5, 5, 5]);
    fs::write(dir.join("h-thumb.jpg"), b"old").expect("legacy");
    fs::write(dir.join("h-thumb-480.part"), b"half").expect("part");
    make(&dir, &full, "h").expect("made");
    assert!(!dir.join("h-thumb.jpg").exists());
    fs::write(dir.join("other-thumb-240.jpg"), b"x").expect("other");
    drop_all(&dir, "h");
    for gone in ["h-thumb-240.jpg", "h-thumb-480.jpg", "h-thumb-480.part"] {
      assert!(!dir.join(gone).exists(), "{gone}");
    }
    assert!(full.exists(), "the cover itself is not a thumbnail");
    assert!(dir.join("other-thumb-240.jpg").exists(), "another book's are not touched");
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_broken_or_enormous_cover_fails_quietly_and_leaves_nothing() {
    let dir = scratch("bad");
    let junk = dir.join("j-cover.jpg");
    fs::write(&junk, b"\xFF\xD8\xFF\xE0 this is not really a jpeg").expect("junk");
    assert!(make(&dir, &junk, "j").is_err());
    assert!(get(&dir, &junk, "j", 240).is_err());
    // A PNG that says it is 100000 px tall: refused before any pixels are made.
    let mut png = Vec::new();
    image::RgbImage::new(1, 1).write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png).expect("png");
    png[16..20].copy_from_slice(&100_000u32.to_be_bytes());
    png[20..24].copy_from_slice(&100_000u32.to_be_bytes());
    let bomb = dir.join("b-cover.jpg");
    fs::write(&bomb, &png).expect("bomb");
    assert!(make(&dir, &bomb, "b").is_err());
    let left: Vec<_> = fs::read_dir(&dir).expect("list").flatten().map(|entry| entry.file_name().to_string_lossy().to_string()).collect();
    assert!(left.iter().all(|name| !name.contains("-thumb")), "nothing half made: {left:?}");
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn the_queue_makes_each_book_once_and_skips_one_removed_meanwhile() {
    let dir = scratch("queue");
    let queue = Queue::new();
    let a = cover(&dir, "a-cover.jpg", 700, 1000, [1, 1, 1]);
    let b = cover(&dir, "b-cover.jpg", 700, 1000, [2, 2, 2]);
    let job = |cover: &Path, hash: &str| Job { dir: dir.clone(), cover: cover.to_path_buf(), hash: hash.into() };
    assert!(queue.push(job(&a, "a")));
    assert!(!queue.push(job(&a, "a")), "asked twice, made once");
    assert!(queue.push(job(&b, "b")));
    fs::remove_file(&b).expect("b removed");
    assert_eq!(queue.drain(), 2);
    assert!(dir.join("a-thumb-480.jpg").exists());
    assert!(!dir.join("b-thumb-480.jpg").exists());
    assert_eq!(queue.len(), 0);
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_width_asked_for_is_served_the_next_one_up() {
    assert_eq!((width_for(1), width_for(240), width_for(241), width_for(5000)), (240, 240, 480, 480));
  }

  /// How long a phone-sized cover takes (run with `--ignored --nocapture`).
  #[test]
  #[ignore]
  fn bench_thumbnails() {
    let dir = scratch("bench");
    let full = dir.join("x-cover.jpg");
    // Noisy, like a real cover: flat colour compresses (and decodes) too easily.
    let mut seed = 7u32;
    let image = image::RgbImage::from_fn(1333, 2000, |x, y| {
      seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
      image::Rgb([(x / 6) as u8 ^ (seed >> 24) as u8, (y / 8) as u8, ((x + y) / 10) as u8 ^ (seed >> 16) as u8])
    });
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 88).encode_image(&image).expect("encode");
    // A real cover instead, if one is named (`LEAFLET_BENCH_COVER=path`).
    if let Ok(path) = std::env::var("LEAFLET_BENCH_COVER") {
      bytes = fs::read(path).expect("bench cover");
    }
    fs::write(&full, &bytes).expect("write");
    let runs = 10;
    let started = std::time::Instant::now();
    for _ in 0..runs {
      drop_all(&dir, "x");
      make(&dir, &full, "x").expect("make");
    }
    let each = started.elapsed().as_secs_f64() * 1000.0 / runs as f64;
    let sizes: Vec<u64> = WIDTHS.iter().map(|width| fs::metadata(path_in(&dir, "x", *width)).expect("meta").len()).collect();
    let started = std::time::Instant::now();
    for _ in 0..runs {
      let _ = decode(&bytes).expect("decode");
    }
    let decode_ms = started.elapsed().as_secs_f64() * 1000.0 / runs as f64;
    let started = std::time::Instant::now();
    for _ in 0..1000 {
      let _ = fresh(&dir, &full, "x", 480).expect("fresh");
    }
    let fresh_us = started.elapsed().as_secs_f64() * 1000.0;
    println!(
      "cover {} KB: both thumbnails in {each:.1} ms (decode alone {decode_ms:.1} ms); sizes {:?} bytes; freshness check {fresh_us:.1} us",
      bytes.len() / 1024,
      sizes
    );
    let _ = fs::remove_dir_all(&dir);
  }
}
