package com.dnaevolutions.moldqueen.service

import android.content.Context
import android.util.Log
import com.dnaevolutions.moldqueen.BleBroadcaster
import com.dnaevolutions.moldqueen.core.ApiCore
import com.dnaevolutions.moldqueen.core.ClientRoutes
import com.dnaevolutions.moldqueen.core.ControlApp
import com.dnaevolutions.moldqueen.core.InfoConfig
import com.dnaevolutions.moldqueen.core.LayoutRegistry
import fi.iki.elonen.NanoHTTPD
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
    private val registry = LayoutRegistry(asset("web/layouts.json"))
    private val controlApp = ControlApp(registry, store)
    val core = ApiCore(controlApp, radio, AndroidInfoConfig(appCtx))
    private val routes = ClientRoutes(asset("web/layouts.json"))

    private var wsServer: Mk4WsServer? = null
    private var httpServer: ClientHttpServer? = null

    fun start() {
        if (wsServer == null) {
            wsServer = Mk4WsServer(InetSocketAddress("127.0.0.1", WS_PORT), core).also {
                it.isReuseAddr = true
                it.start()
            }
        }
        if (httpServer == null) {
            httpServer = ClientHttpServer(HTTP_PORT, appCtx.assets, WS_PORT, routes, ::initJson).also {
                it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            }
        }
        Log.i(TAG, "Mk4Service started; client http://127.0.0.1:$HTTP_PORT  ·  WS ws://127.0.0.1:$WS_PORT")
    }

    fun stop() {
        wsServer?.let { runCatching { it.stop(1000) } }; wsServer = null
        httpServer?.let { runCatching { it.stop() } }; httpServer = null
        ble.stop()
    }

    /** The __INIT_JSON__ the served HTML bootstraps from — mirrors api.py's init dict. */
    private fun initJson(): String = JSONObject()
        .put("default", controlApp.defaultMap)
        .put("active", controlApp.activeMap)
        .put("device_swap", controlApp.deviceSwap)
        .put("lifecycle", controlApp.lifecycle)
        .toString()

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
        override val httpPort = HTTP_PORT
        override val serveClient = true         // the client is served over local HTTP (layer 3)
        override fun adapterMac(): String? = null
        override fun hostname() = android.os.Build.MODEL ?: "android"
        override fun bluetoothd(): String? = null
        override val hostBind = "127.0.0.1"
        override fun paths() = JSONObject().put("files_dir", ctx.filesDir.absolutePath)
    }

    companion object {
        private const val TAG = "Mk4Service"
        const val WS_PORT = 8765
        const val HTTP_PORT = 8080
    }
}
