package io.github.jrichter24.moldqueen.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * Server-side route derivation for the bundled client — clean-room port of api.py's
 * _load_layouts / _safe_id / _build_html_routes + LAYOUTS_JSON. From the ACTIVE layouts
 * it derives each route as /<sanitized-id> (route is NOT a manifest field), augments each
 * layout in place with its `route`, and exposes the served /layouts.json (with routes).
 */
class ClientRoutes(layoutsText: String) {

    /** route ("/excavator") -> html file ("dashboard.html"). */
    val htmlRoutes: Map<String, String>
    /** The JSON served at /layouts.json: {"layouts":[ ... active, each with `route` ]}. */
    val layoutsJson: String

    init {
        val active = JSONArray()
        val src = JSONObject(layoutsText).optJSONArray("layouts") ?: JSONArray()
        for (i in 0 until src.length()) {
            val l = src.getJSONObject(i)
            if (l.optBoolean("active", true)) active.put(l)
        }
        val routes = LinkedHashMap<String, String>()
        val used = HashSet<String>()
        for (i in 0 until active.length()) {
            val lay = active.getJSONObject(i)
            val html = lay.optJSONObject("files")?.optString("html").orEmpty()
            val sid = safeId(lay.optString("id"))
            if (sid.isEmpty() || html.isEmpty()) continue       // placeholder (byo): no route
            var route = "/$sid"
            if (route in used) {                                 // collision -> -2, -3, …
                var n = 2
                while ("$route-$n" in used) n++
                route = "$route-$n"
            }
            used.add(route)
            routes[route] = html
            lay.put("route", route)                              // augment so /layouts.json carries it
        }
        htmlRoutes = routes
        layoutsJson = JSONObject().put("layouts", active).toString()
    }

    private fun safeId(id: String): String =
        Regex("[^A-Za-z0-9._-]").replace(id, "-").trim('-')
}
