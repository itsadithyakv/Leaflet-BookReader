package com.leaflet.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.webkit.WebView
import androidx.core.content.ContextCompat
import app.tauri.Logger
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.Locale

/**
 * Read aloud on Android (`readers/readAloud/androidEngine.ts` is the page's
 * half): the phone's own text-to-speech reads the sentences the page queues,
 * one utterance each, and says as each starts and ends.
 *
 * The queue is kept here, so the voice reads on with the screen off and
 * Leaflet out of sight, and the notification, the lock screen and a headset's
 * buttons (one MediaSession) can pause it, go a sentence on or back, and stop
 * it without the page. `ReadAloudService` is the media-playback service that
 * keeps Leaflet running meanwhile, with the notification. Audio focus pauses
 * it for a call or other audio (a notification's sound only ducks it), and
 * headphones pulled out pause it.
 *
 * Text-to-speech has no pause: pausing stops the voice and remembers the
 * sentence, and resuming says that sentence again from its start.
 *
 * Everything here runs on the main thread; the engine's callbacks are posted
 * there.
 */
object ReadAloud {
  private data class Item(val id: String, val text: String)

  private val main = Handler(Looper.getMainLooper())
  private var webView: WeakReference<WebView>? = null
  private var app: Context? = null

  private var tts: TextToSpeech? = null
  /** null: starting; true: ready; false: no engine on this phone. */
  private var ready: Boolean? = null
  private val waiting = mutableListOf<(Boolean) -> Unit>()

  private val items = ArrayList<Item>()
  /** The item being read, or paused in. */
  private var at = 0
  private var playing = false
  /** A session is on: the service and the notification are up. */
  private var active = false
  private var rate = 1f

  private var title = ""
  private var author = ""
  private var chapter = ""

  private var session: MediaSession? = null
  private var focusRequest: AudioFocusRequest? = null
  /** Paused for a moment by a call or another app's sound: carry on when it is over. */
  private var resumeOnFocus = false
  private var noisyRegistered = false

  fun attach(view: WebView) {
    webView = WeakReference(view)
    app = view.context.applicationContext
  }

  /** The device plugin's `read_aloud` command: the step is in `op`. */
  fun command(activity: Activity, invoke: Invoke) {
    val args = invoke.getArgs()
    if (app == null) app = activity.applicationContext
    main.post {
      try {
        handle(activity, args.optString("op", ""), args, invoke)
      } catch (error: Exception) {
        Logger.error("read_aloud: ${error.message}")
        invoke.reject(error.message ?: "Read aloud failed.")
      }
    }
  }

  private fun handle(activity: Activity, op: String, args: JSONObject, invoke: Invoke) {
    when (op) {
      "voices" -> whenReady { ok -> invoke.resolve(JSObject().put("engine", ok).put("voices", voiceList())) }
      "speak" -> {
        val list = args.optJSONArray("items")
        val added = ArrayList<Item>()
        if (list != null) {
          for (index in 0 until list.length()) {
            val entry = list.optJSONObject(index) ?: continue
            val text = entry.optString("text", "")
            if (text.isNotBlank()) added.add(Item(entry.optString("id", ""), text))
          }
        }
        val replace = args.optBoolean("replace", false)
        whenReady { ok ->
          if (!ok) {
            emit(JSObject().put("type", "error").put("message", "no engine"))
          } else {
            speak(added, replace)
          }
        }
        invoke.resolve()
      }
      "pause" -> {
        pause(fromPage = true)
        invoke.resolve()
      }
      "resume" -> {
        resume(fromPage = true)
        invoke.resolve()
      }
      "stop" -> {
        stop(fromPage = true)
        invoke.resolve()
      }
      "rate" -> {
        rate = args.optDouble("rate", 1.0).toFloat().coerceIn(0.5f, 2.5f)
        tts?.setSpeechRate(rate)
        updateSession()
        invoke.resolve()
      }
      "voice" -> {
        val name = if (args.isNull("voice")) null else args.optString("voice", "")
        val language = if (args.isNull("language")) null else args.optString("language", "")
        whenReady { ok ->
          if (ok) useVoice(name, language)
          invoke.resolve()
        }
      }
      "info" -> {
        title = args.optString("title", "")
        author = args.optString("author", "")
        chapter = args.optString("chapter", "")
        updateSession()
        invoke.resolve()
      }
      "settings" -> {
        try {
          activity.startActivity(Intent("com.android.settings.TTS_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (error: ActivityNotFoundException) {
          activity.startActivity(Intent(android.provider.Settings.ACTION_SETTINGS))
        }
        invoke.resolve()
      }
      else -> invoke.reject("Unknown read_aloud step: $op")
    }
  }

  // ---- the engine -------------------------------------------------------

  private fun whenReady(then: (Boolean) -> Unit) {
    when (ready) {
      true -> then(true)
      false -> {
        // Asked again: the reader may have installed an engine since.
        ready = null
        tts = null
        waiting.add(then)
        startEngine()
      }
      null -> {
        waiting.add(then)
        if (tts == null) startEngine()
      }
    }
  }

  private fun startEngine() {
    val context = app ?: run {
      ready = false
      flushWaiting(false)
      return
    }
    try {
      tts = TextToSpeech(context) { status ->
        main.post {
          val ok = status == TextToSpeech.SUCCESS
          ready = ok
          if (ok) {
            tts?.setAudioAttributes(
              AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
            )
            tts?.setSpeechRate(rate)
            tts?.setOnUtteranceProgressListener(listener)
          } else {
            Logger.error("read_aloud: text-to-speech did not start ($status)")
            tts?.shutdown()
            tts = null
          }
          flushWaiting(ok)
        }
      }
    } catch (error: Exception) {
      Logger.error("read_aloud: ${error.message}")
      ready = false
      flushWaiting(false)
    }
  }

  private fun flushWaiting(ok: Boolean) {
    val calls = waiting.toList()
    waiting.clear()
    calls.forEach { it(ok) }
  }

  private val listener = object : UtteranceProgressListener() {
    override fun onStart(utteranceId: String?) {
      main.post {
        val index = items.indexOfFirst { it.id == utteranceId }
        if (index < 0 || !playing) return@post
        at = index
        emit(JSObject().put("type", "start").put("id", utteranceId))
      }
    }

    override fun onDone(utteranceId: String?) {
      main.post {
        if (!playing || items.none { it.id == utteranceId }) return@post
        emit(JSObject().put("type", "done").put("id", utteranceId))
      }
    }

    @Deprecated("Deprecated in Java")
    override fun onError(utteranceId: String?) {
      onError(utteranceId, TextToSpeech.ERROR)
    }

    override fun onError(utteranceId: String?, errorCode: Int) {
      main.post {
        if (!playing || items.none { it.id == utteranceId }) return@post
        Logger.error("read_aloud: utterance $utteranceId failed ($errorCode)")
        emit(JSObject().put("type", "error").put("id", utteranceId).put("message", "code $errorCode"))
      }
    }

    // Stopped on purpose (a pause, a skip): nothing to say.
    override fun onStop(utteranceId: String?, interrupted: Boolean) {}
  }

  private fun voiceList(): JSArray {
    val out = JSArray()
    val engine = tts ?: return out
    val voices: Set<Voice> = try {
      engine.voices ?: emptySet()
    } catch (error: Exception) {
      emptySet()
    }
    val preferred = try {
      engine.defaultVoice?.name
    } catch (error: Exception) {
      null
    }
    val installed = voices.filter { voice ->
      !voice.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)
    }
    // Named by language, then a number within it: the engine's own names are codes ("en-us-x-iob-local").
    val counts = HashMap<String, Int>()
    installed
      .sortedWith(compareBy<Voice>({ it.locale.toLanguageTag() }, { it.isNetworkConnectionRequired }, { it.name }))
      .forEach { voice ->
        val tag = voice.locale.toLanguageTag()
        val number = (counts[tag] ?: 0) + 1
        counts[tag] = number
        out.put(
          JSObject()
            .put("id", voice.name)
            .put("name", "${voice.locale.getDisplayName(voice.locale).replaceFirstChar { it.titlecase(voice.locale) }} $number")
            .put("lang", tag)
            .put("online", voice.isNetworkConnectionRequired)
            .put("preferred", voice.name == preferred)
        )
      }
    return out
  }

  private fun useVoice(name: String?, language: String?) {
    val engine = tts ?: return
    val voice = name?.let { wanted -> engine.voices?.firstOrNull { it.name == wanted } }
    if (voice != null) {
      engine.voice = voice
    } else if (!language.isNullOrBlank()) {
      engine.language = Locale.forLanguageTag(language.replace('_', '-'))
    }
  }

  // ---- the queue --------------------------------------------------------

  private fun speak(added: List<Item>, replace: Boolean) {
    if (replace) {
      items.clear()
      items.addAll(added)
      at = 0
      begin()
      playing = true
      speakFrom(at)
      updateSession()
      return
    }
    val from = items.size
    items.addAll(added)
    if (playing) {
      for (index in from until items.size) say(index, TextToSpeech.QUEUE_ADD)
    }
    trim()
  }

  private fun say(index: Int, mode: Int) {
    val item = items.getOrNull(index) ?: return
    tts?.speak(item.text, mode, Bundle(), item.id)
  }

  private fun speakFrom(index: Int) {
    if (index >= items.size) {
      tts?.stop()
      return
    }
    for (next in index until items.size) say(next, if (next == index) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD)
  }

  /** Long sessions: what was read long ago is let go (a sentence back still works for a good while). */
  private fun trim() {
    val drop = at - 200
    if (drop > 0 && items.size > 400) {
      items.subList(0, drop).clear()
      at -= drop
    }
  }

  private fun pause(fromPage: Boolean) {
    if (!playing) return
    playing = false
    tts?.stop()
    updateSession()
    if (!fromPage) emit(JSObject().put("type", "state").put("playing", false))
  }

  private fun resume(fromPage: Boolean) {
    if (playing || items.isEmpty() || !active) return
    if (!requestFocus()) return
    playing = true
    resumeOnFocus = false
    speakFrom(at)
    updateSession()
    if (!fromPage) emit(JSObject().put("type", "state").put("playing", true))
  }

  /** A sentence on or back, from the notification or a headset: within what the page has queued. */
  private fun skip(by: Int) {
    val target = at + by
    if (target < 0 || target >= items.size) return
    at = target
    if (playing) {
      speakFrom(at)
    } else {
      emit(JSObject().put("type", "at").put("id", items[at].id))
    }
  }

  private fun stop(fromPage: Boolean) {
    val wasActive = active
    playing = false
    items.clear()
    at = 0
    tts?.stop()
    end()
    if (!fromPage && wasActive) emit(JSObject().put("type", "stopped"))
  }

  /** From the notification's buttons (ReadAloudService). */
  fun control(action: String) {
    main.post {
      when (action) {
        ReadAloudService.ACTION_PLAY_PAUSE -> if (playing) pause(fromPage = false) else resume(fromPage = false)
        ReadAloudService.ACTION_NEXT -> skip(1)
        ReadAloudService.ACTION_PREVIOUS -> skip(-1)
        ReadAloudService.ACTION_STOP -> stop(fromPage = false)
      }
    }
  }

  // ---- the session: service, notification, focus ---------------------------

  private fun begin() {
    val context = app ?: return
    requestFocus()
    if (!noisyRegistered) {
      ContextCompat.registerReceiver(context, noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED)
      noisyRegistered = true
    }
    if (session == null) {
      session = MediaSession(context, "Leaflet read aloud").apply {
        setCallback(object : MediaSession.Callback() {
          override fun onPlay() = resume(fromPage = false)
          override fun onPause() = pause(fromPage = false)
          override fun onSkipToNext() = skip(1)
          override fun onSkipToPrevious() = skip(-1)
          override fun onStop() = stop(fromPage = false)
        })
        isActive = true
      }
    }
    if (!active) {
      active = true
      ReadAloudService.start(context)
    }
  }

  private fun end() {
    val context = app
    if (noisyRegistered && context != null) {
      try {
        context.unregisterReceiver(noisy)
      } catch (error: IllegalArgumentException) {
        // Not registered after all.
      }
      noisyRegistered = false
    }
    abandonFocus()
    session?.isActive = false
    session?.release()
    session = null
    if (active && context != null) ReadAloudService.stop(context)
    active = false
  }

  /** The MediaSession's state and the notification, as things are now. */
  private fun updateSession() {
    val media = session ?: return
    media.setPlaybackState(
      PlaybackState.Builder()
        .setActions(
          PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
            PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_STOP
        )
        .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, if (playing) rate else 0f)
        .build()
    )
    media.setMetadata(
      MediaMetadata.Builder()
        .putString(MediaMetadata.METADATA_KEY_TITLE, title.ifBlank { "Leaflet" })
        .putString(MediaMetadata.METADATA_KEY_ARTIST, chapter.ifBlank { author })
        .putString(MediaMetadata.METADATA_KEY_ALBUM, author)
        .build()
    )
    app?.let { ReadAloudService.refresh(it) }
  }

  /** For the notification (ReadAloudService). */
  val isPlaying get() = playing
  val bookTitle get() = title
  val subtitle get() = chapter.ifBlank { author }
  val sessionToken get() = session?.sessionToken

  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    main.post {
      when (change) {
        AudioManager.AUDIOFOCUS_LOSS -> {
          resumeOnFocus = false
          pause(fromPage = false)
        }
        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
          if (playing) {
            resumeOnFocus = true
            pause(fromPage = false)
          }
        }
        // A notification's sound: Android lowers the voice itself (Android 8 and on).
        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {}
        AudioManager.AUDIOFOCUS_GAIN -> {
          if (resumeOnFocus) {
            resumeOnFocus = false
            resume(fromPage = false)
          }
        }
      }
    }
  }

  private fun requestFocus(): Boolean {
    val manager = app?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return true
    val result = if (Build.VERSION.SDK_INT >= 26) {
      val request = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(
          AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
        )
        .setOnAudioFocusChangeListener(focusListener, main)
        .build()
      focusRequest = request
      manager.requestAudioFocus(request)
    } else {
      @Suppress("DEPRECATION")
      manager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
    }
    // A call in progress: not now.
    return result != AudioManager.AUDIOFOCUS_REQUEST_FAILED
  }

  private fun abandonFocus() {
    val manager = app?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
    if (Build.VERSION.SDK_INT >= 26) {
      focusRequest?.let { manager.abandonAudioFocusRequest(it) }
    } else {
      @Suppress("DEPRECATION")
      manager.abandonAudioFocus(focusListener)
    }
    resumeOnFocus = false
  }

  /** Headphones pulled out (or a Bluetooth speaker gone): pause, as music apps do. */
  private val noisy = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
        main.post { pause(fromPage = false) }
      }
    }
  }

  // ---- to the page --------------------------------------------------------

  private fun emit(event: JSObject) {
    val view = webView?.get() ?: return
    val script = "(function(){try{window.__leafletReadAloud&&window.__leafletReadAloud($event);}catch(e){}})()"
    view.post { view.evaluateJavascript(script, null) }
  }
}
