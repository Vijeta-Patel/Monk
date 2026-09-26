package dev.monk.tally

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class ArchiveTest {
    private val today = LocalDate.of(2026, 9, 23)
    private fun store() = HabitStore.sample(today)

    @Test fun archive_removesFromActive() {
        val s = store()
        s.archive(0, 1_000)
        assertFalse(s.habits.any { it.name == "Read 20 min" })
    }

    @Test fun archive_keepsHistory() {
        val s = store()
        s.archive(0, 1_000)
        assertEquals(listOf("Read 20 min"), s.history.map { it.name })
    }

    @Test fun undoArchive_restoresOrder() {
        val s = store()
        val before = s.habits.map { it.id }
        val e = s.archive(2, 1_000)!!
        assertTrue(s.undo(e, 2_000))
        assertEquals(before, s.habits.map { it.id })
    }

    @Test fun swipe_emitsArchiveEvent() {
        val e = store().archive(1, 42)
        assertNotNull(e)
        assertEquals(1, e!!.position)
        assertEquals(42L, e.atMillis)
    }

    @Test fun undo_withinWindow() {
        val s = store()
        val e = s.archive(0, 1_000)!!
        assertTrue(s.undo(e, 5_900))
    }

    @Test fun undo_afterWindowFails() {
        val s = store()
        val e = s.archive(0, 1_000)!!
        assertFalse(s.undo(e, 7_000))
        assertEquals(4, s.habits.size)
    }

    @Test fun undo_twiceOnlyOnce() {
        val s = store()
        val e = s.archive(0, 1_000)!!
        assertTrue(s.undo(e, 1_500))
        assertFalse(s.undo(e, 1_600))
        assertEquals(5, s.habits.size)
    }

    @Test fun archive_lastPositionThenUndo() {
        val s = store()
        val e = s.archive(4, 0)!!
        assertTrue(s.undo(e, 1))
        assertEquals("Journal", s.habits.last().name)
    }
}
