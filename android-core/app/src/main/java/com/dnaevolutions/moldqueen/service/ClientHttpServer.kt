package com.dnaevolutions.moldqueen.service

import android.content.res.AssetManager
import com.dnaevolutions.moldqueen.core.ClientRoutes
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Response
import fi.iki.elonen.NanoHTTPD.newFixedLengthResponse
import java.io.ByteArrayInputStream

/**
 * Serves the bundled web client over local HTTP, byte-for-byte like the Pi's api.py
 * WebHandler: same routes (root, /<id>, /layouts.json, /asyncapi.yaml, by-filename
 * static, and the /assets path) and the SAME injection of __WS_PORT__ / __LAYOUTS_JSON__
 * / __INIT_JSON__ into served HTML. Static files (js/css/images) are served verbatim
 * from the assets bundled at build time from bt-core/mk4web/web (plus the repo assets
 * dir under the /assets path), so the client is identical to the Pi's served version.
 * Loopback only.
 */
class ClientHttpServer(
    port: Int,
    private val assets: AssetManager,
    private val wsPort: Int,
    private val routes: ClientRoutes,
    private val initJson: () -> String,
) : NanoHTTPD("127.0.0.1", port) {

    override fun serve(session: IHTTPSession): Response {
        val path = session.uri ?: "/"
        val resp = try {
            when {
                path == "/" || path == "/index.html" -> html("chooser.html")
                routes.htmlRoutes.containsKey(path) -> html(routes.htmlRoutes.getValue(path))
                path == "/layouts.json" -> text(routes.layoutsJson, CTYPES["json"]!!)
                path == "/asyncapi.yaml" -> asset("asyncapi.yaml", CTYPES["yaml"]!!)
                else -> static(path)
            }
        } catch (e: Exception) {
            notFound()
        }
        // Permissive CORS by design, mirroring api.py (LAN hobby tool).
        resp.addHeader("Access-Control-Allow-Origin", "*")
        return resp
    }

    private fun html(name: String): Response {
        var s = String(readAsset("web/$name"), Charsets.UTF_8)
        s = s.replace("__WS_PORT__", wsPort.toString())
        if (s.contains("__LAYOUTS_JSON__")) s = s.replace("__LAYOUTS_JSON__", esc(routes.layoutsJson))
        if (s.contains("__INIT_JSON__")) s = s.replace("__INIT_JSON__", esc(initJson()))
        return newFixedLengthResponse(Response.Status.OK, CTYPES["html"]!!, s)
    }

    /** Match api.py's HTML escaping of injected JSON: backslash then double-quote. */
    private fun esc(s: String) = s.replace("\\", "\\\\").replace("\"", "\\\"")

    private fun static(path: String): Response {
        val base: String
        val rel: String
        if (path.startsWith("/assets/")) { base = "webassets"; rel = path.removePrefix("/assets/") }
        else { base = "web"; rel = path.trimStart('/') }
        if (rel.isEmpty() || !rel.matches(Regex("[A-Za-z0-9._/-]+")) || rel.split("/").contains(".."))
            return notFound()
        val ext = rel.substringAfterLast('.', "").lowercase()
        val ctype = CTYPES[ext] ?: return notFound()
        return asset("$base/$rel", ctype)
    }

    private fun asset(assetPath: String, ctype: String): Response {
        val bytes = try { readAsset(assetPath) } catch (e: Exception) { return notFound() }
        return newFixedLengthResponse(Response.Status.OK, ctype, ByteArrayInputStream(bytes), bytes.size.toLong())
    }

    private fun text(s: String, ctype: String) = newFixedLengthResponse(Response.Status.OK, ctype, s)
    private fun notFound() = newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "404")
    private fun readAsset(p: String): ByteArray = assets.open(p).use { it.readBytes() }

    companion object {
        // Mirrors api.py _CTYPES.
        private val CTYPES = mapOf(
            "js" to "text/javascript; charset=utf-8", "css" to "text/css; charset=utf-8",
            "json" to "application/json; charset=utf-8", "html" to "text/html; charset=utf-8",
            "yaml" to "application/yaml; charset=utf-8", "svg" to "image/svg+xml",
            "png" to "image/png", "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "webp" to "image/webp",
            "gif" to "image/gif", "mp4" to "video/mp4", "webm" to "video/webm",
        )
    }
}
