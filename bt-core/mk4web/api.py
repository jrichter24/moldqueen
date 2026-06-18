"""API process (B) — WebSocket control API + serves the thin web client.

The WebSocket API is the product (the web page is its first client).

Client -> server:
  {"cmd":"setup","action":"connect"|"ready"|"reset"}   drive the lifecycle
  {"cmd":"set","slot":0-2,"channel":0-3,"value":-7..7}  raw motion (only in READY)
  {"cmd":"drive","function":<name>,"value":-7..7}        motion by FUNCTION (only in READY)
  {"cmd":"stop"}                                         all neutral (any state)
  {"cmd":"state"}                                        request current state
  {"cmd":"map","action":"get"}                           request the channel map
  {"cmd":"map","action":"set","map":{...}}               set the session ACTIVE map
  {"cmd":"map","action":"swap","value":bool}             session device-0/1 (slot 0<->1) swap
  {"cmd":"map","action":"promote","map":{...}}           persist a map as the DEFAULT
Server -> client (pushed):
  {"type":"lifecycle","state":"IDLE"|"CONNECTING"|"READY"}
  {"type":"state","slots":[[v,v,v,v] x3]}
  {"type":"map","default":{...},"active":{...},"device_swap":bool}
  {"type":"mapresult","action":...,"ok":bool,"errors":[...]}     (to requester)

Lifecycle is owned here (the GUI drives the transitions) and forwarded to the
broadcaster, which enacts the radio. The server resolves function -> (slot,
channel, value) against the ACTIVE channel map (channelmap.py); the broadcaster
stays dumb (12 nibbles only). value->nibble map lives in telegram.py.

SAFETY: on a client disconnect (or no clients), command the broadcaster to NEUTRAL.

Run:  python -m mk4web.api
"""
import os, re, json, socket, asyncio, threading, logging, argparse, subprocess, platform
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from websockets.asyncio.server import serve

from . import channelmap
from .telegram import (value_to_nibble, nibble_to_value, channel_index, N_CHANNELS, NEUTRAL,
                       motion_raw, ad_hex)
from .config import (HOST, HTTP_PORT, WS_PORT, SOCK_PATH, CONFIG_DIR, channel_map_path,
                     ASSETS_DIR, SERVE_CLIENT, RADIO_BACKEND, HCI, INFO_LEVEL, DRY_RUN, VERSION)

log = logging.getLogger("api")
WEB_DIR = os.path.join(os.path.dirname(__file__), "web")
NEUTRAL_STATE = [NEUTRAL] * N_CHANNELS
IDLE, CONNECTING, READY = "IDLE", "CONNECTING", "READY"

# ---- layout manifest (single source of truth: web/layouts.json) --------------
# Each layout declares id/name/description/icon/kind and its client files. The ROUTE
# is NOT a manifest field — the server DERIVES it as /<id> (id sanitized to a URL-safe
# segment), so renaming a display title never changes a route. The chooser CARDS get
# the derived route (the server augments each layout with `route` before injecting it /
# serving /layouts.json). Add a layout (+ its files in web/) and it surfaces in both
# the chooser and the routes with NO api.py change. .js/.css are served generically by
# filename (see WebHandler._serve_static).
_CTYPES = {
    "js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
    "json": "application/json; charset=utf-8", "html": "text/html; charset=utf-8",
    "yaml": "application/yaml; charset=utf-8", "svg": "image/svg+xml",
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
    "gif": "image/gif", "mp4": "video/mp4", "webm": "video/webm",
}


def _load_layouts():
    try:
        with open(os.path.join(WEB_DIR, "layouts.json")) as f:
            return json.load(f).get("layouts", [])
    except (OSError, ValueError) as e:
        log.warning("layouts.json unreadable (%s) — no layout routes derived", e)
        return []


def _safe_id(layout_id):
    """A URL-safe path segment from a layout id (unsafe chars -> '-', trimmed). '' if
    nothing usable remains."""
    return re.sub(r"[^A-Za-z0-9._-]", "-", str(layout_id or "")).strip("-")


def _build_html_routes(layouts):
    """SERVER-GENERATE each layout's route as /<id> and return {route -> html file}.
    The route is derived from the (sanitized) id, NOT a manifest field — the title is
    display-only. On a route collision (e.g. two ids sanitizing to the same segment)
    later layouts get -2, -3, … appended. Each layout dict is augmented in place with
    its derived `route` so the chooser/manifest follow automatically. .js/.css are NOT
    listed here (served generically by filename)."""
    routes, used = {}, set()
    for lay in layouts:
        html = (lay.get("files") or {}).get("html")
        sid = _safe_id(lay.get("id"))
        if not sid:
            log.warning("layout %r has no URL-safe id — skipped", lay.get("id"))
            continue
        if not html:                              # e.g. the "bring your own" placeholder: no route
            continue
        route = "/" + sid
        if route in used:                         # collision -> enumerate (-2, -3, …)
            n = 2
            while "%s-%d" % (route, n) in used:
                n += 1
            route = "%s-%d" % (route, n)
            log.warning("layout id %r route collides -> using %s", lay.get("id"), route)
        used.add(route)
        routes[route] = html
        lay["route"] = route                      # augment so the chooser + /layouts.json follow
    return routes


def _function_layouts(layouts):
    """{layout_id: [function names]} for function-mapped layouts (declared in the
    manifest). This is the per-layout FUNCTION SET — no global hardcoded list."""
    return {lay["id"]: list(lay["functions"])
            for lay in layouts if lay.get("kind") == "function-mapped" and lay.get("functions")}


LAYOUTS = _load_layouts()
# `active` (default true): an INACTIVE layout (active:false) is fully hidden — no route,
# no chooser card, not in /layouts.json, no function set loaded. This is how the bundled
# template ships dormant until a contributor flips it active. `category` is a layout-
# declared grouping label (e.g. "vehicle"/"debug"/"template") carried through to the
# chooser. Everything below derives from the ACTIVE subset only.
ACTIVE_LAYOUTS = [l for l in LAYOUTS if l.get("active", True)]
HTML_ROUTES = _build_html_routes(ACTIVE_LAYOUTS)      # derives /<id> + augments each with `route`
LAYOUTS_JSON = json.dumps({"layouts": ACTIVE_LAYOUTS})
LAYOUT_FUNCTIONS = _function_layouts(ACTIVE_LAYOUTS)
DEFAULT_LAYOUT = next(iter(LAYOUT_FUNCTIONS), None)   # active function-mapped layout (today: excavator)


class IPCClient:
    """Reconnecting Unix-socket client to the broadcaster; sends newline JSON."""
    def __init__(self, path):
        self.path = path
        self.sock = None
        self.lock = threading.Lock()

    def _send(self, obj):
        data = (json.dumps(obj) + "\n").encode()
        with self.lock:
            for _ in range(2):
                try:
                    if self.sock is None:
                        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                        s.connect(self.path)
                        self.sock = s
                    self.sock.sendall(data)
                    return True
                except OSError:
                    if self.sock:
                        try:
                            self.sock.close()
                        except OSError:
                            pass
                    self.sock = None
            log.warning("IPC: broadcaster not reachable at %s", self.path)
            return False

    def setup(self, action):   self._send({"cmd": action})         # connect|ready|reset
    def send_state(self, nb):  self._send({"state": nb})
    def send_neutral(self):    self._send({"neutral": True})


def _clone(mp):
    return json.loads(json.dumps(mp))


class App:
    def __init__(self):
        self.lifecycle = IDLE
        self.nibbles = list(NEUTRAL_STATE)
        # Active function-mapped LAYOUT: its function set (from the manifest) + its
        # per-layout default map (config/channel_map.<id>.json). The client may push an
        # ACTIVE map (default + overrides) for the session. RAW (no functions) ignores all this.
        self.layout_id = DEFAULT_LAYOUT
        self.functions = list(LAYOUT_FUNCTIONS.get(self.layout_id, []))
        self.default_map = self._load_default()
        self.active_map = _clone(self.default_map)
        self.device_swap = False              # session-only (slot 0<->1), not persisted

    def _load_default(self):
        if not self.layout_id:
            return {"version": 1, "functions": {}}
        return channelmap.load(channel_map_path(self.layout_id), self.functions)

    def set_layout(self, layout_id):
        """Switch the active function-mapped layout (its function set + default map).
        Returns True if switched. No-op for unknown ids or the current one — so the
        default (excavator) means today's single-layout behavior is unchanged; a future
        multi-layout client selects via this (e.g. {cmd:map, layout:<id>})."""
        if layout_id not in LAYOUT_FUNCTIONS or layout_id == self.layout_id:
            return False
        self.layout_id = layout_id
        self.functions = list(LAYOUT_FUNCTIONS[layout_id])
        self.default_map = self._load_default()
        self.active_map = _clone(self.default_map)
        return True

    def slots_grid(self):
        return [[nibble_to_value(self.nibbles[s * 4 + c]) for c in range(4)] for s in range(3)]

    def set(self, slot, channel, value):
        if 0 <= slot <= 2 and 0 <= channel <= 3:
            self.nibbles[channel_index(slot, channel)] = value_to_nibble(value)

    def stop(self):
        self.nibbles = list(NEUTRAL_STATE)

    # ---- channel map (function-based control) ----
    def drive(self, function, value):
        """Resolve a function to (slot, channel) via the ACTIVE map and set its nibble.
        READY-only. Returns the resolved (slot, channel, value) or None."""
        if self.lifecycle != READY:
            return None
        r = channelmap.resolve(self.active_map, function, value, self.device_swap)
        if r is None:
            return None
        slot, ch, v = r
        self.nibbles[channel_index(slot, ch)] = value_to_nibble(v)
        return r

    def set_active_map(self, mp):
        ok, errs = channelmap.validate(mp, self.functions)   # against THIS layout's function set
        if ok:
            self.active_map = _clone(mp)
        return ok, errs

    def set_swap(self, on):
        self.device_swap = bool(on)

    def promote(self, mp=None):
        """Persist `mp` (or the current active map) as THIS layout's DEFAULT
        (config/channel_map.<layout_id>.json). Validates against its function set."""
        cand = mp if mp is not None else self.active_map
        ok, errs = channelmap.validate(cand, self.functions)
        if not ok:
            return ok, errs
        try:
            channelmap.save(channel_map_path(self.layout_id), cand)
        except (OSError, ValueError) as e:
            return False, [str(e)]
        self.active_map = _clone(cand)
        self.default_map = _clone(cand)
        return True, []


ipc = IPCClient(SOCK_PATH)
app = App()
clients = set()


def state_json():
    # include the resulting motion telegram (raw + on-air AD) so the RAW debug
    # console can show exact bytes without reinventing the crypt client-side.
    raw = motion_raw(app.nibbles)
    return json.dumps({"type": "state", "slots": app.slots_grid(),
                       "raw": raw, "ad": ad_hex(raw)})


def lifecycle_json():
    return json.dumps({"type": "lifecycle", "state": app.lifecycle})


def map_json():
    return json.dumps({"type": "map", "layout": app.layout_id, "default": app.default_map,
                       "active": app.active_map, "device_swap": app.device_swap})


def _adapter_mac(hci):
    """Best-effort adapter MAC for the debug tier (read-only hciconfig; None if N/A)."""
    try:
        out = subprocess.run(["hciconfig", hci], capture_output=True, text=True, timeout=2).stdout
        m = re.search(r"([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})", out)
        return m.group(1) if m else None
    except Exception:
        return None


def _bluetoothd_state():
    """Best-effort bluetoothd state for the debug tier (None if unknown)."""
    try:
        return (subprocess.run(["systemctl", "is-active", "bluetooth"],
                               capture_output=True, text=True, timeout=2).stdout.strip() or None)
    except Exception:
        return None


def info_json(level):
    """Server-info disclosure over the WS (mandatory channel — works in --ws-only).
    Tiered: safe < light < debug; include only the fields the tier allows, and always
    report info_level so the client knows the tier. Values are the API server's
    CONFIGURED view (env/config)."""
    info = {"type": "info", "app": "moldqueen", "version": VERSION,
            "lifecycle": app.lifecycle, "info_level": level}
    if level in ("light", "debug"):          # + radio + ports + active layout, but NO MAC / host identity
        info.update({"radio_backend": RADIO_BACKEND, "dry_run": DRY_RUN, "hci": HCI,
                     "ws_port": WS_PORT, "http_port": HTTP_PORT, "serve_client": SERVE_CLIENT,
                     "layout": app.layout_id})   # active function-mapped layout id (non-sensitive)
    if level == "debug":                     # + identifying diagnostics
        cmap = channel_map_path(app.layout_id) if app.layout_id else None
        info.update({"adapter_mac": _adapter_mac(HCI), "hostname": platform.node(),
                     "bluetoothd": _bluetoothd_state(), "host_bind": HOST,
                     "paths": {"sock": SOCK_PATH, "config_dir": CONFIG_DIR, "channel_map": cmap,
                               "assets": ASSETS_DIR, "web": WEB_DIR}})
    return json.dumps(info)


async def push(msg):
    if clients:
        await asyncio.gather(*(c.send(msg) for c in list(clients)), return_exceptions=True)


async def handler(websocket):
    clients.add(websocket)
    log.info("WS client connected; clients=%d", len(clients))
    try:
        await websocket.send(lifecycle_json())
        await websocket.send(state_json())
        await websocket.send(map_json())
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            cmd = msg.get("cmd")
            if cmd == "setup":
                action = msg.get("action")
                if action in ("connect", "ready", "reset"):
                    app.lifecycle = {"connect": CONNECTING, "ready": READY, "reset": IDLE}[action]
                    if action == "reset":
                        app.stop()
                    ipc.setup(action)
                    await push(lifecycle_json())
                    await push(state_json())
            elif cmd == "set":
                if app.lifecycle == READY:        # motion only when READY
                    app.set(msg.get("slot"), msg.get("channel"), msg.get("value"))
                    ipc.send_state(app.nibbles)
                    await push(state_json())
            elif cmd == "drive":                  # motion by FUNCTION (resolved here)
                if app.lifecycle == READY:
                    if app.drive(msg.get("function"), msg.get("value")) is not None:
                        ipc.send_state(app.nibbles)
                        await push(state_json())
            elif cmd == "map":
                if msg.get("layout") and app.set_layout(msg["layout"]):   # optional: switch layout
                    app.stop(); ipc.send_neutral()                        # (default excavator → unused today)
                    await push(map_json()); await push(state_json())
                action = msg.get("action")
                if action == "get":
                    await websocket.send(map_json())
                elif action == "set":
                    ok, errs = app.set_active_map(msg.get("map") or {})
                    if ok:                        # routing changed -> neutralize for safety
                        app.stop(); ipc.send_neutral()
                    await websocket.send(json.dumps(
                        {"type": "mapresult", "action": "set", "ok": ok, "errors": errs}))
                    if ok:
                        await push(map_json())
                        await push(state_json())
                elif action == "swap":
                    app.set_swap(msg.get("value"))
                    app.stop(); ipc.send_neutral()  # routing changed -> neutralize
                    await push(map_json())
                    await push(state_json())
                elif action == "promote":
                    ok, errs = app.promote(msg.get("map"))
                    if ok:
                        app.stop(); ipc.send_neutral()
                    await websocket.send(json.dumps(
                        {"type": "mapresult", "action": "promote", "ok": ok, "errors": errs}))
                    if ok:
                        await push(map_json())
                        await push(state_json())
            elif cmd == "stop":
                app.stop()
                ipc.send_neutral()
                await push(state_json())
            elif cmd == "state":
                await websocket.send(lifecycle_json())
                await websocket.send(state_json())
            elif cmd == "info":               # server-info disclosure (tiered)
                await websocket.send(info_json(INFO_LEVEL))
    except Exception as e:
        log.debug("WS handler error: %s", e)
    finally:
        clients.discard(websocket)
        log.info("WS client disconnected; clients=%d -> NEUTRAL (safety)", len(clients))
        app.stop()
        ipc.send_neutral()
        await push(state_json())


# ---------------------------------------------------------------- static web page
class WebHandler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        # Permissive CORS BY DESIGN — this is a LAN hobby tool, so a client served
        # from another host/container can fetch these endpoints (e.g. /asyncapi.yaml).
        # Tightening to a specific origin allowlist is a future option.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):               # CORS preflight (permissive, LAN)
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send_web_html(self, name):     # serve an HTML file, inject WS port + initial state
        # Placeholders are written so the files stay VALID even when served raw by a
        # plain static server (e.g. nginx in the client Docker image) that can't
        # inject: the port lives in a string, and __INIT_JSON__ is JSON.parse'd in a
        # try/catch (→ null when unreplaced). See web/clientconfig.js.
        with open(os.path.join(WEB_DIR, name)) as f:
            html = f.read().replace("__WS_PORT__", str(WS_PORT))
        # In-client Fullscreen button: shown on the web (default). A native host that
        # handles fullscreen itself (the Android app) injects "false" instead.
        html = html.replace("__SHOW_FULLSCREEN__", "true")
        if "__LAYOUTS_JSON__" in html:  # chooser cards from the manifest (raw-serve falls back to fetch)
            html = html.replace("__LAYOUTS_JSON__", LAYOUTS_JSON.replace("\\", "\\\\").replace('"', '\\"'))
        if "__INIT_JSON__" in html:     # let the page render immediately, before the WS opens
            init = {"default": app.default_map, "active": app.active_map,
                    "device_swap": app.device_swap, "lifecycle": app.lifecycle}
            js_str = json.dumps(init).replace("\\", "\\\\").replace('"', '\\"')
            html = html.replace("__INIT_JSON__", js_str)
        self._send(200, html.encode(), "text/html; charset=utf-8")

    def _serve_file(self, abspath, ctype):
        try:
            with open(abspath, "rb") as f:
                self._send(200, f.read(), ctype)
        except OSError:
            self._send(404, b"404", "text/plain")

    def _serve_static(self, path):
        """Generic static handler: serve a file BY NAME from web/ (or assets/ for
        /assets/**), content-type by extension, with path-traversal protection. No
        per-file plumbing — a new layout's *.js/*.css (and shared infra like
        clientconfig.js / layouts.json) serve automatically once the file exists."""
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
            self._serve_file(fp, ctype)
        else:
            self._send(404, b"404", "text/plain")

    def do_GET(self):
        path = self.path.split("?")[0]
        # "/" = layout chooser. Each layout's server-derived route (/<id>, in HTML_ROUTES)
        # serves its injected HTML. /layouts.json returns the manifest WITH derived routes
        # (so the chooser's fetch-fallback gets them too). EVERY other file —
        # clientconfig.js, *.js/*.css, /assets/** — is served generically by filename, so a
        # new layout needs only its manifest entry + files (no route plumbing here).
        # asyncapi.yaml sits beside api.py (not in web/) so it keeps a small mapping.
        if path in ("/", "/index.html"):
            self._send_web_html("chooser.html")
        elif path in HTML_ROUTES:                          # /<id> (e.g. /excavator, /raw) -> injected HTML
            self._send_web_html(HTML_ROUTES[path])
        elif path == "/layouts.json":                      # manifest WITH server-derived routes
            self._send(200, LAYOUTS_JSON.encode(), _CTYPES["json"])
        elif path == "/asyncapi.yaml":                     # API contract, lives beside api.py
            self._serve_file(os.path.join(os.path.dirname(__file__), "asyncapi.yaml"), _CTYPES["yaml"])
        else:                                              # generic by-filename static handler
            self._serve_static(path)

    def log_message(self, *a):
        pass


def start_http(http_port):
    httpd = ThreadingHTTPServer((HOST, http_port), WebHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    log.info("client web UI on http://%s:%d/", HOST, http_port)


async def amain(serve_client, http_port):
    # The WebSocket API is the product and is ALWAYS started. Serving the client
    # web page is OPTIONAL (a convenience) — skipped entirely when serve_client is
    # off (--ws-only / MK4_SERVE_CLIENT=0): no HTTP server is opened at all.
    if serve_client:
        start_http(http_port)
    else:
        log.info("WebSocket-only (client web UI NOT served) — bring your own client")
    # WS ORIGIN: `serve(...)` is called WITHOUT an `origins=` allowlist, so the
    # server accepts WebSocket connections from ANY Origin — permissive BY DESIGN
    # for a LAN hobby tool (a client served from another host/container can connect).
    # Tightening (e.g. origins=[...]) is a future option. The broadcaster stays on
    # the Pi and is unaffected — only this API faces clients.
    async with serve(handler, HOST, WS_PORT):
        log.info("WebSocket API on ws://%s:%d (any origin accepted — LAN tool)", HOST, WS_PORT)
        await asyncio.Future()


def main():
    global INFO_LEVEL                          # may be overridden by --info-level below
    ap = argparse.ArgumentParser(description="moldqueen API — WebSocket control + optional client web UI.")
    ap.add_argument("--ws-only", "--no-client", dest="ws_only", action="store_true",
                    help="WebSocket-only: do NOT serve the client web page (no HTTP server).")
    ap.add_argument("--http-port", type=int, default=None,
                    help="port for the client web UI (overrides MK4_HTTP_PORT; default %d)." % HTTP_PORT)
    ap.add_argument("--info-level", choices=["safe", "light", "debug"], default=None,
                    help="server-info disclosure tier (overrides MK4_INFO_LEVEL; default %s)." % INFO_LEVEL)
    a = ap.parse_args()
    serve_client = SERVE_CLIENT and not a.ws_only          # CLI --ws-only wins over env
    http_port = a.http_port if a.http_port is not None else HTTP_PORT   # CLI flag wins over env
    if a.info_level:                                       # CLI --info-level wins over env
        INFO_LEVEL = a.info_level
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    try:
        asyncio.run(amain(serve_client, http_port))
    except KeyboardInterrupt:
        ipc.setup("reset")
        log.info("api stopped (sent reset)")


if __name__ == "__main__":
    main()
