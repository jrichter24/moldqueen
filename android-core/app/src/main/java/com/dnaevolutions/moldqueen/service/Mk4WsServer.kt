package com.dnaevolutions.moldqueen.service

import android.util.Log
import com.dnaevolutions.moldqueen.core.ApiCore
import com.dnaevolutions.moldqueen.core.ClientSink
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentHashMap

/**
 * Local WebSocket transport that adapts each connection to a [ClientSink] and forwards
 * the connect/message/disconnect lifecycle to [ApiCore]. Bound to loopback only — the
 * (future) WebView client connects to ws://localhost:<port>. Mirrors the Pi's serve().
 */
class Mk4WsServer(address: InetSocketAddress, private val core: ApiCore) : WebSocketServer(address) {

    private val sinks = ConcurrentHashMap<WebSocket, ClientSink>()

    init {
        isReuseAddr = true
    }

    override fun onStart() {
        Log.i(TAG, "WS API listening on ws://${address.hostString}:${address.port}")
    }

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake?) {
        val sink = ClientSink { text -> runCatching { conn.send(text) } }
        sinks[conn] = sink
        core.onConnect(sink)
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String?, remote: Boolean) {
        sinks.remove(conn)?.let { core.onDisconnect(it) }
    }

    override fun onMessage(conn: WebSocket, message: String) {
        sinks[conn]?.let { core.onMessage(it, message) }
    }

    override fun onError(conn: WebSocket?, ex: Exception) {
        Log.w(TAG, "WS error: ${ex.message}")
    }

    companion object {
        private const val TAG = "Mk4Ws"
    }
}
