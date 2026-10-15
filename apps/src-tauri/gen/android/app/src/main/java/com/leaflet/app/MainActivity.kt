package com.leaflet.app

import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.util.Locale

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  /** The last insets, in CSS px, so they can be sent again to a page that loaded after them. */
  private var insetsScript: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // A tapped reading reminder opened Leaflet: noted before the plugins load
    // (the device plugin replaces the launch intent once it has read it).
    if (savedInstanceState == null) {
      Reminders.noteLaunch(intent)
    }
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView

    // Back (the button and the edge swipe) goes to the page first: it closes the
    // top sheet, panel or book (`platform/back.ts`). Only when the page answers
    // that it had nothing to close does Leaflet go to the background, as other
    // apps do from their first screen.
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val view = this@MainActivity.webView
        if (view == null) {
          moveTaskToBack(true)
          return
        }
        view.evaluateJavascript(BACK_SCRIPT) { answer ->
          if (answer != "true") {
            moveTaskToBack(true)
          }
        }
      }
    })

    // The WebView is handed over before it is put on screen: watch the insets
    // from its container once it has one.
    if (webView.parent != null) {
      watchInsets(webView)
    } else {
      webView.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
        override fun onViewAttachedToWindow(view: View) {
          view.removeOnAttachStateChangeListener(this)
          watchInsets(webView)
        }

        override fun onViewDetachedFromWindow(view: View) {}
      })
    }

    // The page may load after the first insets arrive; the Rust side asks again
    // after each page load, and these catch a slow first load.
    for (delay in longArrayOf(400, 1200, 3000, 6000)) {
      webView.postDelayed({ sendInsets() }, delay)
    }
  }

  /**
   * Edge to edge, the page is told where the bars, the cutout and the keyboard
   * are. The keyboard resizes the WebView (bottom padding on its container):
   * with edge-to-edge, `adjustResize` no longer does it, and a resized page is
   * the one where a focused field near the bottom is scrolled into view by the
   * WebView itself. So the keyboard covers none of the page, `--inset-keyboard`
   * stays 0, and `data-keyboard` says whether it is open.
   */
  private fun watchInsets(webView: WebView) {
    val container = (webView.parent as? View) ?: webView
    ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val keyboardOpen = insets.isVisible(WindowInsetsCompat.Type.ime()) && ime.bottom > 0
      val keyboardPadding = if (keyboardOpen) ime.bottom else 0
      if (view.paddingBottom != keyboardPadding) {
        view.setPadding(0, 0, 0, keyboardPadding)
      }
      val density = resources.displayMetrics.density
      fun css(px: Int) = String.format(Locale.US, "%.2f", px / density)
      // With the keyboard up the page ends at the keyboard, above the gesture bar.
      val bottom = if (keyboardOpen) 0 else bars.bottom
      insetsScript = "(function(){var w=window;" +
        "if(w.__leafletInsets){w.__leafletInsets({top:${css(bars.top)},right:${css(bars.right)},bottom:${css(bottom)},left:${css(bars.left)},keyboard:0});}" +
        "if(document.documentElement){document.documentElement.dataset.keyboard='${if (keyboardOpen) "open" else "closed"}';}" +
        "})()"
      sendInsets()
      insets
    }
    ViewCompat.requestApplyInsets(container)
  }

  /** Sends the last insets to the page again (it ignores them until it has loaded). */
  fun sendInsets() {
    val view = webView ?: return
    val script = insetsScript ?: return
    view.post { view.evaluateJavascript(script, null) }
  }

  companion object {
    private const val BACK_SCRIPT =
      "(function(){try{return !!(window.__leafletBack&&window.__leafletBack());}catch(e){return false;}})()"
  }
}
