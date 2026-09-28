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
  tauri_build::build();
}
