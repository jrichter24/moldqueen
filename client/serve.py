#!/usr/bin/env python3
"""moldqueen client — standalone dev server.

Serves THIS folder's web client EXACTLY like the production serving hosts (the Pi and
the Docker image), so "run the client standalone" behaves identically:

  * route  /  and  /index.html   -> chooser.html
  * derive each layout's route from layouts.json ids (safe-id + collision suffixes),
    e.g. /excavator -> dashboard.html, /raw -> raw.html
  * serve  /layouts.json  with the derived `route` added per layout
  * inject the 4 placeholders into served HTML:
      __WS_PORT__         -> the WS API port (default 8765; set with --ws-port)
      __SHOW_FULLSCREEN__ -> "true" (web default; in-client fullscreen button shown)
      __LAYOUTS_JSON__    -> the routed manifest (escaped)
      __INIT_JSON__       -> null (no core here; the client fills in over the WS map push)
  * serve /assets/** from ./assets and every other file by name from ./web

The client is INDEPENDENT: it needs only these static files plus a WebSocket API
endpoint, which you set in the UI (Settings / API connection -> ws://<host>:8765).
This server imports NO core code. /asyncapi.yaml is a server-side artifact (not bundled
here); the client is 404-tolerant for it.

    python serve.py                 # http://localhost:8080  (WS defaults to :8765)
    python serve.py --port 8080 --ws-port 8765
"""
import os, re, json, argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(HERE, "web")
ASSETS_DIR = os.path.join(HERE, "assets")

_CTYPES = {
    "js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
    "json": "application/json; charset=utf-8", "html": "text/html; charset=utf-8",
    "yaml": "application/yaml; charset=utf-8", "svg": "image/svg+xml",
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
    "gif": "image/gif", "mp4": "video/mp4", "webm": "video/webm",
}

WS_PORT = 8765
SHOW_FULLSCREEN = "true"


def _safe_id(layout_id):
    return re.sub(r"[^A-Za-z0-9._-]", "-", str(layout_id or "")).strip("-")


def _load_layouts():
    try:
        with open(os.path.join(WEB_DIR, "layouts.json"), encoding="utf-8") as f:
            return json.load(f).get("layouts", [])
    except (OSError, ValueError):
        return []


def _build_routes(layouts):
    """Derive /<id> per layout (augmenting each with `route`); -> {route: html}.
    Built for EVERY layout (active and inactive): `active` gates the chooser CARD, not the
    ROUTE — an inactive layout stays reachable by direct URL so it can be verified before
    activation. (collision suffixes are deduped across the whole set.)"""
    routes, used = {}, set()
    for lay in layouts:
        html = (lay.get("files") or {}).get("html")
        sid = _safe_id(lay.get("id"))
        if not sid or not html:
            continue
        route = "/" + sid
        if route in used:
            n = 2
            while "%s-%d" % (route, n) in used:
                n += 1
            route = "%s-%d" % (route, n)
        used.add(route)
        routes[route] = html
        lay["route"] = route
    return routes


ALL_LAYOUTS = _load_layouts()
ACTIVE = [l for l in ALL_LAYOUTS if l.get("active", True)]
HTML_ROUTES = _build_routes(ALL_LAYOUTS)             # routes for ALL layouts (active gates the card, not the route)
LAYOUTS_JSON = json.dumps({"layouts": ACTIVE})       # chooser sees ONLY active layouts -> no card for inactive ones


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")   # LAN/dev convenience, mirrors the core
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, name):
        with open(os.path.join(WEB_DIR, name), encoding="utf-8") as f:
            html = f.read().replace("__WS_PORT__", str(WS_PORT)).replace("__SHOW_FULLSCREEN__", SHOW_FULLSCREEN)
        if "__LAYOUTS_JSON__" in html:
            html = html.replace("__LAYOUTS_JSON__", LAYOUTS_JSON.replace("\\", "\\\\").replace('"', '\\"'))
        if "__INIT_JSON__" in html:                            # no live core here -> null; client fills via WS
            html = html.replace("__INIT_JSON__", "null")
        self._send(200, html.encode(), "text/html; charset=utf-8")

    def _serve_static(self, path):
        if path.startswith("/assets/"):
            base, rel = os.path.abspath(ASSETS_DIR), path[len("/assets/"):]
        else:
            base, rel = os.path.abspath(WEB_DIR), path.lstrip("/")
        ext = rel.rsplit(".", 1)[-1].lower() if "." in rel else ""
        ctype = _CTYPES.get(ext)
        fp = os.path.normpath(os.path.join(base, rel))
        ok = (rel and re.fullmatch(r"[A-Za-z0-9._/-]+", rel) and ".." not in rel.split("/")
              and (fp == base or fp.startswith(base + os.sep)) and ctype and os.path.isfile(fp))
        if ok:
            with open(fp, "rb") as f:
                self._send(200, f.read(), ctype)
        else:
            self._send(404, b"404", "text/plain")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            self._send_html("chooser.html")
        elif path in HTML_ROUTES:
            self._send_html(HTML_ROUTES[path])
        elif path == "/layouts.json":
            self._send(200, LAYOUTS_JSON.encode(), _CTYPES["json"])
        else:
            self._serve_static(path)

    def log_message(self, *a):
        pass


def main():
    global WS_PORT, SHOW_FULLSCREEN
    ap = argparse.ArgumentParser(description="moldqueen client standalone dev server.")
    ap.add_argument("--port", type=int, default=8080, help="HTTP port for the client (default 8080).")
    ap.add_argument("--ws-port", type=int, default=8765, help="WS API port injected as __WS_PORT__ (default 8765).")
    ap.add_argument("--host", default="127.0.0.1", help="bind address (default 127.0.0.1).")
    ap.add_argument("--no-fullscreen", action="store_true", help="inject __SHOW_FULLSCREEN__=false (hide the button).")
    a = ap.parse_args()
    WS_PORT = a.ws_port
    SHOW_FULLSCREEN = "false" if a.no_fullscreen else "true"
    routes = ", ".join(sorted(HTML_ROUTES))
    print("moldqueen client on http://%s:%d/  (chooser at /, routes: %s)" % (a.host, a.port, routes or "none"))
    print("Set the API endpoint in the UI to ws://<host>:%d (default ws://localhost:%d)." % (WS_PORT, WS_PORT))
    ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
