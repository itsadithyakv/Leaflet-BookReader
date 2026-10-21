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
import android.os.SystemClock
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
 * half): the phone's own text-to-speech reads the items the page queues (a
 * paragraph, or a sentence), one utterance each after the silence each asks
 * for, and says as each starts and ends and (Android 8 and on) which word it
 * is at.
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
 * word it was at, and resuming says the item on from that word (from its
 * start, where the engine says nothing of its words).
 *
 * The Studio voice (a voice id "neural:…", `StudioVoice.kt`) is another
 * engine behind the same queue, session, notification, focus and service: it
 * is given the items from where the voice is, says when each starts, each
 * sentence of it and when it is done, and pauses where it is (resuming goes on
 * from the very sample). When it cannot go on, the phone's own voice reads on
 * from there, and the page is told (an error, "studio: …").
 *
 * Everything here runs on the main thread; the engine's callbacks are posted
 * there.
 */
object ReadAloud {
  private class Item(val id: String, val text: String, val silence: Long, val marks: IntArray, val phonemes: Array<String?>?) {
    /** Where in `text` the utterance being said starts (resumed part of the way in), so its word offsets are the item's. */
    var base = 0
  }

  /** The silence before an item is an utterance of its own, by this name. */
  private const val GAP = "#gap"

  private val main = Handler(Looper.getMainLooper())
  private var webView: WeakReference<WebView>? = null
  private var app: Context? = null

  private var tts: TextToSpeech? = null
  /** The queue given to `tts`, bumped at each flush: its callbacks of an older one are not this reading's (`UtteranceIds`). */
  @Volatile private var generation = 0
  /** null: starting; true: ready; false: no engine on this phone. */
  private var ready: Boolean? = null
  private val waiting = mutableListOf<(Boolean) -> Unit>()

  private val items = ArrayList<Item>()
  /** The item being read, or paused in (or the next, in the silence before it). */
  private var at = 0
  /** Where the voice is in that item: the start of the last word it said. */
  private var heard = 0
  /** When it started (for "back": the start of this item, or the one before). */
  private var startedAt = 0L
  /** The item that last started (`startedAt` is its time). */
  private var startedId: String? = null
  private var playing = false
  /** A session is on: the service and the notification are up. */
  private var active = false
  private var rate = 1f

  private var title = ""
  private var author = ""
  private var chapter = ""

  /** Reading in the Studio voice (null: the phone's own). */
  private var studio: StudioVoice.Voice? = null
  /** The language last asked for: the phone's voice for it, should the Studio voice fail. */
  private var language: String? = null
  /** Seconds until the Studio voice can start (it is preparing the chapter), or null. */
  private var preparing: Int? = null

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
    StudioVoice.init(activity)
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
      "voices" -> whenReady { ok ->
        val list = voiceList()
        val studioVoices = StudioVoice.voiceList(activity)
        for (index in 0 until studioVoices.length()) list.put(studioVoices.get(index))
        invoke.resolve(JSObject().put("engine", ok || studioVoices.length() > 0).put("voices", list))
      }
      "speak" -> {
        val added = itemsOf(args)
        val replace = args.optBoolean("replace", false)
        if (studio != null) {
          speak(added, replace)
        } else {
          whenReady { ok ->
            if (!ok) {
              emit(JSObject().put("type", "error").put("message", "no engine"))
            } else {
              speak(added, replace)
            }
          }
        }
        invoke.resolve()
      }
      // The Studio voice, on a phone that prepares a chapter first: these made ahead, quietly, before reading starts.
      "prepare" -> {
        val voice = if (args.isNull("voice")) null else args.optString("voice", "")
        if (args.has("bookId") && !args.isNull("bookId")) StudioVoice.setBook(args.optString("bookId", ""))
        if (voice != null && voice.startsWith(StudioVoice.PREFIX) && !active) {
          StudioVoice.warm(activity, itemsOf(args).map { utterance(it) }, voice, args.optDouble("rate", rate.toDouble()).toFloat())
        }
        invoke.resolve()
      }
      // The book closed: what was prepared for it goes.
      "forget" -> {
        if (!active) StudioVoice.forget()
        invoke.resolve()
      }
      // The Studio voice here: libraries, pack, memory, pace (the Settings card).
      "studio" -> invoke.resolve(StudioVoice.support(activity))
      // After the pack is installed: one sentence made and timed (the page records it with studio_voice_record_self_test).
      "studioSelfTest" -> {
        val voice = if (args.isNull("voice")) null else args.optString("voice", "")
        StudioVoice.selfTest(activity, voice) { result, error ->
          if (result != null) invoke.resolve(result) else invoke.reject(error ?: "Self-test failed.")
        }
      }
      // Whether a download now would be on a metered network (mobile data).
      "network" -> {
        val manager = activity.getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager
        val metered = try {
          manager?.isActiveNetworkMetered ?: false
        } catch (error: SecurityException) {
          false
        }
        invoke.resolve(JSObject().put("metered", metered))
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
        // (The Studio voice takes it from the next reading the page starts, which a new speed always is.)
        updateSession()
        invoke.resolve()
      }
      "voice" -> {
        val name = if (args.isNull("voice")) null else args.optString("voice", "")
        val language = if (args.isNull("language")) null else args.optString("language", "")
        this.language = language
        val chosen = if (name != null && name.startsWith(StudioVoice.PREFIX) && StudioVoice.usable(activity)) StudioVoice.voice(name) else null
        if (chosen != null) {
          switchEngine(chosen)
          invoke.resolve()
        } else {
          whenReady { ok ->
            switchEngine(null)
            if (ok) useVoice(if (name != null && name.startsWith(StudioVoice.PREFIX)) null else name, language)
            invoke.resolve()
          }
        }
      }
      "info" -> {
        title = args.optString("title", "")
        author = args.optString("author", "")
        chapter = args.optString("chapter", "")
        val book = if (args.has("bookId") && !args.isNull("bookId")) args.optString("bookId", "") else ""
        StudioVoice.setBook(book.ifBlank { Integer.toHexString("$title|$author".hashCode()) })
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

  private fun itemsOf(args: JSONObject): List<Item> {
    val list = args.optJSONArray("items") ?: return emptyList()
    val added = ArrayList<Item>()
    for (index in 0 until list.length()) {
      val entry = list.optJSONObject(index) ?: continue
      val text = entry.optString("text", "")
      val silence = entry.optLong("silence", 0L).coerceIn(0L, 5000L)
      val marks = entry.optJSONArray("marks")?.let { array -> IntArray(array.length()) { array.optInt(it, 0) } } ?: IntArray(0)
      val phonemes = entry.optJSONArray("phonemes")?.let { array -> Array(array.length()) { if (array.isNull(it)) null else array.optString(it) } }
      if (text.isNotBlank()) added.add(Item(entry.optString("id", ""), text, silence, marks, phonemes))
    }
    return added
  }

  private fun utterance(item: Item) =
    StudioVoice.Utterance(item.id, item.text, if (item.base >= item.text.length) 0 else item.base, item.silence, item.marks, item.phonemes)

  /** The Studio voice or the phone's own from now on: the other one falls quiet. */
  private fun switchEngine(voice: StudioVoice.Voice?) {
    val before = studio
    studio = voice
    if (before != null && voice?.id != before.id) StudioVoice.halt()
    if (before == null && voice != null) stopTts()
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
      main.post { if (studio == null) UtteranceIds.current(utteranceId, generation)?.let { started(it, null) } }
    }

    override fun onDone(utteranceId: String?) {
      main.post { if (studio == null) UtteranceIds.current(utteranceId, generation)?.let { finished(it) } }
    }

    /** A word about to be said (Android 8 and on, where the engine says). */
    override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
      main.post {
        if (studio != null) return@post
        val id = UtteranceIds.current(utteranceId, generation) ?: return@post
        val index = items.indexOfFirst { it.id == id }
        if (!playing || index < 0 || index != at) return@post
        heard = items[index].base + start
        emit(
          JSObject()
            .put("type", "boundary")
            .put("id", id)
            .put("charIndex", heard)
            .put("charLength", (end - start).coerceAtLeast(0))
            .put("kind", "word")
        )
      }
    }

    @Deprecated("Deprecated in Java")
    override fun onError(utteranceId: String?) {
      onError(utteranceId, TextToSpeech.ERROR)
    }

    override fun onError(utteranceId: String?, errorCode: Int) {
      main.post { if (studio == null) UtteranceIds.current(utteranceId, generation)?.let { failed(it, "code $errorCode") } }
    }

    // Stopped on purpose (a pause, a skip): nothing to say.
    override fun onStop(utteranceId: String?, interrupted: Boolean) {}
  }

  /** An item has started (from `from`, else from where it was resumed). */
  private fun started(id: String, from: Int?) {
    val index = items.indexOfFirst { it.id == id }
    if (index < 0 || !playing) return
    at = index
    heard = from ?: items[index].base
    startedAt = SystemClock.elapsedRealtime()
    startedId = id
    val event = JSObject().put("type", "start").put("id", id)
    if (heard > 0) event.put("from", heard)
    emit(event)
  }

  private fun finished(id: String) {
    val index = items.indexOfFirst { it.id == id }
    if (!playing || index < 0) return
    if (index == at) {
      // Done: a pause from now on goes on from the next item. After the last
      // one queued, past the end: what the page adds next is where a resume
      // goes on from (it used to stay on this one, and say it all again).
      items[index].base = 0
      at += 1
      heard = 0
    }
    emit(JSObject().put("type", "done").put("id", id))
  }

  private fun failed(id: String, message: String) {
    if (!playing || items.none { it.id == id }) return
    Logger.error("read_aloud: utterance $id failed ($message)")
    val index = items.indexOfFirst { it.id == id }
    if (index == at) {
      items[index].base = 0
      at += 1
      heard = 0
    }
    emit(JSObject().put("type", "error").put("id", id).put("message", message))
  }

  /** The Studio voice's news, on the main thread. */
  private val studioListener = object : StudioVoice.Listener {
    override fun onStart(id: String, from: Int) {
      if (studio != null) started(id, from)
    }

    override fun onSentence(id: String, charIndex: Int) {
      if (studio == null) return
      val index = items.indexOfFirst { it.id == id }
      if (!playing || index < 0 || index != at) return
      heard = charIndex
      emit(JSObject().put("type", "boundary").put("id", id).put("charIndex", charIndex).put("kind", "sentence"))
    }

    override fun onDone(id: String) {
      if (studio != null) finished(id)
    }

    override fun onError(id: String, message: String) {
      if (studio != null) failed(id, "studio: $message")
    }

    /** It cannot go on: the phone's own voice reads on from the sentence it was at. */
    override fun onFatal(message: String) {
      if (studio == null) return
      studio = null
      preparing = null
      emit(JSObject().put("type", "error").put("id", items.getOrNull(at)?.id ?: JSONObject.NULL).put("message", "studio: $message"))
      items.getOrNull(at)?.let { it.base = heard.coerceIn(0, it.text.length) }
      updateSession()
      if (!playing) return
      whenReady { ok ->
        if (studio != null || !playing) return@whenReady
        if (ok) {
          useVoice(null, language)
          speakFrom(at)
        } else {
          stop(fromPage = false)
        }
      }
    }

    override fun onPreparing(seconds: Int?) {
      if (studio == null && seconds != null) return
      if (preparing == seconds) return
      val was = preparing
      preparing = seconds
      emit(JSObject().put("type", "preparing").put("seconds", seconds ?: JSONObject.NULL))
      if ((was == null) != (seconds == null)) updateSession()
    }
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
    // How good each sounds and how quick it is to start go with it: the page picks the best (voiceRank.ts).
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
            .put("quality", voice.quality)
            .put("latency", voice.latency)
            .put("legacy", voice.features.contains("legacySetLanguageVoice"))
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
      heard = 0
      begin()
      playing = true
      speakFrom(at)
      updateSession()
      return
    }
    val from = items.size
    items.addAll(added)
    if (playing) {
      if (studio != null) StudioVoice.add(added.map { utterance(it) })
      else for (index in from until items.size) say(index, TextToSpeech.QUEUE_ADD)
    }
    trim()
  }

  /** The phone's voice quiet, its queue flushed: anything it still reports of that queue is dropped. */
  private fun stopTts() {
    generation += 1
    tts?.stop()
  }

  /** An item to the engine: its silence first (not when resumed part of the way in), then its text from `base`. */
  private fun say(index: Int, mode: Int) {
    val item = items.getOrNull(index) ?: return
    val engine = tts ?: return
    if (item.base >= item.text.length) item.base = 0
    var queue = mode
    if (item.base == 0 && item.silence > 0) {
      engine.playSilentUtterance(item.silence, queue, UtteranceIds.of(generation, item.id + GAP))
      queue = TextToSpeech.QUEUE_ADD
    }
    val text = if (item.base > 0) item.text.substring(item.base) else item.text
    engine.speak(text, queue, Bundle(), UtteranceIds.of(generation, item.id))
  }

  private fun speakFrom(index: Int) {
    val voice = studio
    val context = app
    if (voice != null && context != null) {
      stopTts()
      if (index >= items.size) {
        StudioVoice.halt()
        return
      }
      StudioVoice.play(context, items.subList(index, items.size).map { utterance(it) }, voice.id, rate, studioListener)
      return
    }
    StudioVoice.halt()
    if (index >= items.size) {
      stopTts()
      return
    }
    // A new queue: what the old one still reports is not this one's.
    generation += 1
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
    // Resumed from the word it was at (the Studio voice: from the very sample, where it still can).
    items.getOrNull(at)?.let { it.base = heard.coerceIn(0, it.text.length) }
    if (studio != null) StudioVoice.pause() else stopTts()
    updateSession()
    if (!fromPage) emit(JSObject().put("type", "state").put("playing", false))
  }

  private fun resume(fromPage: Boolean) {
    if (playing || items.isEmpty() || !active) return
    if (!requestFocus()) return
    playing = true
    resumeOnFocus = false
    if (studio == null || !StudioVoice.resume()) speakFrom(at)
    updateSession()
    if (!fromPage) emit(JSObject().put("type", "state").put("playing", true))
  }

  /**
   * An item on or back (a paragraph, or a sentence where the voice says
   * nothing of its words), from the notification or a headset, within what
   * the page has queued. Back, a few seconds into an item, is its start.
   */
  private fun skip(by: Int) {
    val current = items.getOrNull(at)
    // (In the silence before an item, or past the last one, the voice is not into it: back is the one just heard.)
    val into = if (playing) current != null && current.id == startedId && SystemClock.elapsedRealtime() - startedAt > 3000 else (current?.base ?: 0) > 0
    val target = if (by < 0 && into) at else at + by
    if (target < 0 || target >= items.size) return
    current?.base = 0
    items[target].base = 0
    at = target
    heard = 0
    if (playing) {
      speakFrom(at)
    } else {
      // (The Studio voice was paused elsewhere: resuming starts again here.)
      if (studio != null) StudioVoice.halt()
      emit(JSObject().put("type", "at").put("id", items[at].id))
    }
  }

  private fun stop(fromPage: Boolean) {
    val wasActive = active
    playing = false
    items.clear()
    at = 0
    heard = 0
    stopTts()
    preparing = null
    // A reading stopped: what was prepared for it goes (not when the page only clears the way for a new one).
    StudioVoice.stop(clear = wasActive)
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
        .setState(
          when {
            !playing -> PlaybackState.STATE_PAUSED
            preparing != null -> PlaybackState.STATE_BUFFERING
            else -> PlaybackState.STATE_PLAYING
          },
          PlaybackState.PLAYBACK_POSITION_UNKNOWN,
          if (playing && preparing == null) rate else 0f
        )
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
