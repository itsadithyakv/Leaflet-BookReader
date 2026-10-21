package com.leaflet.app

/**
 * The Studio voice's arithmetic, apart from any audio or file (StudioVoice.kt
 * uses it; StudioPaceTest checks it): how fast this phone makes the voice,
 * whether it reads live or prepares the chapter first, how much must be
 * prepared before the voice may start, and the window of prepared sentences.
 *
 * The real-time factor `r` is the time it takes to make a stretch of speech
 * over the time it takes to say it: under 1, the phone keeps up. From the
 * self-test at first, then from the sentences it actually makes (phones slow
 * down as they warm).
 *
 * - r <= 0.85: live. A little is made ahead of the voice and it starts at once.
 * - 0.85 < r <= 2.5: prepare. The voice starts once the prepared lead A holds
 *   `A >= D * (1 - 1/r) * 1.15`, where D is what is left of the chapter: from
 *   then on the making never falls behind the saying (D seconds of saying,
 *   r * (D - A) of making the rest).
 * - r > 2.5: not offered on this phone.
 */
object StudioPace {
  const val LIVE_MAX = 0.85
  const val PREPARE_MAX = 2.5
  const val SAFETY = 1.15
  /** This much is always prepared before the voice starts (or all of the chapter, when it is shorter). */
  const val MIN_LEAD_SECONDS = 6.0
  /** Live: how far the making runs ahead of the voice. */
  const val LIVE_AHEAD_SECONDS = 30.0
  /** Seconds a character takes at speed 1 before any has been measured (Kokoro, English: about 15 a second). */
  const val DEFAULT_SECONDS_PER_CHAR = 0.068

  enum class Mode { LIVE, PREPARE, OFF }

  /**
   * espeak-ng's voice for a voice of the pack (sherpa-onnx 1.x's Kokoro `lang`):
   * "en-us" for an American voice, plain "en" (espeak's British English) for a
   * British one ("en-gb" is not in espeak-ng 1.13.8). The same as the Rust
   * side's `VoiceSpec::espeak_lang`.
   */
  fun espeakLang(lang: String): String {
    val tag = lang.trim().lowercase().replace('_', '-')
    return if (tag == "en-gb" || tag.startsWith("en-gb-")) "en" else "en-us"
  }

  /** The least the cache may hold however full the phone (a few minutes of speech), if the phone has room for it at all. */
  const val MIN_CACHE_BYTES = 16L * 1024 * 1024

  /**
   * What the cache may hold with `free` bytes left on the phone: at most `cap`,
   * less when keeping `reserve` free would leave less, but never so little that
   * the voice could not make the next sentence (`MIN_CACHE_BYTES`, or half of
   * what is free when that is less).
   */
  fun cacheCap(free: Long, cap: Long, reserve: Long): Long {
    val floor = minOf(MIN_CACHE_BYTES, maxOf(0L, free) / 2)
    return minOf(cap, maxOf(floor, free - reserve))
  }

  /**
   * How many sentences still to be said use each prepared file (a sentence said
   * twice in a chapter is one file): a file goes once the last of them is said,
   * and only by a reading still on. A reading stopped leaves its files (the next
   * one, started from the same place, may be using them already).
   */
  class Uses {
    private val counts = HashMap<String, Int>()

    fun add(key: String) {
      counts[key] = (counts[key] ?: 0) + 1
    }

    /** One use said; true when the file may go now. */
    fun release(key: String, readingOn: Boolean): Boolean {
      val left = (counts[key] ?: 1) - 1
      if (left <= 0) counts.remove(key) else counts[key] = left
      return left <= 0 && readingOn
    }
  }

  /** Not measured yet: live, and the measuring decides. */
  fun mode(rtf: Double?): Mode = when {
    rtf == null || rtf <= LIVE_MAX -> Mode.LIVE
    rtf <= PREPARE_MAX -> Mode.PREPARE
    else -> Mode.OFF
  }

  /** How much (seconds of speech) must be prepared before the voice starts, with `remaining` seconds left of the chapter. */
  fun requiredLead(remaining: Double, rtf: Double): Double {
    val floor = minOf(remaining, MIN_LEAD_SECONDS)
    if (rtf <= 1.0) return floor
    return minOf(remaining, maxOf(floor, remaining * (1.0 - 1.0 / rtf) * SAFETY))
  }

  /** Seconds until the voice can start: the lead still wanting, made at `rtf`. */
  fun secondsToReady(needed: Double, lead: Double, rtf: Double): Double = maxOf(0.0, needed - lead) * maxOf(rtf, 0.0)

  /** From the start of a chapter of `chapterSeconds`, prepared from nothing: seconds to the first sound. */
  fun firstSound(chapterSeconds: Double, rtf: Double): Double = secondsToReady(requiredLead(chapterSeconds, rtf), 0.0, rtf)

  /**
   * A rolling ratio over the last `size` samples (the making over the saying,
   * or seconds over characters), with a starting value that counts as one
   * sample of `seedWeight` until the window has filled.
   */
  class Rolling(private val size: Int = 12, private var seed: Double? = null, private val seedWeight: Double = 5.0) {
    private val top = DoubleArray(size)
    private val bottom = DoubleArray(size)
    private var count = 0
    private var next = 0

    fun add(numerator: Double, denominator: Double) {
      if (denominator <= 0.0 || numerator < 0.0) return
      top[next] = numerator
      bottom[next] = denominator
      next = (next + 1) % size
      if (count < size) count += 1
    }

    fun reset(seed: Double?) {
      this.seed = seed
      count = 0
      next = 0
    }

    /** Every sample scaled (the speed changed: each character now takes less or more). */
    fun scale(factor: Double) {
      seed = seed?.times(factor)
      for (index in 0 until count) top[index] *= factor
    }

    val samples get() = count

    val value: Double?
      get() {
        var t = 0.0
        var b = 0.0
        for (index in 0 until count) {
          t += top[index]
          b += bottom[index]
        }
        val start = seed
        if (start != null && count < size) {
          t += start * seedWeight
          b += seedWeight
        }
        return if (b > 0.0) t / b else start
      }
  }

  /**
   * The sentences of a reading, in order, and which of them are prepared: what
   * is made next, how far ahead it is, and whether the voice may start. A
   * sentence is `chars` long in `chapter`; once made, `seconds` long and
   * `bytes` on disk. Indices are counts from the start of the reading, kept as
   * the oldest are let go (`dropBefore`).
   */
  class Window(var capBytes: Long) {
    class Entry(val chapter: String, val chars: Int, val payload: Any? = null) {
      var ready = false
      var seconds = 0.0
      var bytes = 0L
      /** Written to the speaker and its file let go. */
      var played = false
    }

    private val entries = ArrayList<Entry>()
    private var first = 0
    var bytes = 0L
      private set

    val end get() = first + entries.size
    val start get() = first

    fun add(entry: Entry): Int {
      entries.add(entry)
      return end - 1
    }

    operator fun get(index: Int): Entry? = entries.getOrNull(index - first)

    fun prepared(index: Int, seconds: Double, bytes: Long) {
      val entry = get(index) ?: return
      if (entry.ready) this.bytes -= entry.bytes
      entry.ready = true
      entry.seconds = seconds
      entry.bytes = bytes
      this.bytes += bytes
    }

    /** Written to the speaker: its file goes (the bytes it freed). */
    fun played(index: Int): Long {
      val entry = get(index) ?: return 0
      entry.played = true
      val freed = if (entry.ready) entry.bytes else 0L
      bytes -= freed
      entry.bytes = 0
      return freed
    }

    /** Made again from here (a new speed): the entries that were ready, whose files go. */
    fun invalidateFrom(index: Int): List<Entry> {
      val gone = ArrayList<Entry>()
      for (at in maxOf(index, first) until end) {
        val entry = get(at) ?: continue
        if (entry.ready && !entry.played) {
          bytes -= entry.bytes
          entry.ready = false
          entry.bytes = 0
          entry.seconds = 0.0
          gone.add(entry)
        }
      }
      return gone
    }

    fun full() = bytes >= capBytes

    /** The first index past the chapter `index` is in (or the end of what is queued). */
    fun chapterEnd(index: Int): Int {
      val chapter = get(index)?.chapter ?: return end
      var at = index
      while (at < end && get(at)?.chapter == chapter) at += 1
      return at
    }

    /** Seconds of speech prepared one after another from `index`, within its chapter (or on through all, `acrossChapters`). */
    fun lead(index: Int, acrossChapters: Boolean = false): Double {
      val stop = if (acrossChapters) end else chapterEnd(index)
      var total = 0.0
      for (at in index until stop) {
        val entry = get(at) ?: break
        if (!entry.ready) break
        total += entry.seconds
      }
      return total
    }

    /** Seconds left of the chapter from `index`: as made, or as estimated (`secondsPerChar`). */
    fun remaining(index: Int, secondsPerChar: Double): Double {
      var total = 0.0
      for (at in index until chapterEnd(index)) {
        val entry = get(at) ?: break
        total += if (entry.ready) entry.seconds else entry.chars * secondsPerChar
      }
      return total
    }

    /** Every entry of the chapter from `index` (as far as it is queued) is prepared. */
    fun chapterReady(index: Int): Boolean {
      for (at in index until chapterEnd(index)) if (get(at)?.ready != true) return false
      return true
    }

    /** The lead the voice wants before it starts at `index`, and what it has. */
    fun need(index: Int, rtf: Double, secondsPerChar: Double): Double = requiredLead(remaining(index, secondsPerChar), rtf)

    /** The voice may start (or carry on) at `index`: enough is prepared, all of the chapter is, or no more fits. */
    fun canPlay(index: Int, rtf: Double, secondsPerChar: Double): Boolean {
      if (index >= end) return false
      if (get(index)?.ready != true) return false
      if (chapterReady(index) || full()) return true
      return lead(index) >= need(index, rtf, secondsPerChar)
    }

    /**
     * What to make next, with the voice at `play`: live, the next entry not made
     * while less than `LIVE_AHEAD_SECONDS` is ready; preparing, the rest of the
     * chapter, then the next chapter as far as it would want before it starts.
     * Null: nothing for now.
     */
    fun nextToMake(play: Int, rtf: Double, secondsPerChar: Double, prepare: Boolean): Int? {
      val from = maxOf(play, first)
      // Full, but nothing made for the voice to say: the next is made all the same, or it would wait for ever.
      if (full() && lead(from, acrossChapters = true) > 0.0) return null
      if (!prepare) {
        var ahead = 0.0
        for (at in from until end) {
          val entry = get(at) ?: return null
          if (!entry.ready) return if (ahead < LIVE_AHEAD_SECONDS) at else null
          ahead += entry.seconds
        }
        return null
      }
      val chapterEnd = chapterEnd(from)
      for (at in from until chapterEnd) if (get(at)?.ready != true) return at
      // The chapter is prepared: the start of the next, as much as it will want.
      if (chapterEnd >= end) return null
      val nextEnd = chapterEnd(chapterEnd)
      val wanted = need(chapterEnd, rtf, secondsPerChar)
      if (lead(chapterEnd) >= wanted) return null
      for (at in chapterEnd until nextEnd) if (get(at)?.ready != true) return at
      return null
    }

    /** Lets go of entries before `index` (played long ago). */
    fun dropBefore(index: Int) {
      val count = (index - first).coerceIn(0, entries.size)
      if (count == 0) return
      for (at in 0 until count) {
        val entry = entries[at]
        if (entry.ready && !entry.played) bytes -= entry.bytes
      }
      entries.subList(0, count).clear()
      first += count
    }
  }
}
