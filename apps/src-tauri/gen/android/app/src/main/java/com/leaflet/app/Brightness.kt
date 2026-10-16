package com.leaflet.app

import android.app.Activity
import android.provider.Settings
import android.view.WindowManager
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.JSObject

@InvokeArg
class BrightnessArgs {
  /** The window's own brightness, 0.01 to 1; null gives it back to the system. */
  var level: Double? = null
}

/**
 * The reader's brightness (`readers/readingLight.ts` is the other half): a
 * swipe up or down the left edge of the page sets this window's brightness,
 * which lasts only while Leaflet is in front and leaves the phone's own
 * setting alone. Below the lowest the screen can go the page dims itself with
 * a dark veil, so this never goes under `MIN`. Leaving the reader gives the
 * window back to the system (`level` null).
 */
object Brightness {
  /** The lowest a window is given: 0 is "off" on some phones. */
  const val MIN = 0.01f

  /** Sets the window's brightness on the UI thread, and answers with the phone's own setting (0 to 1, roughly) for the page to start from. */
  fun set(activity: Activity, level: Double?, done: (JSObject) -> Unit) {
    activity.runOnUiThread {
      val attributes = activity.window.attributes
      attributes.screenBrightness = level?.toFloat()?.coerceIn(MIN, 1f) ?: WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
      activity.window.attributes = attributes
      val answer = JSObject()
      answer.put("system", system(activity))
      done(answer)
    }
  }

  /** The phone's brightness setting as a share of its range (Android keeps it as 0 to 255). */
  private fun system(activity: Activity): Double =
    try {
      Settings.System.getInt(activity.contentResolver, Settings.System.SCREEN_BRIGHTNESS).coerceIn(0, 255) / 255.0
    } catch (missing: Settings.SettingNotFoundException) {
      0.5
    }
}
