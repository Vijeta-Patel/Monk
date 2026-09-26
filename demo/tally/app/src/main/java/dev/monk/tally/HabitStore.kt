package dev.monk.tally

import java.time.LocalDate

data class Habit(val id: Long, val name: String, val doneOn: Set<LocalDate> = emptySet()) {
    /** Consecutive days done, counting back from [today] (or yesterday if today isn't done yet). */
    fun streak(today: LocalDate): Int {
        var day = if (today in doneOn) today else today.minusDays(1)
        var count = 0
        while (day in doneOn) {
            count++
            day = day.minusDays(1)
        }
        return count
    }
}

/** What an archive did, so it can be undone exactly. */
data class ArchiveEvent(val habit: Habit, val position: Int, val atMillis: Long)

/** Pure habit list logic; the activity only renders it. */
class HabitStore(initial: List<Habit>, private val undoWindowMillis: Long = 5_000) {
    private val active = initial.toMutableList()
    private val archived = mutableListOf<Habit>()

    val habits: List<Habit> get() = active.toList()
    val history: List<Habit> get() = archived.toList()

    fun archive(position: Int, nowMillis: Long): ArchiveEvent? {
        if (position !in active.indices) return null
        val habit = active.removeAt(position)
        archived.add(habit)
        return ArchiveEvent(habit, position, nowMillis)
    }

    /** Puts the habit back where it was; false once the undo window has passed. */
    fun undo(event: ArchiveEvent, nowMillis: Long): Boolean {
        if (nowMillis - event.atMillis > undoWindowMillis) return false
        if (!archived.remove(event.habit)) return false
        active.add(event.position.coerceAtMost(active.size), event.habit)
        return true
    }

    fun markDone(id: Long, day: LocalDate) {
        val i = active.indexOfFirst { it.id == id }
        if (i >= 0) active[i] = active[i].copy(doneOn = active[i].doneOn + day)
    }

    companion object {
        fun sample(today: LocalDate): HabitStore = HabitStore(
            listOf(
                Habit(1, "Read 20 min", setOf(today.minusDays(1), today.minusDays(2))),
                Habit(2, "Walk 5k", setOf(today)),
                Habit(3, "No phone after 10pm"),
                Habit(4, "Stretch", setOf(today, today.minusDays(1))),
                Habit(5, "Journal"),
            ),
        )
    }
}
