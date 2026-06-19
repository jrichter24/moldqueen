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

/** The radio side (broadcaster). Android wires this to BleBroadcaster. */
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
 * The DUMB-transport WebSocket API, clean-room port of linux-core/mk4web/api.py's handler.
 * Pure (no Android/transport): the Android layer feeds it onConnect/onMessage/onDisconnect
 * and implements [ClientSink]/[Radio]/[InfoConfig].
 *
 * The server knows NOTHING about functions/maps/invert/caps/labels — the client owns all
 * that and sends only low-level `set`. Choreography:
 *  - on connect: send lifecycle, then state;
 *  - setup: push lifecycle + state; set: push state (READY only); stop: push state;
 *  - state: reply lifecycle + state; info: reply info; on disconnect: NEUTRAL + push state.
 */
class ApiCore(
    val app: ControlApp,
    private val radio: Radio,
    private val info: InfoConfig,
) {
    private val clients: MutableSet<ClientSink> = Collections.synchronizedSet(LinkedHashSet())

    // Dead-man's-switch: last time ANY client message arrived (heartbeat or otherwise).
    // A connected-but-quiet client must NOT leave motors latched — see tickWatchdog().
    @Volatile private var lastClientActivity = System.nanoTime()

    fun clientCount(): Int = clients.size

    // Serialized to mirror the Pi's single-threaded asyncio handler (Java-WebSocket is
    // multi-threaded). All state mutation + push happens under this monitor.
    @Synchronized
    fun onConnect(c: ClientSink) {
        clients.add(c)
        lastClientActivity = System.nanoTime()   // fresh on connect (watchdog)
        c.send(lifecycleJson())
        c.send(stateJson())
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
        lastClientActivity = System.nanoTime()        // ANY message proves the client is alive
        val msg = try { JSONObject(raw) } catch (e: Exception) { return }
        when (msg.optString("cmd")) {
            "ping" -> { /* heartbeat: activity refreshed above; nothing else to do */ }
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
            "set" -> if (app.lifecycle == READY) {   // the ONLY motion primitive
                app.set(optIntOrNull(msg, "slot"), optIntOrNull(msg, "channel"), optIntOrNull(msg, "value"))
                radio.sendState(app.nibbles)
                push(stateJson())
            }
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

    fun infoJson(level: String): String {
        val o = JSONObject()
            .put("type", "info").put("app", "moldqueen").put("version", info.version)
            .put("lifecycle", app.lifecycle).put("info_level", level)
        if (level == "light" || level == "debug") {
            o.put("radio_backend", info.radioBackend).put("dry_run", info.dryRun).put("hci", info.hci)
                .put("ws_port", info.wsPort).put("http_port", info.httpPort)
                .put("serve_client", info.serveClient)
        }
        if (level == "debug") {
            o.put("adapter_mac", info.adapterMac() ?: JSONObject.NULL).put("hostname", info.hostname())
                .put("bluetoothd", info.bluetoothd() ?: JSONObject.NULL).put("host_bind", info.hostBind)
                .put("paths", info.paths())
        }
        return o.toString()
    }

    /**
     * Dead-man's-switch (clean-room port of api.py's watchdog()): if no client message
     * (heartbeat or otherwise) has arrived within WATCHDOG_NS while READY and the state is
     * non-neutral, command NEUTRAL. Protects against ANY quiet client — including the
     * frozen-gamepad / stalled-loop runaway. Call periodically from a timer. Returns true
     * if it fired (caller may log).
     */
    @Synchronized
    fun tickWatchdog(): Boolean {
        if (app.lifecycle == READY && !app.isNeutral() &&
            System.nanoTime() - lastClientActivity > WATCHDOG_NS) {
            app.stop()
            radio.sendNeutral()
            push(stateJson())
            return true
        }
        return false
    }

    private fun push(text: String) {
        val snapshot = synchronized(clients) { clients.toList() }
        for (cl in snapshot) runCatching { cl.send(text) }
    }

    private fun optIntOrNull(o: JSONObject, key: String): Int? {
        val v = o.opt(key)
        return when (v) {
            is Int -> v
            is Long -> v.toInt()
            else -> null
        }
    }

    companion object {
        // Quiet-client window (~2.25 missed 200ms heartbeats). Matches api.py MK4_WATCHDOG=0.45s.
        private const val WATCHDOG_NS = 450_000_000L
    }
}
