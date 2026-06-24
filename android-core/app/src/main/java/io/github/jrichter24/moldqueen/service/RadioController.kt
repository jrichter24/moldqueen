package io.github.jrichter24.moldqueen.service

import io.github.jrichter24.moldqueen.BleSink
import io.github.jrichter24.moldqueen.Mk4Telegrams
import io.github.jrichter24.moldqueen.MouldKingCrypt
import io.github.jrichter24.moldqueen.core.Radio

/**
 * Bridges the pure [Radio] interface (api.py's broadcaster role) to the proven
 * [BleSink]/BleBroadcaster. Holds the lifecycle + current nibbles and drives advertising:
 * CONNECTING → connect telegram; READY → motion telegram of the current nibbles;
 * IDLE → advertising off. On-air repetition is inherent to ADVERTISE_MODE_LOW_LATENCY
 * (~10/sec), so we RE-ADVERTISE ON CHANGE ONLY — re-issuing the same frame at the client's
 * affirmative-keepalive rate (~10/s) churns the advertiser's async start/stop and DROPS
 * frames (incl. the release NEUTRAL → motor never stops). The keepalive's liveness job is the
 * server-side per-channel timeout (ControlApp), not the radio; the radio just mirrors changes.
 */
class RadioController(private val ble: BleSink) : Radio {

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
        if (nb.contentEquals(nibbles)) return         // CHANGE ONLY — don't churn the BLE advertiser
        nibbles = nb.copyOf()
        if (lifecycle == "READY") advertiseMotion()
    }

    override fun sendNeutral() {
        val n = neutral()
        if (n.contentEquals(nibbles)) return          // already neutral on-air (radio keeps repeating it)
        nibbles = n
        if (lifecycle == "READY") advertiseMotion()   // CONNECTING keeps the connect telegram
    }

    // STOP: KILL the radio + RECONNECT at neutral. The BLE keepalive repeats its last frame
    // forever, so a dropped neutral leaves a stale non-zero running; tearing the advertiser down
    // and re-establishing a clean neutral guarantees the repeated frame is neutral.
    override fun hardStop() {
        nibbles = neutral()
        ble.hardStop(Mk4Telegrams.connect(),
                     MouldKingCrypt.encode(Mk4Telegrams.motionRawHexNibbles(nibbles)))
    }

    private fun advertiseMotion() =
        ble.setPayload(MouldKingCrypt.encode(Mk4Telegrams.motionRawHexNibbles(nibbles)), "MOTION")

    private fun neutral() = IntArray(Mk4Telegrams.N_CHANNELS) { Mk4Telegrams.NEUTRAL }
}
