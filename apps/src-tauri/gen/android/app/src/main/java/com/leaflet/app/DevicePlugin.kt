package com.leaflet.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.pm.ActivityInfo
import android.net.Uri
import android.provider.OpenableColumns
import android.view.WindowManager
import android.webkit.MimeTypeMap
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import androidx.core.content.IntentCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.Logger
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicLong

@InvokeArg
class KeepAwakeArgs {
  var on: Boolean = false
}

@InvokeArg
class LockRotationArgs {
  var lock: String = "auto"
}

@InvokeArg
class SystemBarsArgs {
  var hidden: Boolean = false
}

@InvokeArg
class PickFilesArgs {
  var kind: String = "books"
  var multiple: Boolean = true
}

@InvokeArg
class ShareFileArgs {
  lateinit var path: String
  var mime: String? = null
  var title: String? = null
}

@InvokeArg
class ShareTextArgs {
  lateinit var text: String
  var title: String? = null
}

@InvokeArg
class ShareTargetArgs {
  lateinit var name: String
}

/**
 * What only Android can do for Leaflet (`platform/android.ts` is the other
 * half): the screen kept on, the rotation held, the system bars hidden, the
 * system picker and share sheet, Google Play, and books arriving from other
 * apps ("Open with", "Share to Leaflet").
 *
 * Android hands over `content://` addresses, not paths, so everything picked
 * or received is copied into Leaflet's cache first and the copy's path is what
 * the Rust side imports (it then keeps its own copy, so the cache can go).
 */
@TauriPlugin
class DevicePlugin(private val activity: Activity) : Plugin(activity) {
  private val opened = mutableListOf<String>()
  private val batch = AtomicLong(0)

  override fun load(webView: WebView) {
    super.load(webView)
    receive(activity.intent)
    // Handled once: a later re-creation of the activity must not import it again.
    activity.intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
  }

  override fun onNewIntent(intent: Intent) {
    receive(intent)
  }

  @Command
  fun keepAwake(invoke: Invoke) {
    val args = invoke.parseArgs(KeepAwakeArgs::class.java)
    activity.runOnUiThread {
      if (args.on) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
      invoke.resolve()
    }
  }

  @Command
  fun lockRotation(invoke: Invoke) {
    val args = invoke.parseArgs(LockRotationArgs::class.java)
    activity.runOnUiThread {
      activity.requestedOrientation = when (args.lock) {
        "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        // With the phone, as far as the phone's own rotation lock allows.
        else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
      }
      invoke.resolve()
    }
  }

  @Command
  fun hideSystemBars(invoke: Invoke) {
    val args = invoke.parseArgs(SystemBarsArgs::class.java)
    activity.runOnUiThread {
      val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
      controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      if (args.hidden) {
        controller.hide(WindowInsetsCompat.Type.systemBars())
      } else {
        controller.show(WindowInsetsCompat.Type.systemBars())
      }
      invoke.resolve()
    }
  }

  @Command
  fun pickFiles(invoke: Invoke) {
    val args = invoke.parseArgs(PickFilesArgs::class.java)
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      putExtra(Intent.EXTRA_MIME_TYPES, if (args.kind == "font") FONT_TYPES else BOOK_PICK_TYPES)
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, args.multiple)
    }
    try {
      startActivityForResult(invoke, intent, "picked")
    } catch (error: ActivityNotFoundException) {
      invoke.reject("This phone has no file picker.")
    }
  }

  @ActivityCallback
  fun picked(invoke: Invoke, result: ActivityResult) {
    val data = result.data
    if (result.resultCode != Activity.RESULT_OK || data == null) {
      invoke.resolveObject(emptyList<String>())
      return
    }
    val uris = urisOf(data)
    // Off the main thread: a comic can be hundreds of megabytes.
    Thread {
      val paths = copyIn(uris, "picked")
      invoke.resolveObject(paths)
    }.start()
  }

  /** A fresh path in the cache for a file about to be shared (a picture, a sheet). */
  @Command
  fun shareTarget(invoke: Invoke) {
    val args = invoke.parseArgs(ShareTargetArgs::class.java)
    val dir = File(activity.cacheDir, "shared")
    dir.mkdirs()
    prune(dir, 10 * 60 * 1000L)
    invoke.resolveObject(File(dir, safeName(args.name, null)).absolutePath)
  }

  @Command
  fun shareFile(invoke: Invoke) {
    val args = invoke.parseArgs(ShareFileArgs::class.java)
    val file = File(args.path)
    val cache = activity.cacheDir.canonicalFile
    if (!file.isFile || !file.canonicalFile.startsWith(cache)) {
      invoke.reject("That file can't be shared.")
      return
    }
    activity.runOnUiThread {
      try {
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
        val send = Intent(Intent.ACTION_SEND).apply {
          type = args.mime ?: "application/octet-stream"
          putExtra(Intent.EXTRA_STREAM, uri)
          args.title?.let { putExtra(Intent.EXTRA_TITLE, it) }
          clipData = ClipData.newRawUri(args.title ?: file.name, uri)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.startActivity(Intent.createChooser(send, args.title))
        invoke.resolve()
      } catch (error: Exception) {
        Logger.error("share_file: ${error.message}")
        invoke.reject("That file couldn't be shared.")
      }
    }
  }

  @Command
  fun shareText(invoke: Invoke) {
    val args = invoke.parseArgs(ShareTextArgs::class.java)
    activity.runOnUiThread {
      val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, args.text)
        args.title?.let { putExtra(Intent.EXTRA_TITLE, it) }
      }
      try {
        activity.startActivity(Intent.createChooser(send, args.title))
        invoke.resolve()
      } catch (error: ActivityNotFoundException) {
        invoke.reject("Nothing on this phone can share that.")
      }
    }
  }

  @Command
  fun openStore(invoke: Invoke) {
    activity.runOnUiThread {
      val id = activity.packageName
      val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$id"))
      val web = Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$id"))
      try {
        activity.startActivity(market)
        invoke.resolve()
      } catch (noStore: ActivityNotFoundException) {
        try {
          activity.startActivity(web)
          invoke.resolve()
        } catch (noBrowser: ActivityNotFoundException) {
          invoke.reject("Google Play couldn't be opened.")
        }
      }
    }
  }

  /** Asked by the Rust side after each page load: the page may have missed the first insets. */
  @Command
  fun resendInsets(invoke: Invoke) {
    (activity as? MainActivity)?.sendInsets()
    invoke.resolve()
  }

  /** The Rust side listens for "opened" at start; anything that arrived before then is sent now. */
  @Command
  override fun registerListener(invoke: Invoke) {
    super.registerListener(invoke)
    flushOpened()
  }

  // ---- books from other apps ----------------------------------------------

  private fun receive(intent: Intent?) {
    if (intent == null || intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) {
      return
    }
    val uris = when (intent.action) {
      Intent.ACTION_VIEW -> listOfNotNull(intent.data)
      Intent.ACTION_SEND ->
        listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
          .ifEmpty { urisOf(intent) }
      Intent.ACTION_SEND_MULTIPLE ->
        (IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java) ?: arrayListOf())
          .toList()
          .ifEmpty { urisOf(intent) }
      else -> emptyList()
    }
    if (uris.isEmpty()) {
      return
    }
    Thread {
      val paths = copyIn(uris, "opened")
      synchronized(opened) { opened.addAll(paths) }
      flushOpened()
    }.start()
  }

  private fun flushOpened() {
    if (!hasListener("opened")) {
      return
    }
    val paths = synchronized(opened) {
      val taken = opened.toList()
      opened.clear()
      taken
    }
    if (paths.isNotEmpty()) {
      trigger("opened", JSObject().put("paths", JSArray(paths)))
    }
  }

  // ---- copying in ---------------------------------------------------------

  private fun urisOf(data: Intent): List<Uri> {
    val clip = data.clipData
    if (clip != null && clip.itemCount > 0) {
      return (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
    }
    return listOfNotNull(data.data)
  }

  /** Copies each stream into `<cache>/<folder>/<batch>/<its own name>`; the ones that could not be read are left out. */
  private fun copyIn(uris: List<Uri>, folder: String): List<String> {
    val root = File(activity.cacheDir, folder)
    prune(root, 24 * 60 * 60 * 1000L)
    val dir = File(root, "${System.currentTimeMillis()}-${batch.incrementAndGet()}")
    val paths = mutableListOf<String>()
    for (uri in uris) {
      try {
        val name = safeName(displayName(uri), activity.contentResolver.getType(uri))
        val sub = File(dir, paths.size.toString())
        sub.mkdirs()
        val target = File(sub, name)
        val input = activity.contentResolver.openInputStream(uri) ?: continue
        input.use { source -> FileOutputStream(target).use { source.copyTo(it, 256 * 1024) } }
        paths.add(target.absolutePath)
      } catch (error: Exception) {
        Logger.error("Leaflet could not copy $uri: ${error.message}")
      }
    }
    return paths
  }

  private fun displayName(uri: Uri): String? {
    if (uri.scheme == "file") {
      return uri.lastPathSegment
    }
    return try {
      activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
      } ?: uri.lastPathSegment
    } catch (error: Exception) {
      uri.lastPathSegment
    }
  }

  /** A name safe on disk, with an extension (from the type) when the sender gave none. */
  private fun safeName(name: String?, mime: String?): String {
    var clean = (name ?: "")
      .substringAfterLast('/')
      .replace(Regex("[\\\\:*?\"<>|\\u0000-\\u001f]"), "_")
      .trim()
      .trimStart('.')
    if (clean.isEmpty()) {
      clean = "book"
    }
    if (!clean.contains('.') && mime != null) {
      val extension = EXTENSION_FOR_TYPE[mime] ?: MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
      if (extension != null) {
        clean = "$clean.$extension"
      }
    }
    if (clean.length > 150) {
      val extension = clean.substringAfterLast('.', "")
      clean = clean.take(140) + if (extension.isNotEmpty() && extension.length < 9) ".$extension" else ""
    }
    return clean
  }

  /** Removes what is older than `age` in `dir` (earlier picks, shares long since made). */
  private fun prune(dir: File, age: Long) {
    val before = System.currentTimeMillis() - age
    dir.listFiles()?.forEach { entry ->
      if (entry.lastModified() < before) {
        entry.deleteRecursively()
      }
    }
  }

  companion object {
    /** Types offered for books; the importer has the last word on what is one. */
    val BOOK_TYPES = arrayOf(
      "application/epub+zip",
      "application/pdf",
      "application/x-cbz",
      "application/vnd.comicbook+zip",
      "application/x-cbr",
      "application/vnd.comicbook-rar",
      "application/x-mobipocket-ebook",
      "application/vnd.amazon.ebook",
      "application/vnd.amazon.mobi8-ebook",
      "application/x-fictionbook+xml",
      "text/plain"
    )

    /** The picker also offers files whose type the phone does not know (Kindle files often come so). */
    val BOOK_PICK_TYPES = BOOK_TYPES + arrayOf("application/octet-stream", "application/zip", "application/vnd.rar", "application/x-rar-compressed")

    val FONT_TYPES = arrayOf(
      "font/ttf",
      "font/otf",
      "font/sfnt",
      "font/woff",
      "font/woff2",
      "application/x-font-ttf",
      "application/x-font-otf",
      "application/font-sfnt",
      "application/vnd.ms-opentype",
      "application/octet-stream"
    )

    private val EXTENSION_FOR_TYPE = mapOf(
      "application/epub+zip" to "epub",
      "application/pdf" to "pdf",
      "application/x-cbz" to "cbz",
      "application/vnd.comicbook+zip" to "cbz",
      "application/x-cbr" to "cbr",
      "application/vnd.comicbook-rar" to "cbr",
      "application/x-mobipocket-ebook" to "mobi",
      "application/vnd.amazon.ebook" to "azw",
      "application/vnd.amazon.mobi8-ebook" to "azw3",
      "application/x-fictionbook+xml" to "fb2",
      "text/plain" to "txt"
    )
  }
}
