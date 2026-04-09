use anyhow::Result;
use quick_xml::events::Event;
use quick_xml::Reader;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};
use regex::Regex;
use zip::ZipArchive;

pub struct BasicMetadata {
  pub title: Option<String>,
  pub author: Option<String>
}

pub fn app_data_dir() -> Result<PathBuf> {
  let base = dirs::data_dir().ok_or_else(|| anyhow::anyhow!("missing app data dir"))?;
  Ok(base.join("leaflet"))
}

pub fn books_dir() -> Result<PathBuf> {
  Ok(app_data_dir()?.join("books"))
}

pub fn covers_dir() -> Result<PathBuf> {
  Ok(app_data_dir()?.join("covers"))
}

pub fn hash_file(path: &Path) -> Result<String> {
  let mut file = fs::File::open(path)?;
  let mut hasher = Sha256::new();
  let mut buffer = [0u8; 8192];
  loop {
    let n = file.read(&mut buffer)?;
    if n == 0 {
      break;
    }
    hasher.update(&buffer[..n]);
  }
  Ok(hex::encode(hasher.finalize()))
}

pub fn store_book_file(source: &Path, hash: &str) -> Result<PathBuf> {
  let ext = source.extension().and_then(|v| v.to_str()).unwrap_or("bin");
  let dir = books_dir()?;
  fs::create_dir_all(&dir)?;
  let dest = dir.join(format!("{}.{}", hash, ext));
  if !dest.exists() {
    fs::copy(source, &dest)?;
  }
  Ok(dest)
}

pub fn converted_epub_path(hash: &str) -> Result<PathBuf> {
  Ok(books_dir()?.join(format!("{}.epub", hash)))
}

fn normalized_ext(path: &Path) -> String {
  path.extension()
    .and_then(|v| v.to_str())
    .unwrap_or("")
    .to_lowercase()
}

fn converter_filename() -> &'static str {
  #[cfg(target_os = "windows")]
  {
    "ebook-convert.exe"
  }
  #[cfg(not(target_os = "windows"))]
  {
    "ebook-convert"
  }
}

fn converter_candidates(app: Option<&AppHandle>) -> Vec<PathBuf> {
  let mut candidates = Vec::new();

  if let Some(handle) = app {
    if let Ok(resource_dir) = handle.path().resource_dir() {
      candidates.push(resource_dir.join("resources").join("converters").join(converter_filename()));
      candidates.push(
        resource_dir
          .join("resources")
          .join("converters")
          .join("calibre-portable")
          .join("Calibre")
          .join(converter_filename())
      );
      candidates.push(resource_dir.join("converters").join(converter_filename()));
    }
    if let Ok(app_data) = handle.path().app_data_dir() {
      candidates.push(
        app_data
          .join("converters")
          .join("calibre-portable")
          .join("Calibre")
          .join(converter_filename())
      );
      candidates.push(app_data.join("converters").join(converter_filename()));
    }
  }

  if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
    candidates.push(
      PathBuf::from(manifest)
        .join("resources")
        .join("converters")
        .join(converter_filename())
    );
  }

  candidates
}

fn resolve_converter_path(app: Option<&AppHandle>) -> Option<PathBuf> {
  let mut candidates = converter_candidates(app);

  if let Some(app_handle) = app {
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
      candidates.push(resource_dir.join("resources").join("converters"));
      candidates.push(resource_dir.join("converters"));
    }
  }

  if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
    candidates.push(PathBuf::from(manifest).join("resources").join("converters"));
  }

  for path in candidates {
    if path.is_file() && path.exists() {
      return Some(path);
    }
    if path.is_dir() {
      if let Some(found) = find_in_dir(&path, converter_filename()) {
        return Some(found);
      }
    }
  }

  None
}

fn find_in_dir(root: &Path, filename: &str) -> Option<PathBuf> {
  let entries = std::fs::read_dir(root).ok()?;
  for entry in entries.flatten() {
    let path = entry.path();
    if path.is_file() {
      if let Some(name) = path.file_name().and_then(|v| v.to_str()) {
        if name.eq_ignore_ascii_case(filename) {
          return Some(path);
        }
      }
    } else if path.is_dir() {
      if let Some(found) = find_in_dir(&path, filename) {
        return Some(found);
      }
    }
  }
  None
}

fn converter_install_dir(app: &AppHandle) -> Result<PathBuf> {
  let base = app
    .path()
    .app_data_dir()
    .map_err(|_| anyhow::anyhow!("missing app data dir"))?;
  Ok(base.join("converters"))
}

pub fn converter_installed(app: &AppHandle) -> bool {
  resolve_converter_path(Some(app)).is_some()
}

pub async fn install_converter(app: &AppHandle) -> Result<PathBuf> {
  if let Some(existing) = resolve_converter_path(Some(app)) {
    return Ok(existing);
  }

  let install_root = converter_install_dir(app)?.join("calibre-portable");
  fs::create_dir_all(&install_root)?;

  let page = reqwest::get("https://calibre-ebook.com/download_portable")
    .await?
    .text()
    .await?;

  let version_re = Regex::new(r"Version:\\s*([0-9.]+)").unwrap();
  let version = version_re
    .captures(&page)
    .and_then(|caps| caps.get(1))
    .map(|m| m.as_str().to_string())
    .ok_or_else(|| anyhow::anyhow!("unable to detect calibre version"))?;

  let installer_name = format!("calibre-portable-installer-{}.exe", version);
  let url = format!("https://download.calibre-ebook.com/{}/{}", version, installer_name);
  let installer_path = install_root.join(&installer_name);

  let bytes = reqwest::get(&url).await?.bytes().await?;
  fs::write(&installer_path, bytes)?;

  let status = Command::new(&installer_path).arg(&install_root).status();
  let _ = fs::remove_file(&installer_path);

  if status.map(|s| s.success()).unwrap_or(false) {
    if let Some(found) = resolve_converter_path(Some(app)) {
      return Ok(found);
    }
  }

  Err(anyhow::anyhow!("converter installation failed"))
}

pub fn ensure_epub_version(source: &Path, hash: &str, app: Option<&AppHandle>) -> Result<Option<PathBuf>> {
  let ext = normalized_ext(source);
  if ext == "epub" {
    return Ok(Some(source.to_path_buf()));
  }

  let target = converted_epub_path(hash)?;
  if target.exists() {
    return Ok(Some(target));
  }

  if ext != "azw3" && ext != "mobi" {
    return Ok(None);
  }

  let converter = match resolve_converter_path(app) {
    Some(path) => path,
    None => return Ok(None)
  };

  let status = Command::new(converter)
    .arg(source)
    .arg(&target)
    .status();

  match status {
    Ok(result) if result.success() && target.exists() => Ok(Some(target)),
    _ => Ok(None)
  }
}

#[allow(dead_code)]
pub fn resolve_readable_path(source: &Path, hash: &str) -> Result<PathBuf> {
  let ext = normalized_ext(source);
  if ext == "epub" {
    return Ok(source.to_path_buf());
  }
  let target = converted_epub_path(hash)?;
  if target.exists() {
    return Ok(target);
  }
  Ok(source.to_path_buf())
}

pub async fn store_cover(url: &str, hash: &str) -> Result<PathBuf> {
  let dir = covers_dir()?;
  fs::create_dir_all(&dir)?;
  let dest = dir.join(format!("{}-cover.jpg", hash));
  if dest.exists() {
    return Ok(dest);
  }
  let bytes = reqwest::get(url).await?.bytes().await?;
  fs::write(&dest, bytes)?;
  Ok(dest)
}

pub fn extract_basic_metadata(path: &Path) -> Result<BasicMetadata> {
  let ext = path.extension().and_then(|v| v.to_str()).unwrap_or("").to_lowercase();
  if ext == "epub" {
    if let Ok(metadata) = extract_epub_metadata(path) {
      return Ok(metadata);
    }
  }
  Ok(BasicMetadata {
    title: None,
    author: None
  })
}

fn extract_epub_metadata(path: &Path) -> Result<BasicMetadata> {
  let file = fs::File::open(path)?;
  let mut archive = ZipArchive::new(file)?;
  let mut opf_index = None;
  for i in 0..archive.len() {
    let file = archive.by_index(i)?;
    let name = file.name().to_lowercase();
    if name.ends_with("content.opf") || name.ends_with("package.opf") {
      opf_index = Some(i);
      break;
    }
  }
  let index = opf_index.ok_or_else(|| anyhow::anyhow!("missing opf"))?;
  let mut opf_file = archive.by_index(index)?;
  let mut contents = String::new();
  opf_file.read_to_string(&mut contents)?;

  let mut reader = Reader::from_str(&contents);
  reader.trim_text(true);
  let mut buf = Vec::new();
  let mut title: Option<String> = None;
  let mut author: Option<String> = None;
  let mut capture = None;

  loop {
    match reader.read_event_into(&mut buf) {
      Ok(Event::Start(e)) => {
        let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
        if name.ends_with("title") {
          capture = Some("title".to_string());
        } else if name.ends_with("creator") {
          capture = Some("creator".to_string());
        }
      }
      Ok(Event::Text(e)) => {
        if let Some(kind) = capture.as_deref() {
          let value = e.unescape()?.to_string();
          if kind == "title" && title.is_none() {
            title = Some(value.clone());
          }
          if kind == "creator" && author.is_none() {
            author = Some(value);
          }
        }
      }
      Ok(Event::End(_)) => {
        capture = None;
      }
      Ok(Event::Eof) => break,
      Err(_) => break,
      _ => {}
    }
    buf.clear();
  }

  Ok(BasicMetadata { title, author })
}
