package com.dnaevolutions.moldqueen.core

import com.dnaevolutions.moldqueen.Mk4Telegrams
import com.dnaevolutions.moldqueen.core.ControlApp.Companion.CONNECTING
import com.dnaevolutions.moldqueen.core.ControlApp.Companion.IDLE
import com.dnaevolutions.moldqueen.core.ControlApp.Companion.READY
import org.json.JSONArray
import org.json.JSONObject
import java.util.Collections

/** One connected client (transport-agnostic). */
fun interface ClientSink {
    fun send(text: String)
}

/** The radio side (api.py's IPCClient -> broadcaster). Android wires this to BleBroadcaster. */
interface Radio {
    fun setup(action: String)          // connect | ready | reset
    fun sendState(nibbles: IntArray)   // motion nibbles changed
    fun sendNeutral()                  // force neutral
}

/** Supplies the server-info field VALUES; ApiCore applies the tier logic (api.py info_json). */
interface InfoConfig {
    val level: String                  // safe | light | debug
    val version: String
    val radioBackend: String
    val dryRun: Boolean
    val hci: String
    val wsPort: Int
    val httpPort: Int
    val serveClient: Boolean
    fun adapterMac(): String?
    fun hostname(): String
    fun bluetoothd(): String?
    val hostBind: String
    fun paths(): JSONObject
}

/**
 * The WebSocket control API, clean-room port of bt-core/mk4web/api.py's handler + push
 * choreography. Pure (no Android/transport): the Android layer feeds it onConnect/
 * onMessage/onDisconnect and implements [ClientSink]/[Radio]/[InfoConfig].
 *
 * Push choreography matches api.py exactly:
 *  - on connect: send lifecycle, then state, then map (to the new client);
 *  - setup: push lifecycle + state to all;
 *  - set/drive: push state to all (READY only);
 *  - map get: reply map to requester; map set/promote: reply mapresult to requester,
 *    and on success push map + state to all; map swap: push map + state to all;
 *  - stop: push state to all; state: reply lifecycle + state; info: reply info;
 *  - on disconnect: NEUTRAL + push state to all (safety).
 */
class ApiCore(
    val app: ControlApp,
    private val radio: Radio,
    private val info: InfoConfig,
) {
    private val clients: MutableSet<ClientSink> = Collections.synchronizedSet(LinkedHashSet())

    fun clientCount(): Int = clients.size

    // Serialized to mirror the Pi's single-threaded asyncio handler (Java-WebSocket is
    // multi-threaded). All state mutation + push happens under this monitor.
    @Synchronized
    fun onConnect(c: ClientSink) {
        clients.add(c)
        c.send(lifecycleJson())
        c.send(stateJson())
        c.send(mapJson())
    }

    @Synchronized
    fun onDisconnect(c: ClientSink) {
        clients.remove(c)
        app.stop()                         // SAFETY: client gone -> neutral
        radio.sendNeutral()
        push(stateJson())
    }

    @Synchronized
    fun onMessage(c: ClientSink, raw: String) {
        val msg = try { JSONObject(raw) } catch (e: Exception) { return }
        when (msg.optString("cmd")) {
            "setup" -> {
                val action = msg.optString("action")
                if (action in setOf("connect", "ready", "reset")) {
                    app.lifecycle = when (action) {
                        "connect" -> CONNECTING; "ready" -> READY; else -> IDLE
                    }
                    if (action == "reset") app.stop()
                    radio.setup(action)
                    push(lifecycleJson())
                    push(stateJson())
                }
            }
            "set" -> if (app.lifecycle == READY) {
                app.set(optIntOrNull(msg, "slot"), optIntOrNull(msg, "channel"), optIntOrNull(msg, "value"))
                radio.sendState(app.nibbles)
                push(stateJson())
            }
            "drive" -> if (app.lifecycle == READY) {
                val fn = if (msg.has("function")) msg.optString("function") else null
                if (app.drive(fn, optIntOrNull(msg, "value")) != null) {
                    radio.sendState(app.nibbles)
                    push(stateJson())
                }
            }
            "map" -> handleMap(c, msg)
            "stop" -> {
                app.stop()
                radio.sendNeutral()
                push(stateJson())
            }
            "state" -> {
                c.send(lifecycleJson())
                c.send(stateJson())
            }
            "info" -> c.send(infoJson(info.level))
        }
    }

    private fun handleMap(c: ClientSink, msg: JSONObject) {
        val layout = if (msg.has("layout")) msg.optString("layout") else ""
        if (layout.isNotEmpty() && app.setLayout(layout)) {
            app.stop(); radio.sendNeutral()
            push(mapJson()); push(stateJson())
        }
        when (msg.optString("action")) {
            "get" -> c.send(mapJson())
            "set" -> {
                val (ok, errs) = app.setActiveMap(msg.optJSONObject("map") ?: JSONObject())
                if (ok) { app.stop(); radio.sendNeutral() }
                c.send(mapResultJson("set", ok, errs))
                if (ok) { push(mapJson()); push(stateJson()) }
            }
            "swap" -> {
                app.setSwap(msg.optBoolean("value"))
                app.stop(); radio.sendNeutral()
                push(mapJson()); push(stateJson())
            }
            "promote" -> {
                val (ok, errs) = app.promote(msg.optJSONObject("map"))
                if (ok) { app.stop(); radio.sendNeutral() }
                c.send(mapResultJson("promote", ok, errs))
                if (ok) { push(mapJson()); push(stateJson()) }
            }
        }
    }

    // ---- server -> client JSON (field names/shapes match api.py) -----------------

    fun lifecycleJson(): String =
        JSONObject().put("type", "lifecycle").put("state", app.lifecycle).toString()

    fun stateJson(): String {
        val raw = Mk4Telegrams.motionRawHexNibbles(app.nibbles)
        val slots = JSONArray()
        for (row in app.slotsGrid()) slots.put(JSONArray(row))
        return JSONObject()
            .put("type", "state")
            .put("slots", slots)
            .put("raw", raw)
            .put("ad", Mk4Telegrams.adHex(raw))
            .toString()
    }

    fun mapJson(): String =
        JSONObject()
            .put("type", "map")
            .put("layout", app.layoutId ?: JSONObject.NULL)
            .put("default", app.defaultMap)
            .put("active", app.activeMap)
            .put("device_swap", app.deviceSwap)
            .toString()

    private fun mapResultJson(action: String, ok: Boolean, errors: List<String>): String =
        JSONObject()
            .put("type", "mapresult")
            .put("action", action)
            .put("ok", ok)
            .put("errors", JSONArray(errors))
            .toString()

    fun infoJson(level: String): String {
        val o = JSONObject()
            .put("type", "info").put("app", "moldqueen").put("version", info.version)
            .put("lifecycle", app.lifecycle).put("info_level", level)
        if (level == "light" || level == "debug") {
            o.put("radio_backend", info.radioBackend).put("dry_run", info.dryRun).put("hci", info.hci)
                .put("ws_port", info.wsPort).put("http_port", info.httpPort)
                .put("serve_client", info.serveClient).put("layout", app.layoutId ?: JSONObject.NULL)
        }
        if (level == "debug") {
            o.put("adapter_mac", info.adapterMac() ?: JSONObject.NULL).put("hostname", info.hostname())
                .put("bluetoothd", info.bluetoothd() ?: JSONObject.NULL).put("host_bind", info.hostBind)
                .put("paths", info.paths())
        }
        return o.toString()
    }

    private fun push(text: String) {
        val snapshot = synchronized(clients) { clients.toList() }
        for (cl in snapshot) runCatching { cl.send(text) }
    }

    /** Python-ish: present integer field or null (missing/non-int -> null, no coercion of bools). */
    private fun optIntOrNull(o: JSONObject, key: String): Int? {
        val v = o.opt(key)
        return when (v) {
            is Int -> v
            is Long -> v.toInt()
            else -> null
        }
    }
}
