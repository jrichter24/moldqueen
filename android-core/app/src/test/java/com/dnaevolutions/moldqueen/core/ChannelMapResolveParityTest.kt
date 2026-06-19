package com.dnaevolutions.moldqueen.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Resolution parity: every vector here was produced by the AUTHORITATIVE
 * linux-core/mk4web/channelmap.py (see tools that generated resolve_vectors.json).
 * Same input -> same (slot, channel, value) as the Pi. Covers the excavator map
 * and a synthetic map exercising reverse_scale half-to-even rounding, per-direction
 * caps, invert, legacy `max`, slot-2 (swap-immune), and unknown functions.
 */
class ChannelMapResolveParityTest {

    private fun res(name: String): String =
        javaClass.getResourceAsStream("/$name")!!.bufferedReader().readText()

    private val maps = mapOf(
        "excavator" to JSONObject(res("resolve_excavator_map.json")),
        "synth" to JSONObject(res("resolve_synth_map.json")),
    )

    @Test fun resolve_matches_channelmap_py_vectors() {
        val vectors = JSONArray(res("resolve_vectors.json"))
        var checked = 0
        for (i in 0 until vectors.length()) {
            val vec = vectors.getJSONObject(i)
            val mp = maps.getValue(vec.getString("map"))
            val fn = vec.getString("function")
            val value = vec.getInt("value")
            val swap = vec.getBoolean("swap")
            val got = ChannelMap.resolve(mp, fn, value, swap)
            val label = "map=${vec.getString("map")} fn=$fn val=$value swap=$swap"
            if (vec.isNull("expected")) {
                assertNull("expected null for $label, got ${got?.toList()}", got)
            } else {
                val exp = vec.getJSONArray("expected")
                requireNotNull(got) { "expected ${exp} for $label, got null" }
                assertEquals("slot $label", exp.getInt(0), got[0])
                assertEquals("channel $label", exp.getInt(1), got[1])
                assertEquals("out $label", exp.getInt(2), got[2])
            }
            checked++
        }
        assertEquals(510, checked)
    }
}
