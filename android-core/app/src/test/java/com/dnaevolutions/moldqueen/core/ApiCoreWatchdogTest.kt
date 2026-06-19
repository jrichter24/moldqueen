package com.dnaevolutions.moldqueen.core

import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Dead-man's-switch parity with api.py: a connected-but-quiet client must NOT leave
 *  motors latched, while a legitimately HELD + heartbeating control must not be falsely
 *  neutralized. Exercises ApiCore.tickWatchdog() directly (mirrors the Mk4Service timer). */
class ApiCoreWatchdogTest {

    private val sink = ClientSink { /* discard */ }

    private fun newCore(neutralCalls: IntArray): ApiCore {
        val radio = object : Radio {
            override fun setup(action: String) {}
            override fun sendState(nibbles: IntArray) {}
            override fun sendNeutral() { neutralCalls[0]++ }
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
        return ApiCore(ControlApp(), radio, info)
    }

    @Test
    fun quietClientNeutralizes() {
        val nc = intArrayOf(0); val core = newCore(nc)
        core.onConnect(sink)
        core.onMessage(sink, """{"cmd":"setup","action":"ready"}""")
        core.onMessage(sink, """{"cmd":"set","slot":1,"channel":0,"value":5}""")
        assertFalse("fresh activity must NOT fire", core.tickWatchdog())
        assertFalse("state is driving (non-neutral)", core.app.isNeutral())
        Thread.sleep(550)                                   // > 450ms window, no messages
        assertTrue("quiet > window MUST fire", core.tickWatchdog())
        assertTrue("state neutral after watchdog", core.app.isNeutral())
        assertTrue("radio.sendNeutral called", nc[0] >= 1)
    }

    @Test
    fun heldHeartbeatNotFalselyNeutralized() {
        val nc = intArrayOf(0); val core = newCore(nc)
        core.onConnect(sink)
        core.onMessage(sink, """{"cmd":"setup","action":"ready"}""")
        core.onMessage(sink, """{"cmd":"set","slot":1,"channel":0,"value":5}""")   // held control
        val start = System.nanoTime()
        var falselyFired = false
        while (System.nanoTime() - start < 700_000_000L) {  // 0.7s > window
            core.onMessage(sink, """{"cmd":"ping"}""")       // heartbeat keeps it alive
            if (core.tickWatchdog()) falselyFired = true
            Thread.sleep(50)
        }
        assertFalse("held + heartbeating must NOT be neutralized", falselyFired)
        assertFalse("state still driving", core.app.isNeutral())
    }
}
