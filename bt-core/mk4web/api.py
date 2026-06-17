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
from .config import (HOST, HTTP_PORT, WS_PORT, SOCK_PATH, CHANNEL_MAP_PATH, ASSETS_DIR,
                     SERVE_CLIENT, RADIO_BACKEND, HCI, INFO_LEVEL, DRY_RUN, VERSION)

log = logging.getLogger("api")
WEB_DIR = os.path.join(os.path.dirname(__file__), "web")
NEUTRAL_STATE = [NEUTRAL] * N_CHANNELS
IDLE, CONNECTING, READY = "IDLE", "CONNECTING", "READY"

# ---- layout manifest (single source of truth: web/layouts.json) --------------
# Each layout declares id/name/description/route/icon/kind and its client files.
# Both the served ROUTES (below) and the chooser CARDS (injected into chooser.html /
# fetched at /layouts.json) derive from this — add a layout here and it surfaces in
# both. STAGE 2 will replace the explicit per-file route maps with a generic handler.
_STATIC_CTYPE = {"js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8"}


def _load_layouts():
    try:
        with open(os.path.join(WEB_DIR, "layouts.json")) as f:
            return json.load(f).get("layouts", [])
    except (OSError, ValueError) as e:
        log.warning("layouts.json unreadable (%s) — no layout routes derived", e)
        return []


def _build_routes(layouts):
    """Derive {path -> html file} and {path -> (file, ctype)} from the manifest."""
    html_routes, static_files = {}, {}
    for lay in layouts:
        files, route = lay.get("files") or {}, lay.get("route")
        html = files.get("html")
        if route and html:
            html_routes[route] = html                 # e.g. /dashboard -> dashboard.html
            html_routes["/" + html] = html            # alias /dashboard.html
        for kind in ("js", "css"):
            fn = files.get(kind)
            if fn:
                static_files["/" + fn] = (fn, _STATIC_CTYPE[kind])   # /dashboard.js -> (dashboard.js, ctype)
    return html_routes, static_files


LAYOUTS = _load_layouts()
HTML_ROUTES, STATIC_FILES = _build_routes(LAYOUTS)
LAYOUTS_JSON = json.dumps({"layouts": LAYOUTS})


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
        # Channel map: persisted DEFAULT + session ACTIVE (default + client overrides).
        self.default_map = channelmap.load(CHANNEL_MAP_PATH)
        self.active_map = _clone(self.default_map)
        self.device_swap = False              # session-only (slot 0<->1), not persisted

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
        ok, errs = channelmap.validate(mp)
        if ok:
            self.active_map = _clone(mp)
        return ok, errs

    def set_swap(self, on):
        self.device_swap = bool(on)

    def promote(self, mp=None):
        """Persist `mp` (or the current active map) as the DEFAULT. Validates first."""
        cand = mp if mp is not None else self.active_map
        ok, errs = channelmap.validate(cand)
        if not ok:
            return ok, errs
        try:
            channelmap.save(CHANNEL_MAP_PATH, cand)
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
    return json.dumps({"type": "map", "default": app.default_map,
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
    if level in ("light", "debug"):          # + radio + ports, but NO MAC / host identity
        info.update({"radio_backend": RADIO_BACKEND, "dry_run": DRY_RUN, "hci": HCI,
                     "ws_port": WS_PORT, "http_port": HTTP_PORT, "serve_client": SERVE_CLIENT})
    if level == "debug":                     # + identifying diagnostics
        info.update({"adapter_mac": _adapter_mac(HCI), "hostname": platform.node(),
                     "bluetoothd": _bluetoothd_state(), "host_bind": HOST,
                     "paths": {"sock": SOCK_PATH, "channel_map": CHANNEL_MAP_PATH,
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
        if "__LAYOUTS_JSON__" in html:  # chooser cards from the manifest (raw-serve falls back to fetch)
            html = html.replace("__LAYOUTS_JSON__", LAYOUTS_JSON.replace("\\", "\\\\").replace('"', '\\"'))
        if "__INIT_JSON__" in html:     # let the page render immediately, before the WS opens
            init = {"default": app.default_map, "active": app.active_map,
                    "device_swap": app.device_swap, "lifecycle": app.lifecycle}
            js_str = json.dumps(init).replace("\\", "\\\\").replace('"', '\\"')
            html = html.replace("__INIT_JSON__", js_str)
        self._send(200, html.encode(), "text/html; charset=utf-8")

    def _send_web_file(self, name, ctype):
        with open(os.path.join(WEB_DIR, name), "rb") as f:
            self._send(200, f.read(), ctype)

    def do_GET(self):
        path = self.path.split("?")[0]
        # "/" presents a LAYOUT CHOOSER (pluggable layouts). The dashboard/RAW HTML
        # routes and their .js/.css are DERIVED from the layout manifest (web/
        # layouts.json) — see HTML_ROUTES / STATIC_FILES above — not hardcoded here.
        if path in ("/", "/index.html"):
            self._send_web_html("chooser.html")
        elif path in HTML_ROUTES:                          # /dashboard, /raw, … (+ .html aliases)
            self._send_web_html(HTML_ROUTES[path])
        elif path == "/clientconfig.js":                   # shared client infra (not a layout)
            self._send_web_file("clientconfig.js", "text/javascript; charset=utf-8")
        elif path in STATIC_FILES:                         # /dashboard.js, /raw.css, … from the manifest
            fn, ctype = STATIC_FILES[path]
            self._send_web_file(fn, ctype)
        elif path == "/layouts.json":                      # the manifest itself (chooser fetch fallback)
            self._send_web_file("layouts.json", "application/json; charset=utf-8")
        elif path.startswith("/assets/"):                  # static assets (UI background, wizard media)
            rel = path[len("/assets/"):]
            ext = rel.rsplit(".", 1)[-1].lower() if "." in rel else ""
            ctype = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                     "svg": "image/svg+xml", "webp": "image/webp", "gif": "image/gif",
                     "mp4": "video/mp4", "webm": "video/webm"}.get(ext)
            base = os.path.abspath(ASSETS_DIR)
            fp = os.path.normpath(os.path.join(base, rel))
            ok = (re.fullmatch(r"[A-Za-z0-9._/-]+", rel) and ".." not in rel.split("/")
                  and (fp == base or fp.startswith(base + os.sep)) and ctype and os.path.isfile(fp))
            if ok:
                with open(fp, "rb") as f:
                    self._send(200, f.read(), ctype)
            else:
                self._send(404, b"asset not found", "text/plain")
        elif path == "/asyncapi.yaml":   # the WebSocket API's AsyncAPI 3.0 spec
            try:
                with open(os.path.join(os.path.dirname(__file__), "asyncapi.yaml"), "rb") as f:
                    self._send(200, f.read(), "application/yaml; charset=utf-8")
            except OSError:
                self._send(404, b"asyncapi.yaml not found", "text/plain")
        else:
            self._send(404, b"404", "text/plain")

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
