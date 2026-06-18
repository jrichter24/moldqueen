package com.dnaevolutions.moldqueen.core

import com.dnaevolutions.moldqueen.Mk4Telegrams.N_CHANNELS
import com.dnaevolutions.moldqueen.Mk4Telegrams.NEUTRAL
import com.dnaevolutions.moldqueen.Mk4Telegrams.channelIndex
import com.dnaevolutions.moldqueen.Mk4Telegrams.nibbleToValue
import com.dnaevolutions.moldqueen.Mk4Telegrams.valueToNibble
import org.json.JSONArray
import org.json.JSONObject

/** Persistence seam for per-layout default channel maps (bundled asset + override). */
interface MapStore {
    /** This layout's DEFAULT map JSON text (persisted override or bundled asset), or null. */
    fun loadDefault(layoutId: String): String?
    /** Persist this layout's DEFAULT map JSON text (promote). */
    fun saveDefault(layoutId: String, jsonText: String)
}

/**
 * Active-layout registry parsed from web/layouts.json. Mirrors api.py's ACTIVE_LAYOUTS /
 * LAYOUT_FUNCTIONS / DEFAULT_LAYOUT: only ACTIVE, function-mapped layouts that declare a
 * non-empty function set are exposed, in manifest order (DEFAULT = the first).
 */
class LayoutRegistry(layoutsJson: String) {
    val layoutFunctions = LinkedHashMap<String, List<String>>()
    val defaultLayout: String?

    init {
        val arr = JSONObject(layoutsJson).optJSONArray("layouts") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val lay = arr.getJSONObject(i)
            if (!lay.optBoolean("active", true)) continue
            if (lay.optString("kind") != "function-mapped") continue
            val fnsArr = lay.optJSONArray("functions") ?: continue
            if (fnsArr.length() == 0) continue
            layoutFunctions[lay.getString("id")] = (0 until fnsArr.length()).map { fnsArr.getString(it) }
        }
        defaultLayout = layoutFunctions.keys.firstOrNull()
    }
}

/**
 * Authoritative control state — a clean-room port of api.py's `App`. Holds the lifecycle,
 * the 12-nibble state, the active function-mapped layout (its function set + default/active
 * maps) and the session device-swap. Pure: no Android, no transport.
 */
class ControlApp(
    private val registry: LayoutRegistry,
    private val store: MapStore,
) {
    var lifecycle: String = IDLE
    val nibbles = IntArray(N_CHANNELS) { NEUTRAL }
    var layoutId: String? = registry.defaultLayout
        private set
    var functions: List<String> = registry.layoutFunctions[registry.defaultLayout] ?: emptyList()
        private set
    var defaultMap: JSONObject = loadDefault()
        private set
    var activeMap: JSONObject = clone(defaultMap)
        private set
    var deviceSwap: Boolean = false
        private set

    private fun loadDefault(): JSONObject {
        val id = layoutId ?: return JSONObject().put("version", 1).put("functions", JSONObject())
        return ChannelMap.load(store.loadDefault(id), functions)
    }

    /** Switch the active function-mapped layout; no-op for unknown/current ids. */
    fun setLayout(id: String): Boolean {
        if (!registry.layoutFunctions.containsKey(id) || id == layoutId) return false
        layoutId = id
        functions = registry.layoutFunctions[id]!!
        defaultMap = loadDefault()
        activeMap = clone(defaultMap)
        return true
    }

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

    /** READY-only. Resolve a function via the ACTIVE map and set its nibble. Returns [slot,ch,out] or null. */
    fun drive(function: String?, value: Int?): IntArray? {
        if (lifecycle != READY || function == null || value == null) return null
        val r = ChannelMap.resolve(activeMap, function, value, deviceSwap) ?: return null
        nibbles[channelIndex(r[0], r[1])] = valueToNibble(r[2])
        return r
    }

    fun setActiveMap(mp: JSONObject): Pair<Boolean, List<String>> {
        val (ok, errs) = ChannelMap.validate(mp, functions)
        if (ok) activeMap = clone(mp)
        return ok to errs
    }

    fun setSwap(on: Boolean) { deviceSwap = on }

    /** Persist [mp] (or active) as THIS layout's default. Validates against the function set. */
    fun promote(mp: JSONObject?): Pair<Boolean, List<String>> {
        val cand = mp ?: activeMap
        val (ok, errs) = ChannelMap.validate(cand, functions)
        if (!ok) return ok to errs
        return try {
            ChannelMap.migrate(cand)                  // save() writes the canonical shape
            store.saveDefault(layoutId!!, cand.toString())
            activeMap = clone(cand)
            defaultMap = clone(cand)
            true to emptyList()
        } catch (e: Exception) {
            false to listOf(e.message ?: "save failed")
        }
    }

    private fun clone(o: JSONObject) = JSONObject(o.toString())

    companion object {
        const val IDLE = "IDLE"
        const val CONNECTING = "CONNECTING"
        const val READY = "READY"
    }
}
