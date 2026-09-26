package dev.monk.tally

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class HabitStoreTest {
    private val today = LocalDate.of(2026, 9, 23)

    @Test fun sample_hasFiveHabits() = assertEquals(5, HabitStore.sample(today).habits.size)

    @Test fun streak_countsBackFromToday() {
        val h = Habit(1, "x", setOf(today, today.minusDays(1), today.minusDays(2)))
        assertEquals(3, h.streak(today))
    }

    @Test fun streak_startsYesterdayWhenTodayNotDone() {
        val h = Habit(1, "x", setOf(today.minusDays(1), today.minusDays(2)))
        assertEquals(2, h.streak(today))
    }

    @Test fun streak_breaksOnAGap() {
        val h = Habit(1, "x", setOf(today, today.minusDays(2)))
        assertEquals(1, h.streak(today))
    }

    @Test fun dailyStreak_acrossMidnight() {
        val h = Habit(1, "x", setOf(LocalDate.of(2026, 9, 22), LocalDate.of(2026, 9, 23)))
        assertEquals(2, h.streak(LocalDate.of(2026, 9, 23)))
        assertEquals(2, h.streak(LocalDate.of(2026, 9, 24)))
    }

    @Test fun markDone_extendsStreak() {
        val s = HabitStore(listOf(Habit(1, "x", setOf(today.minusDays(1)))))
        s.markDone(1, today)
        assertEquals(2, s.habits[0].streak(today))
    }

    @Test fun archive_outOfRangeIsNull() = assertNull(HabitStore.sample(today).archive(99, 0))

    @Test fun markDone_unknownIdIsIgnored() {
        val s = HabitStore.sample(today)
        s.markDone(42, today)
        assertTrue(s.habits.none { it.id == 42L })
        assertFalse(s.habits.isEmpty())
    }
}
