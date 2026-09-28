//! Windows toasts: shown now, or left with Windows for when the app is closed.
//!
//! Straight WinRT (`Windows.UI.Notifications`) rather than the notification
//! plugin, because the plugin can neither schedule a toast nor address the
//! MSIX package's own app identity; one code path does both kinds.
//!
//! Scheduling needs package identity (the MSIX build). An unpackaged build
//! (`tauri dev`, or the NSIS/MSI installer) can still show a toast while it
//! runs, under an AppUserModelID it names itself, but Windows will not keep a
//! schedule for it, so there the reminders are in-app only.

#[cfg(windows)]
mod imp {
  use crate::reminders::Reminder;
  use std::sync::OnceLock;
  use windows::core::{Interface, HSTRING};
  use windows::Data::Xml::Dom::XmlDocument;
  use windows::Foundation::{DateTime, IReference, PropertyValue};
  use windows::UI::Notifications::{
    NotificationSetting, ScheduledToastNotification, ToastNotification, ToastNotificationManager,
    ToastNotifier
  };
  use windows::Win32::Foundation::APPMODEL_ERROR_NO_PACKAGE;
  use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;

  /// Every reminder toast carries this group, so Leaflet can find its own
  /// scheduled toasts (and only those) to replace them.
  const GROUP: &str = "leaflet-reminders";
  /// Staged into the package by build-msix.ps1 (the Pip logo).
  const PACKAGED_IMAGE: &str = "ms-appx:///Assets/PipToast.png";
  /// Windows PowerShell's AppUserModelID, which Windows always knows. A dev
  /// build has no Start-menu shortcut of its own, and a toast under an unknown
  /// id is silently dropped. The notification plugin does the same.
  const DEV_AUMID: &str = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

  /// Whether this process runs from the MSIX package.
  pub fn packaged() -> bool {
    static PACKAGED: OnceLock<bool> = OnceLock::new();
    *PACKAGED.get_or_init(|| {
      let mut length = 0u32;
      // With a package this reports the buffer as too small; without one it
      // says so outright.
      let result = unsafe { GetCurrentPackageFullName(&mut length, None) };
      result != APPMODEL_ERROR_NO_PACKAGE
    })
  }

  /// The id an unpackaged build shows toasts under: the installer's Start-menu
  /// shortcut carries the bundle identifier, a dev build has no shortcut.
  fn unpackaged_aumid(identifier: &str) -> String {
    let dev = std::env::current_exe()
      .ok()
      .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf()))
      .map(|dir| {
        let dir = dir.to_string_lossy().to_ascii_lowercase();
        dir.ends_with("\\target\\debug") || dir.ends_with("\\target\\release")
      })
      .unwrap_or(true);
    if dev {
      DEV_AUMID.to_string()
    } else {
      identifier.to_string()
    }
  }

  fn notifier(identifier: &str) -> windows::core::Result<ToastNotifier> {
    if packaged() {
      ToastNotificationManager::CreateToastNotifier()
    } else {
      ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(unpackaged_aumid(identifier)))
    }
  }

  /// The Pip logo for the toast. Packaged, from the package; unpackaged, a
  /// copy in the temp folder (a packaged app's AppData is virtualised, which
  /// is why the package path is used there instead).
  fn image() -> Option<String> {
    if packaged() {
      return Some(PACKAGED_IMAGE.to_string());
    }
    static PATH: OnceLock<Option<String>> = OnceLock::new();
    PATH
      .get_or_init(|| {
        let path = std::env::temp_dir().join("leaflet-pip-toast.png");
        std::fs::write(&path, include_bytes!("../../../src/assets/pip/pip-256.png")).ok()?;
        let text = path.to_string_lossy().replace('\\', "/").replace(' ', "%20");
        Some(format!("file:///{text}"))
      })
      .clone()
  }

  fn document(reminder: &Reminder) -> windows::core::Result<XmlDocument> {
    let xml = crate::reminders::toast_xml(reminder, image().as_deref(), packaged());
    let document = XmlDocument::new()?;
    document.LoadXml(&HSTRING::from(xml))?;
    Ok(document)
  }

  fn winrt_time(time: chrono::DateTime<chrono::Utc>) -> DateTime {
    // WinRT counts 100 ns ticks from 1601-01-01 UTC.
    const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;
    DateTime {
      UniversalTime: UNIX_EPOCH_TICKS + time.timestamp() * 10_000_000 + i64::from(time.timestamp_subsec_nanos() / 100)
    }
  }

  fn reference(time: chrono::DateTime<chrono::Utc>) -> windows::core::Result<IReference<DateTime>> {
    PropertyValue::CreateDateTime(winrt_time(time))?.cast()
  }

  /// Windows' own switch for Leaflet's notifications, so Settings can say
  /// when reminders are on but Windows is holding them back.
  pub fn blocked(identifier: &str) -> bool {
    notifier(identifier)
      .and_then(|notifier| notifier.Setting())
      .map(|setting| setting != NotificationSetting::Enabled)
      .unwrap_or(false)
  }

  pub fn show(
    identifier: &str,
    reminder: &Reminder,
    expires: Option<chrono::DateTime<chrono::Utc>>
  ) -> windows::core::Result<()> {
    let toast = ToastNotification::CreateToastNotification(&document(reminder)?)?;
    toast.SetTag(&HSTRING::from(reminder.kind.tag()))?;
    toast.SetGroup(&HSTRING::from(GROUP))?;
    // "Time to read?" still sitting in the notification centre tomorrow would
    // be wrong, so each reminder leaves at the end of its day.
    if let Some(expires) = expires {
      let _ = toast.SetExpirationTime(&reference(expires)?);
    }
    notifier(identifier)?.Show(&toast)
  }

  /// Removes every reminder Leaflet left with Windows. Anything else in the
  /// schedule (nothing today) is not Leaflet's reminders' to touch.
  pub fn clear_scheduled(identifier: &str) -> windows::core::Result<()> {
    if !packaged() {
      return Ok(());
    }
    let notifier = notifier(identifier)?;
    let scheduled = notifier.GetScheduledToastNotifications()?;
    for index in 0..scheduled.Size()? {
      let toast = scheduled.GetAt(index)?;
      if toast.Group().map(|group| group == GROUP).unwrap_or(false) {
        notifier.RemoveFromSchedule(&toast)?;
      }
    }
    Ok(())
  }

  /// Drops delivered reminders from the notification centre: the reader is
  /// back, so yesterday's "time to read?" has done its job.
  pub fn clear_delivered(identifier: &str) {
    if let Ok(history) = ToastNotificationManager::History() {
      let _ = if packaged() {
        history.RemoveGroup(&HSTRING::from(GROUP))
      } else {
        history.RemoveGroupWithId(&HSTRING::from(GROUP), &HSTRING::from(unpackaged_aumid(identifier)))
      };
    }
  }

  /// Replaces Leaflet's scheduled reminders with these. Returns how many
  /// Windows accepted. Packaged builds only.
  pub fn schedule(
    identifier: &str,
    toasts: &[(Reminder, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>)]
  ) -> windows::core::Result<usize> {
    if !packaged() {
      return Ok(0);
    }
    clear_scheduled(identifier)?;
    let notifier = notifier(identifier)?;
    let mut accepted = 0;
    for (reminder, at, expires) in toasts {
      let toast = ScheduledToastNotification::CreateScheduledToastNotification(&document(reminder)?, winrt_time(*at))?;
      toast.SetTag(&HSTRING::from(reminder.kind.tag()))?;
      toast.SetGroup(&HSTRING::from(GROUP))?;
      if let Some(expires) = expires {
        let _ = toast.SetExpirationTime(&reference(*expires)?);
      }
      // One refused toast (a time Windows thinks is past) must not cost the
      // rest of the schedule.
      if notifier.AddToSchedule(&toast).is_ok() {
        accepted += 1;
      }
    }
    Ok(accepted)
  }
}

/// Everywhere else there is nothing to deliver with: the reminders card is
/// hidden (`supported` is false), and these are never reached in practice.
#[cfg(not(windows))]
mod imp {
  use crate::reminders::Reminder;

  pub fn packaged() -> bool {
    false
  }

  pub fn blocked(_identifier: &str) -> bool {
    false
  }

  pub fn show(
    _identifier: &str,
    _reminder: &Reminder,
    _expires: Option<chrono::DateTime<chrono::Utc>>
  ) -> Result<(), String> {
    Err("Reminders are only delivered on Windows.".to_string())
  }

  pub fn clear_scheduled(_identifier: &str) -> Result<(), String> {
    Ok(())
  }

  pub fn clear_delivered(_identifier: &str) {}

  pub fn schedule(
    _identifier: &str,
    _toasts: &[(Reminder, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>)]
  ) -> Result<usize, String> {
    Ok(0)
  }
}

pub use imp::*;
