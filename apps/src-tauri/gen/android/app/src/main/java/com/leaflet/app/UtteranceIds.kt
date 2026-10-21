package com.leaflet.app

/**
 * The names the phone's text-to-speech is given for each utterance: the
 * item's id with the queue's generation in front (`"7|s:12"`), bumped each
 * time the queue is flushed (a pause, a skip, a new reading, a new speed).
 * Android still reports utterances it has just flushed (a late `onDone`,
 * `onRangeStart`); one of an older generation whose item id is queued again
 * (the same sentence, re-queued at a new speed) would otherwise move the
 * place being read. ReadAloud.kt uses it; UtteranceIdsTest checks it.
 */
object UtteranceIds {
  private const val SEPARATOR = '|'

  fun of(generation: Int, id: String) = "$generation$SEPARATOR$id"

  /** The item id an utterance is of, when it is of this generation; null for an older one (or a stranger). */
  fun current(utteranceId: String?, generation: Int): String? {
    val name = utteranceId ?: return null
    val cut = name.indexOf(SEPARATOR)
    if (cut <= 0) return null
    if (name.substring(0, cut).toIntOrNull() != generation) return null
    return name.substring(cut + 1)
  }
}
