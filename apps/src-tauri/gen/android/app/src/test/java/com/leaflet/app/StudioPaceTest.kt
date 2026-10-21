package com.leaflet.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StudioPaceTest {
  private val eps = 1e-6

  @Test
  fun modes() {
    assertEquals(StudioPace.Mode.LIVE, StudioPace.mode(null))
    assertEquals(StudioPace.Mode.LIVE, StudioPace.mode(0.5))
    assertEquals(StudioPace.Mode.LIVE, StudioPace.mode(0.85))
    assertEquals(StudioPace.Mode.PREPARE, StudioPace.mode(0.86))
    assertEquals(StudioPace.Mode.PREPARE, StudioPace.mode(2.5))
    assertEquals(StudioPace.Mode.OFF, StudioPace.mode(2.51))
  }

  @Test
  fun leadKeepsAheadOfTheVoice() {
    // D (1 - 1/r) 1.15: a 30-minute chapter.
    assertEquals(1800 * (1 - 1 / 1.3) * 1.15, StudioPace.requiredLead(1800.0, 1.3), eps)
    assertEquals(1800 * 0.5 * 1.15, StudioPace.requiredLead(1800.0, 2.0), eps)
    // Keeping up: only the floor.
    assertEquals(StudioPace.MIN_LEAD_SECONDS, StudioPace.requiredLead(1800.0, 1.0), eps)
    assertEquals(StudioPace.MIN_LEAD_SECONDS, StudioPace.requiredLead(1800.0, 0.9), eps)
    // Never more than there is.
    assertEquals(3.0, StudioPace.requiredLead(3.0, 2.0), eps)
    assertEquals(40 * 0.6 * 1.15, StudioPace.requiredLead(40.0, 2.5), eps)
    assertEquals(4.0, StudioPace.requiredLead(4.0, 1.2), eps)
  }

  @Test
  fun neverCatchesUp() {
    // With the lead it asks for, the making (r per second said) finishes before the saying does.
    for (r in listOf(0.9, 1.0, 1.3, 2.0, 2.5)) {
      val d = 1800.0
      val a = StudioPace.requiredLead(d, r)
      assertTrue("r=$r", (d - a) * r <= d + eps)
    }
  }

  @Test
  fun firstSoundOfAThirtyMinuteChapter() {
    assertEquals(6.0, StudioPace.firstSound(1800.0, 1.0), eps)
    assertEquals(1800 * (1 - 1 / 1.3) * 1.15 * 1.3, StudioPace.firstSound(1800.0, 1.3), eps) // about 10.4 minutes
    assertEquals(1800 * 0.5 * 1.15 * 2.0, StudioPace.firstSound(1800.0, 2.0), eps) // about 34.5 minutes
  }

  @Test
  fun rollingRatio() {
    val rolling = StudioPace.Rolling(size = 3, seed = 2.0, seedWeight = 1.0)
    assertEquals(2.0, rolling.value!!, eps)
    rolling.add(1.0, 1.0)
    assertEquals(1.5, rolling.value!!, eps)
    rolling.add(1.0, 1.0)
    rolling.add(1.0, 1.0)
    // Full: the seed no longer counts.
    assertEquals(1.0, rolling.value!!, eps)
    rolling.add(3.0, 1.0)
    assertEquals(5.0 / 3.0, rolling.value!!, eps)
    rolling.reset(null)
    assertNull(rolling.value)
  }

  private fun window(vararg chapters: Pair<String, Int>, cap: Long = 1_000_000): StudioPace.Window {
    val window = StudioPace.Window(cap)
    for ((chapter, count) in chapters) repeat(count) { window.add(StudioPace.Window.Entry(chapter, 100)) }
    return window
  }

  @Test
  fun liveMakesHalfAMinuteAhead() {
    val w = window("1" to 20)
    assertEquals(0, w.nextToMake(0, 0.5, 0.068, prepare = false))
    for (index in 0 until 4) w.prepared(index, 8.0, 1000)
    // 32 s ready ahead of the voice: wait.
    assertNull(w.nextToMake(0, 0.5, 0.068, prepare = false))
    // The voice moved on two: 16 s ahead, make the next.
    w.played(0)
    w.played(1)
    assertEquals(4, w.nextToMake(2, 0.5, 0.068, prepare = false))
  }

  @Test
  fun prepareWaitsForTheLead() {
    // 10 sentences of 10 s (estimated 100 chars x 0.1 s): D = 100 s; at r = 2, 57.5 s wanted.
    val w = window("1" to 10, "2" to 10)
    val perChar = 0.1
    assertEquals(57.5, w.need(0, 2.0, perChar), eps)
    for (index in 0 until 5) w.prepared(index, 10.0, 1000)
    assertFalse(w.canPlay(0, 2.0, perChar))
    w.prepared(5, 10.0, 1000)
    assertTrue(w.canPlay(0, 2.0, perChar))
    // Not past a gap.
    w.prepared(7, 10.0, 1000)
    assertEquals(60.0, w.lead(0), eps)
  }

  @Test
  fun preparesTheChapterThenTheStartOfTheNext() {
    val w = window("1" to 3, "2" to 10)
    val perChar = 0.1
    assertEquals(0, w.nextToMake(0, 2.0, perChar, prepare = true))
    for (index in 0 until 3) w.prepared(index, 10.0, 1000)
    // Chapter 1 is ready: chapter 2's start.
    assertEquals(3, w.nextToMake(0, 2.0, perChar, prepare = true))
    // Chapter 2 wants 57.5 s before it starts: six sentences, then nothing more for now.
    for (index in 3 until 9) w.prepared(index, 10.0, 1000)
    assertNull(w.nextToMake(0, 2.0, perChar, prepare = true))
    // The voice is into chapter 2: the rest of it.
    assertEquals(9, w.nextToMake(4, 2.0, perChar, prepare = true))
  }

  @Test
  fun chapterReadyOrFullPlaysAtOnce() {
    val w = window("1" to 2, "2" to 5)
    w.prepared(0, 5.0, 100)
    w.prepared(1, 5.0, 100)
    assertTrue(w.canPlay(0, 2.5, 0.1))
    val full = window("1" to 100, cap = 250)
    full.prepared(0, 5.0, 100)
    assertFalse(full.canPlay(0, 2.0, 0.1))
    full.prepared(1, 5.0, 100)
    full.prepared(2, 5.0, 100)
    assertTrue(full.full())
    assertTrue(full.canPlay(0, 2.0, 0.1))
    assertNull(full.nextToMake(0, 2.0, 0.1, prepare = true))
  }

  @Test
  fun bytesFollowTheWindow() {
    val w = window("1" to 5)
    for (index in 0 until 5) w.prepared(index, 2.0, 100)
    assertEquals(500, w.bytes)
    assertEquals(100, w.played(0))
    assertEquals(400, w.bytes)
    // A new speed from sentence 2: those files go.
    val gone = w.invalidateFrom(2)
    assertEquals(3, gone.size)
    assertEquals(100, w.bytes)
    assertEquals(2, w.nextToMake(1, 2.0, 0.1, prepare = true))
    w.dropBefore(2)
    assertEquals(0, w.bytes)
    assertEquals(2, w.start)
    assertNull(w[1])
    assertEquals(2, w.nextToMake(0, 2.0, 0.1, prepare = true))
  }

  @Test
  fun remainingUsesWhatIsMadeAndGuessesTheRest() {
    val w = window("1" to 4)
    w.prepared(0, 7.0, 10)
    assertEquals(7.0 + 3 * 100 * 0.05, w.remaining(0, 0.05), eps)
    assertEquals(4, w.chapterEnd(1))
    assertEquals(StudioPace.secondsToReady(10.0, 4.0, 1.5), 9.0, eps)
  }

  @Test
  fun eachVoiceIsSoundedOutInItsOwnEnglish() {
    // espeak-ng's "en" is British: an American voice needs "en-us" ("Darcy" is not dˈɑːsi).
    assertEquals("en-us", StudioPace.espeakLang("en-US"))
    assertEquals("en", StudioPace.espeakLang("en-GB"))
    assertEquals("en", StudioPace.espeakLang("en_gb"))
    assertEquals("en-us", StudioPace.espeakLang("en"))
  }

  @Test
  fun aNearlyFullPhoneStillHasRoomForTheNextSentence() {
    val mb = 1024L * 1024
    // Plenty of room: the cap.
    assertEquals(300 * mb, StudioPace.cacheCap(10_000 * mb, 300 * mb, 500 * mb))
    // Under the reserve: once that left 0, so nothing was ever made and the voice waited for ever.
    assertEquals(StudioPace.MIN_CACHE_BYTES, StudioPace.cacheCap(400 * mb, 300 * mb, 500 * mb))
    assertEquals(5 * mb, StudioPace.cacheCap(10 * mb, 300 * mb, 500 * mb))
    assertEquals(0L, StudioPace.cacheCap(0, 300 * mb, 500 * mb))
    // With such a cap the next sentence is still made, live or preparing.
    val w = window("1" to 3, cap = StudioPace.cacheCap(400 * mb, 300 * mb, 500 * mb))
    assertEquals(0, w.nextToMake(0, 0.5, 0.05, prepare = false))
    assertEquals(0, w.nextToMake(0, 2.0, 0.05, prepare = true))
  }

  @Test
  fun aFullCacheNeverLeavesTheVoiceWithNothingToSay() {
    // Full (with what is still being said elsewhere counted), and nothing ready where the voice is.
    val w = window("1" to 3, cap = 0)
    assertTrue(w.full())
    assertEquals(0, w.nextToMake(0, 0.5, 0.05, prepare = false))
    w.prepared(0, 5.0, 100)
    // Something to say: it waits for room.
    assertNull(w.nextToMake(0, 0.5, 0.05, prepare = false))
  }

  @Test
  fun aFileGoesWithItsLastUseAndOnlyWhileTheReadingIsOn() {
    val uses = StudioPace.Uses()
    uses.add("a")
    uses.add("a")
    uses.add("b")
    assertFalse(uses.release("a", readingOn = true))
    assertTrue(uses.release("a", readingOn = true))
    // Stopped (a skip back starts a new reading here): the file is the new reading's now.
    assertFalse(uses.release("b", readingOn = false))
  }
}
