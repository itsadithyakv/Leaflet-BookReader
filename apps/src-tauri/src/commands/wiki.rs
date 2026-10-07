//! A book's fan wiki, asked one read-only question. What may be asked, and of
//! whom, is in `crate::wiki`.

use crate::wiki::WikiError;

/// The wiki's answer to one question of its API, as JSON text. `host` is a
/// Fandom wiki (`mistborn.fandom.com`); `params` the question.
#[tauri::command]
pub async fn wiki_ask(host: String, params: Vec<(String, String)>) -> Result<String, WikiError> {
  crate::wiki::ask(&host, &params).await
}
