//! Desktop Pip: Pip outside the app, standing on the taskbar's top edge.
//!
//! Pure, like the reminders and the habit engine. Every rule takes rectangles,
//! a scale and a time as data: where she stands on a monitor, a step of her
//! walk and where it turns, a fall, whether a window fills the screen, whether
//! her sign is up. So they are tested without a screen, a clock or Windows.
//! `runtime` gathers the inputs and moves her window; `win` is the handful of
//! Win32 calls that needs.
//!
//! Units: everything on screen is in physical pixels, as Windows reports it
//! to a per-monitor DPI aware process. Her own sizes are in art pixels (the
//! sprite is 32 of them square) and become physical through [`per_pixel`], so
//! at any scaling one art pixel is a whole number of device pixels.

use crate::reminders::{self, Reminder, ReminderKind};
use chrono::{Duration, NaiveDateTime};
use serde::{Deserialize, Serialize};

pub mod runtime;
#[cfg(windows)]
mod win;

/// Her window's label (and the name of her page, `desktop-pip.html`).
pub const WINDOW_LABEL: &str = "desktop-pip";
/// The sprite, in art pixels.
pub const SPRITE: i32 = 32;
/// The largest her window gets (the menu open above her), in art pixels.
pub const WIDEST: i32 = 88;
pub const TALLEST: i32 = 84;
/// Art pixels a second: the pace of the Pip that walks about inside the app
/// (46 CSS pixels a second at 64).
pub const WALK_SPEED: f64 = 23.0;
/// Art pixels a second squared, as in the app (2600 CSS pixels at 64).
pub const GRAVITY: f64 = 1300.0;
/// The fastest a throw counts for, art pixels a second.
pub const MAX_THROW: f64 = 1400.0;
/// Landing faster than this she bounces once...
pub const BOUNCE_SPEED: f64 = 260.0;
/// ...and faster than this she lands flat (the page plays the splat).
pub const SPLAT_SPEED: f64 = 650.0;
/// A sign stays up this long once it has been seen on screen.
pub const SIGN_HOLD_MINUTES: i64 = 5;

/// Device pixels per art pixel at a display scale (1.0 is 100%).
///
/// The same sum as `pixelScale(64)` in `components/PipSprite.tsx`, which draws
/// her: two device pixels per art pixel at 100%, and never a fraction, so the
/// window Rust sizes is exactly the canvas the page draws.
pub fn per_pixel(scale: f64) -> i32 {
  let scale = if scale.is_finite() { scale } else { 1.0 };
  ((2.0 * scale + 1e-6).floor() as i32).max(1)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub struct Rect {
  pub left: i32,
  pub top: i32,
  pub right: i32,
  pub bottom: i32
}

impl Rect {
  pub fn new(left: i32, top: i32, right: i32, bottom: i32) -> Self {
    Self { left, top, right, bottom }
  }

  pub fn width(&self) -> i32 {
    self.right - self.left
  }

  pub fn height(&self) -> i32 {
    self.bottom - self.top
  }

  pub fn contains(&self, x: i32, y: i32) -> bool {
    x >= self.left && x < self.right && y >= self.top && y < self.bottom
  }

  fn within(&self, outer: &Rect) -> bool {
    self.left >= outer.left && self.top >= outer.top && self.right <= outer.right && self.bottom <= outer.bottom
  }
}

/// Which side of the screen the taskbar takes, read off the work area.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskbarEdge {
  Bottom,
  Top,
  Left,
  Right,
  /// The work area is the whole monitor: an auto-hiding taskbar, or none.
  Hidden
}

/// The side with the most taken off it. Not `SHAppBarMessage`: that only knows
/// the primary monitor's taskbar, and the work area is what a window has to
/// keep to on every monitor anyway.
pub fn taskbar_edge(monitor: Rect, work: Rect) -> TaskbarEdge {
  let gaps = [
    (TaskbarEdge::Bottom, monitor.bottom - work.bottom),
    (TaskbarEdge::Top, work.top - monitor.top),
    (TaskbarEdge::Left, work.left - monitor.left),
    (TaskbarEdge::Right, monitor.right - work.right)
  ];
  gaps
    .into_iter()
    .filter(|(_, gap)| *gap > 0)
    .max_by_key(|(_, gap)| *gap)
    .map(|(edge, _)| edge)
    .unwrap_or(TaskbarEdge::Hidden)
}

/// Where she can be on one monitor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stage {
  pub monitor: Rect,
  /// The line her feet stand on: the bottom of the work area.
  pub ground: i32,
  /// How far her feet may go either way along it.
  pub min_x: i32,
  pub max_x: i32,
  pub per_pixel: i32,
  pub edge: TaskbarEdge
}

/// The stage a monitor gives her.
///
/// She stands on the bottom of the work area. With the taskbar at the bottom
/// that is its top edge; with it at the top or a side, or hiding itself, it is
/// the bottom of the screen, and a side taskbar shortens her walk instead.
/// She keeps half her widest window from each end, so the menu and the sign
/// open centred on her without hanging off the monitor (or onto the next).
pub fn stage_for(monitor: Rect, work: Rect, scale: f64) -> Stage {
  let per_pixel = per_pixel(scale);
  // Mid-change (a monitor unplugged, the taskbar moving) Windows can report
  // a work area that is empty or not on its monitor: stand on the screen.
  let work = if work.width() > 0 && work.height() > 0 && work.within(&monitor) { work } else { monitor };
  let margin = (WIDEST / 2 + 2) * per_pixel;
  let (mut min_x, mut max_x) = (work.left + margin, work.right - margin);
  if min_x > max_x {
    min_x = (work.left + work.right) / 2;
    max_x = min_x;
  }
  Stage { monitor, ground: work.bottom, min_x, max_x, per_pixel, edge: taskbar_edge(monitor, work) }
}

/// Where a newcomer starts: four fifths of the way along, near the clock.
pub fn start_x(stage: &Stage) -> f64 {
  f64::from(stage.min_x) + f64::from(stage.max_x - stage.min_x) * 0.8
}

/// The corner she keeps to when motion is reduced.
pub fn corner_x(stage: &Stage) -> f64 {
  f64::from(stage.max_x)
}

/// What her window holds, in art pixels: herself, or herself under a sign or
/// a menu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Frame {
  pub width: i32,
  pub height: i32
}

impl Frame {
  pub const PLAIN: Frame = Frame { width: SPRITE, height: SPRITE };

  /// Never smaller than she is, never larger than the menu needs, and an even
  /// width, so she stays centred on a whole device pixel.
  pub fn clamped(self) -> Self {
    let width = self.width.clamp(SPRITE, WIDEST);
    Frame { width: width - width % 2, height: self.height.clamp(SPRITE, TALLEST) }
  }
}

/// Her window for feet at (x, y): centred on her, growing upward.
pub fn frame_rect(feet_x: i32, feet_y: i32, frame: Frame, per_pixel: i32) -> Rect {
  let width = frame.width * per_pixel;
  let height = frame.height * per_pixel;
  let left = feet_x - width / 2;
  Rect { left, top: feet_y - height, right: left + width, bottom: feet_y }
}

/// One step of a walk toward `target`: where her feet are after `dt` seconds,
/// and whether she has arrived. The target is kept on her stage.
pub fn walk_step(x: f64, target: f64, dt: f64, stage: &Stage) -> (f64, bool) {
  let target = target.clamp(f64::from(stage.min_x), f64::from(stage.max_x));
  let reach = WALK_SPEED * f64::from(stage.per_pixel) * dt.max(0.0);
  if (target - x).abs() <= reach {
    (target, true)
  } else {
    (x + reach * (target - x).signum(), false)
  }
}

/// Where a stroll goes, and which way she faces for it.
///
/// On the way she is facing (the other way with `turn`), between two and ten
/// of her own widths as `roll` (0 to 1) says. With less than half a width of
/// room that way (the end of her edge: the side of the screen, or where the
/// next monitor begins) she turns round first. Off her stage, she heads back
/// onto it.
pub fn stroll_target(x: f64, facing: i8, stage: &Stage, roll: f64, turn: bool) -> (f64, i8) {
  let unit = f64::from(SPRITE * stage.per_pixel);
  let (min, max) = (f64::from(stage.min_x), f64::from(stage.max_x));
  let mut facing: i8 = if (facing < 0) != turn { -1 } else { 1 };
  if x < min {
    facing = 1;
  } else if x > max {
    facing = -1;
  } else {
    let room = if facing > 0 { max - x } else { x - min };
    if room < unit / 2.0 {
      facing = -facing;
    }
  }
  let roll = if roll.is_finite() { roll.clamp(0.0, 1.0) } else { 0.5 };
  let stride = unit * (2.0 + 8.0 * roll);
  ((x + f64::from(facing) * stride).clamp(min, max), facing)
}

/// Her feet in the air: where, and how fast, in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Body {
  pub x: f64,
  pub y: f64,
  pub vx: f64,
  pub vy: f64
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Fall {
  pub body: Body,
  pub landed: bool,
  /// She has had her one bounce.
  pub bounced: bool,
  /// How hard she met the ground, in art pixels a second (0 until she does).
  pub impact: f64
}

/// A moment of a fall: gravity, the sides and top of her monitor (she bounces
/// off them, so a throw never leaves the screen she was let go on), and the
/// ground, off which she bounces once if she came down fast.
pub fn fall_step(body: Body, dt: f64, stage: &Stage, bounced: bool) -> Fall {
  let scale = f64::from(stage.per_pixel);
  let half = f64::from(SPRITE / 2) * scale;
  let dt = dt.clamp(0.0, 0.1);
  let Body { mut x, mut y, mut vx, mut vy } = body;
  vy += GRAVITY * scale * dt;
  x += vx * dt;
  y += vy * dt;
  let (left, right) = (f64::from(stage.monitor.left) + half, f64::from(stage.monitor.right) - half);
  if x < left {
    x = left;
    vx = vx.abs() * 0.45;
  } else if x > right {
    x = right;
    vx = -vx.abs() * 0.45;
  }
  let ceiling = f64::from(stage.monitor.top) + f64::from(SPRITE) * scale;
  if y < ceiling && vy < 0.0 {
    y = ceiling;
    vy = vy.abs() * 0.3;
  }
  let ground = f64::from(stage.ground);
  if y < ground {
    return Fall { body: Body { x, y, vx, vy }, landed: false, bounced, impact: 0.0 };
  }
  let impact = vy.max(0.0) / scale;
  if impact > BOUNCE_SPEED && !bounced {
    return Fall { body: Body { x, y: ground, vx: vx * 0.6, vy: -vy * 0.32 }, landed: false, bounced: true, impact };
  }
  Fall { body: Body { x, y: ground, vx: 0.0, vy: 0.0 }, landed: true, bounced, impact }
}

/// How fast the hand was going as it let go: over the last tenth of a second
/// of `samples` (seconds, x, y), capped at the fastest throw.
pub fn release_velocity(samples: &[(f64, f64, f64)], now: f64, per_pixel: i32) -> (f64, f64) {
  let recent: Vec<&(f64, f64, f64)> = samples.iter().filter(|sample| now - sample.0 <= 0.11).collect();
  let (Some(first), Some(last)) = (recent.first(), recent.last()) else {
    return (0.0, 0.0);
  };
  let dt = last.0 - first.0;
  if dt <= 0.004 {
    return (0.0, 0.0);
  }
  let cap = MAX_THROW * f64::from(per_pixel);
  (((last.1 - first.1) / dt).clamp(-cap, cap), ((last.2 - first.2) / dt).clamp(-cap, cap))
}

/// Slower than this at letting go (art pixels a second) is a drop, not a throw.
pub const TOSS_MIN: f64 = 220.0;

pub fn is_toss(velocity: (f64, f64), per_pixel: i32) -> bool {
  velocity.0.hypot(velocity.1) >= TOSS_MIN * f64::from(per_pixel)
}

/// Whether a window fills a monitor edge to edge.
pub fn covers(window: Rect, monitor: Rect) -> bool {
  monitor.within(&window)
}

/// Whether the window in front is a full-screen app on her monitor: a game, a
/// film, a presentation, Leaflet's own focus lock. She hides while it lasts.
///
/// A maximised window is not one, though with an auto-hiding taskbar it
/// covers the monitor just the same: it keeps its title bar style, and a
/// full-screen window has none. The desktop itself covers the monitor too.
pub fn full_screen(window: Rect, captioned: bool, shell: bool, monitor: Rect) -> bool {
  !shell && !captioned && covers(window, monitor)
}

/// Where the pointer is from her: which side, whether above her head, and
/// whether it is close enough for her to look at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub struct Glance {
  pub side: i8,
  pub up: bool,
  pub near: bool
}

/// She notices the pointer within about three of her widths either side, from
/// well above her head to the taskbar under her feet.
pub fn glance(feet_x: i32, ground: i32, cursor: (i32, i32), per_pixel: i32) -> Glance {
  let dx = cursor.0 - feet_x;
  let dy = ground - cursor.1;
  let art = |pixels: i32| pixels * per_pixel;
  if dx.abs() > art(100) || dy > art(110) || dy < -art(30) {
    return Glance::default();
  }
  Glance {
    side: if dx.abs() <= art(8) { 0 } else if dx < 0 { -1 } else { 1 },
    up: dy > art(SPRITE + 4),
    near: true
  }
}

/// What the reader chose, as the main window reports it. Kept by the webview
/// (`leaflet.desktopPip.*`), on this device only.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Wanted {
  /// The switch in Settings. Off until the reader turns it on.
  pub enabled: bool,
  /// The local day ("2026-03-03") she was hidden for, from her menu.
  pub hidden_on: Option<String>,
  /// Pip is off everywhere (Settings, "Off"): then out here too.
  pub pip_off: bool,
  /// Quiet Pip: she stands about, but does not stroll or fidget.
  pub quiet: bool
}

/// Whether she is out on the desktop at all. "Hide for today" ends with the
/// day; "Send her home" (`sent_home`) lasts until Leaflet next starts or the
/// reader calls her back.
pub fn present(wanted: &Wanted, sent_home: bool, today: &str) -> bool {
  wanted.enabled && !wanted.pip_off && !sent_home && wanted.hidden_on.as_deref() != Some(today)
}

/// A reminder she is holding a sign up for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Nudge {
  pub kind: ReminderKind,
  /// The local day the reminder is about.
  pub date_key: String,
  pub fired_at: NaiveDateTime,
  /// When the sign was first up where it could be seen. She may have been
  /// hidden behind a full-screen app when the reminder came.
  pub shown_at: Option<NaiveDateTime>,
  /// Clicked, or put away with her.
  pub put_down: bool
}

/// What the sign says. Short: it is a little sign.
pub fn sign_text(kind: ReminderKind) -> &'static str {
  match kind {
    ReminderKind::Daily => "time to read?",
    ReminderKind::StreakRisk => "your streak!",
    ReminderKind::Close => "so close!"
  }
}

/// The nudge for a reminder the scheduler has just sent, unless she has held
/// a sign for that reminder already.
///
/// There is no clock of her own here. `reminders::due_now` decides that a
/// reminder goes out (the reader's time, the goal not met, not at night, not
/// while reading, once a day per kind); she is told in the same breath as the
/// toast is shown, and only refuses a repeat.
pub fn nudge_for(reminder: &Reminder, last: Option<&Nudge>, now: NaiveDateTime) -> Option<Nudge> {
  if last.is_some_and(|last| last.kind == reminder.kind && last.date_key == reminder.date_key) {
    return None;
  }
  Some(Nudge {
    kind: reminder.kind,
    date_key: reminder.date_key.clone(),
    fired_at: now,
    shown_at: None,
    put_down: false
  })
}

/// Whether the sign is up at `now`.
///
/// It is held for [`SIGN_HOLD_MINUTES`] from when it could first be seen, and
/// the reminders' own limits end it early: a reminder an hour old has had its
/// moment (`CATCH_UP_MINUTES`), and nothing is said at night.
pub fn sign_up(nudge: &Nudge, now: NaiveDateTime) -> bool {
  if nudge.put_down || now < nudge.fired_at || reminders::in_quiet_hours(now) {
    return false;
  }
  if now >= nudge.fired_at + Duration::minutes(reminders::CATCH_UP_MINUTES) {
    return false;
  }
  nudge.shown_at.is_none_or(|shown| now < shown + Duration::minutes(SIGN_HOLD_MINUTES))
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::reminders::{due_now, Activity, FiredLog, HabitView, PipVoice, ReminderSettings};
  use chrono::NaiveDate;

  const FULL_HD: Rect = Rect { left: 0, top: 0, right: 1920, bottom: 1080 };

  fn at(key: &str, hour: u32, minute: u32) -> NaiveDateTime {
    NaiveDate::parse_from_str(key, "%Y-%m-%d").unwrap().and_hms_opt(hour, minute, 0).unwrap()
  }

  fn bottom_taskbar(monitor: Rect, height: i32) -> Rect {
    Rect { bottom: monitor.bottom - height, ..monitor }
  }

  // ---- scale ---------------------------------------------------------------

  #[test]
  fn an_art_pixel_is_a_whole_number_of_device_pixels_at_every_scaling() {
    // (scale, device pixels per art pixel): the same table as the page's test
    // (desktop-pip/geometry.test.ts), which has to agree.
    for (scale, expected) in [(1.0, 2), (1.25, 2), (1.5, 3), (1.75, 3), (2.0, 4), (2.25, 4), (2.5, 5), (3.0, 6)] {
      assert_eq!(per_pixel(scale), expected, "at {scale}");
    }
    assert_eq!(per_pixel(0.3), 1, "never less than one");
    assert_eq!(per_pixel(f64::NAN), 2);
  }

  // ---- where she stands ----------------------------------------------------

  #[test]
  fn she_stands_on_the_top_edge_of_a_bottom_taskbar() {
    let stage = stage_for(FULL_HD, bottom_taskbar(FULL_HD, 48), 1.0);
    assert_eq!(stage.edge, TaskbarEdge::Bottom);
    assert_eq!(stage.ground, 1032);
    assert_eq!(stage.per_pixel, 2);
    let window = frame_rect(960, stage.ground, Frame::PLAIN, stage.per_pixel);
    assert_eq!(window, Rect::new(928, 968, 992, 1032), "64 device pixels square, sitting on the taskbar");
  }

  #[test]
  fn a_top_or_side_taskbar_leaves_her_the_bottom_of_the_screen() {
    let top = stage_for(FULL_HD, Rect { top: 48, ..FULL_HD }, 1.0);
    assert_eq!((top.edge, top.ground), (TaskbarEdge::Top, 1080));

    let left = stage_for(FULL_HD, Rect { left: 62, ..FULL_HD }, 1.0);
    assert_eq!((left.edge, left.ground), (TaskbarEdge::Left, 1080));
    assert!(left.min_x >= 62 + 16 * 2, "her walk starts clear of the taskbar: {}", left.min_x);

    let right = stage_for(FULL_HD, Rect { right: 1920 - 62, ..FULL_HD }, 1.0);
    assert_eq!((right.edge, right.ground), (TaskbarEdge::Right, 1080));
    assert!(right.max_x <= 1920 - 62 - 16 * 2);
  }

  #[test]
  fn an_auto_hiding_taskbar_means_the_screens_own_edge() {
    let stage = stage_for(FULL_HD, FULL_HD, 1.0);
    assert_eq!((stage.edge, stage.ground), (TaskbarEdge::Hidden, 1080));
  }

  #[test]
  fn the_stage_follows_the_scaling() {
    // 4K at 150%: the taskbar is 72 device pixels, an art pixel is three.
    let monitor = Rect::new(0, 0, 3840, 2160);
    let stage = stage_for(monitor, bottom_taskbar(monitor, 72), 1.5);
    assert_eq!((stage.ground, stage.per_pixel), (2088, 3));
    let window = frame_rect(1000, stage.ground, Frame::PLAIN, stage.per_pixel);
    assert_eq!((window.width(), window.height(), window.bottom), (96, 96, 2088));

    // 125% draws her no larger than 100% does (two device pixels), which is
    // what the sprite does everywhere else in the app.
    assert_eq!(stage_for(FULL_HD, FULL_HD, 1.25).per_pixel, 2);
    assert_eq!(stage_for(FULL_HD, FULL_HD, 2.0).per_pixel, 4);
  }

  #[test]
  fn a_second_monitor_left_of_the_first_has_its_own_stage() {
    // Left of the primary, so its pixels are negative; taller, and at 125%.
    let monitor = Rect::new(-2560, -200, 0, 1240);
    let stage = stage_for(monitor, bottom_taskbar(monitor, 60), 1.25);
    assert_eq!(stage.ground, 1180);
    assert!(stage.min_x > -2560 && stage.max_x < 0);
    assert!(f64::from(stage.min_x) < start_x(&stage) && start_x(&stage) < f64::from(stage.max_x));
  }

  #[test]
  fn the_widest_window_never_leaves_her_monitor() {
    for scale in [1.0, 1.25, 1.5, 1.75, 2.0] {
      let stage = stage_for(FULL_HD, bottom_taskbar(FULL_HD, 48), scale);
      let widest = Frame { width: WIDEST, height: TALLEST };
      for x in [stage.min_x, stage.max_x] {
        let window = frame_rect(x, stage.ground, widest, stage.per_pixel);
        assert!(window.within(&FULL_HD), "{window:?} at {scale}");
        // She is in the middle of it, on a whole device pixel.
        assert_eq!((window.width() - SPRITE * stage.per_pixel) % 2, 0);
      }
    }
  }

  #[test]
  fn a_work_area_that_makes_no_sense_is_ignored() {
    let elsewhere = Rect::new(4000, 0, 5000, 900);
    let stage = stage_for(FULL_HD, elsewhere, 1.0);
    assert_eq!((stage.ground, stage.edge), (1080, TaskbarEdge::Hidden));
    let empty = stage_for(FULL_HD, Rect::default(), 1.0);
    assert_eq!(empty.ground, 1080);
    // A monitor too narrow for her margins still gives her one place to stand.
    let sliver = Rect::new(0, 0, 120, 600);
    let stage = stage_for(sliver, sliver, 1.0);
    assert_eq!((stage.min_x, stage.max_x), (60, 60));
  }

  #[test]
  fn a_frame_is_never_smaller_than_she_is_or_larger_than_the_menu() {
    assert_eq!(Frame { width: 5, height: 500 }.clamped(), Frame { width: SPRITE, height: TALLEST });
    assert_eq!(Frame { width: 9000, height: 0 }.clamped(), Frame { width: WIDEST, height: SPRITE });
    assert_eq!(Frame { width: 61, height: 50 }.clamped().width, 60, "an even width keeps her centred");
  }

  // ---- the walk ------------------------------------------------------------

  #[test]
  fn she_walks_at_her_pace_and_stops_on_the_spot() {
    let stage = stage_for(FULL_HD, bottom_taskbar(FULL_HD, 48), 1.0);
    // A twelfth of a second at 100%: 23 art pixels a second is 46 device ones.
    let (x, arrived) = walk_step(500.0, 900.0, 1.0 / 12.0, &stage);
    assert!((x - (500.0 + 46.0 / 12.0)).abs() < 1e-9 && !arrived);
    let (x, arrived) = walk_step(898.0, 900.0, 1.0 / 12.0, &stage);
    assert_eq!((x, arrived), (900.0, true));
    // Leftward, and at 200% twice as many device pixels for the same stride.
    let wide = stage_for(Rect::new(0, 0, 3840, 2160), Rect::new(0, 0, 3840, 2064), 2.0);
    let (x, _) = walk_step(1000.0, 200.0, 0.5, &wide);
    assert!((x - (1000.0 - 46.0)).abs() < 1e-9);
  }

  #[test]
  fn a_walk_never_leaves_the_stage() {
    let stage = stage_for(FULL_HD, FULL_HD, 1.0);
    let mut x = f64::from(stage.max_x) - 10.0;
    let mut arrived = false;
    for _ in 0..200 {
      (x, arrived) = walk_step(x, 99_999.0, 1.0 / 12.0, &stage);
    }
    assert_eq!((x, arrived), (f64::from(stage.max_x), true));
  }

  #[test]
  fn a_stroll_keeps_going_the_way_she_faces_and_turns_at_the_end_of_the_edge() {
    let stage = stage_for(FULL_HD, FULL_HD, 1.0);
    let (min, max) = (f64::from(stage.min_x), f64::from(stage.max_x));
    // Mid-edge, facing right: on she goes, two widths at the least.
    let (target, facing) = stroll_target(900.0, 1, &stage, 0.0, false);
    assert_eq!((target, facing), (900.0 + 128.0, 1));
    // A long stroll near the end stops at the end.
    let (target, facing) = stroll_target(max - 200.0, 1, &stage, 1.0, false);
    assert_eq!((target, facing), (max, 1));
    // At the end, she turns round.
    let (target, facing) = stroll_target(max, 1, &stage, 0.5, false);
    assert_eq!(facing, -1);
    assert!(target < max);
    let (_, facing) = stroll_target(min, -1, &stage, 0.5, false);
    assert_eq!(facing, 1);
    // Asked to turn mid-edge, she does; asked at an end she is facing away
    // from, the end wins.
    assert_eq!(stroll_target(900.0, 1, &stage, 0.2, true).1, -1);
    assert_eq!(stroll_target(max, -1, &stage, 0.2, true).1, -1);
  }

  #[test]
  fn another_monitor_is_the_end_of_her_edge() {
    // Two monitors side by side: her edge on the left one ends where the
    // right one begins, and she turns there rather than walking across.
    let left = Rect::new(0, 0, 1920, 1080);
    let stage = stage_for(left, bottom_taskbar(left, 48), 1.0);
    let mut x = 1700.0;
    let mut facing = 1;
    let mut furthest: f64 = 0.0;
    for _ in 0..40 {
      let (target, way) = stroll_target(x, facing, &stage, 0.9, false);
      facing = way;
      let mut arrived = false;
      while !arrived {
        (x, arrived) = walk_step(x, target, 1.0 / 12.0, &stage);
        furthest = furthest.max(x);
      }
    }
    assert!(furthest <= f64::from(stage.max_x), "{furthest}");
    assert!(stage.max_x < 1920 - 16 * 2, "her whole body stays on her own monitor");
  }

  #[test]
  fn dropped_off_her_stage_she_walks_back_onto_it() {
    let stage = stage_for(FULL_HD, FULL_HD, 1.0);
    let (target, facing) = stroll_target(20.0, -1, &stage, 0.0, false);
    assert_eq!(facing, 1);
    assert!(target >= f64::from(stage.min_x));
    let (target, facing) = stroll_target(1915.0, 1, &stage, 0.0, false);
    assert_eq!((target, facing), (1915.0 - 128.0, -1));
    assert!(target <= f64::from(stage.max_x));
  }

  // ---- the fall --------------------------------------------------------------

  fn settle(mut body: Body, stage: &Stage) -> (Body, f64, usize) {
    let mut bounced = false;
    let mut hardest: f64 = 0.0;
    for frame in 0..2000 {
      let fall = fall_step(body, 1.0 / 60.0, stage, bounced);
      body = fall.body;
      bounced = fall.bounced;
      hardest = hardest.max(fall.impact);
      if fall.landed {
        return (body, hardest, frame);
      }
    }
    panic!("never landed: {body:?}");
  }

  #[test]
  fn let_go_she_falls_back_to_the_taskbar() {
    let stage = stage_for(FULL_HD, bottom_taskbar(FULL_HD, 48), 1.0);
    let (body, impact, frames) = settle(Body { x: 700.0, y: 400.0, vx: 0.0, vy: 0.0 }, &stage);
    assert_eq!((body.x, body.y), (700.0, 1032.0));
    assert!(impact > SPLAT_SPEED, "from that high she lands flat: {impact}");
    assert!(frames < 120, "and it takes under two seconds: {frames}");
    // Set down a hand's width above the taskbar: no bounce, no splat.
    let (body, impact, _) = settle(Body { x: 700.0, y: 1010.0, vx: 0.0, vy: 0.0 }, &stage);
    assert_eq!(body.y, 1032.0);
    assert!(impact < BOUNCE_SPEED, "{impact}");
  }

  #[test]
  fn a_throw_stays_on_the_monitor_she_was_let_go_on() {
    let stage = stage_for(FULL_HD, bottom_taskbar(FULL_HD, 48), 1.0);
    let mut body = Body { x: 1800.0, y: 300.0, vx: 2800.0, vy: -2000.0 };
    let mut bounced = false;
    for _ in 0..2000 {
      let fall = fall_step(body, 1.0 / 60.0, &stage, bounced);
      body = fall.body;
      bounced = fall.bounced;
      assert!(body.x >= 32.0 && body.x <= 1920.0 - 32.0, "{body:?}");
      assert!(body.y >= 64.0 && body.y <= 1032.0, "{body:?}");
      if fall.landed {
        return;
      }
    }
    panic!("never landed");
  }

  #[test]
  fn the_speed_of_the_hand_as_it_lets_go() {
    // 300 device pixels in a tenth of a second, rightward and a little up.
    let samples: Vec<(f64, f64, f64)> = (0..=10).map(|i| (f64::from(i) * 0.01, f64::from(i) * 30.0, -f64::from(i) * 5.0)).collect();
    let (vx, vy) = release_velocity(&samples, 0.1, 2);
    assert!((vx - 2800.0).abs() < 1e-6, "capped at the fastest throw: {vx}");
    assert!((vy + 500.0).abs() < 1e-6);
    assert!(is_toss((vx, vy), 2));
    // A hand that stopped before letting go drops her.
    let still: Vec<(f64, f64, f64)> = (0..=10).map(|i| (f64::from(i) * 0.01, 400.0, 300.0)).collect();
    assert_eq!(release_velocity(&still, 0.1, 2), (0.0, 0.0));
    assert!(!is_toss((0.0, 0.0), 2));
    // Old samples say nothing about now.
    assert_eq!(release_velocity(&samples, 5.0, 2), (0.0, 0.0));
    assert_eq!(release_velocity(&[], 0.0, 2), (0.0, 0.0));
  }

  // ---- full screen ---------------------------------------------------------

  #[test]
  fn a_full_screen_window_is_one_with_no_title_bar_that_fills_her_monitor() {
    // A borderless game, a film, a slide show.
    assert!(full_screen(FULL_HD, false, false, FULL_HD));
    // A maximised window with an auto-hiding taskbar covers the monitor too
    // (and overhangs it by its frame), but keeps its title bar style.
    assert!(!full_screen(Rect::new(-8, -8, 1928, 1088), true, false, FULL_HD));
    // An ordinary window, borderless or not.
    assert!(!full_screen(Rect::new(100, 100, 900, 700), false, false, FULL_HD));
    // The desktop itself is not an app.
    assert!(!full_screen(FULL_HD, false, true, FULL_HD));
    // Full screen on the other monitor is not over her.
    assert!(!full_screen(Rect::new(1920, 0, 3840, 1080), false, false, FULL_HD));
  }

  // ---- the pointer ---------------------------------------------------------

  #[test]
  fn she_looks_at_a_pointer_that_comes_near() {
    let (x, ground, scale) = (1000, 1032, 2);
    assert_eq!(glance(x, ground, (300, 500), scale), Glance::default());
    assert_eq!(glance(x, ground, (1100, 1010), scale), Glance { side: 1, up: false, near: true });
    assert_eq!(glance(x, ground, (900, 900), scale), Glance { side: -1, up: true, near: true });
    assert_eq!(glance(x, ground, (1004, 900), scale), Glance { side: 0, up: true, near: true });
    // On the taskbar just under her feet counts; the far side of the screen does not.
    assert!(glance(x, ground, (1050, 1060), scale).near);
    assert!(!glance(x, ground, (1050, 300), scale).near);
  }

  // ---- whether she is out --------------------------------------------------

  #[test]
  fn she_is_off_until_switched_on() {
    assert!(!present(&Wanted::default(), false, "2026-03-03"));
    let on = Wanted { enabled: true, ..Wanted::default() };
    assert!(present(&on, false, "2026-03-03"));
    assert!(!present(&on, true, "2026-03-03"), "sent home");
    assert!(!present(&Wanted { pip_off: true, ..on.clone() }, false, "2026-03-03"), "Pip is off everywhere");
  }

  #[test]
  fn hidden_for_today_she_is_back_tomorrow() {
    let hidden = Wanted { enabled: true, hidden_on: Some("2026-03-03".into()), ..Wanted::default() };
    assert!(!present(&hidden, false, "2026-03-03"));
    assert!(present(&hidden, false, "2026-03-04"));
  }

  // ---- the nudge -----------------------------------------------------------

  fn habit(key: &str, minutes: f64, goal: i64) -> HabitView {
    HabitView { date_key: key.into(), minutes, goal, met: minutes >= goal as f64, streak: 3, last_session_end: None }
  }

  fn daily_at_seven() -> ReminderSettings {
    ReminderSettings { daily: true, daily_at: 19 * 60, asked: true, ..ReminderSettings::default() }
  }

  /// The scheduler's minute, as `reminders::runtime::tick` runs it: what is
  /// due goes out and is logged, and she is told.
  fn minute(settings: &ReminderSettings, habit: &HabitView, log: &mut FiredLog, held: &mut Option<Nudge>, now: NaiveDateTime) -> bool {
    let Some(due) = due_now(settings, PipVoice::Chatty, habit, Activity::default(), log, now) else {
      return false;
    };
    log.mark(due.reminder.kind, &due.reminder.date_key);
    match nudge_for(&due.reminder, held.as_ref(), now) {
      Some(nudge) => {
        *held = Some(nudge);
        true
      }
      None => false
    }
  }

  #[test]
  fn the_sign_goes_up_at_the_readers_reminder_time_when_the_goal_is_not_met() {
    let (mut log, mut held) = (FiredLog::default(), None);
    let unread = habit("2026-03-03", 5.0, 20);
    assert!(!minute(&daily_at_seven(), &unread, &mut log, &mut held, at("2026-03-03", 18, 59)));
    assert!(minute(&daily_at_seven(), &unread, &mut log, &mut held, at("2026-03-03", 19, 0)));
    let nudge = held.clone().unwrap();
    assert_eq!(sign_text(nudge.kind), "time to read?");
    assert!(sign_up(&nudge, at("2026-03-03", 19, 0)));
  }

  #[test]
  fn no_nudge_with_reminders_off_or_the_goal_met() {
    let (mut log, mut held) = (FiredLog::default(), None);
    let unread = habit("2026-03-03", 5.0, 20);
    for hour in 7..23 {
      assert!(!minute(&ReminderSettings::default(), &unread, &mut log, &mut held, at("2026-03-03", hour, 0)));
    }
    let done = habit("2026-03-03", 25.0, 20);
    assert!(!minute(&daily_at_seven(), &done, &mut log, &mut held, at("2026-03-03", 19, 0)));
    assert_eq!(held, None);
  }

  #[test]
  fn she_never_nags_twice_for_one_reminder() {
    let (mut log, mut held) = (FiredLog::default(), None);
    let unread = habit("2026-03-03", 5.0, 20);
    assert!(minute(&daily_at_seven(), &unread, &mut log, &mut held, at("2026-03-03", 19, 0)));
    // The scheduler's own log stops the next minute...
    for minute_past in 1..60 {
      assert!(!minute(&daily_at_seven(), &unread, &mut log, &mut held, at("2026-03-03", 19, minute_past)));
    }
    // ...and were the log lost (it is a settings row), she would still refuse.
    let mut fresh = FiredLog::default();
    assert!(!minute(&daily_at_seven(), &unread, &mut fresh, &mut held, at("2026-03-03", 19, 30)));
    // Tomorrow's reminder is another reminder.
    let tomorrow = habit("2026-03-04", 0.0, 20);
    assert!(minute(&daily_at_seven(), &tomorrow, &mut fresh, &mut held, at("2026-03-04", 19, 0)));
  }

  #[test]
  fn the_sign_is_held_for_a_while_and_then_put_down() {
    let mut nudge = nudge_for(
      &reminders::compose(ReminderKind::Daily, PipVoice::Chatty, 15, 0, "2026-03-03"),
      None,
      at("2026-03-03", 19, 0)
    )
    .unwrap();
    nudge.shown_at = Some(at("2026-03-03", 19, 0));
    assert!(sign_up(&nudge, at("2026-03-03", 19, 4)));
    assert!(!sign_up(&nudge, at("2026-03-03", 19, 5)));
    // Clicked: down at once.
    nudge.shown_at = Some(at("2026-03-03", 19, 0));
    nudge.put_down = true;
    assert!(!sign_up(&nudge, at("2026-03-03", 19, 1)));
  }

  #[test]
  fn a_sign_kept_back_by_a_full_screen_app_goes_up_after_it_if_the_moment_has_not_passed() {
    let reminder = reminders::compose(ReminderKind::StreakRisk, PipVoice::Chatty, 15, 4, "2026-03-03");
    let mut nudge = nudge_for(&reminder, None, at("2026-03-03", 22, 0)).unwrap();
    assert_eq!(sign_text(nudge.kind), "your streak!");
    // The film ends at 22:40: still inside the reminders' own hour of grace.
    assert!(sign_up(&nudge, at("2026-03-03", 22, 40)));
    nudge.shown_at = Some(at("2026-03-03", 22, 40));
    assert!(sign_up(&nudge, at("2026-03-03", 22, 44)));
    assert!(!sign_up(&nudge, at("2026-03-03", 22, 45)));
    // Never into the night, whatever is left of the five minutes.
    nudge.shown_at = Some(at("2026-03-03", 22, 58));
    assert!(sign_up(&nudge, at("2026-03-03", 22, 59)));
    assert!(!sign_up(&nudge, at("2026-03-03", 23, 0)));
    // And a film that runs past the hour takes the moment with it.
    let daily = reminders::compose(ReminderKind::Daily, PipVoice::Chatty, 15, 4, "2026-03-03");
    let late = nudge_for(&daily, None, at("2026-03-03", 19, 0)).unwrap();
    assert!(sign_up(&late, at("2026-03-03", 19, 59)));
    assert!(!sign_up(&late, at("2026-03-03", 20, 0)));
  }
}
