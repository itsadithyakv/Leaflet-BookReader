#[cfg(target_os = "windows")]
fn download_converter() {
  use regex::Regex;
  use std::fs;
  use std::path::Path;
  use std::process::Command;

  if std::env::var("DUDEREADER_SKIP_CONVERTER_DOWNLOAD").is_ok() {
    println!("cargo:warning=Skipping converter download (DUDEREADER_SKIP_CONVERTER_DOWNLOAD set).");
    return;
  }

  if std::env::var("DUDEREADER_AUTO_DOWNLOAD_CONVERTER").is_err() {
    println!("cargo:warning=Skipping converter download (set DUDEREADER_AUTO_DOWNLOAD_CONVERTER=1 to enable).");
    return;
  }

  if std::env::var("PROFILE").unwrap_or_default() == "debug" {
    println!("cargo:warning=Skipping converter download in debug profile.");
    return;
  }

  let manifest_dir = match std::env::var("CARGO_MANIFEST_DIR") {
    Ok(dir) => dir,
    Err(_) => return
  };
  let resources_dir = Path::new(&manifest_dir).join("resources").join("converters");
  if fs::create_dir_all(&resources_dir).is_err() {
    return;
  }

  let marker_path = resources_dir.join(".calibre-version");
  let existing_marker = fs::read_to_string(&marker_path).ok().unwrap_or_default();

  let page = match ureq::get("https://calibre-ebook.com/download_portable")
    .call()
  {
    Ok(resp) => match resp.into_string() {
      Ok(text) => text,
      Err(_) => {
        println!("cargo:warning=Unable to read calibre portable info.");
        return;
      }
    },
    Err(_) => {
      println!("cargo:warning=Unable to download calibre portable info.");
      return;
    }
  };

  let version_re = Regex::new(r"Version:\s*([0-9.]+)").ok();
  let version = version_re
    .as_ref()
    .and_then(|re| re.captures(&page))
    .and_then(|caps| caps.get(1))
    .map(|m| m.as_str().to_string())
    .unwrap_or_else(|| "latest".to_string());

  if version == "latest" {
    println!("cargo:warning=Unable to parse calibre portable version.");
    return;
  }

  let converter_exists = resources_dir
    .join("calibre-portable")
    .join("Calibre")
    .join("ebook-convert.exe")
    .exists()
    || resources_dir.join("ebook-convert.exe").exists();

  if existing_marker.trim() == version && converter_exists {
    return;
  }

  let installer_name = format!("calibre-portable-installer-{}.exe", version);
  let url = format!("https://download.calibre-ebook.com/{}/{}", version, installer_name);
  let installer_path = resources_dir.join(&installer_name);

  let response = match ureq::get(&url).call() {
    Ok(resp) => resp,
    Err(_) => {
      println!("cargo:warning=Unable to download calibre portable installer.");
      return;
    }
  };

  if let Ok(mut file) = fs::File::create(&installer_path) {
    let mut reader = response.into_reader();
    let _ = std::io::copy(&mut reader, &mut file);
  }

  let install_dir = resources_dir.join("calibre-portable");
  let _ = fs::create_dir_all(&install_dir);

  let status = Command::new(&installer_path).arg(&install_dir).status();
  if status.map(|s| s.success()).unwrap_or(false) {
    let _ = fs::write(&marker_path, version.as_bytes());
  } else {
    println!("cargo:warning=Calibre portable installer failed.");
  }

  let _ = fs::remove_file(&installer_path);
}

#[cfg(not(target_os = "windows"))]
fn download_converter() {}

fn main() {
  tauri_build::build();
  download_converter();
}
