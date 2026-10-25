package com.leaflet.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.WebView
import androidx.core.app.AlarmManagerCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import app.tauri.Logger
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Reading reminders on the phone (`src/reminders/phone.rs` is the other half).
 *
 * The Rust side decides what is due and when, and hands over the plan: each
 * alarm with its words, its time, the latest it may still go out, and when it
 * leaves the shade. This side keeps the plan (so a reboot or an update can
 * set it again), sets the alarms, and at fire time checks only what Rust
 * cannot be asked then: is Leaflet in front, was today's goal already met, is
 * it too late, did this kind already go out today.
 *
 * Each alarm is set twice: once in a ten-minute window (on time while the
 * phone is awake) and once allowed while idle (still arrives when the phone
 * is dozing, within the hour). Whichever comes first is shown; the other
 * finds it already sent.
 */
object Reminders {
  const val CHANNEL = "reading-reminders"
  const val ACTION_FIRE = "com.leaflet.app.REMINDER"
  const val ACTION_CONTINUE = "com.leaflet.app.CONTINUE_READING"
  const val ACTION_TEST = "com.leaflet.app.REMINDER_TEST"
  private const val PREFS = "leaflet_reminders"
  private const val TAG = "leaflet-reminder"
  /** Today's plan is at most three, tomorrow's two, and the year's notice one. */
  private const val SLOTS = 8
  private const val WINDOWED = 7300
  private const val WHILE_IDLE = 7320
  private const val TEST_SLOT = 7340
  private const val WINDOW_MS = 10 * 60 * 1000L

  /** Leaflet is on screen. Only this process knows; a process started for an alarm starts with false. */
  @Volatile
  var inFront = false

  /** A tapped notification waiting for the Rust side to listen. */
  @Volatile
  var continuePending = false

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL) != null) {
      return
    }
    val channel = NotificationChannel(CHANNEL, "Reading reminders", NotificationManager.IMPORTANCE_DEFAULT)
    channel.description = "A nudge when today's reading is still to do."
    manager.createNotificationChannel(channel)
  }

  /** Notifications get through: allowed for Leaflet (Android 13+: the permission) and the channel not turned off. */
  fun allowed(context: Context): Boolean {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
      return false
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = context.getSystemService(NotificationManager::class.java)?.getNotificationChannel(CHANNEL)
      if (channel != null && channel.importance == NotificationManager.IMPORTANCE_NONE) {
        return false
      }
    }
    return true
  }

  fun channelBlocked(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return false
    }
    val channel = context.getSystemService(NotificationManager::class.java)?.getNotificationChannel(CHANNEL)
    return channel != null && channel.importance == NotificationManager.IMPORTANCE_NONE
  }

  /** What went out while Leaflet was closed, by the field names of the Rust `FiredLog`. */
  fun fired(context: Context): JSObject {
    val prefs = prefs(context)
    val fired = JSObject()
    for ((kind, field) in FIELDS) {
      prefs.getString("fired_$kind", null)?.let { fired.put(field, it) }
    }
    return fired
  }

  fun state(context: Context): JSObject =
    JSObject().put("allowed", allowed(context)).put("fired", fired(context))

  /** Replaces the plan and the alarms with these. */
  fun schedule(context: Context, alarms: JSONArray, metDate: String?) {
    prefs(context).edit().putString("plan", alarms.toString()).putString("met_date", metDate).apply()
    arm(context, alarms)
  }

  /** After a reboot or an update: the alarms are gone, the plan is not. */
  fun rearm(context: Context) {
    val plan = prefs(context).getString("plan", null) ?: return
    try {
      arm(context, JSONArray(plan))
    } catch (error: Exception) {
      Logger.error("reminders: the stored plan could not be read: ${error.message}")
    }
  }

  private fun arm(context: Context, alarms: JSONArray) {
    val manager = context.getSystemService(AlarmManager::class.java) ?: return
    for (slot in 0 until SLOTS) {
      cancel(context, manager, WINDOWED + slot)
      cancel(context, manager, WHILE_IDLE + slot)
    }
    val prefs = prefs(context)
    val now = System.currentTimeMillis()
    var slot = 0
    for (index in 0 until alarms.length()) {
      val alarm = alarms.optJSONObject(index) ?: continue
      val kind = alarm.optString("kind")
      val day = alarm.optString("dateKey")
      if (alarm.optLong("until") <= now || prefs.getString("fired_$kind", null) == day || slot >= SLOTS) {
        continue
      }
      // A time that passed while the phone was off still goes out, within its hour.
      val at = maxOf(alarm.optLong("at"), now + 1000)
      manager.setWindow(AlarmManager.RTC_WAKEUP, at, WINDOW_MS, firing(context, WINDOWED + slot, alarm))
      AlarmManagerCompat.setAndAllowWhileIdle(manager, AlarmManager.RTC_WAKEUP, at, firing(context, WHILE_IDLE + slot, alarm))
      slot += 1
    }
  }

  private fun firing(context: Context, code: Int, alarm: JSONObject): PendingIntent {
    val intent = Intent(context, ReminderAlarmReceiver::class.java)
      .setAction(ACTION_FIRE)
      .putExtra("alarm", alarm.toString())
    return PendingIntent.getBroadcast(context, code, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun cancel(context: Context, manager: AlarmManager, code: Int) {
    val intent = Intent(context, ReminderAlarmReceiver::class.java).setAction(ACTION_FIRE)
    val existing = PendingIntent.getBroadcast(context, code, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE)
    if (existing != null) {
      manager.cancel(existing)
      existing.cancel()
    }
  }

  /** An alarm went off: shown unless the reader is here, the day is done, or its moment has passed. */
  fun fire(context: Context, alarm: JSONObject) {
    val prefs = prefs(context)
    val kind = alarm.optString("kind")
    val day = alarm.optString("dateKey")
    val test = alarm.optBoolean("test", false)
    val now = System.currentTimeMillis()
    if (!test) {
      // The year's notice is not about the day's goal, so a met day keeps it.
      val met = kind != "year" && prefs.getString("met_date", null) == day
      if (met || prefs.getString("fired_$kind", null) == day) {
        return
      }
    }
    if (now > alarm.optLong("until") || inFront || !allowed(context)) {
      return
    }
    show(context, kind, alarm.optString("title"), alarm.optString("body"), alarm.optLong("expires"))
    if (!test) {
      prefs.edit().putString("fired_$kind", day).apply()
    }
  }

  @SuppressLint("MissingPermission")
  fun show(context: Context, kind: String, title: String, body: String, expires: Long) {
    ensureChannel(context)
    // The year's notice just opens Leaflet (the Library has its key); the rest pick up the book.
    val toBook = kind != "year"
    val open = Intent(context, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (toBook) {
      open.setAction(ACTION_CONTINUE)
    }
    val tap = PendingIntent.getActivity(context, if (toBook) 7360 else 7361, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val builder = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.ic_stat_leaflet)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setContentIntent(tap)
      .setAutoCancel(true)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
    // "Time to read?" still in the shade tomorrow would be wrong.
    val left = expires - System.currentTimeMillis()
    if (left > 0) {
      builder.setTimeoutAfter(left)
    }
    NotificationManagerCompat.from(context).notify(TAG, KIND_IDS[kind] ?: 0, builder.build())
  }

  /** Called from MainActivity with the intent that started it. */
  fun noteLaunch(intent: Intent?) {
    if (isContinue(intent)) {
      continuePending = true
    }
  }

  fun isContinue(intent: Intent?): Boolean =
    intent != null &&
      intent.action == ACTION_CONTINUE &&
      intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY == 0

  /** Debug builds only: a sample through the real alarm path, `seconds` from now. */
  fun armTest(context: Context, seconds: Int) {
    val manager = context.getSystemService(AlarmManager::class.java) ?: return
    val at = System.currentTimeMillis() + seconds * 1000L
    val alarm = JSONObject()
      .put("kind", "daily")
      .put("dateKey", SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(at)))
      .put("title", "Time to read?")
      .put("body", "A test reminder, sent through the phone's alarm clock.")
      .put("at", at)
      .put("until", at + 60 * 60 * 1000L)
      .put("expires", at + 60 * 60 * 1000L)
      .put("test", true)
    AlarmManagerCompat.setAndAllowWhileIdle(manager, AlarmManager.RTC_WAKEUP, at, firing(context, TEST_SLOT, alarm))
  }

  /** Notification tags (the Rust `ReminderKind::tag`) to `FiredLog` fields. */
  private val FIELDS = listOf("daily" to "daily", "streak" to "streakRisk", "close" to "close", "year" to "year")
  private val KIND_IDS = mapOf("daily" to 1, "streak" to 2, "close" to 3, "year" to 4)
}

/** Shows a reminder when its alarm goes off. Only Leaflet's own alarms reach it. */
class ReminderAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Reminders.ACTION_FIRE) {
      return
    }
    val alarm = intent.getStringExtra("alarm") ?: return
    try {
      Reminders.fire(context, JSONObject(alarm))
    } catch (error: Exception) {
      Logger.error("reminders: an alarm could not be shown: ${error.message}")
    }
  }
}

/**
 * Alarms do not survive a reboot or an update of the app: they are set again
 * from the stored plan. A debug build also takes a test from adb here.
 */
class ReminderBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> Reminders.rearm(context)
      Reminders.ACTION_TEST -> if (BuildConfig.DEBUG) {
        Reminders.ensureChannel(context)
        Reminders.armTest(context, intent.getIntExtra("seconds", 60).coerceIn(5, 3600))
      }
    }
  }
}

/**
 * The commands the Rust side calls (`reminders/phone.rs`), and the two things
 * it is told: a notification was tapped ("activation") and Leaflet came to the
 * front or left it ("lifecycle"), when the plan is handed over again.
 */
@TauriPlugin(
  permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")]
)
class RemindersPlugin(private val activity: Activity) : Plugin(activity) {
  override fun load(webView: WebView) {
    super.load(webView)
    Reminders.ensureChannel(activity)
    // Added now, the observer is first brought up to where the activity is.
    (activity as? LifecycleOwner)?.lifecycle?.addObserver(LifecycleEventObserver { _, event ->
      when (event) {
        Lifecycle.Event.ON_START -> {
          Reminders.inFront = true
          lifecycle("front")
        }
        Lifecycle.Event.ON_STOP -> {
          Reminders.inFront = false
          lifecycle("away")
        }
        else -> {}
      }
    })
  }

  override fun onNewIntent(intent: Intent) {
    if (Reminders.isContinue(intent)) {
      Reminders.continuePending = true
      flushActivation()
    }
  }

  @Command
  override fun registerListener(invoke: Invoke) {
    super.registerListener(invoke)
    flushActivation()
  }

  private fun lifecycle(state: String) {
    if (hasListener("lifecycle")) {
      trigger("lifecycle", JSObject().put("state", state))
    }
  }

  private fun flushActivation() {
    if (Reminders.continuePending && hasListener("activation")) {
      Reminders.continuePending = false
      trigger("activation", JSObject())
    }
  }

  @Command
  fun state(invoke: Invoke) {
    invoke.resolve(Reminders.state(activity))
  }

  @Command
  fun schedule(invoke: Invoke) {
    try {
      val args = invoke.getArgs()
      val alarms = args.optJSONArray("alarms") ?: JSONArray()
      val metDate = if (args.isNull("metDate")) null else args.optString("metDate")
      Reminders.schedule(activity, alarms, metDate)
      invoke.resolve()
    } catch (error: Exception) {
      invoke.reject("The reminders couldn't be set: ${error.message}")
    }
  }

  @Command
  fun show(invoke: Invoke) {
    val args = invoke.getArgs()
    if (!Reminders.allowed(activity)) {
      invoke.reject("Notifications for Leaflet are off.")
      return
    }
    Reminders.show(activity, args.optString("kind"), args.optString("title"), args.optString("body"), 0)
    invoke.resolve()
  }

  /** Android 13+ asks; earlier versions have nothing to ask (the answer is in `allowed`). */
  @Command
  fun requestNotifications(invoke: Invoke) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || Reminders.allowed(activity) ||
      activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED
    ) {
      invoke.resolve(Reminders.state(activity))
      return
    }
    requestPermissionForAlias("notifications", invoke, "notificationsAnswered")
  }

  @PermissionCallback
  private fun notificationsAnswered(invoke: Invoke) {
    invoke.resolve(Reminders.state(activity))
  }

  /** The phone's page for Leaflet's notifications (the reminders channel's, when only that is off). */
  @Command
  fun openSettings(invoke: Invoke) {
    activity.runOnUiThread {
      val intent = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && NotificationManagerCompat.from(activity).areNotificationsEnabled() &&
          Reminders.channelBlocked(activity) ->
          Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
            .putExtra(Settings.EXTRA_CHANNEL_ID, Reminders.CHANNEL)
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ->
          Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
        else ->
          Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${activity.packageName}"))
      }
      try {
        activity.startActivity(intent)
        invoke.resolve()
      } catch (error: Exception) {
        try {
          activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${activity.packageName}")))
          invoke.resolve()
        } catch (again: Exception) {
          invoke.reject("The phone's settings couldn't be opened.")
        }
      }
    }
  }
}
