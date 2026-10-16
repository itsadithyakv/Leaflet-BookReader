package com.leaflet.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import app.tauri.Logger

/**
 * Keeps Leaflet awake while the reader signs in to Google Drive.
 *
 * Drive's sign-in comes back to a small server Leaflet runs on the phone
 * (127.0.0.1, `sync/drive.rs`). The browser is in front all that time, and
 * Android, sooner on some phones than others, pauses an app behind it: the
 * browser's return then waited on a paused app until it gave up ("took too
 * long to respond"). A foreground service of the short kind is Android's own
 * answer for a task like this: a quiet notification while it lasts, ended the
 * moment the browser comes back, and by Android itself after about three
 * minutes in any case.
 */
class SignInKeeper : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE else 0
      ServiceCompat.startForeground(this, NOTIFICATION, notification(), type)
    } catch (error: Exception) {
      // Without it, sign-in is as it was: it works wherever the phone lets
      // Leaflet be.
      Logger.error("SignInKeeper: ${error.message}")
      stopSelf()
    }
    return START_NOT_STICKY
  }

  // A short service has to end when Android says its time is up, or the app
  // is stopped. The sign-in itself goes on waiting (`AUTH_TIMEOUT`).
  override fun onTimeout(startId: Int) = stopSelf()

  override fun onTimeout(startId: Int, fgsType: Int) = stopSelf()

  private fun notification() = NotificationCompat.Builder(this, channel())
    .setSmallIcon(R.drawable.ic_stat_leaflet)
    .setContentTitle("Connecting Google Drive…")
    .setOngoing(true)
    .setSilent(true)
    .setCategory(NotificationCompat.CATEGORY_PROGRESS)
    .setContentIntent(
      PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
    )
    .build()

  private fun channel(): String {
    if (Build.VERSION.SDK_INT >= 26) {
      val manager = getSystemService(NotificationManager::class.java)
      if (manager?.getNotificationChannel(CHANNEL) == null) {
        manager?.createNotificationChannel(
          NotificationChannel(CHANNEL, "Connecting Google Drive", NotificationManager.IMPORTANCE_LOW)
        )
      }
    }
    return CHANNEL
  }

  companion object {
    private const val CHANNEL = "drive-sign-in"
    private const val NOTIFICATION = 7301

    /** On while Drive's sign-in is out in the browser; off when it is back, or abandoned. */
    fun hold(context: Context, on: Boolean) {
      val intent = Intent(context, SignInKeeper::class.java)
      try {
        if (!on) {
          context.stopService(intent)
        } else if (Build.VERSION.SDK_INT >= 26) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (error: Exception) {
        Logger.error("SignInKeeper: ${error.message}")
      }
    }
  }
}
