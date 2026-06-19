package com.dnaevolutions.moldqueen.core

import com.dnaevolutions.moldqueen.Mk4Telegrams.N_CHANNELS
import com.dnaevolutions.moldqueen.Mk4Telegrams.NEUTRAL
import com.dnaevolutions.moldqueen.Mk4Telegrams.channelIndex
import com.dnaevolutions.moldqueen.Mk4Telegrams.nibbleToValue
import com.dnaevolutions.moldqueen.Mk4Telegrams.valueToNibble

/**
 * Dumb transport state — clean-room port of api.py's (now dumb) App. Holds the lifecycle
 * and the 12 raw nibbles, nothing more. The server knows NOTHING about functions, channel
 * maps, invert/caps, or labels; the client owns all that and sends only low-level `set`
 * (slot/channel/value). Motion is honored only in READY.
 */
class ControlApp {
    var lifecycle: String = IDLE
    val nibbles = IntArray(N_CHANNELS) { NEUTRAL }

    fun slotsGrid(): List<List<Int>> =
        (0..2).map { s -> (0..3).map { c -> nibbleToValue(nibbles[channelIndex(s, c)]) } }

    fun set(slot: Int?, channel: Int?, value: Int?) {
        if (slot != null && channel != null && value != null && slot in 0..2 && channel in 0..3) {
            nibbles[channelIndex(slot, channel)] = valueToNibble(value)
        }
    }

    fun stop() {
        for (i in nibbles.indices) nibbles[i] = NEUTRAL
    }

    fun isNeutral(): Boolean = nibbles.all { it == NEUTRAL }

    companion object {
        const val IDLE = "IDLE"
        const val CONNECTING = "CONNECTING"
        const val READY = "READY"
    }
}
