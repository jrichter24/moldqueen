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
import os, re, json, socket, asyncio, threading, logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from websockets.asyncio.server import serve

from . import channelmap
from .telegram import value_to_nibble, nibble_to_value, channel_index, N_CHANNELS, NEUTRAL
from .config import HOST, HTTP_PORT, WS_PORT, SOCK_PATH, CHANNEL_MAP_PATH, ASSETS_DIR

log = logging.getLogger("api")
WEB_DIR = os.path.join(os.path.dirname(__file__), "web")
NEUTRAL_STATE = [NEUTRAL] * N_CHANNELS
IDLE, CONNECTING, READY = "IDLE", "CONNECTING", "READY"


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
    return json.dumps({"type": "state", "slots": app.slots_grid()})


def lifecycle_json():
    return json.dumps({"type": "lifecycle", "state": app.lifecycle})


def map_json():
    return json.dumps({"type": "map", "default": app.default_map,
                       "active": app.active_map, "device_swap": app.device_swap})


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
        self.end_headers()
        self.wfile.write(body)

    def _send_web_html(self, name):     # serve an HTML file, inject WS port + initial state
        with open(os.path.join(WEB_DIR, name)) as f:
            html = f.read().replace("__WS_PORT__", str(WS_PORT))
        if "__INIT__" in html:          # let the page render immediately, before the WS opens
            init = {"default": app.default_map, "active": app.active_map,
                    "device_swap": app.device_swap, "lifecycle": app.lifecycle}
            html = html.replace("__INIT__", json.dumps(init))
        self._send(200, html.encode(), "text/html; charset=utf-8")

    def _send_web_file(self, name, ctype):
        with open(os.path.join(WEB_DIR, name), "rb") as f:
            self._send(200, f.read(), ctype)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            self._send_web_html("index.html")             # simple control page (unchanged)
        elif path in ("/dashboard", "/dashboard.html"):
            self._send_web_html("dashboard.html")          # landscape dashboard
        elif path == "/app.js":
            self._send_web_file("app.js", "text/javascript; charset=utf-8")
        elif path == "/dashboard.js":
            self._send_web_file("dashboard.js", "text/javascript; charset=utf-8")
        elif path == "/dashboard.css":
            self._send_web_file("dashboard.css", "text/css; charset=utf-8")
        elif path.startswith("/assets/"):                  # static assets (e.g. the UI background)
            name = path[len("/assets/"):]
            ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            ctype = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                     "svg": "image/svg+xml", "webp": "image/webp"}.get(ext)
            fp = os.path.join(ASSETS_DIR, name)
            if re.fullmatch(r"[A-Za-z0-9._-]+", name) and ctype and os.path.isfile(fp):
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


def start_http():
    httpd = ThreadingHTTPServer((HOST, HTTP_PORT), WebHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    log.info("web page on http://%s:%d/", HOST, HTTP_PORT)


async def amain():
    start_http()
    async with serve(handler, HOST, WS_PORT):
        log.info("WebSocket API on ws://%s:%d", HOST, WS_PORT)
        await asyncio.Future()


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    try:
        asyncio.run(amain())
    except KeyboardInterrupt:
        ipc.setup("reset")
        log.info("api stopped (sent reset)")


if __name__ == "__main__":
    main()
