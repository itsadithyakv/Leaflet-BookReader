use super::*;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::sync::atomic::AtomicUsize;

struct TempDir(PathBuf);
impl TempDir {
  fn new(name: &str) -> TempDir {
    let path = std::env::temp_dir().join(format!("leaflet-packs-{name}-{}-{:?}", std::process::id(), std::thread::current().id()));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).unwrap();
    TempDir(path)
  }
}
impl Drop for TempDir {
  fn drop(&mut self) {
    let _ = fs::remove_dir_all(&self.0);
  }
}

fn sha(bytes: &[u8]) -> String {
  hex::encode(Sha256::digest(bytes))
}

fn spec(path: &str, bytes: &[u8]) -> FileSpec {
  FileSpec { path: path.into(), size: bytes.len() as u64, sha256: sha(bytes) }
}

/// A `.tar.bz2` holding `root/<path>` for each file, plus something not wanted.
fn archive(root: &str, files: &[(&str, &[u8])]) -> Vec<u8> {
  let mut builder = tar::Builder::new(Vec::new());
  let mut add = |path: String, bytes: &[u8]| {
    let mut header = tar::Header::new_gnu();
    header.set_size(bytes.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder.append_data(&mut header, path, bytes).unwrap();
  };
  add(format!("{root}/README.md"), b"not wanted");
  for (path, bytes) in files {
    add(format!("{root}/{path}"), bytes);
  }
  add(format!("{root}/lexicon-zh.txt"), b"not wanted either");
  let tar = builder.into_inner().unwrap();
  let mut out = Vec::new();
  let mut encoder = bzip2::read::BzEncoder::new(&tar[..], bzip2::Compression::fast());
  encoder.read_to_end(&mut out).unwrap();
  out
}

fn test_pack(sources: Vec<Source>, files: Vec<FileSpec>) -> PackSpec {
  let mut variants = BTreeMap::new();
  variants.insert("fp32".to_string(), VariantSpec { model: files[0].path.clone(), files, sources });
  PackSpec {
    id: "kokoro-v1".into(),
    variant: "fp32".into(),
    variants,
    voices: vec![VoiceSpec { id: "neural:af_heart".into(), name: "Heart".into(), sid: 3, lang: "en-US".into(), lexicon: "lexicon-us-en.txt".into() }],
    default_voice: "neural:af_heart".into(),
    sample: "Hello.".into(),
  }
}

#[test]
fn the_shipped_manifest_is_sound() {
  let manifest = Manifest::parse(MANIFEST_JSON).unwrap();
  let pack = manifest.pack(PACK_ID).unwrap();
  // fp32 is the one downloaded (the benchmark: 2.3–2.7x faster than int8 on a laptop).
  assert_eq!(pack.variant, "fp32");
  assert_eq!(pack.chosen().model, "model.onnx");
  let paths: Vec<&str> = pack.chosen().files.iter().map(|file| file.path.as_str()).collect();
  for needed in ["model.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt", "lexicon-gb-en.txt", "espeak-ng-data/phontab", "espeak-ng-data/en_dict"] {
    assert!(paths.contains(&needed), "{needed}");
  }
  // English only: no other language's dictionaries.
  assert!(!paths.iter().any(|path| path.contains("zh") || path.ends_with("fr_dict")));
  let espeak: u64 = pack.chosen().files.iter().filter(|file| file.path.starts_with("espeak-ng-data/")).map(|file| file.size).sum();
  assert!(espeak < 1_000_000, "{espeak}");
  assert_eq!(pack.download_size(), 349_906_910);
  assert!(pack.installed_size() > 360_000_000 && pack.installed_size() < 370_000_000);
  assert_eq!(pack.voice(None).id, "neural:af_heart");
  assert_eq!(pack.voice(Some("neural:bf_emma")).sid, 21);
  assert_eq!(pack.voice(Some("neural:bf_emma")).lexicon, "lexicon-gb-en.txt");
  assert_eq!(pack.voice(Some("neural:am_michael")).sid, 16);
  assert_eq!(pack.voice(Some("nobody")).id, "neural:af_heart");
  // Both variants describe the same files apart from the model.
  let int8 = &pack.variants["int8"];
  assert_eq!(int8.files.len(), pack.chosen().files.len());
}

#[test]
fn a_bad_manifest_is_refused() {
  let good = MANIFEST_JSON.to_string();
  assert!(Manifest::parse(&good.replace("\"version\": 1", "\"version\": 2")).is_err());
  assert!(Manifest::parse(&good.replace("\"variant\": \"fp32\"", "\"variant\": \"fp64\"")).is_err());
  assert!(Manifest::parse(&good.replacen("\"path\": \"tokens.txt\"", "\"path\": \"../tokens.txt\"", 1)).is_err());
  assert!(Manifest::parse(&good.replacen("6ebb6bb288f20f3ae8d004d3c2ca27697da27c037d75e81a60e2a6a663f95425", "nothex", 1)).is_err());
  assert!(Manifest::parse("{").is_err());
}

#[test]
fn a_loose_files_source_is_understood() {
  let source: Source = serde_json::from_str(r#"{ "kind": "files", "base": "https://example.org/voice/" }"#).unwrap();
  assert_eq!(source, Source::Files { base: "https://example.org/voice/".into() });
}

#[test]
fn paths_cannot_leave_the_pack() {
  assert_eq!(safe_relative("espeak-ng-data/lang/gmw/en"), Some(PathBuf::from("espeak-ng-data").join("lang").join("gmw").join("en")));
  for bad in ["", "../x", "/etc/passwd", "a/../../b", "C:/x", "a\\b"] {
    assert_eq!(safe_relative(bad), None, "{bad}");
  }
}

#[test]
fn what_to_ask_for_follows_what_is_on_disk() {
  assert_eq!(plan_range(0, 100), RangePlan::From(0));
  assert_eq!(plan_range(40, 100), RangePlan::From(40));
  assert_eq!(plan_range(100, 100), RangePlan::Complete);
  // Longer than it should be: started again.
  assert_eq!(plan_range(140, 100), RangePlan::From(0));
}

#[test]
fn what_a_response_means_for_the_file() {
  assert_eq!(plan_response(40, 206, Some(40)), ResponsePlan::Append);
  assert!(matches!(plan_response(40, 206, Some(0)), ResponsePlan::Fail(_)));
  assert_eq!(plan_response(40, 200, None), ResponsePlan::Restart);
  assert_eq!(plan_response(0, 200, None), ResponsePlan::Restart);
  assert_eq!(plan_response(100, 416, None), ResponsePlan::Nothing);
  assert!(matches!(plan_response(0, 404, None), ResponsePlan::Fail(_)));
  assert_eq!(content_range_start("bytes 100-199/1000"), Some(100));
  assert_eq!(content_range_start("bytes */1000"), None);
}

#[test]
fn a_file_is_checked_by_size_and_hash() {
  let dir = TempDir::new("hash");
  let path = dir.0.join("f");
  fs::write(&path, b"hello").unwrap();
  assert!(file_matches(&path, 5, &sha(b"hello")));
  assert!(file_matches(&path, 5, &sha(b"hello").to_uppercase()));
  assert!(!file_matches(&path, 5, &sha(b"jello")));
  assert!(!file_matches(&path, 6, &sha(b"hello")));
  assert!(!file_matches(&dir.0.join("missing"), 5, &sha(b"hello")));
}

#[test]
fn only_the_wanted_files_come_out_of_the_archive_each_checked() {
  let dir = TempDir::new("extract");
  let files = [("model.onnx", &b"model bytes"[..]), ("espeak-ng-data/lang/gmw/en", &b"en"[..])];
  let path = dir.0.join("a.tar.bz2");
  fs::write(&path, archive("root", &files)).unwrap();
  let specs: Vec<FileSpec> = files.iter().map(|(p, b)| spec(p, b)).collect();
  let staging = dir.0.join("staging");
  let mut last = (0, 0);
  extract_archive(&path, "root", &specs, &staging, &AtomicBool::new(false), |done, total| last = (done, total)).unwrap();
  assert_eq!(fs::read(staging.join("model.onnx")).unwrap(), b"model bytes");
  assert_eq!(fs::read(staging.join("espeak-ng-data/lang/gmw/en")).unwrap(), b"en");
  assert!(!staging.join("README.md").exists() && !staging.join("lexicon-zh.txt").exists());
  assert_eq!(last.0, last.1);
  // A file whose hash is wrong is refused, and not left behind.
  let mut wrong = specs.clone();
  wrong[0].sha256 = sha(b"other");
  let fresh = dir.0.join("fresh");
  assert!(matches!(extract_archive(&path, "root", &wrong, &fresh, &AtomicBool::new(false), |_, _| {}), Err(DownloadError::Failed(_))));
  assert!(!fresh.join("model.onnx").exists());
  // A file the archive lacks is named.
  let mut missing = specs.clone();
  missing.push(spec("voices.bin", b"v"));
  match extract_archive(&path, "root", &missing, &dir.0.join("m"), &AtomicBool::new(false), |_, _| {}) {
    Err(DownloadError::Failed(message)) => assert!(message.contains("voices.bin"), "{message}"),
    other => panic!("{other:?}"),
  }
  // Cancelled: stops.
  assert_eq!(extract_archive(&path, "root", &specs, &dir.0.join("c"), &AtomicBool::new(true), |_, _| {}), Err(DownloadError::Cancelled));
}

#[test]
fn installing_swaps_the_folder_in_whole_and_removing_frees_it() {
  let dir = TempDir::new("install");
  let dirs = PackDirs::under(&dir.0, "kokoro-v1");
  let files = vec![spec("model.onnx", b"model")];
  let pack = test_pack(vec![Source::Files { base: "http://unused".into() }], files);
  // An older pack in place, with a thread count set by hand (kept).
  fs::create_dir_all(&dirs.dir).unwrap();
  fs::write(dirs.dir.join("model.onnx"), b"old").unwrap();
  let mut old = install_staged_info(&pack);
  old.threads = Some(3);
  write_install(&dirs.dir, &old).unwrap();
  fs::create_dir_all(&dirs.staging).unwrap();
  fs::write(dirs.staging.join("model.onnx"), b"model").unwrap();
  let info = install_staged(&pack, &dirs).unwrap();
  assert_eq!(info.threads, Some(3));
  assert_eq!(fs::read(dirs.dir.join("model.onnx")).unwrap(), b"model");
  assert!(!dirs.staging.exists() && !dirs.old.exists());
  assert_eq!(read_install(&dirs.dir).unwrap().pack, "kokoro-v1");
  let status = status_of(&pack, &dirs, false, true);
  assert!(status.installed && status.installed_bytes > 5);
  assert_eq!(status.self_test, None);
  // The self-test's result is kept with it.
  record_self_test(&dirs, 0.45, 4).unwrap();
  let status = status_of(&pack, &dirs, false, true);
  assert_eq!(status.self_test.as_ref().unwrap().rtf, 0.45);
  assert!(!status.slow);
  assert_eq!(status.mode, crate::tts::lead::Mode::Live);
  record_self_test(&dirs, 1.6, 2).unwrap();
  let status = status_of(&pack, &dirs, false, true);
  assert!(status.slow);
  assert_eq!(status.mode, crate::tts::lead::Mode::Prepare);
  assert!(record_self_test(&dirs, f64::NAN, 2).is_err());
  // Removed: all of it, partials too, and what that freed.
  fs::write(&dirs.archive, b"partial").unwrap();
  let before = dir_size(&dirs.dir) + 7;
  assert_eq!(remove(&dirs), before);
  assert!(!dirs.dir.exists() && !dirs.archive.exists());
  assert!(!status_of(&pack, &dirs, false, true).installed);
}

fn install_staged_info(pack: &PackSpec) -> InstallInfo {
  InstallInfo {
    pack: pack.id.clone(),
    manifest_version: 1,
    variant: pack.variant.clone(),
    model: pack.chosen().model.clone(),
    bytes: 3,
    installed_at: "then".into(),
    files: pack.chosen().files.iter().map(|file| (file.path.clone(), FileEntry { size: file.size, sha256: file.sha256.clone() })).collect(),
    self_test: None,
    threads: None,
  }
}

/// A server for one body that, the first time, stops halfway (as a dropped connection does),
/// and honours `Range` after that.
fn flaky_server(body: Vec<u8>) -> (String, Arc<AtomicUsize>, Arc<Mutex<Vec<String>>>) {
  let listener = TcpListener::bind("127.0.0.1:0").unwrap();
  let address = format!("http://{}", listener.local_addr().unwrap());
  let requests = Arc::new(AtomicUsize::new(0));
  let ranges = Arc::new(Mutex::new(Vec::new()));
  let (count, seen) = (requests.clone(), ranges.clone());
  std::thread::spawn(move || {
    for stream in listener.incoming() {
      let Ok(mut stream) = stream else { continue };
      let mut reader = BufReader::new(stream.try_clone().unwrap());
      let mut range = None;
      loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
          break;
        }
        if let Some(value) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
          range = value.trim().trim_end_matches('-').parse::<usize>().ok();
        }
      }
      seen.lock().unwrap().push(format!("{range:?}"));
      let n = count.fetch_add(1, Ordering::SeqCst);
      match range {
        Some(from) => {
          let rest = &body[from..];
          let head = format!(
            "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
            rest.len(),
            from,
            body.len() - 1,
            body.len()
          );
          let _ = stream.write_all(head.as_bytes());
          let _ = stream.write_all(rest);
        }
        None => {
          let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
          let _ = stream.write_all(head.as_bytes());
          let cut = if n == 0 { body.len() / 2 } else { body.len() };
          let _ = stream.write_all(&body[..cut]);
        }
      }
      let _ = stream.flush();
    }
  });
  (address, requests, ranges)
}

#[tokio::test]
async fn an_interrupted_download_resumes_where_it_stopped() {
  let dir = TempDir::new("resume");
  let body: Vec<u8> = (0..200_000u32).map(|n| (n % 251) as u8).collect();
  let (address, _, ranges) = flaky_server(body.clone());
  let client = http_client().unwrap();
  let path = dir.0.join("file.part");
  let cancel = AtomicBool::new(false);
  let first = fetch_resumable(&client, &format!("{address}/f"), &path, body.len() as u64, &cancel, |_| {}).await;
  assert!(matches!(first, Err(DownloadError::Failed(_))), "{first:?}");
  let kept = fs::metadata(&path).unwrap().len();
  assert!(kept > 0 && kept < body.len() as u64);
  fetch_resumable(&client, &format!("{address}/f"), &path, body.len() as u64, &cancel, |_| {}).await.unwrap();
  assert_eq!(fs::read(&path).unwrap(), body);
  assert_eq!(ranges.lock().unwrap().clone(), vec!["None".to_string(), format!("Some({kept})")]);
}

#[tokio::test]
async fn a_cancelled_download_keeps_what_it_has() {
  let dir = TempDir::new("cancel");
  let body = vec![7u8; 50_000];
  let (address, requests, _) = flaky_server(body.clone());
  let client = http_client().unwrap();
  let path = dir.0.join("file.part");
  let result = fetch_resumable(&client, &format!("{address}/f"), &path, body.len() as u64, &AtomicBool::new(true), |_| {}).await;
  assert_eq!(result, Err(DownloadError::Cancelled));
  assert_eq!(requests.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_whole_pack_downloads_from_loose_files_resuming_and_checking_each() {
  let dir = TempDir::new("files");
  let model: Vec<u8> = (0..120_000u32).map(|n| (n % 13) as u8).collect();
  let (address, _, _) = flaky_server(model.clone());
  let pack = test_pack(vec![Source::Files { base: address.clone() }], vec![spec("model.onnx", &model)]);
  let dirs = PackDirs::under(&dir.0, "kokoro-v1");
  let client = http_client().unwrap();
  let seen = Arc::new(Mutex::new(Vec::<Progress>::new()));
  let sink = seen.clone();
  let report = move |progress: Progress| sink.lock().unwrap().push(progress);
  // First try: the connection drops halfway.
  assert!(download_pack(&client, &pack, &dirs, &AtomicBool::new(false), &report).await.is_err());
  assert!(!dirs.dir.exists());
  assert!(status_of(&pack, &dirs, false, true).partial_bytes > 0);
  // Second: carries on, checks, installs.
  let info = download_pack(&client, &pack, &dirs, &AtomicBool::new(false), &report).await.unwrap();
  assert_eq!(info.files["model.onnx"].sha256, sha(&model));
  assert_eq!(fs::read(dirs.dir.join("model.onnx")).unwrap(), model);
  assert!(!dirs.staging.exists());
  let phases: Vec<Phase> = seen.lock().unwrap().iter().map(|progress| progress.phase).collect();
  assert!(phases.contains(&Phase::Download) && phases.contains(&Phase::Verify) && phases.last() == Some(&Phase::Install));
}

#[tokio::test]
async fn a_whole_pack_downloads_from_an_archive_and_falls_back_from_a_bad_mirror() {
  let dir = TempDir::new("archive");
  let files = [("model.onnx", &b"the model"[..]), ("voices.bin", &b"the voices"[..])];
  let bytes = archive("kokoro-multi-lang-v1_0", &files);
  let (address, _, _) = flaky_server(bytes.clone());
  let specs: Vec<FileSpec> = files.iter().map(|(p, b)| spec(p, b)).collect();
  let pack = test_pack(
    vec![
      // A mirror that is not there: tried first, then the archive.
      Source::Files { base: "http://127.0.0.1:9/nothing".into() },
      Source::Archive { url: format!("{address}/a.tar.bz2"), size: bytes.len() as u64, sha256: sha(&bytes), root: "kokoro-multi-lang-v1_0".into() },
    ],
    specs,
  );
  let dirs = PackDirs::under(&dir.0, "kokoro-v1");
  let client = http_client().unwrap();
  let report = |_: Progress| {};
  // The archive drops halfway the first time.
  assert!(download_pack(&client, &pack, &dirs, &AtomicBool::new(false), &report).await.is_err());
  download_pack(&client, &pack, &dirs, &AtomicBool::new(false), &report).await.unwrap();
  assert_eq!(fs::read(dirs.dir.join("voices.bin")).unwrap(), b"the voices");
  // The archive is not kept once the files are out of it.
  assert!(!dirs.archive.exists());
}

#[tokio::test]
async fn an_archive_that_changed_upstream_is_refused_and_not_resumed() {
  let dir = TempDir::new("changed");
  let bytes = archive("root", &[("model.onnx", b"m")]);
  let (address, _, _) = flaky_server(bytes.clone());
  let pack = test_pack(
    vec![Source::Archive { url: format!("{address}/a"), size: bytes.len() as u64, sha256: sha(b"something else"), root: "root".into() }],
    vec![spec("model.onnx", b"m")],
  );
  let dirs = PackDirs::under(&dir.0, "kokoro-v1");
  let client = http_client().unwrap();
  let _ = download_pack(&client, &pack, &dirs, &AtomicBool::new(false), &|_| {}).await;
  match download_pack(&client, &pack, &dirs, &AtomicBool::new(false), &|_| {}).await {
    Err(DownloadError::Failed(message)) => assert!(message.contains("changed upstream"), "{message}"),
    other => panic!("{other:?}"),
  }
  assert!(!dirs.archive.exists());
  assert!(!dirs.dir.exists());
}

#[test]
fn one_download_at_a_time() {
  let flag = begin_download().unwrap();
  assert!(downloading());
  assert!(begin_download().is_none());
  cancel_download();
  assert!(flag.load(Ordering::SeqCst));
  end_download();
  assert!(!downloading());
}

#[test]
fn each_voice_is_sounded_out_in_its_own_english() {
  // espeak-ng's plain "en" is British: an American voice reads with "en-us"
  // (else "Darcy" is dˈɑːsi), a British one with "en" ("en-gb" is not in 1.13.8).
  let pack = Manifest::shipped().pack(PACK_ID).unwrap().clone();
  assert_eq!(pack.voice(Some("neural:af_heart")).espeak_lang(), "en-us");
  assert_eq!(pack.voice(Some("neural:am_michael")).espeak_lang(), "en-us");
  assert_eq!(pack.voice(Some("neural:bf_emma")).espeak_lang(), "en");
  for voice in &pack.voices {
    let want = if voice.lang == "en-GB" { "en" } else { "en-us" };
    assert_eq!(voice.espeak_lang(), want, "{}", voice.id);
  }
  assert_eq!(espeak_lang_for("en_gb"), "en");
  assert_eq!(espeak_lang_for("en-US"), "en-us");
}

#[test]
fn an_install_file_naming_a_model_outside_the_pack_is_not_trusted() {
  let dir = TempDir::new("install-json");
  let pack = test_pack(vec![Source::Files { base: "http://unused".into() }], vec![spec("model.onnx", b"model")]);
  let mut info = install_staged_info(&pack);
  write_install(&dir.0, &info).unwrap();
  assert!(read_install(&dir.0).is_some());
  for bad in ["../../evil.onnx", "C:/evil.onnx", "other.onnx"] {
    info.model = bad.into();
    write_install(&dir.0, &info).unwrap();
    assert!(read_install(&dir.0).is_none(), "{bad}");
  }
}

#[test]
fn the_size_a_server_reports_is_read_from_either_response() {
  assert_eq!(reported_total(200, Some(500), None), Some(500));
  assert_eq!(reported_total(206, Some(400), Some("bytes 100-499/500")), Some(500));
  assert_eq!(reported_total(206, Some(400), Some("bytes 100-499/*")), None);
  assert_eq!(reported_total(416, None, Some("bytes */500")), None);
}

/// A server that answers every request with the whole of `body`, ignoring `Range`.
fn plain_server(body: Vec<u8>) -> String {
  let listener = TcpListener::bind("127.0.0.1:0").unwrap();
  let address = format!("http://{}", listener.local_addr().unwrap());
  std::thread::spawn(move || {
    for stream in listener.incoming() {
      let Ok(mut stream) = stream else { continue };
      let mut reader = BufReader::new(stream.try_clone().unwrap());
      loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
          break;
        }
      }
      let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
      let _ = stream.write_all(head.as_bytes());
      let _ = stream.write_all(&body);
      let _ = stream.flush();
    }
  });
  address
}

#[tokio::test]
async fn a_server_ignoring_range_starts_the_file_again() {
  let dir = TempDir::new("no-range");
  let body: Vec<u8> = (0..30_000u32).map(|n| (n % 241) as u8).collect();
  let address = plain_server(body.clone());
  let path = dir.0.join("file.part");
  // A partial copy on disk that is not even the start of it.
  fs::write(&path, vec![9u8; 10_000]).unwrap();
  fetch_resumable(&http_client().unwrap(), &format!("{address}/f"), &path, body.len() as u64, &AtomicBool::new(false), |_| {}).await.unwrap();
  assert_eq!(fs::read(&path).unwrap(), body);
}

#[tokio::test]
async fn a_file_of_another_size_upstream_is_said_to_have_changed_at_once() {
  let dir = TempDir::new("resized");
  let address = plain_server(vec![1u8; 5_000]);
  let path = dir.0.join("file.part");
  fs::write(&path, vec![1u8; 100]).unwrap();
  match fetch_resumable(&http_client().unwrap(), &format!("{address}/f"), &path, 4_000, &AtomicBool::new(false), |_| {}).await {
    Err(DownloadError::Failed(message)) => assert_eq!(message, CHANGED_UPSTREAM),
    other => panic!("{other:?}"),
  }
  // Nothing kept to resume from.
  assert!(!path.exists());
}
