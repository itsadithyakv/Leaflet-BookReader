use crate::comic;
use crate::db::{self, BookRecord, FocusSessionRecord};
use crate::habit;
use crate::pip;
use crate::formats::{self, Delivery};
use crate::metadata::{normalize, open_library, wikipedia};
use crate::storage;
use crate::sync::drive;
use crate::{AppState, OpenComic};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, State};
use crate::LockExt;
use crate::sync::cloud;
use cloud::CommunityAuth;
use reqwest::Method;

// The app's commands, one module per area. Each area sees everything above
// (`use super::*`), and everything is re-exported here, so callers (and the
// handler list in lib.rs) still name them `commands::...`.
mod library;
mod backup;
mod social;
mod community;
mod account;
mod comics;
mod habits;
mod converter;
mod pip_shop;
mod diagnostics;
mod annotations;
mod collections;

pub use library::*;
pub use backup::*;
pub use social::*;
pub use community::*;
pub use account::*;
pub use comics::*;
pub use habits::*;
pub use converter::*;
pub use pip_shop::*;
pub use diagnostics::*;
pub use annotations::*;
pub use collections::*;
