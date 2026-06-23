package com.dnaevolutions.moldqueen.core

import com.dnaevolutions.moldqueen.Mk4Telegrams.N_CHANNELS
import com.dnaevolutions.moldqueen.Mk4Telegrams.NEUTRAL
import com.dnaevolutions.moldqueen.Mk4Telegrams.channelIndex
import com.dnaevolutions.moldqueen.Mk4Telegrams.nibbleToValue
import com.dnaevolutions.moldqueen.Mk4Telegrams.valueToNibble

/**
 * Thin-transport state — clean-room port of api.py's (now thin-transport) App. Holds the lifecycle
 * and the 12 raw nibbles, nothing more. The server knows NOTHING about functions, channel
 * maps, invert/caps, or labels; the client owns all that and sends only low-level `set`
 * (slot/channel/value). Motion is honored only in READY.
 */
class ControlApp {
    var lifecycle: String = IDLE
    val nibbles = IntArray(N_CHANNELS) { NEUTRAL }
    private val lastRefresh = LongArray(N_CHANNELS)   // per-channel: last set() time (dead-man's-switch)

    fun slotsGrid(): List<List<Int>> =
        (0..2).map { s -> (0..3).map { c -> nibbleToValue(nibbles[channelIndex(s, c)]) } }

    fun set(slot: Int?, channel: Int?, value: Int?, nowNs: Long) {
        if (slot != null && channel != null && value != null && slot in 0..2 && channel in 0..3) {
            val ci = channelIndex(slot, channel)
            nibbles[ci] = valueToNibble(value)
            lastRefresh[ci] = nowNs                    // affirmative-keepalive: channel actively driven
        }
    }

    /** Per-channel dead-man's-switch: NEUTRALIZE any non-neutral channel not refreshed within
     *  [timeoutNs]. A channel is held alive ONLY by active client refresh — gamepad death,
     *  frozen axis, stalled loop, or client death all stop the refresh. Returns true if changed. */
    fun reapStale(nowNs: Long, timeoutNs: Long): Boolean {
        var changed = false
        for (ci in nibbles.indices) {
            if (nibbles[ci] != NEUTRAL && nowNs - lastRefresh[ci] > timeoutNs) {
                nibbles[ci] = NEUTRAL; changed = true
            }
        }
        return changed
    }

    fun stop() {
        for (i in nibbles.indices) nibbles[i] = NEUTRAL
    }

    companion object {
        const val IDLE = "IDLE"
        const val CONNECTING = "CONNECTING"
        const val READY = "READY"
    }
}
