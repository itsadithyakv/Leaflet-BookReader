package com.leaflet.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UtteranceIdsTest {
  @Test
  fun anUtteranceOfTheQueueNowIsItsItem() {
    assertEquals("s:12", UtteranceIds.current(UtteranceIds.of(7, "s:12"), 7))
    // Item ids may hold the separator themselves.
    assertEquals("12:40|x", UtteranceIds.current(UtteranceIds.of(3, "12:40|x"), 3))
    assertEquals("s:1#gap", UtteranceIds.current(UtteranceIds.of(2, "s:1#gap"), 2))
  }

  @Test
  fun oneOfAQueueFlushedIsNot() {
    // The same sentence queued again at a new speed: the late onDone of the old one is not its.
    assertNull(UtteranceIds.current(UtteranceIds.of(7, "s:12"), 8))
    assertNull(UtteranceIds.current("s:12", 8))
    assertNull(UtteranceIds.current(null, 0))
    assertNull(UtteranceIds.current("|s:12", 0))
  }
}
