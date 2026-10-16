package com.leaflet.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import app.tauri.Logger

/**
 * Keeps Leaflet reading aloud with the screen off or another app in front: a
 * foreground service of the media-playback kind, with the media notification
 * (a sentence back, play or pause, a sentence on, stop) that the lock screen
 * shows too. `ReadAloud` does the reading; this is its notification and its
 * hold on the process, from the first sentence until reading aloud stops.
 */
class ReadAloudService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val action = intent?.action
    if (action != null && action != ACTION_SHOW) {
      ReadAloud.control(action)
      if (action == ACTION_STOP) return START_NOT_STICKY
    }
    try {
      val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0
      ServiceCompat.startForeground(this, NOTIFICATION, build(this), type)
    } catch (error: Exception) {
      // Without it the voice still reads while Leaflet is on screen.
      Logger.error("ReadAloudService: ${error.message}")
      stopSelf()
    }
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Leaflet swiped away from the recent apps: the reading stops with it.
    ReadAloud.control(ACTION_STOP)
    stopSelf()
  }

  companion object {
    const val ACTION_SHOW = "com.leaflet.app.readaloud.SHOW"
    const val ACTION_PLAY_PAUSE = "com.leaflet.app.readaloud.PLAY_PAUSE"
    const val ACTION_NEXT = "com.leaflet.app.readaloud.NEXT"
    const val ACTION_PREVIOUS = "com.leaflet.app.readaloud.PREVIOUS"
    const val ACTION_STOP = "com.leaflet.app.readaloud.STOP"
    private const val CHANNEL = "read-aloud"
    private const val NOTIFICATION = 7302

    fun start(context: Context) {
      val intent = Intent(context, ReadAloudService::class.java).setAction(ACTION_SHOW)
      try {
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      } catch (error: Exception) {
        Logger.error("ReadAloudService: ${error.message}")
      }
    }

    fun stop(context: Context) {
      try {
        context.stopService(Intent(context, ReadAloudService::class.java))
      } catch (error: Exception) {
        Logger.error("ReadAloudService: ${error.message}")
      }
    }

    /** The notification again, as the reading now is (playing or paused, the chapter). */
    fun refresh(context: Context) {
      val manager = context.getSystemService(NotificationManager::class.java) ?: return
      if (manager.activeNotifications.none { it.id == NOTIFICATION }) return
      try {
        manager.notify(NOTIFICATION, build(context))
      } catch (error: SecurityException) {
        // Notifications turned off: the lock screen's controls come from the session regardless.
      }
    }

    private fun button(context: Context, action: String, code: Int): PendingIntent =
      PendingIntent.getService(
        context,
        code,
        Intent(context, ReadAloudService::class.java).setAction(action),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )

    private fun build(context: Context): Notification {
      val builder = if (Build.VERSION.SDK_INT >= 26) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager?.getNotificationChannel(CHANNEL) == null) {
          manager?.createNotificationChannel(
            NotificationChannel(CHANNEL, "Read aloud", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) }
          )
        }
        Notification.Builder(context, CHANNEL)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context)
      }
      val playing = ReadAloud.isPlaying
      val action = { icon: Int, label: String, intent: PendingIntent ->
        Notification.Action.Builder(Icon.createWithResource(context, icon), label, intent).build()
      }
      val style = Notification.MediaStyle().setShowActionsInCompactView(0, 1, 2)
      ReadAloud.sessionToken?.let { style.setMediaSession(it) }
      return builder
        .setSmallIcon(R.drawable.ic_stat_leaflet)
        .setContentTitle(ReadAloud.bookTitle.ifBlank { "Reading aloud" })
        .setContentText(ReadAloud.subtitle)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setOngoing(playing)
        .setCategory(Notification.CATEGORY_TRANSPORT)
        .setContentIntent(
          PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
          )
        )
        .setDeleteIntent(button(context, ACTION_STOP, 5))
        .addAction(action(android.R.drawable.ic_media_previous, "A sentence back", button(context, ACTION_PREVIOUS, 1)))
        .addAction(
          if (playing) {
            action(android.R.drawable.ic_media_pause, "Pause", button(context, ACTION_PLAY_PAUSE, 2))
          } else {
            action(android.R.drawable.ic_media_play, "Play", button(context, ACTION_PLAY_PAUSE, 2))
          }
        )
        .addAction(action(android.R.drawable.ic_media_next, "A sentence on", button(context, ACTION_NEXT, 3)))
        .addAction(action(android.R.drawable.ic_menu_close_clear_cancel, "Stop", button(context, ACTION_STOP, 4)))
        .setStyle(style)
        .build()
    }
  }
}
