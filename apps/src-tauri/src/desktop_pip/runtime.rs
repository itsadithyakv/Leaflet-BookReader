//! Desktop Pip in the running app: her window, the one thread that moves it,
//! and the commands her page and Settings call.
//!
//! The rules are the parent module's; this file gathers their inputs (the
//! monitors, the pointer, the window in front, the clock, the reminders'
//! scheduler) and acts on the answers.
//!
//! Who does what:
//!
//! - **Rust moves her.** The window is exactly as large as what it shows (her
//!   sprite; taller and wider only while a sign or her menu is up), and one
//!   thread here moves it: about twelve times a second while she walks, sixty
//!   while she is carried or falling, never while she stands, sits or sleeps.
//!   Standing, the thread wakes twice a second to look around (a handful of
//!   reads: the work area, the window in front, the pointer). Because the
//!   window is no larger than she is, everything else on screen stays
//!   clickable with no click-through tricks and no polling to turn them off.
//! - **Her page draws her and decides what she does** (`apps/src/desktop-pip`):
//!   the sprite with the reader's look, when to stroll, sit or fidget, the
//!   poke, the menu. It asks for a stroll and is told when she arrives; it
//!   says the hand has her and is told when she lands.
//! - **The reminders decide the nudge.** `reminders::runtime::tick` calls
//!   [`nudge`] when it sends a reminder; there is no second clock.
//!
//! She exists only while Leaflet runs and the reader has switched her on: the
//! thread and the window are made the first time she is wanted, and the
//! window goes when she is switched off, sent home, hidden for the day, when
//! the main window closes, and on Delete All Data. Nothing is written to
//! disk here; the switch itself is the webview's (`leaflet.desktopPip.*`).
//!
//! Windows only. Elsewhere the commands answer "not supported" and nothing
//! is started.

use super::{present, sign_text, sign_up, Nudge, Wanted};
use crate::reminders::Reminder;
use crate::LockExt;
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Condvar, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};

/// Her page, beside `index.html` (see `apps/desktop-pip.html`).
#[cfg(windows)]
const PAGE: &str = "desktop-pip.html";

/// What her page is told, down the channel it hands over when it is ready.
/// A channel rather than events: her window then needs no capability at all.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HostEvent {
  /// Night fell or ended, or Pip's mode changed.
  World { night: bool, quiet: bool },
  /// She is walking, this way (-1 left, 1 right).
  Walking { facing: i8 },
  /// She has reached where she was going, or was stopped.
  Arrived,
  /// The hand let go.
  Falling { tossed: bool },
  /// She is on the ground again: how hard she met it (art pixels a second),
  /// and whether that was hard enough to land flat.
  Landed { impact: f64, flat: bool },
  /// Where the pointer is from her.
  Glance { side: i8, up: bool, near: bool },
  /// The sign to hold up, or none.
  Sign { text: Option<String> },
  /// The reader has left Leaflet's window: her look may have changed there.
  Look
}

/// What her page starts from.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
  pub night: bool,
  pub quiet: bool,
  pub facing: i8,
  pub sign: Option<String>
}

/// What Settings shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPipStatus {
  /// She can live on this desktop at all (Windows only).
  pub supported: bool,
  pub enabled: bool,
  /// She is out there now (or behind a full-screen app).
  pub out: bool,
  pub hidden_today: bool,
  pub sent_home: bool
}

/// What her menu and her sign can ask for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
  /// Bring Leaflet's window forward.
  Open,
  /// The sign was clicked: Leaflet, at the last book.
  Continue,
  /// The sign was put down without being followed.
  PutDown,
  /// Home until Leaflet next starts, or the reader calls her back.
  Home,
  /// Gone for the rest of today.
  Today
}

#[derive(Default)]
struct Inner {
  wanted: Wanted,
  sent_home: bool,
  /// Leaflet is closing: the thread ends.
  quit: bool,
  /// The thread has been started. It is, the first time she is wanted.
  running: bool,
  /// Her window could not be made. Not tried again until the switch is.
  failed: bool,
  /// The last reminder she was told of, kept after its sign comes down so
  /// the same reminder is never signed twice.
  nudge: Option<Nudge>,
  #[cfg(windows)]
  live: Option<host::Live>
}

struct Shared {
  inner: Mutex<Inner>,
  /// Wakes the thread at once when something is asked of her.
  wake: Condvar
}

/// Managed state: desktop Pip, whether or not she is out.
pub struct DesktopPip(Arc<Shared>);

fn today_key() -> String {
  Local::now().format("%Y-%m-%d").to_string()
}

fn status(inner: &Inner) -> DesktopPipStatus {
  let today = today_key();
  DesktopPipStatus {
    supported: cfg!(windows),
    enabled: inner.wanted.enabled,
    out: cfg!(windows) && !inner.failed && present(&inner.wanted, inner.sent_home, &today),
    hidden_today: inner.wanted.hidden_on.as_deref() == Some(today.as_str()),
    sent_home: inner.sent_home
  }
}

/// Called once from setup. Starts nothing: she is off until the main window
/// reports that the reader switched her on.
pub fn init<R: Runtime>(app: &AppHandle<R>) {
  app.manage(DesktopPip(Arc::new(Shared { inner: Mutex::new(Inner::default()), wake: Condvar::new() })));
}

/// Closes her window, if there is one. (Only Windows ever has one; the
/// window calls below do not exist on a phone, which is why this is fenced.)
fn destroy_window<R: Runtime>(app: &AppHandle<R>) {
  #[cfg(windows)]
  if let Some(window) = app.get_webview_window(super::WINDOW_LABEL) {
    let _ = window.destroy();
  }
  #[cfg(not(windows))]
  let _ = app;
}

/// The main window is gone, which is how Leaflet exits. Her window goes with
/// it, here and now rather than when the thread next wakes: Tauri only ends
/// the process once every window is closed.
pub fn shutdown<R: Runtime>(app: &AppHandle<R>) {
  if let Some(pip) = app.try_state::<DesktopPip>() {
    pip.0.inner.guard().quit = true;
    pip.0.wake.notify_all();
  }
  destroy_window(app);
}

/// Delete All Data: she is switched off and her window closed. The switch
/// itself is the webview's and is removed there (`services/deviceData.ts`).
pub fn forget<R: Runtime>(app: &AppHandle<R>) {
  if let Some(pip) = app.try_state::<DesktopPip>() {
    let mut inner = pip.0.inner.guard();
    inner.wanted = Wanted::default();
    inner.sent_home = false;
    inner.failed = false;
    inner.nudge = None;
    drop(inner);
    pip.0.wake.notify_all();
  }
}

/// A reminder has just gone out (`reminders::runtime::tick`). If she is out
/// on the desktop she holds up a sign for it; if she is not, nothing is kept.
pub fn nudge<R: Runtime>(app: &AppHandle<R>, reminder: &Reminder) {
  let Some(pip) = app.try_state::<DesktopPip>() else {
    return;
  };
  let mut inner = pip.0.inner.guard();
  if !status(&inner).out {
    return;
  }
  if let Some(nudge) = super::nudge_for(reminder, inner.nudge.as_ref(), Local::now().naive_local()) {
    inner.nudge = Some(nudge);
    drop(inner);
    pip.0.wake.notify_all();
  }
}

/// The text of the sign that is up now, if one is.
fn sign_now(inner: &Inner) -> Option<String> {
  let now = Local::now().naive_local();
  inner
    .nudge
    .as_ref()
    .filter(|nudge| sign_up(nudge, now))
    .map(|nudge| sign_text(nudge.kind).to_string())
}

fn open_leaflet(app: &AppHandle) {
  #[cfg(windows)]
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
  #[cfg(not(windows))]
  let _ = app;
}

// ---- commands: Settings (the main window) ------------------------------------

/// The reader's choices, from the main window: at launch, when the switch or
/// Pip's mode changes. `recall` brings her back from "home" or "hidden today".
#[tauri::command]
pub fn desktop_pip_set(wanted: Wanted, recall: bool, app: AppHandle, pip: State<'_, DesktopPip>) -> DesktopPipStatus {
  let shared = pip.0.clone();
  let mut inner = shared.inner.guard();
  if recall || (wanted.enabled && !inner.wanted.enabled) {
    inner.sent_home = false;
    inner.failed = false;
  }
  inner.wanted = wanted;
  let now = status(&inner);
  let start = now.out && !inner.running;
  if start {
    inner.running = true;
  }
  drop(inner);
  if start {
    #[cfg(windows)]
    host::start(&app, shared.clone());
  }
  let _ = &app;
  shared.wake.notify_all();
  now
}

#[tauri::command]
pub fn desktop_pip_status(pip: State<'_, DesktopPip>) -> DesktopPipStatus {
  status(&pip.0.inner.guard())
}

// ---- commands: her page --------------------------------------------------------

/// Her page is ready to draw her: it hands over the channel it listens on and
/// says whether motion is reduced (then she stands still in the corner). The
/// window is shown only after this, so it never appears empty.
#[tauri::command]
pub fn desktop_pip_attach(channel: Channel<HostEvent>, still: bool, pip: State<'_, DesktopPip>) -> Option<Snapshot> {
  let mut inner = pip.0.inner.guard();
  let quiet = inner.wanted.quiet;
  let sign = sign_now(&inner);
  #[cfg(windows)]
  let snapshot = inner.live.as_mut().map(|live| live.attach(channel, still, quiet, sign));
  #[cfg(not(windows))]
  let snapshot = {
    let _ = (channel, still, quiet, sign);
    None
  };
  drop(inner);
  pip.0.wake.notify_all();
  snapshot
}

/// A stroll: `roll` (0 to 1) is how far, `turn` whether she turns round
/// first. Answers the way she is now walking, or nothing if she stays.
#[tauri::command]
pub fn desktop_pip_stroll(roll: f64, turn: bool, pip: State<'_, DesktopPip>) -> Option<i8> {
  #[cfg(windows)]
  let facing = pip.0.inner.guard().live.as_mut().and_then(|live| live.stroll(roll, turn));
  #[cfg(not(windows))]
  let facing = {
    let _ = (roll, turn);
    None
  };
  pip.0.wake.notify_all();
  facing
}

/// Stops a walk where she is (she was poked, or her menu opened).
#[tauri::command]
pub fn desktop_pip_halt(pip: State<'_, DesktopPip>) {
  #[cfg(windows)]
  if let Some(live) = pip.0.inner.guard().live.as_mut() {
    live.halt();
  }
  pip.0.wake.notify_all();
}

/// The hand has her: from now her window follows the pointer, until the page
/// says the button came up or Windows does.
#[tauri::command]
pub fn desktop_pip_hold(pip: State<'_, DesktopPip>) -> bool {
  #[cfg(windows)]
  let held = pip.0.inner.guard().live.as_mut().is_some_and(|live| live.hold());
  #[cfg(not(windows))]
  let held = false;
  pip.0.wake.notify_all();
  held
}

#[tauri::command]
pub fn desktop_pip_release(pip: State<'_, DesktopPip>) {
  #[cfg(windows)]
  if let Some(live) = pip.0.inner.guard().live.as_mut() {
    live.let_go(std::time::Instant::now());
  }
  pip.0.wake.notify_all();
}

/// What the window must hold, in art pixels: just her, or her under the sign
/// or the menu. It grows upward from her feet and stays centred on her.
#[tauri::command]
pub fn desktop_pip_frame(width: i32, height: i32, pip: State<'_, DesktopPip>) {
  #[cfg(windows)]
  if let Some(live) = pip.0.inner.guard().live.as_mut() {
    live.set_frame(super::Frame { width, height });
  }
  #[cfg(not(windows))]
  let _ = (width, height);
  pip.0.wake.notify_all();
}

/// Her menu and her sign.
#[tauri::command]
pub fn desktop_pip_act(action: Action, app: AppHandle, pip: State<'_, DesktopPip>) -> DesktopPipStatus {
  let mut inner = pip.0.inner.guard();
  match action {
    Action::Open => {}
    Action::Continue | Action::PutDown => {
      if let Some(nudge) = inner.nudge.as_mut() {
        nudge.put_down = true;
      }
    }
    Action::Home => inner.sent_home = true,
    Action::Today => inner.wanted.hidden_on = Some(today_key())
  }
  let now = status(&inner);
  drop(inner);
  pip.0.wake.notify_all();
  match action {
    Action::Open => open_leaflet(&app),
    Action::Continue => {
      // The same road a clicked reminder toast takes: the app picks the
      // route up and reopens the last book.
      crate::reminders::runtime::note_activation(&app, &[String::new(), crate::reminders::CONTINUE_URI.to_string()]);
      open_leaflet(&app);
    }
    Action::PutDown | Action::Home | Action::Today => {}
  }
  now
}

// ---- the window and its thread ---------------------------------------------------

#[cfg(windows)]
mod host {
  use super::super::{
    corner_x, fall_step, frame_rect, full_screen, glance, is_toss, release_velocity, stage_for, start_x, stroll_target,
    walk_step, win, Body, Frame, Glance, Rect, Stage, SPLAT_SPEED, WINDOW_LABEL
  };
  use super::{destroy_window, present, sign_text, sign_up, today_key, HostEvent, Inner, Nudge, Shared, Snapshot, PAGE};
  use crate::{diag, reminders, LockExt};
  use chrono::{Local, Timelike};
  use std::collections::VecDeque;
  use std::sync::{Arc, MutexGuard, PoisonError};
  use std::time::{Duration, Instant};
  use tauri::ipc::Channel;
  use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

  /// A step of a walk: the sprite's own twelve frames a second.
  const WALK_EVERY: Duration = Duration::from_millis(83);
  /// Carried or falling, she moves with the display.
  const FLY_EVERY: Duration = Duration::from_millis(16);
  /// Standing, how often she looks around...
  const LOOK_EVERY: Duration = Duration::from_millis(500);
  /// ...and with the pointer close, so her eyes keep up with it...
  const LOOK_EVERY_NEAR: Duration = Duration::from_millis(150);
  /// ...and hidden behind a full-screen app, only to see when it ends.
  const LOOK_EVERY_COVERED: Duration = Duration::from_secs(1);

  enum Motion {
    Rest,
    Walk { target: f64 },
    /// In the hand: her feet are this far from the pointer.
    Held { dx: f64, dy: f64, samples: VecDeque<(Instant, f64, f64)> },
    Fall { body: Body, bounced: bool, hardest: f64 }
  }

  /// Desktop Pip while her window exists.
  pub struct Live {
    hwnd: win::Handle,
    /// Leaflet's own window, to notice the reader leaving it.
    main: win::Handle,
    channel: Option<Channel<HostEvent>>,
    /// Her page has drawn her; until then the window stays hidden.
    attached: bool,
    /// Reduced motion: she keeps to the corner and nothing travels.
    still: bool,
    stage: Stage,
    /// Her feet, in physical pixels.
    x: f64,
    y: f64,
    facing: i8,
    motion: Motion,
    frame: Frame,
    /// The rectangle last asked of Windows.
    placed: Option<Rect>,
    visible: bool,
    /// A full-screen app is in front, on her monitor.
    covered: bool,
    night: bool,
    quiet: bool,
    glance: Glance,
    /// Her page has been told the sign is up.
    sign: bool,
    leaflet_front: bool,
    next_look: Instant
  }

  impl Live {
    fn tell(&self, event: HostEvent) {
      if let Some(channel) = &self.channel {
        let _ = channel.send(event);
      }
    }

    fn carried(&self) -> bool {
      matches!(self.motion, Motion::Held { .. } | Motion::Fall { .. })
    }

    fn rect(&self) -> Rect {
      // In the hand or in the air she is only herself: no sign, no menu.
      let frame = if self.carried() { Frame::PLAIN } else { self.frame };
      frame_rect(self.x.round() as i32, self.y.round() as i32, frame, self.stage.per_pixel)
    }

    /// Moves the window if it is not already where she is.
    fn place(&mut self) {
      let rect = self.rect();
      if self.placed != Some(rect) {
        win::place(self.hwnd, rect);
        self.placed = Some(rect);
      }
    }

    pub fn attach(&mut self, channel: Channel<HostEvent>, still: bool, quiet: bool, sign: Option<String>) -> Snapshot {
      self.channel = Some(channel);
      self.attached = true;
      self.still = still;
      self.quiet = quiet;
      self.night = reminders::in_quiet_hours(Local::now().naive_local());
      self.glance = Glance::default();
      self.frame = Frame::PLAIN;
      if still {
        self.motion = Motion::Rest;
        self.x = corner_x(&self.stage);
        self.y = f64::from(self.stage.ground);
      }
      self.sign = sign.is_some() && !self.covered;
      self.next_look = Instant::now();
      self.place();
      Snapshot {
        night: self.night,
        quiet,
        facing: self.facing,
        sign: if self.sign { sign } else { None }
      }
    }

    pub fn stroll(&mut self, roll: f64, turn: bool) -> Option<i8> {
      if !matches!(self.motion, Motion::Rest) || self.still || !self.visible {
        return None;
      }
      let (target, facing) = stroll_target(self.x, self.facing, &self.stage, roll, turn);
      if (target - self.x).abs() < 1.0 {
        return None;
      }
      self.facing = facing;
      self.motion = Motion::Walk { target };
      Some(facing)
    }

    pub fn halt(&mut self) {
      if matches!(self.motion, Motion::Walk { .. }) {
        self.motion = Motion::Rest;
      }
    }

    pub fn hold(&mut self) -> bool {
      if !self.visible || self.carried() {
        return false;
      }
      let Some((cx, cy)) = win::cursor() else {
        return false;
      };
      self.motion = Motion::Held { dx: self.x - f64::from(cx), dy: self.y - f64::from(cy), samples: VecDeque::new() };
      true
    }

    pub fn let_go(&mut self, now: Instant) {
      let Motion::Held { samples, .. } = std::mem::replace(&mut self.motion, Motion::Rest) else {
        return;
      };
      if self.still {
        // No fall to watch: she is simply set down on her edge.
        self.x = self.x.clamp(f64::from(self.stage.min_x), f64::from(self.stage.max_x));
        self.y = f64::from(self.stage.ground);
        self.tell(HostEvent::Landed { impact: 0.0, flat: false });
        return;
      }
      let since = samples.front().map_or(now, |sample| sample.0);
      let track: Vec<(f64, f64, f64)> =
        samples.iter().map(|(at, x, y)| (at.duration_since(since).as_secs_f64(), *x, *y)).collect();
      let velocity = release_velocity(&track, now.duration_since(since).as_secs_f64(), self.stage.per_pixel);
      self.motion = Motion::Fall {
        body: Body { x: self.x, y: self.y, vx: velocity.0, vy: velocity.1 },
        bounced: false,
        hardest: 0.0
      };
      self.tell(HostEvent::Falling { tossed: is_toss(velocity, self.stage.per_pixel) });
    }

    pub fn set_frame(&mut self, frame: Frame) {
      self.frame = frame.clamped();
      self.place();
    }

    /// What `dt` seconds do to her.
    fn advance(&mut self, app: &AppHandle, dt: f64, now: Instant) {
      match std::mem::replace(&mut self.motion, Motion::Rest) {
        Motion::Rest => {}
        Motion::Walk { target } => {
          let (x, arrived) = walk_step(self.x, target, dt, &self.stage);
          self.x = x;
          if arrived {
            self.tell(HostEvent::Arrived);
          } else {
            self.motion = Motion::Walk { target };
          }
        }
        Motion::Held { dx, dy, mut samples } => {
          let Some((cx, cy)) = win::cursor() else {
            self.motion = Motion::Held { dx, dy, samples };
            return;
          };
          // Carried onto another monitor, she takes its scale, and it is its
          // ground she will fall to.
          if !self.stage.monitor.contains(cx, cy) {
            if let Some(stage) = stage_at(app, f64::from(cx), f64::from(cy)) {
              self.stage = stage;
            }
          }
          self.x = f64::from(cx) + dx;
          self.y = f64::from(cy) + dy;
          samples.push_back((now, self.x, self.y));
          while samples.front().is_some_and(|sample| now.duration_since(sample.0) > Duration::from_millis(250)) {
            samples.pop_front();
          }
          self.motion = Motion::Held { dx, dy, samples };
          if !win::button_down() {
            self.let_go(now);
          }
        }
        Motion::Fall { body, bounced, hardest } => {
          let fall = fall_step(body, dt, &self.stage, bounced);
          let hardest = hardest.max(fall.impact);
          self.x = fall.body.x;
          self.y = fall.body.y;
          if !fall.landed {
            self.motion = Motion::Fall { body: fall.body, bounced: fall.bounced, hardest };
            return;
          }
          self.tell(HostEvent::Landed { impact: hardest, flat: hardest > SPLAT_SPEED });
          // Down in the margin at the end of her edge: she walks back onto it.
          let (min, max) = (f64::from(self.stage.min_x), f64::from(self.stage.max_x));
          if self.x < min || self.x > max {
            self.facing = if self.x < min { 1 } else { -1 };
            self.motion = Motion::Walk { target: self.x.clamp(min, max) };
            self.tell(HostEvent::Walking { facing: self.facing });
          }
        }
      }
    }

    /// Looks around: the monitor under her feet, the window in front, the
    /// clock, the pointer, the sign. Told to her page only when it changes.
    fn look(&mut self, app: &AppHandle, quiet: bool, nudge: &mut Option<Nudge>) {
      let carried = self.carried();

      if !carried {
        let stage = stage_at(app, self.x, f64::from(self.stage.ground) - 1.0).or_else(|| primary_stage(app));
        if let Some(stage) = stage {
          if stage != self.stage {
            // The resolution, the scaling or the taskbar changed (or her
            // monitor went): back onto the edge as it is now.
            let lost = !stage.monitor.contains(self.x.round() as i32, stage.monitor.top);
            self.stage = stage;
            self.x = if lost { start_x(&stage) } else { self.x.clamp(f64::from(stage.min_x), f64::from(stage.max_x)) };
          }
          self.y = f64::from(self.stage.ground);
        }
      }

      let front = win::foreground();
      let leaflet = front.as_ref().is_some_and(|front| front.handle == self.main);
      if self.leaflet_front && !leaflet {
        self.tell(HostEvent::Look);
      }
      self.leaflet_front = leaflet;

      // A full-screen app on her monitor: the one in front, or one left
      // showing there (the middle of the monitor is never her own window).
      let monitor = self.stage.monitor;
      let fills = |window: &win::Front| {
        window.handle != self.hwnd && full_screen(window.rect, window.captioned, window.shell, monitor)
      };
      let covered = !carried
        && (win::away()
          || front.as_ref().is_some_and(fills)
          || win::window_at((monitor.left + monitor.right) / 2, (monitor.top + monitor.bottom) / 2).as_ref().is_some_and(fills));
      if covered && !self.covered && matches!(self.motion, Motion::Walk { .. }) {
        self.motion = Motion::Rest;
        self.tell(HostEvent::Arrived);
      }
      self.covered = covered;
      let visible = self.attached && !covered;
      if visible != self.visible {
        self.visible = visible;
        if visible {
          // In place before she is seen.
          self.placed = None;
          self.place();
        }
        win::show(self.hwnd, visible);
      }

      let now = Local::now().naive_local();
      let night = reminders::in_quiet_hours(now);
      if night != self.night || quiet != self.quiet {
        self.night = night;
        self.quiet = quiet;
        self.tell(HostEvent::World { night, quiet });
      }

      let seen = if visible && matches!(self.motion, Motion::Rest) {
        win::cursor()
          .map(|cursor| glance(self.x.round() as i32, self.stage.ground, cursor, self.stage.per_pixel))
          .unwrap_or_default()
      } else {
        Glance::default()
      };
      if seen != self.glance {
        self.glance = seen;
        self.tell(HostEvent::Glance { side: seen.side, up: seen.up, near: seen.near });
      }

      let up = visible && !carried && nudge.as_ref().is_some_and(|nudge| sign_up(nudge, now));
      if up {
        if let Some(nudge) = nudge.as_mut() {
          nudge.shown_at.get_or_insert(now);
        }
      }
      if up != self.sign {
        self.sign = up;
        let text = nudge.as_ref().filter(|_| up).map(|nudge| sign_text(nudge.kind).to_string());
        self.tell(HostEvent::Sign { text });
      }

      // Windows moves windows too (a change of scaling resizes them, a
      // monitor going rearranges them): put her back if it has.
      if visible && !carried && win::rect_of(self.hwnd).is_some_and(|actual| actual != self.rect()) {
        self.placed = None;
      }
    }

    fn look_every(&self) -> Duration {
      if self.covered {
        LOOK_EVERY_COVERED
      } else if self.glance.near || self.carried() {
        LOOK_EVERY_NEAR
      } else {
        LOOK_EVERY
      }
    }

    /// How long until the thread is next needed.
    fn pace(&self, now: Instant) -> Duration {
      match self.motion {
        Motion::Held { .. } | Motion::Fall { .. } => FLY_EVERY,
        Motion::Walk { .. } => WALK_EVERY,
        Motion::Rest => self.next_look.saturating_duration_since(now).max(Duration::from_millis(10))
      }
    }
  }

  fn rect_of(position: &tauri::PhysicalPosition<i32>, size: &tauri::PhysicalSize<u32>) -> Rect {
    Rect::new(position.x, position.y, position.x + size.width as i32, position.y + size.height as i32)
  }

  fn stage_of(monitor: &tauri::Monitor) -> Stage {
    let work = monitor.work_area();
    stage_for(
      rect_of(monitor.position(), monitor.size()),
      rect_of(&work.position, &work.size),
      monitor.scale_factor()
    )
  }

  /// The stage of the monitor a point is on. Straight Win32 underneath
  /// (`MonitorFromPoint`), with no trip to the main thread.
  fn stage_at(app: &AppHandle, x: f64, y: f64) -> Option<Stage> {
    app.monitor_from_point(x, y).ok().flatten().map(|monitor| stage_of(&monitor))
  }

  fn primary_stage(app: &AppHandle) -> Option<Stage> {
    app.primary_monitor().ok().flatten().map(|monitor| stage_of(&monitor))
  }

  /// Makes her window, hidden, on the primary monitor's taskbar. Must be
  /// called without her lock: building a window waits on the main thread.
  fn open(app: &AppHandle) -> Result<Live, String> {
    if app.get_webview_window(WINDOW_LABEL).is_some() {
      // Left from a moment ago (switched off and on again quickly).
      destroy_window(app);
      std::thread::sleep(Duration::from_millis(150));
    }
    let stage = primary_stage(app).ok_or("no monitor to stand on")?;
    let window = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App(PAGE.into()))
      .title("Pip")
      .inner_size(64.0, 64.0)
      // tao leaves an undecorated window its title bar's style, and Windows
      // will not make a window with that style narrower than a title bar's
      // buttons (about 136 pixels) unless it is told a smaller minimum.
      .min_inner_size(8.0, 8.0)
      .decorations(false)
      .transparent(true)
      // No shadow: on an undecorated window it is also a 1px border and, on
      // Windows 11, rounded corners.
      .shadow(false)
      .always_on_top(true)
      .skip_taskbar(true)
      // WS_EX_NOACTIVATE: shown without activation, and a click on her
      // leaves the focus (and the keyboard) with whatever the reader is in.
      .focusable(false)
      .focused(false)
      .resizable(false)
      .maximizable(false)
      .minimizable(false)
      .drag_and_drop(false)
      .zoom_hotkeys_enabled(false)
      .visible(false)
      .build()
      .map_err(|error| error.to_string())?;
    let hwnd = win::handle_of(window.hwnd().map_err(|error| error.to_string())?);
    win::dress(hwnd);
    let main = app
      .get_webview_window("main")
      .and_then(|main| main.hwnd().ok())
      .map(win::handle_of)
      .unwrap_or_default();
    let mut live = Live {
      hwnd,
      main,
      channel: None,
      attached: false,
      still: false,
      stage,
      x: start_x(&stage),
      y: f64::from(stage.ground),
      facing: -1,
      motion: Motion::Rest,
      frame: Frame::PLAIN,
      placed: None,
      visible: false,
      covered: false,
      night: false,
      quiet: false,
      glance: Glance::default(),
      sign: false,
      leaflet_front: false,
      next_look: Instant::now()
    };
    live.place();
    Ok(live)
  }

  fn wait<'a>(shared: &'a Shared, guard: MutexGuard<'a, Inner>, pause: Duration) -> MutexGuard<'a, Inner> {
    shared.wake.wait_timeout(guard, pause).unwrap_or_else(PoisonError::into_inner).0
  }

  /// Until just past the next local midnight, when "hidden for today" ends.
  fn until_tomorrow() -> Duration {
    let now = Local::now();
    let left = 86_400 - i64::from(now.num_seconds_from_midnight());
    Duration::from_secs(left.clamp(1, 86_400) as u64 + 2)
  }

  pub fn start(app: &AppHandle, shared: Arc<Shared>) {
    let handle = app.clone();
    let spawned = std::thread::Builder::new().name("desktop-pip".into()).spawn(move || run(&handle, &shared));
    if let Err(error) = spawned {
      diag::warn(&format!("desktop Pip's thread did not start: {error}"));
    }
  }

  fn run(app: &AppHandle, shared: &Shared) {
    let mut last = Instant::now();
    let mut inner = shared.inner.guard();
    loop {
      if inner.quit {
        inner.live = None;
        drop(inner);
        destroy_window(app);
        return;
      }
      let today = today_key();
      if inner.failed || !present(&inner.wanted, inner.sent_home, &today) {
        if inner.live.take().is_some() {
          drop(inner);
          destroy_window(app);
          inner = shared.inner.guard();
          continue;
        }
        // Nothing to do until she is asked for, or until tomorrow comes.
        inner = wait(shared, inner, until_tomorrow());
        continue;
      }
      if inner.live.is_none() {
        drop(inner);
        let opened = open(app);
        inner = shared.inner.guard();
        match opened {
          Ok(live) => inner.live = Some(live),
          Err(reason) => {
            diag::warn(&format!("desktop Pip's window was not made: {reason}"));
            inner.failed = true;
          }
        }
        last = Instant::now();
        continue;
      }

      let now = Instant::now();
      let dt = now.duration_since(last).as_secs_f64().min(0.1);
      last = now;
      let quiet = inner.wanted.quiet;
      let Inner { live, nudge, .. } = &mut *inner;
      let pause = match live.as_mut() {
        // The window went without her (its page crashed, something closed
        // it): forget it, and the next turn makes another.
        Some(body) if !win::alive(body.hwnd) => {
          *live = None;
          Duration::from_millis(500)
        }
        Some(body) => {
          body.advance(app, dt, now);
          if now >= body.next_look {
            body.look(app, quiet, nudge);
            body.next_look = now + body.look_every();
          }
          body.place();
          body.pace(now)
        }
        None => Duration::ZERO
      };
      inner = wait(shared, inner, pause);
    }
  }
}
