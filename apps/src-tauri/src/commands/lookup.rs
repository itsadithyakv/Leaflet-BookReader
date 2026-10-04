//! Looking up selected text: its meaning and a short summary. The work, and
//! what is and is not sent, is in `crate::lookup`.

use crate::lookup::{Lookup, LookupError};

/// What Wiktionary and Wikipedia have on the selected word or phrase.
/// `language` is the book's own ("en", "fr-FR"); English when it has none.
/// Finding nothing is an answer; an error means nothing could be asked.
#[tauri::command]
pub async fn lookup_term(term: String, language: Option<String>) -> Result<Lookup, LookupError> {
  crate::lookup::look_up(&term, language.as_deref()).await
}
