package com.dnaevolutions.moldqueen.service

import com.dnaevolutions.moldqueen.BleBroadcaster
import com.dnaevolutions.moldqueen.Mk4Telegrams
import com.dnaevolutions.moldqueen.MouldKingCrypt
import com.dnaevolutions.moldqueen.core.Radio

/**
 * Bridges the pure [Radio] interface (api.py's broadcaster role) to the proven
 * [BleBroadcaster]. Holds the lifecycle + current nibbles and drives advertising:
 * CONNECTING → connect telegram; READY → motion telegram of the current nibbles;
 * IDLE → advertising off. Keepalive/repetition is inherent to the advertiser's
 * ADVERTISE_MODE_LOW_LATENCY (~10 frames/sec on air), so no churn-y re-assert loop.
 */
class RadioController(private val ble: BleBroadcaster) : Radio {

    @Volatile private var lifecycle = "IDLE"
    @Volatile private var nibbles = IntArray(Mk4Telegrams.N_CHANNELS) { Mk4Telegrams.NEUTRAL }

    override fun setup(action: String) {
        when (action) {
            "connect" -> { lifecycle = "CONNECTING"; ble.setPayload(Mk4Telegrams.connect(), "CONNECT") }
            "ready" -> { lifecycle = "READY"; advertiseMotion() }
            "reset" -> { lifecycle = "IDLE"; nibbles = neutral(); ble.stop() }
        }
    }

    override fun sendState(nb: IntArray) {
        nibbles = nb.copyOf()
        if (lifecycle == "READY") advertiseMotion()
    }

    override fun sendNeutral() {
        nibbles = neutral()
        if (lifecycle == "READY") advertiseMotion()   // CONNECTING keeps the connect telegram
    }

    private fun advertiseMotion() =
        ble.setPayload(MouldKingCrypt.encode(Mk4Telegrams.motionRawHexNibbles(nibbles)), "MOTION")

    private fun neutral() = IntArray(Mk4Telegrams.N_CHANNELS) { Mk4Telegrams.NEUTRAL }
}
