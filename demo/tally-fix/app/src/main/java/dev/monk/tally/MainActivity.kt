package dev.monk.tally

import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.recyclerview.widget.ItemTouchHelper
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import java.time.LocalDate

class MainActivity : AppCompatActivity() {
    private val today = LocalDate.now()
    private val store = HabitStore.sample(today)
    private val adapter = HabitAdapter(today)
    private var lastArchive: ArchiveEvent? = null
    private val hideUndo = Runnable { findViewById<View>(R.id.undo_bar).visibility = View.GONE }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Edge to edge: the app draws behind the status and navigation bars.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)

        val content = findViewById<LinearLayout>(R.id.content)
        ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.updatePadding(top = bars.top, bottom = bars.bottom)
            insets
        }

        // The undo bar sits at the bottom of an edge-to-edge window, so it has to clear the
        // navigation bar itself; without this the UNDO button is drawn under it (issue #13).
        val undoBar = findViewById<View>(R.id.undo_bar)
        ViewCompat.setOnApplyWindowInsetsListener(undoBar) { v, insets ->
            val nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
            v.updatePadding(bottom = nav.bottom)
            insets
        }

        val list = findViewById<RecyclerView>(R.id.list)
        list.layoutManager = LinearLayoutManager(this)
        list.adapter = adapter
        adapter.submit(store.habits)

        ItemTouchHelper(object : ItemTouchHelper.SimpleCallback(0, ItemTouchHelper.LEFT) {
            override fun onMove(rv: RecyclerView, vh: RecyclerView.ViewHolder, target: RecyclerView.ViewHolder) = false
            override fun onSwiped(vh: RecyclerView.ViewHolder, direction: Int) {
                val event = store.archive(vh.bindingAdapterPosition, System.currentTimeMillis()) ?: return
                adapter.submit(store.habits)
                showUndo(event)
            }
        }).attachToRecyclerView(list)

        findViewById<Button>(R.id.undo).setOnClickListener {
            val event = lastArchive ?: return@setOnClickListener
            if (store.undo(event, System.currentTimeMillis())) adapter.submit(store.habits)
            hideUndo.run()
        }
    }

    private fun showUndo(event: ArchiveEvent) {
        lastArchive = event
        val bar = findViewById<View>(R.id.undo_bar)
        findViewById<TextView>(R.id.undo_text).text = "Archived \"${event.habit.name}\""
        bar.visibility = View.VISIBLE
        bar.removeCallbacks(hideUndo)
        bar.postDelayed(hideUndo, 5_000)
    }
}
