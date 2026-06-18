package com.dnaevolutions.moldqueen.service

import android.content.Context
import android.util.Log
import com.dnaevolutions.moldqueen.BleBroadcaster
import com.dnaevolutions.moldqueen.core.ApiCore
import com.dnaevolutions.moldqueen.core.ClientSink
import com.dnaevolutions.moldqueen.core.ControlApp
import com.dnaevolutions.moldqueen.core.InfoConfig
import com.dnaevolutions.moldqueen.core.LayoutRegistry
import org.json.JSONObject
import java.net.InetSocketAddress

/**
 * The single service that fuses broadcaster-logic + the local WS API (api.py + the Pi
 * broadcaster, in one process). Owns: the pure [ApiCore]/[ControlApp], the [RadioController]
 * driving the proven [BleBroadcaster], the asset/override [AssetMapStore], and the
 * [Mk4WsServer] bound to loopback. Layer 3 (the WebView) connects to ws://localhost:8765
 * and sees the same contract as the Pi — no Android knowledge in the client.
 */
class Mk4Service(context: Context) {

    private val appCtx = context.applicationContext
    private val ble = BleBroadcaster(appCtx)
    private val radio = RadioController(ble)
    private val store = AssetMapStore(appCtx)
    private val registry = LayoutRegistry(asset("layouts.json"))
    private val controlApp = ControlApp(registry, store)
    val core = ApiCore(controlApp, radio, AndroidInfoConfig(appCtx))

    private var server: Mk4WsServer? = null
    /** A local, NON-counted sink so the on-device UI can drive the radio before a WebView exists. */
    private val uiSink = ClientSink { /* replies to UI commands are no-ops; pushes go to real WS clients */ }

    fun start() {
        if (server != null) return
        server = Mk4WsServer(InetSocketAddress("127.0.0.1", WS_PORT), core).also {
            it.isReuseAddr = true
            it.start()
        }
        Log.i(TAG, "Mk4Service started; WS ws://127.0.0.1:$WS_PORT")
    }

    fun stop() {
        server?.let { runCatching { it.stop(1000) } }
        server = null
        ble.stop()
    }

    /** Inject a control command from the local UI. The sink is NOT registered as a client
     *  (only onConnect registers), so it drives the radio + pushes to real WS clients
     *  without counting toward the disconnect-safety client set. */
    fun submit(json: String) = core.onMessage(uiSink, json)

    val bleReady: Boolean get() = ble.isReady()

    private fun asset(name: String): String =
        appCtx.assets.open(name).bufferedReader().use { it.readText() }

    private class AndroidInfoConfig(private val ctx: Context) : InfoConfig {
        override val level = "light"
        override val version = "0.1.0"          // matches config.VERSION
        override val radioBackend = "android-ble"
        override val dryRun = false
        override val hci = "android-ble"
        override val wsPort = WS_PORT
        override val httpPort = 8080
        override val serveClient = false        // layer 3 will serve the client over local HTTP
        override fun adapterMac(): String? = null
        override fun hostname() = android.os.Build.MODEL ?: "android"
        override fun bluetoothd(): String? = null
        override val hostBind = "127.0.0.1"
        override fun paths() = JSONObject().put("files_dir", ctx.filesDir.absolutePath)
    }

    companion object {
        private const val TAG = "Mk4Service"
        const val WS_PORT = 8765
    }
}
