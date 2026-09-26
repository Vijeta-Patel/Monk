package dev.monk.tally

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import java.time.LocalDate

class HabitAdapter(private val today: LocalDate) : RecyclerView.Adapter<HabitAdapter.Holder>() {
    private var items: List<Habit> = emptyList()

    class Holder(view: View) : RecyclerView.ViewHolder(view) {
        val name: TextView = view.findViewById(R.id.name)
        val streak: TextView = view.findViewById(R.id.streak)
    }

    fun submit(habits: List<Habit>) {
        items = habits
        @Suppress("NotifyDataSetChanged")
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder =
        Holder(LayoutInflater.from(parent.context).inflate(R.layout.item_habit, parent, false))

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val habit = items[position]
        holder.name.text = habit.name
        holder.streak.text = holder.itemView.context.getString(R.string.streak, habit.streak(today))
    }

    override fun getItemCount(): Int = items.size
}
