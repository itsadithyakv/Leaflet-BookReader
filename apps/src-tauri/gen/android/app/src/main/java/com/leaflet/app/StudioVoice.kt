package com.leaflet.app

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import app.tauri.Logger
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.tanh

/**
 * The Studio voice on Android: Kokoro, run on the phone by sherpa-onnx (its
 * native libraries ship in the APK; the voice pack is downloaded by the Rust
 * pack manager, `src/tts/packs.rs`, into `<dataDir>/voices/kokoro-v1/`).
 * `ReadAloud` hands it the same items it would give the phone's own voice,
 * and keeps the MediaSession, the notification, audio focus and the service;
 * this makes the sound and says, at the very sample, when each item starts,
 * each sentence of it (the item's `marks`), and when it is done.
 *
 * Each item is cut into sentences (at its marks; the first of a reading at
 * its first clause too, to start sooner, when live). One thread makes them,
 * in order, into 16-bit PCM files in the cache (`studio-cache/<book>/<chapter>/`,
 * named by voice, speed and text, so one made earlier is used again); another
 * writes them to an `AudioTrack` and lets each file go once written. How far
 * the making runs ahead is `StudioPace`'s: live (r <= 0.85), half a minute;
 * preparing (slower phones), the rest of the chapter, and the voice starts
 * once enough is made that it can never catch up (`StudioPace.Window.canPlay`),
 * saying meanwhile how long that will be (`onPreparing`). A chapter can be
 * prepared before reading starts (`warm`: quietly, while Leaflet is on screen,
 * not on a low battery or a hot phone).
 *
 * Pausing pauses the AudioTrack: resuming goes on from the very sample. The
 * model (about 800 MB) is let go a few minutes after reading stops, ten
 * minutes into a pause, and when Android is short of memory. Anything that
 * fails says so (`onFatal`): ReadAloud goes on in the phone's own voice.
 *
 * sherpa-onnx 1.x has espeak-ng (GPL-3.0) in it: not for users before 2.0
 * (docs/android.md, "Studio voice"). The calls into it are only here
 * (`ensureModel`, `make`), to swap for 2.0's.
 */
object StudioVoice {
  const val PREFIX = "neural:"
  private const val PACK = "voices/kokoro-v1"
  private const val CACHE = "studio-cache"
  private const val CACHE_CAP = 300L * 1024 * 1024
  /** Less than this left on the phone: no more is prepared. */
  private const val LOW_STORAGE = 500L * 1024 * 1024
  private const val CACHE_DAYS_MS = 24L * 60 * 60 * 1000
  private const val IDLE_FREE_MS = 3 * 60_000L
  private const val PAUSED_FREE_MS = 10 * 60_000L
  /** A sentence longer than this is made in parts (Kokoro has a limit, and each part comes sooner). */
  private const val PIECE_MAX = 400
  private const val SAMPLE_RATE = 24000
  /** A phone with less memory than this is not offered the voice (it takes about 800 MB). */
  private const val MIN_MEMORY = 3L * 1024 * 1024 * 1024
  private const val TEST_SENTENCE =
    "The rain had stopped by the time she reached the station, and the town lay quiet under a pale evening sky."

  /**
   * The voices of the pack (as in `src/tts/packs.json`). `gain`: Kokoro speaks
   * about 4 to 6 dB under the phone's own voices; this brings each to about
   * -19 dBFS (measured on samples), with a soft limit at the top.
   */
  class Voice(val id: String, val name: String, val sid: Int, val lang: String, val lexicon: String, val gain: Float) {
    /** espeak-ng's voice for its words: "en-us" for Heart and Michael, "en" (British) for Emma. */
    val espeak: String get() = StudioPace.espeakLang(lang)
  }

  val voices = listOf(
    Voice("neural:af_heart", "Heart", 3, "en-US", "lexicon-us-en.txt", 1.74f),
    Voice("neural:bf_emma", "Emma", 21, "en-GB", "lexicon-gb-en.txt", 1.53f),
    Voice("neural:am_michael", "Michael", 16, "en-US", "lexicon-us-en.txt", 2.0f)
  )

  fun voice(id: String?): Voice? = voices.firstOrNull { it.id == id }

  /**
   * An item to say: from `base` in `text` (resumed part of the way in), after
   * `silence` ms (not when resumed). `phonemes`, where given, is each
   * sentence's (one per mark) as Leaflet's own English G2P makes them: used
   * instead of the text once `PHONEMES` is on (sherpa-onnx 2.0, which has no
   * espeak-ng and drops words its lexicon lacks).
   */
  class Utterance(val id: String, val text: String, val base: Int, val silence: Long, val marks: IntArray, val phonemes: Array<String?>? = null)

  /**
   * The one switch to phonemes from Leaflet's G2P instead of sherpa-onnx's own
   * (text in, espeak-ng for words not in the lexicon). Off with sherpa-onnx
   * 1.x, whose Kotlin API takes only text; see `generate`.
   */
  private const val PHONEMES = false

  /** What happens, on the main thread. */
  interface Listener {
    fun onStart(id: String, from: Int)
    fun onSentence(id: String, charIndex: Int)
    fun onDone(id: String)
    fun onError(id: String, message: String)
    /** The voice cannot go on (not installed, the model would not load, too slow): read on with another. */
    fun onFatal(message: String)
    /** Preparing before the voice starts: about this many seconds to go; null: it has started (or stopped waiting). */
    fun onPreparing(seconds: Int?)
  }

  private val main = Handler(Looper.getMainLooper())
  private var app: Context? = null
  /** Every call into sherpa-onnx is made on this one thread. */
  private val synth = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "studio-voice") }

  // On the synth thread only.
  private var model: OfflineTts? = null
  private var modelKey = ""
  @Volatile private var brokenKey: String? = null
  @Volatile private var brokenReason: String? = null

  @Volatile private var nativeOk: Boolean? = null
  private val rates = Any()
  /** The making over the saying, as measured (seeded by the self-test). */
  private val rtf = StudioPace.Rolling(12)
  /** Seconds a character takes at speed 1. */
  private val perChar = StudioPace.Rolling(24, StudioPace.DEFAULT_SECONDS_PER_CHAR)
  private var seededFrom = -1L

  // On the main thread.
  private var session: Session? = null
  private var warmSession: Session? = null
  private var listener: Listener? = null
  @Volatile private var bookKey = "book"
  @Volatile private var started = 0
  private var wakeLock: PowerManager.WakeLock? = null
  private var hooked = false

  fun init(from: Context) {
    if (app != null) return
    // Called first from Leaflet's activity, on screen.
    if (from is Activity) started = 1
    val context = from.applicationContext
    app = context
    if (!hooked) {
      hooked = true
      (context as? Application)?.registerActivityLifecycleCallbacks(lifecycle)
      context.registerComponentCallbacks(memory)
    }
    synth.execute { expireCache(context) }
  }

  // ---- what there is ------------------------------------------------------

  /** The native libraries are in this build (arm64 phones; x86_64 in debug builds, for the emulator). */
  fun native(): Boolean {
    nativeOk?.let { return it }
    val ok = try {
      System.loadLibrary("onnxruntime")
      System.loadLibrary("sherpa-onnx-jni")
      true
    } catch (error: Throwable) {
      false
    }
    nativeOk = ok
    return ok
  }

  fun packDir(context: Context) = File(context.dataDir, PACK)

  private fun installFile(context: Context) = File(packDir(context), "install.json")

  private class Install(val stamp: Long, val model: String, val rtf: Double?)

  @Volatile private var installSeen: Pair<Long, Install?>? = null

  /** The pack as the pack manager left it: installed only once its `install.json` is there. */
  private fun install(context: Context): Install? {
    val file = installFile(context)
    val stamp = file.lastModified()
    installSeen?.let { if (it.first == stamp) return it.second }
    val read = readInstall(context, file)
    installSeen = stamp to read
    return read
  }

  private fun readInstall(context: Context, file: File): Install? {
    if (!file.isFile) return null
    return try {
      val json = JSONObject(file.readText())
      val variant = json.optString("variant", "fp32")
      val model = if (variant == "int8") "model.int8.onnx" else "model.onnx"
      if (!File(packDir(context), model).isFile) return null
      val test = json.optJSONObject("selfTest")
      val rtf = test?.optDouble("rtf", Double.NaN)?.takeIf { it.isFinite() && it > 0 }
      Install(file.lastModified(), model, rtf)
    } catch (error: Exception) {
      null
    }
  }

  private fun lowMemory(context: Context): Boolean {
    val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return false
    val info = ActivityManager.MemoryInfo()
    manager.getMemoryInfo(info)
    return manager.isLowRamDevice || info.totalMem in 1 until MIN_MEMORY
  }

  /** The real-time factor now: as measured lately, else the self-test's; null when never measured. */
  fun currentRtf(context: Context? = app): Double? {
    val installed = context?.let { install(it) }
    synchronized(rates) {
      if (installed != null && installed.stamp != seededFrom) {
        seededFrom = installed.stamp
        rtf.reset(installed.rtf)
      }
      return rtf.value
    }
  }

  private fun secondsPerChar(speed: Float) = synchronized(rates) { (perChar.value ?: StudioPace.DEFAULT_SECONDS_PER_CHAR) / speed.coerceAtLeast(0.1f) }

  fun mode(context: Context): StudioPace.Mode = StudioPace.mode(currentRtf(context))

  /** The voice can read here: the libraries, the pack, the memory, a model that loads, and a phone fast enough. */
  fun usable(context: Context): Boolean {
    if (!native() || lowMemory(context)) return false
    val installed = install(context) ?: return false
    if (brokenKey != null && brokenKey == keyOf(installed, voices[0]).substringBefore('|')) return false
    return mode(context) != StudioPace.Mode.OFF
  }

  /** For the page (the Settings card): what the Studio voice can do on this phone. */
  fun support(context: Context): JSObject {
    val installed = install(context)
    val rate = currentRtf(context)
    return JSObject()
      .put("native", native())
      .put("installed", installed != null)
      .put("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "")
      .put("lowRam", lowMemory(context))
      .put("rtf", rate ?: JSONObject.NULL)
      .put("mode", if (rate == null) JSONObject.NULL else StudioPace.mode(rate).name.lowercase())
      .put("threads", threads())
      .put("broken", brokenReason ?: JSONObject.NULL)
      .put("dir", packDir(context).absolutePath)
  }

  /** The voices to list with the phone's own (none when the voice cannot read here). */
  fun voiceList(context: Context): JSArray {
    val out = JSArray()
    if (!usable(context)) return out
    val preparing = mode(context) == StudioPace.Mode.PREPARE
    for (voice in voices) {
      out.put(
        JSObject()
          .put("id", voice.id)
          .put("name", voice.name)
          .put("lang", voice.lang)
          .put("studio", true)
          .put("quality", 500)
          .put("latency", if (preparing) 500 else 400)
          .put("installed", true)
          .put("slow", preparing)
      )
    }
    return out
  }

  private fun threads(): Int = if (Runtime.getRuntime().availableProcessors() >= 6) 4 else 2

  // ---- the model (on the synth thread) ------------------------------------

  private fun keyOf(install: Install, voice: Voice) = "${install.stamp}:${install.model}|${voice.lexicon}|${voice.espeak}"

  private fun ensureModel(voice: Voice): OfflineTts? {
    val context = app ?: return null
    if (!native()) {
      brokenReason = "not in this build"
      return null
    }
    val installed = install(context) ?: run {
      free()
      brokenReason = "not installed"
      return null
    }
    val key = keyOf(installed, voice)
    model?.let { if (modelKey == key) return it }
    if (brokenKey == key.substringBefore('|')) return null
    free()
    val dir = packDir(context)
    val other = voices.map { it.lexicon }.distinct().filter { it != voice.lexicon }
    // The voice's own lexicon first (US or British spelling of a sound), then the other.
    val lexicon = (listOf(voice.lexicon) + other).map { File(dir, it) }.filter { it.isFile }.joinToString(",") { it.absolutePath }
    return try {
      val started = SystemClock.elapsedRealtime()
      val tts = OfflineTts(
        null,
        OfflineTtsConfig(
          model = OfflineTtsModelConfig(
            kokoro = OfflineTtsKokoroModelConfig(
              model = File(dir, installed.model).absolutePath,
              voices = File(dir, "voices.bin").absolutePath,
              tokens = File(dir, "tokens.txt").absolutePath,
              dataDir = File(dir, "espeak-ng-data").absolutePath,
              lexicon = lexicon,
              // espeak-ng's voice for the accent: "en-us", or "en" (British) for Emma.
              lang = voice.espeak
            ),
            numThreads = threads(),
            debug = false,
            provider = "cpu"
          ),
          maxNumSentences = 1
        )
      )
      if (tts.sampleRate() != SAMPLE_RATE) Logger.error("StudioVoice: sample rate ${tts.sampleRate()}, not $SAMPLE_RATE")
      Logger.info("StudioVoice: model loaded in ${SystemClock.elapsedRealtime() - started} ms")
      model = tts
      modelKey = key
      brokenKey = null
      brokenReason = null
      tts
    } catch (error: Throwable) {
      Logger.error("StudioVoice: the model did not load: ${error.message}")
      brokenKey = key.substringBefore('|')
      brokenReason = "the model did not load"
      null
    }
  }

  private fun free() {
    model?.let {
      try {
        it.release()
      } catch (error: Throwable) {
        Logger.error("StudioVoice: ${error.message}")
      }
    }
    model = null
    modelKey = ""
  }

  private val freeLater = Runnable {
    if (session?.alive != true && warmSession?.alive != true) synth.execute { free() }
  }

  private fun scheduleFree(ms: Long) {
    main.removeCallbacks(freeLater)
    main.postDelayed(freeLater, ms)
  }

  // ---- a reading ------------------------------------------------------------

  /** A sentence (or part of one) of an item, as made. */
  private class Piece(
    val item: Utterance,
    val start: Int,
    val end: Int,
    /** It starts at one of the item's marks: a sentence starts here. */
    val sentence: Boolean,
    val firstOfItem: Boolean,
    val lastOfItem: Boolean,
    val file: File?,
    /** The sentence's phonemes (from the page), when it is made from them. */
    val phonemes: String? = null
  ) {
    val text: String get() = item.text.substring(start, end).trim()
    val speakable: Boolean get() = text.any { it.isLetterOrDigit() }
    @Volatile var error: String? = null
  }

  private sealed class Mark(val frame: Long) {
    class Start(frame: Long, val id: String, val from: Int) : Mark(frame)
    class Sentence(frame: Long, val id: String, val at: Int) : Mark(frame)
    class Done(frame: Long, val id: String) : Mark(frame)
    class Failed(frame: Long, val id: String, val message: String) : Mark(frame)
  }

  private class Session(val voice: Voice, val speed: Float, val warm: Boolean, var gated: Boolean, val dir: File) {
    val lock = Object()
    val window = StudioPace.Window(CACHE_CAP)
    @Volatile var alive = true
    /** Wanted to be heard (not paused). */
    @Volatile var playing = false
    /** The entry the writer is on. */
    @Volatile var play = 0
    /** The voice must wait until enough is made (preparing: at the start, a new chapter, after running dry). */
    var mustWait = gated
    /** Live, the first piece is cut at its first clause. */
    var firstCut = !gated
    var track: AudioTrack? = null
    val marks = ConcurrentLinkedQueue<Mark>()
    var written = 0L
    /** Last said to the page: seconds to wait (null: not waiting). */
    var told: Int? = null
    var pausedAt = 0L
    /** How many entries still to be said use each file (a sentence said twice in a chapter is one file). */
    val uses = StudioPace.Uses()
  }

  /** Starts reading these (instead of anything before), in this voice and at this speed. */
  fun play(context: Context, items: List<Utterance>, voiceId: String, speed: Float, to: Listener) {
    init(context)
    val voice = voice(voiceId) ?: voices[0]
    listener = to
    halt()
    killWarm()
    main.removeCallbacks(freeLater)
    val mode = mode(context)
    if (mode == StudioPace.Mode.OFF) {
      to.onFatal("too slow on this phone")
      return
    }
    val s = Session(voice, speed, warm = false, gated = mode == StudioPace.Mode.PREPARE, dir = bookDir(context))
    s.playing = true
    session = s
    add(s, items)
    synth.execute { runSynth(s) }
    Thread({ runWriter(s) }, "studio-voice-out").start()
    holdAwake(true)
    main.post(poll)
  }

  /** More to read after what is queued. */
  fun add(items: List<Utterance>) {
    val s = session ?: return
    if (!s.alive) return
    add(s, items)
  }

  private fun add(s: Session, items: List<Utterance>) {
    synchronized(s.lock) {
      for (item in items) {
        for (piece in pieces(s, item)) {
          s.window.add(StudioPace.Window.Entry(chapterOf(item.id), piece.end - piece.start, piece))
          piece.file?.let { s.uses.add(it.path) }
        }
      }
      s.lock.notifyAll()
    }
  }

  fun pause() {
    val s = session ?: return
    synchronized(s.lock) {
      s.playing = false
      s.pausedAt = SystemClock.elapsedRealtime()
      try {
        s.track?.pause()
      } catch (error: IllegalStateException) {
        // Not playing yet.
      }
    }
    holdAwake(false)
    // Paused while preparing: no countdown meanwhile (it comes back on resuming, if still waiting).
    if (s.told != null) {
      s.told = null
      listener?.onPreparing(null)
    }
    main.removeCallbacks(pausedTooLong)
    main.postDelayed(pausedTooLong, PAUSED_FREE_MS)
  }

  /** Goes on from the very sample it was paused at; false when there is nothing to go on with (start again). */
  fun resume(): Boolean {
    val s = session ?: return false
    if (!s.alive) return false
    main.removeCallbacks(pausedTooLong)
    synchronized(s.lock) {
      s.playing = true
      try {
        s.track?.play()
      } catch (error: IllegalStateException) {
        return false
      }
      s.lock.notifyAll()
    }
    holdAwake(true)
    main.removeCallbacks(poll)
    main.post(poll)
    return true
  }

  /** A long pause: the reading is let go (resuming starts it again, from what is still in the cache). */
  private val pausedTooLong = Runnable {
    val s = session
    if (s != null && s.alive && !s.playing) {
      halt()
      scheduleFree(1000)
    }
  }

  /** Drops the reading (its prepared files stay, for a resume or a move within them). */
  fun halt() {
    val s = session ?: return
    session = null
    end(s)
    main.removeCallbacks(poll)
    main.removeCallbacks(pausedTooLong)
    holdAwake(false)
    if (s.told != null) listener?.onPreparing(null)
  }

  /** Reading stopped: everything goes, the prepared chapter too (`clear`), and the model in a while. */
  fun stop(clear: Boolean) {
    halt()
    killWarm()
    if (clear) clearCache()
    scheduleFree(IDLE_FREE_MS)
  }

  /** The book closed: what was prepared for it goes. */
  fun forget() {
    stop(clear = true)
  }

  private fun end(s: Session) {
    synchronized(s.lock) {
      s.alive = false
      s.lock.notifyAll()
      s.track?.let { track ->
        try {
          track.pause()
          track.flush()
        } catch (error: IllegalStateException) {
          // Never started.
        }
      }
    }
  }

  fun setBook(key: String) {
    val clean = key.filter { it.isLetterOrDigit() || it == '-' || it == '_' }.take(64)
    bookKey = clean.ifEmpty { "book" }
  }

  /** A chapter prepared before it is asked for (a slow phone, the Studio voice chosen, the book open): quietly. */
  fun warm(context: Context, items: List<Utterance>, voiceId: String, speed: Float) {
    init(context)
    if (session?.alive == true) return
    if (mode(context) != StudioPace.Mode.PREPARE || !usable(context)) return
    killWarm()
    main.removeCallbacks(freeLater)
    val s = Session(voice(voiceId) ?: voices[0], speed, warm = true, gated = true, dir = bookDir(context))
    warmSession = s
    add(s, items)
    synth.execute { runSynth(s) }
  }

  private fun killWarm() {
    val s = warmSession ?: return
    warmSession = null
    end(s)
  }

  // ---- cutting items into pieces ---------------------------------------------

  private fun chapterOf(id: String) = id.substringBefore(':').filter { it.isLetterOrDigit() }.ifEmpty { "x" }

  private fun pieces(s: Session, item: Utterance): List<Piece> {
    val text = item.text
    val base = item.base.coerceIn(0, text.length)
    val starts = sortedSetOf(base)
    for (mark in item.marks) if (mark in (base + 1) until text.length) starts.add(mark)
    val marks = item.marks.toSet()
    val phonemesAt = HashMap<Int, String>()
    if (PHONEMES) item.phonemes?.forEachIndexed { index, value -> if (value != null && index < item.marks.size) phonemesAt[item.marks[index]] = value }
    val bounds = ArrayList<Pair<Int, Boolean>>()
    val list = starts.toList()
    for ((index, start) in list.withIndex()) {
      val stop = list.getOrNull(index + 1) ?: text.length
      bounds.add(start to (start in marks))
      // A sentence given as phonemes is made whole (they are the whole sentence's).
      if (phonemesAt.containsKey(start)) continue
      var at = start
      // Too long a sentence: in parts, at a comma or a space.
      while (stop - at > PIECE_MAX) {
        val cut = cutAt(text, at, at + PIECE_MAX) ?: (at + PIECE_MAX)
        bounds.add(cut to false)
        at = cut
      }
      if (s.firstCut && index == 0) {
        // The first sentence of a reading: its first clause (8 words or fewer) on its own, heard about twice as soon.
        s.firstCut = false
        val clause = firstClause(text, start, minOf(stop, start + PIECE_MAX))
        if (clause != null) {
          bounds.add(clause to false)
          bounds.sortBy { it.first }
        }
      }
    }
    val spans = ArrayList<Triple<Int, Int, Boolean>>()
    for ((index, bound) in bounds.withIndex()) {
      val stop = bounds.getOrNull(index + 1)?.first ?: text.length
      if (stop > bound.first) spans.add(Triple(bound.first, stop, bound.second))
    }
    if (spans.isEmpty()) spans.add(Triple(base, text.length, base in marks))
    // Named by what they are (voice, speed, text or phonemes): the same sentence made before is used again.
    return spans.mapIndexed { index, (start, stop, sentence) ->
      val phonemes = phonemesAt[start]
      val bare = Piece(item, start, stop, sentence, index == 0, index == spans.size - 1, null)
      if (!bare.speakable) bare else Piece(item, start, stop, sentence, index == 0, index == spans.size - 1, fileFor(s, item.id, phonemes ?: bare.text), phonemes)
    }
  }

  /** Where the first clause of the sentence at `start` ends, when it is 2 to 8 words and at least 3 more follow. */
  private fun firstClause(text: String, start: Int, stop: Int): Int? {
    var words = 0
    var inWord = false
    for (at in start until stop) {
      val c = text[at]
      if (c.isLetterOrDigit()) {
        if (!inWord) words += 1
        inWord = true
      } else {
        inWord = false
      }
      if (words > 8) return null
      if (c in ",;:—" && words >= 2 && at + 1 < stop && text[at + 1].isWhitespace()) {
        val rest = text.substring(at + 1, stop).split(Regex("[^\\p{L}\\p{N}]+")).count { it.isNotEmpty() }
        return if (rest >= 3) at + 1 else null
      }
    }
    return null
  }

  private fun cutAt(text: String, from: Int, to: Int): Int? {
    for (at in to - 1 downTo from + PIECE_MAX / 2) if (text[at] in ",;:—") return at + 1
    for (at in to - 1 downTo from + PIECE_MAX / 2) if (text[at].isWhitespace()) return at + 1
    return null
  }

  private fun fileFor(s: Session, id: String, text: String): File {
    val digest = MessageDigest.getInstance("SHA-1").digest("${s.voice.sid}|${speedTag(s.speed)}|$text".toByteArray())
    val hex = digest.joinToString("") { "%02x".format(it) }.take(24)
    return File(File(s.dir, chapterOf(id)), "${s.voice.sid}-${speedTag(s.speed)}-$hex.pcm")
  }

  private fun speedTag(speed: Float) = (speed * 100).toInt().toString()

  // ---- making (the synth thread) ----------------------------------------------

  private fun runSynth(s: Session) {
    try {
      Process.setThreadPriority(if (s.warm) Process.THREAD_PRIORITY_BACKGROUND else Process.THREAD_PRIORITY_DEFAULT)
    } catch (error: Exception) {
      // Kept as it is.
    }
    if (!s.alive) return
    pruneOthers(s)
    val tts = ensureModel(s.voice)
    if (tts == null) {
      if (!s.warm && s.alive) main.post { if (session === s) fatal(brokenReason ?: "could not start") }
      return
    }
    var made = 0
    while (s.alive) {
      var index: Int? = null
      synchronized(s.lock) {
        while (s.alive && index == null) {
          if (s.warm && !warmAllowed()) {
            s.lock.wait(2000)
            continue
          }
          if (made % 20 == 0) s.window.capBytes = cacheCap()
          val rate = currentRtf() ?: 0.5
          index = s.window.nextToMake(s.play, rate, secondsPerChar(s.speed), prepare = s.gated)
          if (index == null) s.lock.wait(500)
        }
      }
      val at = index ?: break
      if (!s.alive) break
      make(s, tts, at)
      made += 1
    }
    if (s.warm) main.post { if (warmSession === s) warmSession = null }
  }

  private fun make(s: Session, tts: OfflineTts, index: Int) {
    val piece = synchronized(s.lock) { s.window[index]?.payload as? Piece } ?: return
    val file = piece.file
    var seconds = 0.0
    var bytes = 0L
    if (file != null && file.isFile && file.length() > 0) {
      // Made before (prepared ahead, or before a move).
      bytes = file.length()
      seconds = bytes / 2.0 / SAMPLE_RATE
      file.setLastModified(System.currentTimeMillis())
    } else if (file != null) {
      file.parentFile?.mkdirs()
      val part = File(file.parentFile, file.name + ".part")
      val began = SystemClock.elapsedRealtime()
      var frames = 0L
      try {
        FileOutputStream(part).use { out ->
          generate(tts, piece, s.voice.sid, s.speed) { samples ->
            if (!s.alive) {
              false
            } else {
              out.write(pcm(samples, s.voice.gain))
              frames += samples.size
              true
            }
          }
        }
        if (s.alive && frames > 0) {
          part.renameTo(file)
          bytes = file.length()
          seconds = frames.toDouble() / SAMPLE_RATE
          val took = (SystemClock.elapsedRealtime() - began) / 1000.0
          synchronized(rates) {
            if (seconds >= 0.5) rtf.add(took, seconds)
            perChar.add(seconds * s.speed, piece.text.length.toDouble())
          }
        } else {
          part.delete()
          if (s.alive) piece.error = "nothing made"
        }
      } catch (error: Throwable) {
        part.delete()
        Logger.error("StudioVoice: ${error.message}")
        piece.error = error.message ?: "could not be made"
        if (error is OutOfMemoryError) {
          free()
          if (!s.warm) main.post { if (session === s) fatal("out of memory") }
          s.alive = false
        }
      }
    }
    if (!s.alive) return
    synchronized(s.lock) {
      s.window.prepared(index, seconds, bytes)
      s.lock.notifyAll()
    }
  }

  /**
   * The one call that makes speech (sherpa-onnx 1.13.8's Kotlin API): the text,
   * or (sherpa-onnx 2.0, `PHONEMES`) the sentence's phonemes, which 2.0 takes
   * through `GenerationConfig` (`generateWithConfigAndCallback`). `sink` gets
   * the samples as they come, and false from it stops the making.
   */
  private fun generate(tts: OfflineTts, piece: Piece, sid: Int, speed: Float, sink: (FloatArray) -> Boolean) {
    val phonemes = piece.phonemes
    if (PHONEMES && phonemes != null) {
      // sherpa-onnx 2.0: tts.generateWithConfigAndCallback(text, GenerationConfig(sid = sid, speed = speed, extra = …phonemes…)) { … }
      throw UnsupportedOperationException("phonemes need sherpa-onnx 2.0")
    }
    tts.generateWithCallback(piece.text, sid, speed) { samples -> if (sink(samples)) 1 else 0 }
  }

  /** Float samples to 16-bit PCM, louder by `gain`, softly limited near full scale. */
  private fun pcm(samples: FloatArray, gain: Float): ByteArray {
    val buffer = ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN)
    for (sample in samples) {
      var x = sample * gain
      val size = abs(x)
      if (size > 0.9f) x = (if (x < 0) -1f else 1f) * (0.9f + 0.1f * tanh((size - 0.9f) / 0.1f))
      buffer.putShort((x * 32767f).toInt().coerceIn(-32768, 32767).toShort())
    }
    return buffer.array()
  }

  private fun warmAllowed(): Boolean {
    val context = app ?: return false
    if (started <= 0) return false
    val battery = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
    if (battery != null) {
      val level = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
      if (!battery.isCharging && level in 0 until 15) return false
    }
    if (Build.VERSION.SDK_INT >= 29) {
      val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
      if (power != null && power.currentThermalStatus >= PowerManager.THERMAL_STATUS_SEVERE) return false
    }
    return true
  }

  // ---- the cache ------------------------------------------------------------------

  private fun cacheRoot(context: Context) = File(context.cacheDir, CACHE)

  private fun bookDir(context: Context) = File(cacheRoot(context), bookKey)

  /** At most 300 MB, and less when the phone is nearly full. */
  private fun cacheCap(): Long {
    val context = app ?: return CACHE_CAP
    // (Never nothing: with no room at all for the next sentence the voice would wait for ever.)
    return StudioPace.cacheCap(context.cacheDir.usableSpace, CACHE_CAP, LOW_STORAGE)
  }

  private fun clearCache() {
    val context = app ?: return
    synth.execute { cacheRoot(context).deleteRecursively() }
  }

  /** Speech made in another voice or at another speed goes (a new speed is made again from where the voice is). */
  private fun pruneOthers(s: Session) {
    val prefix = "${s.voice.sid}-${speedTag(s.speed)}-"
    s.dir.walkBottomUp().forEach { file -> if (file.isFile && !file.name.startsWith(prefix)) file.delete() }
  }

  /** Anything older than a day goes (and everything, on a nearly full phone). */
  private fun expireCache(context: Context) {
    val root = cacheRoot(context)
    if (!root.isDirectory) return
    if (context.cacheDir.usableSpace < LOW_STORAGE) {
      root.deleteRecursively()
      return
    }
    val old = System.currentTimeMillis() - CACHE_DAYS_MS
    root.walkBottomUp().forEach { file ->
      if (file.isFile && file.lastModified() < old) file.delete()
      else if (file.isDirectory && file != root && file.list()?.isEmpty() == true) file.delete()
    }
  }

  // ---- saying (the writer thread) ---------------------------------------------------

  private fun buildTrack(): AudioTrack {
    val min = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    // A fifth of a second or so: short enough to start on a short first piece.
    val size = maxOf(min * 2, SAMPLE_RATE * 2 / 5)
    val track = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
      )
      .setAudioFormat(
        AudioFormat.Builder().setSampleRate(SAMPLE_RATE).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()
      )
      .setBufferSizeInBytes(size)
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
    if (Build.VERSION.SDK_INT >= 31) {
      try {
        track.setStartThresholdInFrames(SAMPLE_RATE / 20)
      } catch (error: Exception) {
        // The default: a full buffer.
      }
    }
    return track
  }

  private fun runWriter(s: Session) {
    try {
      Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
    } catch (error: Exception) {
      // Kept as it is.
    }
    val track = try {
      buildTrack()
    } catch (error: Exception) {
      Logger.error("StudioVoice: no audio track: ${error.message}")
      main.post { if (session === s) fatal("no audio") }
      return
    }
    synchronized(s.lock) {
      if (!s.alive) {
        track.release()
        return
      }
      s.track = track
      if (s.playing) track.play()
    }
    val padFrames = SAMPLE_RATE / 4
    var padded = true
    var chapter: String? = null
    var lastTold = 0L
    var skipping: Utterance? = null
    try {
      while (s.alive) {
        var piece: Piece? = null
        var entryChapter: String? = null
        synchronized(s.lock) {
          while (s.alive && piece == null) {
            val entry = s.window[s.play]
            if (entry == null || !entry.ready) {
              if (s.gated && entry != null) s.mustWait = true
              // Live and running dry on a phone that has become slow: prepare from here on.
              if (!s.gated && entry != null && s.written > 0 && (currentRtf() ?: 0.0) > StudioPace.LIVE_MAX) {
                s.gated = true
                s.mustWait = true
              }
              if (!padded && s.written > 0) break
              tellWaiting(s, entry != null, lastTold).let { if (it != 0L) lastTold = it }
              s.lock.wait(150)
              continue
            }
            if (s.gated && chapter != null && entry.chapter != chapter) s.mustWait = true
            if (s.gated && s.mustWait) {
              val rate = currentRtf() ?: 1.0
              if (!s.window.canPlay(s.play, rate, secondsPerChar(s.speed))) {
                tellWaiting(s, true, lastTold).let { if (it != 0L) lastTold = it }
                s.lock.wait(250)
                continue
              }
              s.mustWait = false
            }
            piece = entry.payload as? Piece
            entryChapter = entry.chapter
          }
        }
        if (!s.alive) break
        val current = piece
        if (current == null) {
          // Ran dry: a little silence, so the last of what was written is heard to its end.
          padded = true
          write(s, track, ShortArray(padFrames))
          continue
        }
        padded = false
        chapter = entryChapter
        if (s.told != null) {
          s.told = null
          main.post { if (session === s) listener?.onPreparing(null) }
        }
        // (The rest of an item that failed part of the way is not said: the page has gone on.)
        if (current.item !== skipping && !say(s, track, current)) skipping = current.item
        synchronized(s.lock) {
          s.window.played(s.play)
          // Its file goes once the last use of it is said, and only while this reading is on: one
          // stopped just now (a skip back, a new start here) may have handed it to the next reading.
          // Under the lock, so `end` (and the next reading) cannot come in between.
          current.file?.let { file -> if (s.uses.release(file.path, readingOn = s.alive)) file.delete() }
          s.play += 1
          if (s.play - s.window.start > 400) s.window.dropBefore(s.play - 200)
          s.lock.notifyAll()
        }
      }
    } finally {
      try {
        track.release()
      } catch (error: Exception) {
        // Gone already.
      }
    }
  }

  /** Says (to the page) how long until the voice can start, once a second while it waits. Returns when it last did, or 0. */
  private fun tellWaiting(s: Session, preparing: Boolean, last: Long): Long {
    if (!preparing || !s.gated || !s.playing) return 0
    val now = SystemClock.elapsedRealtime()
    if (now - last < 1000) return 0
    val rate = currentRtf() ?: 1.0
    val perChar = secondsPerChar(s.speed)
    val need = s.window.need(s.play, rate, perChar)
    val seconds = StudioPace.secondsToReady(need, s.window.lead(s.play), rate).toInt().coerceAtLeast(1)
    s.told = seconds
    main.post { if (session === s) listener?.onPreparing(seconds) }
    return now
  }

  /** Writes a piece (after its item's silence) and marks where its news falls; false: it could not be made. */
  private fun say(s: Session, track: AudioTrack, piece: Piece): Boolean {
    val item = piece.item
    if (piece.firstOfItem && item.base == 0 && item.silence > 0) write(s, track, ShortArray((item.silence * SAMPLE_RATE / 1000).toInt()))
    val failed = piece.error
    if (failed != null) {
      s.marks.add(Mark.Failed(s.written, item.id, failed))
      return false
    }
    if (piece.firstOfItem) s.marks.add(Mark.Start(s.written, item.id, piece.start))
    if (piece.sentence) s.marks.add(Mark.Sentence(s.written, item.id, piece.start))
    val file = piece.file
    if (file != null && file.isFile) {
      val bytes = try {
        file.readBytes()
      } catch (error: Exception) {
        ByteArray(0)
      }
      val samples = ShortArray(bytes.size / 2)
      ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples)
      write(s, track, samples)
    }
    if (piece.lastOfItem) s.marks.add(Mark.Done(s.written, item.id))
    return true
  }

  private fun write(s: Session, track: AudioTrack, samples: ShortArray) {
    var offset = 0
    while (offset < samples.size && s.alive) {
      val count = track.write(samples, offset, samples.size - offset, AudioTrack.WRITE_NON_BLOCKING)
      if (count < 0) {
        Logger.error("StudioVoice: audio write failed ($count)")
        return
      }
      if (count == 0) {
        Thread.sleep(15)
      } else {
        offset += count
        s.written += count
      }
    }
  }

  // ---- telling (the main thread) ------------------------------------------------------

  /** Each thing heard, as the speaker reaches it. */
  private val poll = object : Runnable {
    var lastHold = 0L

    override fun run() {
      val s = session ?: return
      if (!s.alive) return
      val track = s.track
      if (track != null) {
        val head = try {
          track.playbackHeadPosition.toLong() and 0xffffffffL
        } catch (error: Exception) {
          0L
        }
        while (true) {
          val mark = s.marks.peek() ?: break
          val due = when (mark) {
            is Mark.Done, is Mark.Failed -> mark.frame <= head
            else -> mark.frame < head
          }
          if (!due) break
          s.marks.poll()
          val to = listener ?: continue
          when (mark) {
            is Mark.Start -> to.onStart(mark.id, mark.from)
            is Mark.Sentence -> to.onSentence(mark.id, mark.at)
            is Mark.Done -> to.onDone(mark.id)
            is Mark.Failed -> to.onError(mark.id, mark.message)
          }
          if (session !== s) return
        }
      }
      if (s.playing) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastHold > 60_000) {
          lastHold = now
          holdAwake(true)
        }
        // Often while there is news to come; less while it waits for speech to be made.
        main.postDelayed(this, if (s.marks.isEmpty()) 200L else 30L)
      }
    }
  }

  private fun fatal(message: String) {
    Logger.error("StudioVoice: $message")
    halt()
    killWarm()
    scheduleFree(1000)
    listener?.onFatal(message)
  }

  /** Kept awake while reading (the making runs ahead with the screen off), let go when paused or stopped. */
  private fun holdAwake(on: Boolean) {
    val context = app ?: return
    try {
      if (on) {
        val lock = wakeLock ?: (context.getSystemService(Context.POWER_SERVICE) as PowerManager)
          .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "leaflet:studio-voice")
          .apply { setReferenceCounted(false) }
        wakeLock = lock
        lock.acquire(15 * 60_000L)
      } else {
        wakeLock?.let { if (it.isHeld) it.release() }
      }
    } catch (error: Exception) {
      Logger.error("StudioVoice: ${error.message}")
    }
  }

  // ---- the self-test ------------------------------------------------------------------

  /** Makes one sentence and measures how long it took: the real-time factor (`done` on the main thread). */
  fun selfTest(context: Context, voiceId: String?, done: (JSObject?, String?) -> Unit) {
    init(context)
    if (session?.alive == true) {
      done(null, "busy")
      return
    }
    if (!native()) {
      done(null, "not in this build")
      return
    }
    killWarm()
    main.removeCallbacks(freeLater)
    val voice = voice(voiceId) ?: voices[0]
    synth.execute {
      val began = SystemClock.elapsedRealtime()
      val tts = ensureModel(voice)
      val loaded = SystemClock.elapsedRealtime() - began
      if (tts == null) {
        main.post { done(null, brokenReason ?: "could not start") }
        return@execute
      }
      try {
        // The first run of a model is slower than the rest: not counted.
        tts.generate("Hello there.", voice.sid, 1f)
        val start = SystemClock.elapsedRealtime()
        val audio = tts.generate(TEST_SENTENCE, voice.sid, 1f)
        val took = (SystemClock.elapsedRealtime() - start) / 1000.0
        val seconds = audio.samples.size.toDouble() / audio.sampleRate.coerceAtLeast(1)
        val rate = if (seconds > 0) took / seconds else Double.NaN
        synchronized(rates) {
          rtf.reset(rate.takeIf { it.isFinite() })
          perChar.add(seconds, TEST_SENTENCE.length.toDouble())
        }
        val result = JSObject()
          .put("rtf", rate)
          .put("threads", threads())
          .put("loadMs", loaded)
          .put("seconds", seconds)
          .put("mode", StudioPace.mode(rate).name.lowercase())
        main.post {
          done(result, null)
          scheduleFree(IDLE_FREE_MS)
        }
      } catch (error: Throwable) {
        main.post { done(null, error.message ?: "failed") }
      }
    }
  }

  // ---- the app on screen, and memory ----------------------------------------------------

  private val lifecycle = object : Application.ActivityLifecycleCallbacks {
    override fun onActivityStarted(activity: Activity) {
      started += 1
    }

    override fun onActivityStopped(activity: Activity) {
      started = (started - 1).coerceAtLeast(0)
      // Out of sight: no preparing ahead (unless reading).
      if (started == 0) {
        killWarm()
        if (session?.alive != true) scheduleFree(IDLE_FREE_MS)
      }
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivityResumed(activity: Activity) {}
    override fun onActivityPaused(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {}
  }

  private val memory = object : ComponentCallbacks2 {
    override fun onTrimMemory(level: Int) {
      val reading = session?.let { it.alive && it.playing } == true
      if (reading) return
      // Short of memory (not merely out of sight, which is UI_HIDDEN).
      @Suppress("DEPRECATION")
      val short = level in ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW..ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL ||
        level >= ComponentCallbacks2.TRIM_MEMORY_BACKGROUND
      if (short) {
        main.post {
          killWarm()
          if (session?.alive == true && session?.playing == false) halt()
          synth.execute { free() }
        }
      }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {}

    @Deprecated("Deprecated in Java")
    override fun onLowMemory() = @Suppress("DEPRECATION") onTrimMemory(ComponentCallbacks2.TRIM_MEMORY_COMPLETE)
  }
}
