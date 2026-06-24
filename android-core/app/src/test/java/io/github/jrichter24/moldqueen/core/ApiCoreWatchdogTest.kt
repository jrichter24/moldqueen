package io.github.jrichter24.moldqueen.core

import io.github.jrichter24.moldqueen.Mk4Telegrams
import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Affirmative per-channel dead-man's-switch (parity with api.py channel_watchdog): a channel
 *  is held ONLY while actively re-affirmed; one that stops being refreshed auto-neutralizes,
 *  while a refreshed (held) one does not. Per-channel — refreshing A must not save B. */
class ApiCoreWatchdogTest {

    private val sink = ClientSink { /* discard */ }
    private val NEUTRAL = Mk4Telegrams.NEUTRAL
    private val chLeft = Mk4Telegrams.channelIndex(1, 0)   // slot1/ch0
    private val chRight = Mk4Telegrams.channelIndex(1, 2)  // slot1/ch2

    private fun newCore(): ApiCore {
        val radio = object : Radio {
            override fun setup(action: String) {}
            override fun sendState(nibbles: IntArray) {}
            override fun sendNeutral() {}
            override fun hardStop() {}
        }
        val info = object : InfoConfig {
            override val level = "safe"; override val version = "t"; override val radioBackend = "x"
            override val dryRun = true; override val hci = "x"; override val wsPort = 0; override val httpPort = 0
            override val serveClient = false
            override fun adapterMac(): String? = null
            override fun hostname() = "t"
            override fun bluetoothd(): String? = null
            override val hostBind = "x"
            override fun paths() = JSONObject()
        }
        val core = ApiCore(ControlApp(), radio, info)
        core.onConnect(sink)
        core.onMessage(sink, """{"cmd":"setup","action":"ready"}""")
        return core
    }
    private fun set(core: ApiCore, slot: Int, ch: Int, v: Int) =
        core.onMessage(sink, """{"cmd":"set","slot":$slot,"channel":$ch,"value":$v}""")

    @Test
    fun unrefreshedChannelNeutralizes() {
        val core = newCore()
        set(core, 1, 0, 5)
        assertFalse("fresh channel must NOT fire", core.tickWatchdog())
        assertNotEquals("driving", NEUTRAL, core.app.nibbles[chLeft])
        Thread.sleep(380)                                   // > 300ms, no refresh
        assertTrue("stale channel MUST neutralize", core.tickWatchdog())
        assertEquals("channel neutral after timeout", NEUTRAL, core.app.nibbles[chLeft])
    }

    @Test
    fun refreshedChannelHeld() {
        val core = newCore()
        set(core, 1, 0, 5)
        val end = System.nanoTime() + 500_000_000L
        var fired = false
        while (System.nanoTime() < end) {
            set(core, 1, 0, 5)                              // re-affirm ~25/s
            if (core.tickWatchdog()) fired = true
            Thread.sleep(40)
        }
        assertFalse("a refreshed (held) channel must NOT be neutralized", fired)
        assertNotEquals("still driving", NEUTRAL, core.app.nibbles[chLeft])
    }

    @Test
    fun perChannelIsolation() {
        val core = newCore()
        set(core, 1, 0, 5)                                  // left  (refreshed below)
        set(core, 1, 2, 3)                                  // right (never refreshed again)
        val end = System.nanoTime() + 450_000_000L
        while (System.nanoTime() < end) {
            set(core, 1, 0, 5)                              // refresh ONLY left
            core.tickWatchdog()
            Thread.sleep(40)
        }
        assertEquals("un-refreshed channel neutralized", NEUTRAL, core.app.nibbles[chRight])
        assertNotEquals("refreshed channel still driving", NEUTRAL, core.app.nibbles[chLeft])
    }
}
