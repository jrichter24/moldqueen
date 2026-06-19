package com.dnaevolutions.moldqueen.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * End-to-end exchange parity: replays the EXACT client message sequence captured from
 * the authoritative linux-core/mk4web/api.py (parity_golden.json) through [ApiCore], and
 * asserts the server messages match step-by-step — same types, order, choreography and
 * payloads (lifecycle/state/map/mapresult, incl. resolved nibbles, raw+AD bytes, and
 * map echoes after set/swap/promote).
 *
 * `info` is compared on field-PRESENCE + the tier-independent fields only: its other
 * values (radio_backend, hci, paths, …) are the server's own identity and legitimately
 * differ between Pi and Android — that is NOT a client-visible contract difference.
 */
class ApiExchangeParityTest {

    private fun res(name: String) = javaClass.getResourceAsStream("/$name")!!.bufferedReader().readText()

    private class RecordingSink : ClientSink {
        val out = mutableListOf<String>()
        override fun send(text: String) { out.add(text) }
    }

    private object NoopRadio : Radio {
        override fun setup(action: String) {}
        override fun sendState(nibbles: IntArray) {}
        override fun sendNeutral() {}
    }

    private class FixtureInfo : InfoConfig {
        override val level = "light"
        override val version = "0.1.0"
        override val radioBackend = "android-ble"
        override val dryRun = false
        override val hci = "android"
        override val wsPort = 8765
        override val httpPort = 8080
        override val serveClient = true
        override fun adapterMac() = null
        override fun hostname() = "android"
        override fun bluetoothd() = null
        override val hostBind = "127.0.0.1"
        override fun paths() = JSONObject()
    }

    private class MemStore(seed: Map<String, String>) : MapStore {
        private val m = HashMap(seed)
        override fun loadDefault(layoutId: String) = m[layoutId]
        override fun saveDefault(layoutId: String, jsonText: String) { m[layoutId] = jsonText }
    }

    @Test fun exchange_matches_api_py_golden() {
        val registry = LayoutRegistry(res("layouts.json"))
        val store = MemStore(mapOf("excavator" to res("resolve_excavator_map.json")))
        val app = ControlApp(registry, store)
        val core = ApiCore(app, NoopRadio, FixtureInfo())
        val sink = RecordingSink()

        val golden = JSONArray(res("parity_golden.json"))
        for (i in 0 until golden.length()) {
            val step = golden.getJSONObject(i)
            val label = step.getString("label")
            sink.out.clear()
            if (step.isNull("sent")) {
                core.onConnect(sink)
            } else {
                core.onMessage(sink, step.getJSONObject("sent").toString())
            }
            val got = sink.out.map { JSONObject(it) }
            val want = step.getJSONArray("recv")

            assertEquals("[$label] message count; got ${got.map { it.optString("type") }} " +
                "want ${(0 until want.length()).map { want.getJSONObject(it).optString("type") }}",
                want.length(), got.size)
            for (j in got.indices) {
                val g = got[j]; val w = want.getJSONObject(j)
                assertEquals("[$label] msg#$j type", w.getString("type"), g.getString("type"))
                if (w.getString("type") == "info") assertInfoParity(label, g, w)
                else assertTrue("[$label] msg#$j ($g) != golden ($w)", jsonEq(g, w))
            }
        }
    }

    private fun assertInfoParity(label: String, got: JSONObject, want: JSONObject) {
        assertEquals("[$label] info field set", keySet(want), keySet(got))
        for (k in listOf("type", "app", "version", "lifecycle", "info_level")) {
            assertEquals("[$label] info.$k", want.opt(k), got.opt(k))
        }
    }

    // ---- semantic JSON equality (objects order-insensitive, arrays order-sensitive) ----
    private fun jsonEq(a: Any?, b: Any?): Boolean {
        val x = if (a == JSONObject.NULL) null else a
        val y = if (b == JSONObject.NULL) null else b
        if (x is JSONObject && y is JSONObject) {
            if (keySet(x) != keySet(y)) return false
            return keySet(x).all { jsonEq(x.opt(it), y.opt(it)) }
        }
        if (x is JSONArray && y is JSONArray) {
            if (x.length() != y.length()) return false
            return (0 until x.length()).all { jsonEq(x.opt(it), y.opt(it)) }
        }
        return scalar(x) == scalar(y)
    }

    private fun keySet(o: JSONObject): Set<String> = o.keys().asSequence().toSet()

    private fun scalar(v: Any?): Any? = when (v) {
        is Int -> v.toLong()
        is Long -> v
        is Float -> scalar(v.toDouble())
        is Double -> if (!v.isInfinite() && v == Math.floor(v)) v.toLong() else v
        else -> v
    }
}
