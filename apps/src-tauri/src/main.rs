// Hides the console window that Windows would otherwise open behind the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// The desktop entry point.
///
/// Everything lives in the library so that Android and iOS — which load this
/// crate as a `cdylib` from their own host activity rather than starting a Rust
/// binary — run exactly the same setup.
fn main() {
  leaflet_lib::run()
}
