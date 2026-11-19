package com.margelo.nitro.dukaan

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.view.Window
import com.margelo.nitro.NitroModules

/**
 * Hardware scanners are keyboards. We wrap the activity's Window.Callback and hold back key events
 * while they arrive faster than a human types. A burst that ends in Enter/Tab and is long enough is
 * a scan: it is consumed and reported. Anything else (a gap > maxGapMs) is replayed unchanged to
 * the original callback, so normal typing into text fields still works — just ≤ maxGapMs late.
 */
@Keep
@DoNotStrip
class HybridHidScanner : HybridHidScannerSpec() {
  private val main = Handler(Looper.getMainLooper())
  private var original: Window.Callback? = null
  private var window: Window? = null
  private var onScan: ((String, Double) -> Unit)? = null
  private var maxGap = 50L
  private var minLen = 6

  private val held = ArrayList<KeyEvent>()
  private val text = StringBuilder()
  private var firstAt = 0L
  private var lastAt = 0L
  private val flush = Runnable { replay() }

  override val isActive: Boolean
    get() = original != null

  override fun start(onScan: (code: String, durationMs: Double) -> Unit, maxGapMs: Double, minLength: Double) {
    this.onScan = onScan
    maxGap = maxGapMs.toLong().coerceIn(10, 500)
    minLen = minLength.toInt().coerceAtLeast(1)
    main.post {
      if (original != null) return@post
      val activity: Activity = NitroModules.applicationContext?.currentActivity ?: return@post
      val w = activity.window
      val cb = w.callback
      original = cb
      window = w
      w.callback = Interceptor(cb)
    }
  }

  override fun stop() {
    main.post {
      main.removeCallbacks(flush)
      replay()
      original?.let { window?.callback = it }
      original = null
      window = null
      onScan = null
    }
  }

  private inner class Interceptor(private val inner: Window.Callback) : Window.Callback by inner {
    override fun dispatchKeyEvent(event: KeyEvent): Boolean = handle(event) || inner.dispatchKeyEvent(event)
  }

  /** Returns true when the event was taken (held or consumed). Runs on the main thread. */
  private fun handle(e: KeyEvent): Boolean {
    val now = SystemClock.uptimeMillis()
    val terminator = e.keyCode == KeyEvent.KEYCODE_ENTER || e.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER || e.keyCode == KeyEvent.KEYCODE_TAB
    val ch = e.unicodeChar

    if (e.action == KeyEvent.ACTION_DOWN) {
      if (held.isNotEmpty() && now - lastAt > maxGap) replay()
      if (terminator) {
        if (text.length >= minLen) {
          val code = text.toString()
          val took = (lastAt - firstAt).toDouble()
          reset()
          swallowUpOf = e.keyCode
          onScan?.invoke(code, took)
          return true
        }
        replay()
        return false
      }
      if (ch <= 0x20 || e.isCtrlPressed || e.isAltPressed) {
        replay()
        return false
      }
      if (held.isEmpty()) firstAt = now
      lastAt = now
      text.appendCodePoint(ch)
      held += KeyEvent(e)
      main.removeCallbacks(flush)
      main.postDelayed(flush, maxGap + 1)
      return true
    }

    if (e.action == KeyEvent.ACTION_UP) {
      if (terminator && swallowUpOf == e.keyCode) {
        swallowUpOf = -1
        return true
      }
      if (held.isNotEmpty() && !terminator) {
        held += KeyEvent(e)
        return true
      }
    }
    return false
  }

  private var swallowUpOf = -1

  private fun replay() {
    main.removeCallbacks(flush)
    if (held.isEmpty()) return
    val events = ArrayList(held)
    reset()
    val cb = original ?: return
    for (ev in events) cb.dispatchKeyEvent(ev)
  }

  private fun reset() {
    held.clear()
    text.setLength(0)
  }
}
