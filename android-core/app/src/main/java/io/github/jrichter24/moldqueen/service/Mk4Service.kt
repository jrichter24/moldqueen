package io.github.jrichter24.moldqueen.service

import android.content.Context
import android.util.Log
import io.github.jrichter24.moldqueen.BleBroadcaster
import io.github.jrichter24.moldqueen.core.ApiCore
import io.github.jrichter24.moldqueen.core.ClientRoutes
import io.github.jrichter24.moldqueen.core.ControlApp
import io.github.jrichter24.moldqueen.core.InfoConfig
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.net.InetSocketAddress
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * The single service: a THIN-TRANSPORT WS API + the local client HTTP server, in one
 * process. Owns the pure [ApiCore]/[ControlApp] (lifecycle + 12 nibbles only), the
 * [RadioController] driving the proven [BleBroadcaster], and the loopback servers. The
 * client (served from bundled assets) owns the channel map — no map state here. The WebView
 * connects to ws://localhost:8765 and sees the same thin-transport contract as the Pi.
 */
class Mk4Service(context: Context) {

    private val appCtx = context.applicationContext
    private val ble = BleBroadcaster(appCtx)
    private val radio = RadioController(ble)
    private val controlApp = ControlApp()
    val core = ApiCore(controlApp, radio, AndroidInfoConfig(appCtx))
    private val routes = ClientRoutes(asset("web/layouts.json"))   // HTML route derivation for serving

    private var wsServer: Mk4WsServer? = null
    private var httpServer: ClientHttpServer? = null
    private var watchdog: ScheduledExecutorService? = null

    fun start() {
        if (wsServer == null) {
            wsServer = Mk4WsServer(InetSocketAddress("127.0.0.1", WS_PORT), core).also {
                it.isReuseAddr = true
                it.start()
            }
        }
        if (httpServer == null) {
            httpServer = ClientHttpServer(HTTP_PORT, appCtx.assets, WS_PORT, routes).also {
                it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            }
        }
        if (watchdog == null) {
            // per-channel dead-man's-switch: poll ApiCore; un-refreshed channels -> NEUTRAL (parity with api.py)
            watchdog = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "mk4-watchdog") }.also {
                it.scheduleAtFixedRate({
                    runCatching { if (core.tickWatchdog()) Log.w(TAG, "channel not refreshed -> NEUTRAL (dead-man's-switch)") }
                }, 50, 50, TimeUnit.MILLISECONDS)
            }
        }
        Log.i(TAG, "Mk4Service started; client http://127.0.0.1:$HTTP_PORT  ·  WS ws://127.0.0.1:$WS_PORT")
    }

    fun stop() {
        watchdog?.let { runCatching { it.shutdownNow() } }; watchdog = null
        wsServer?.let { runCatching { it.stop(1000) } }; wsServer = null
        httpServer?.let { runCatching { it.stop() } }; httpServer = null
        ble.stop()
    }

    val bleReady: Boolean get() = ble.isReady()

    private fun asset(name: String): String =
        appCtx.assets.open(name).bufferedReader().use { it.readText() }

    private class AndroidInfoConfig(private val ctx: Context) : InfoConfig {
        override val level = "light"
        // version — the APK's committed versionName (release "0.1.0"; debug "0.1.0-debug+<sha>").
        // Shows in the client's Server-info tab so the running build is verifiable on-device.
        override val version = io.github.jrichter24.moldqueen.BuildConfig.VERSION_NAME
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
