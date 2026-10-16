package com.leaflet.app

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Build
import android.util.Base64
import android.webkit.WebView
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import app.tauri.Logger
import app.tauri.annotation.InvokeArg
import java.lang.ref.WeakReference
import kotlin.math.roundToInt

@InvokeArg
class ContinueShortcutArgs {
  lateinit var bookId: String
  lateinit var shortLabel: String
  lateinit var longLabel: String
  /** The cover (the library's small one) as a data URL; none means the app's icon. */
  var coverDataUrl: String? = null
}

/**
 * The app icon's "Continue <book>" shortcut (a long press on Leaflet's icon).
 *
 * The page decides which book and what it says (`platform/continueShortcut.ts`)
 * and sets it or takes it away through `DevicePlugin`; this keeps the one
 * dynamic shortcut, with the book's cover as its icon. A tap on it starts
 * Leaflet with [ACTION] and the book's id, cold or already running: the id is
 * held here until the page takes it, and a running page is nudged to
 * (`window.__leafletContinue`).
 */
object Shortcuts {
  const val ACTION = "com.leaflet.app.CONTINUE"
  const val EXTRA_BOOK_ID = "bookId"
  private const val ID = "continue"
  private const val NUDGE_SCRIPT =
    "(function(){try{window.__leafletContinue&&window.__leafletContinue();}catch(e){}})()"

  @Volatile
  private var pending: String? = null
  private var page: WeakReference<WebView>? = null

  fun attach(webView: WebView) {
    page = WeakReference(webView)
  }

  /** Notes a tapped shortcut's book; false for any other intent. */
  fun receive(context: Context, intent: Intent?): Boolean {
    if (intent == null || intent.action != ACTION || intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) {
      return false
    }
    val bookId = intent.getStringExtra(EXTRA_BOOK_ID)?.takeIf { it.isNotBlank() } ?: return false
    pending = bookId
    try {
      ShortcutManagerCompat.reportShortcutUsed(context, ID)
    } catch (error: Exception) {
      Logger.error("continue shortcut: ${error.message}")
    }
    return true
  }

  /** Tells a loaded page a tapped shortcut is waiting (a page still loading takes it once it is up). */
  fun nudge() {
    val view = page?.get() ?: return
    view.post { view.evaluateJavascript(NUDGE_SCRIPT, null) }
  }

  /** The tapped shortcut's book, once. */
  fun take(): String? {
    val bookId = pending
    pending = null
    return bookId
  }

  fun set(context: Context, args: ContinueShortcutArgs) {
    try {
      val intent = Intent(context, MainActivity::class.java)
        .setAction(ACTION)
        .putExtra(EXTRA_BOOK_ID, args.bookId)
      val shortcut = ShortcutInfoCompat.Builder(context, ID)
        .setShortLabel(args.shortLabel)
        .setLongLabel(args.longLabel)
        .setIcon(icon(context, args.coverDataUrl))
        .setIntent(intent)
        .setRank(0)
        .build()
      ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
    } catch (error: Exception) {
      Logger.error("continue shortcut: ${error.message}")
    }
  }

  fun clear(context: Context) {
    try {
      ShortcutManagerCompat.removeDynamicShortcuts(context, listOf(ID))
    } catch (error: Exception) {
      Logger.error("continue shortcut: ${error.message}")
    }
  }

  private fun icon(context: Context, dataUrl: String?): IconCompat {
    val cover = dataUrl?.let { decode(it) }
    if (cover == null) {
      return IconCompat.createWithResource(context, R.mipmap.ic_launcher)
    }
    val tile = tile(context, cover)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      IconCompat.createWithAdaptiveBitmap(tile)
    } else {
      IconCompat.createWithBitmap(tile)
    }
  }

  private fun decode(dataUrl: String): Bitmap? =
    try {
      val bytes = Base64.decode(dataUrl.substringAfter("base64,"), Base64.DEFAULT)
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (error: Exception) {
      null
    }

  /**
   * The cover on an adaptive icon's 108 dp square, of which a mask shows the
   * middle 72 dp at most (a circle, a squircle). The cover is drawn a little
   * wider than that window, so its width shows nearly whole and no edge
   * shows inside any mask, and from a little above its middle, where the art
   * and the title usually are. A wide cover is drawn by its height instead.
   */
  private fun tile(context: Context, cover: Bitmap): Bitmap {
    val size = (108 * context.resources.displayMetrics.density).roundToInt().coerceIn(108, 432)
    val tile = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(tile)
    canvas.drawColor(Color.rgb(0xFB, 0xF7, 0xEE))
    val window = size * 72f / 108f
    val reach = size * 80f / 108f
    val width = cover.width.toFloat()
    val height = cover.height.toFloat()
    val scale = if (height >= width) reach / width else reach / height
    val drawnWidth = width * scale
    val drawnHeight = height * scale
    val left = (size - drawnWidth) / 2f
    val windowTop = (size - window) / 2f
    val top = if (drawnHeight > window) windowTop - (drawnHeight - window) * 0.3f else (size - drawnHeight) / 2f
    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    canvas.drawBitmap(cover, null, RectF(left, top, left + drawnWidth, top + drawnHeight), paint)
    return tile
  }
}
