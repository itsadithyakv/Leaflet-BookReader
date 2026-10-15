fn main() {
  // Build-time values are compiled in via `option_env!`, which cargo cannot see
  // as an input on its own. Without these, changing one would not rebuild the
  // crate and the old value would silently persist in the binary.
  println!("cargo:rerun-if-env-changed=LEAFLET_GOOGLE_CLIENT_ID");
  println!("cargo:rerun-if-env-changed=LEAFLET_GOOGLE_CLIENT_SECRET");
  // The default Leaflet API (accounts, leaderboard). See sync/cloud.rs.
  println!("cargo:rerun-if-env-changed=LEAFLET_API_BASE");
  println!("cargo:rerun-if-env-changed=LEAFLET_STORE_BUILD");
  println!("cargo:rerun-if-env-changed=LEAFLET_CONFIG_URL");

  // Android 15 and later phones may use 16 KB memory pages, and Google Play
  // requires apps targeting them (targetSdk 35+) to load there: the library's
  // segments must be aligned to 16 KB, and the NDK's linker aligns to 4 KB
  // unless told. Said here rather than in .cargo/config.toml, because the
  // Tauri CLI sets each Android target's rustflags itself, which replaces the
  // config's. Check: llvm-readelf -l libleaflet_lib.so, each LOAD 0x4000.
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
    println!("cargo:rustc-cdylib-link-arg=-Wl,-z,max-page-size=16384");
  }

  // The Android side's own plugin (src/mobile.rs, DevicePlugin.kt). Its
  // commands are answered in Kotlin, but the page may call them only if a
  // capability allows them, so their permissions are made here
  // (`leaflet-device:default`, granted in capabilities/android.json).
  let device = tauri_build::InlinedPlugin::new()
    .commands(&[
      "keep_awake",
      "lock_rotation",
      "hide_system_bars",
      "pick_files",
      "share_target",
      "share_file",
      "share_text",
      "open_store",
      "request_review"
    ])
    .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands);
  tauri_build::try_build(tauri_build::Attributes::new().plugin("leaflet-device", device))
    .expect("failed to run the Tauri build script");
}
