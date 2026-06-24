package io.github.jrichter24.moldqueen.service

import io.github.jrichter24.moldqueen.BleSink
import io.github.jrichter24.moldqueen.Mk4Telegrams
import io.github.jrichter24.moldqueen.MouldKingCrypt
import io.github.jrichter24.moldqueen.core.ApiCore
import io.github.jrichter24.moldqueen.core.ClientSink
import io.github.jrichter24.moldqueen.core.ControlApp
import io.github.jrichter24.moldqueen.core.InfoConfig
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The affirmative keepalive re-sends the SAME `set` ~10/s; RadioController must advertise on
 * CHANGE ONLY so the BLE advertiser isn't churned (churn drops the release NEUTRAL = runaway).
 * A CHANGE — including the release neutral and the disconnect/timeout neutral — MUST advertise.
 */
class RadioControllerDedupTest {

    private class FakeBle : BleSink {
        var motion = 0; var hardStops = 0
        var lastConnect: ByteArray? = null; var lastNeutral: ByteArray? = null
        override fun setPayload(bytes: ByteArray, label: String) { if (label == "MOTION") motion++ }
        override fun stop() {}
        override fun hardStop(connect: ByteArray, neutral: ByteArray) { hardStops++; lastConnect = connect; lastNeutral = neutral }
    }

    private fun neutral() = IntArray(Mk4Telegrams.N_CHANNELS) { Mk4Telegrams.NEUTRAL }
    private fun drive(ci: Int): IntArray { val a = neutral(); a[ci] = Mk4Telegrams.NEUTRAL + 3; return a }

    @Test
    fun repeatedSameStateDoesNotChurn() {
        val ble = FakeBle(); val rc = RadioController(ble)
        rc.setup("ready")                                   // advertises current (neutral) once
        val base = ble.motion
        rc.sendState(drive(4))                              // CHANGE -> 1 advertise
        rc.sendState(drive(4)); rc.sendState(drive(4)); rc.sendState(drive(4))  // keepalive re-affirm (same)
        assertEquals("re-advertise on CHANGE only (not per keepalive)", base + 1, ble.motion)
    }

    @Test
    fun releaseNeutralIsAdvertised() {
        val ble = FakeBle(); val rc = RadioController(ble)
        rc.setup("ready"); rc.sendState(drive(4))
        val c = ble.motion
        rc.sendState(neutral())                            // RELEASE -> CHANGE -> must advertise neutral
        assertEquals("release neutral advertised", c + 1, ble.motion)
    }

    @Test
    fun disconnectTimeoutNeutralIsAdvertised() {
        val ble = FakeBle(); val rc = RadioController(ble)
        rc.setup("ready"); rc.sendState(drive(4))
        val c = ble.motion
        rc.sendNeutral()                                   // gamepad-disconnect / per-channel timeout path
        assertEquals("sendNeutral after drive advertises", c + 1, ble.motion)
    }

    @Test
    fun hardStopKillsAndReconnectsAtNeutral() {
        val ble = FakeBle(); val rc = RadioController(ble)
        rc.setup("ready"); rc.sendState(drive(4))          // driving a non-zero
        rc.hardStop()                                      // STOP
        assertEquals("STOP tears down + reconnects the radio once", 1, ble.hardStops)
        val neutralMotion = MouldKingCrypt.encode(Mk4Telegrams.motionRawHexNibbles(neutral()))
        assertArrayEquals("reconnect payload = all-neutral (0x8) motion telegram", neutralMotion, ble.lastNeutral)
        assertArrayEquals("reconnect re-sends the connect telegram", Mk4Telegrams.connect(), ble.lastConnect)
    }

    // End-to-end through the real ApiCore: the client keepalive re-sends the same `set` ~10/s,
    // then releases with value 0. The radio must advertise ONCE for the drive (not per keepalive)
    // and ONCE for the release — proving touch+release stops on the actual Android path.
    @Test
    fun endToEndKeepaliveNoChurnReleaseStops() {
        val ble = FakeBle()
        val core = ApiCore(ControlApp(), RadioController(ble), fakeInfo())
        val sink = ClientSink { }
        core.onConnect(sink)
        core.onMessage(sink, """{"cmd":"setup","action":"ready"}""")   // advertises neutral once
        val base = ble.motion
        repeat(6) { core.onMessage(sink, """{"cmd":"set","slot":1,"channel":0,"value":5}""") }  // keepalive (same)
        assertEquals("6 keepalive sends of the same value -> ONE advertise", base + 1, ble.motion)
        core.onMessage(sink, """{"cmd":"set","slot":1,"channel":0,"value":0}""")   // RELEASE
        assertEquals("release advertises the neutral -> motor stops", base + 2, ble.motion)
    }

    private fun fakeInfo() = object : InfoConfig {
        override val level = "safe"; override val version = "t"; override val radioBackend = "x"
        override val dryRun = true; override val hci = "x"; override val wsPort = 0; override val httpPort = 0
        override val serveClient = false
        override fun adapterMac(): String? = null
        override fun hostname() = "t"
        override fun bluetoothd(): String? = null
        override val hostBind = "x"
        override fun paths() = JSONObject()
    }
}
