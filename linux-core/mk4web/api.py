"""API process (B) — THIN-TRANSPORT WebSocket API + serves the web client.

The server is pure transport: it knows NOTHING about functions, channel maps, invert,
caps, or labels. The CLIENT owns all semantics (function -> slot/channel/value, invert,
caps, reverse_scale, device-swap, the map, labels) and sends only low-level `set`.

Client -> server:
  {"cmd":"setup","action":"connect"|"ready"|"reset","protocol"?:"mk4"|"mk6","device"?:0-2}
                                                        drive the lifecycle (+ pick the session protocol)
  {"cmd":"set","slot":0-2,"channel":0-3,"value":-7..7,"protocol"?}  raw motion (ONLY motion primitive; READY only)
  {"cmd":"stop"}                                         all neutral (any state)
  {"cmd":"state"}                                        request current state
  {"cmd":"info"}                                         server-info (tiered)
Server -> client (pushed):
  {"type":"lifecycle","state":"IDLE"|"CONNECTING"|"READY"}
  {"type":"state","slots":[[v,v,v,v] x3],"raw":hex,"ad":hex}
  {"type":"info",...}                                    (to requester)

Lifecycle is owned here (the GUI drives the transitions) and forwarded to the
broadcaster. `set` -> the active Protocol's value_to_wire (MK4 nibble / MK6 byte) -> the
API BUILDS the raw telegram (telegram.py / mouldking_crypt.py) and hands the opaque bytes
to the RAW-BLIND broadcaster, which just repeats them. Protocol is a session setting
chosen at `setup` (default MK4); ONE active protocol per session (mixing is step 5).

SAFETY: on a client disconnect (or no clients), command the broadcaster to NEUTRAL.

Run:  python -m mk4web.api
"""
import os, re, json, time, socket, asyncio, threading, logging, argparse, subprocess, platform
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from websockets.asyncio.server import serve

from .telegram import MK4Protocol, make_protocol, ad_hex
from .config import (HOST, HTTP_PORT, WS_PORT, SOCK_PATH,
                     WEB_DIR, ASSETS_DIR, SERVE_CLIENT, RADIO_BACKEND, HCI, INFO_LEVEL, DRY_RUN, VERSION)

log = logging.getLogger("api")
# The web client is an independent peer (client/), located via config.WEB_DIR
# (MK4_WEB_DIR override). asyncapi.yaml stays here server-side (beside api.py).
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


LAYOUTS = _load_layouts()
# `active` (default true): an INACTIVE layout (active:false) is fully hidden — no route,
# no chooser card, not in /layouts.json, no function set loaded. This is how the bundled
# template ships dormant until a contributor flips it active. `category` is a layout-
# declared grouping label (e.g. "vehicle"/"debug"/"template") carried through to the
# chooser. Everything below derives from the ACTIVE subset only.
ACTIVE_LAYOUTS = [l for l in LAYOUTS if l.get("active", True)]
HTML_ROUTES = _build_html_routes(ACTIVE_LAYOUTS)      # derives /<id> + augments each with `route`
LAYOUTS_JSON = json.dumps({"layouts": ACTIVE_LAYOUTS})


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

    # The broadcaster is RAW-BLIND (step 3): the API builds the telegram via the active
    # Protocol and hands over opaque hex — current-raw to broadcast + the protocol's
    # neutral-raw (for the coarse dead-man / STOP reconnect). The broadcaster knows
    # nothing about protocols/nibbles/bytes.
    def connect(self, connect_raw, neutral_raw):
        self._send({"cmd": "connect", "connect_raw": connect_raw, "neutral_raw": neutral_raw})
    def ready(self):           self._send({"cmd": "ready"})
    def reset(self):           self._send({"cmd": "reset"})
    def send_frame(self, raw, neutral_raw):   self._send({"raw": raw, "neutral_raw": neutral_raw})
    def send_neutral(self):    self._send({"neutral": True})
    def hard_stop(self):       self._send({"killreconnect": True})  # STOP: tear down radio + reconnect at neutral


class App:
    """Thin-transport state: a lifecycle + the active Protocol's per-channel WIRE units
    (MK4: 12 nibbles @ 0x8; MK6: 6 bytes @ 0x80). The server knows NOTHING about functions,
    channel maps, invert/caps, or labels — the client owns all that and sends only low-level
    `set` (slot/channel/value). Motion is honored only in READY. The protocol is chosen at
    `setup` (default MK4 for back-compat); ONE active protocol per session (step 3 — the
    simultaneous MK4+MK6 mix is step 5). The raw telegram is BUILT here via the Protocol and
    handed to the raw-blind broadcaster."""
    def __init__(self):
        self.lifecycle = IDLE
        self.protocol = MK4Protocol()            # session default (MK4 byte-identical to before)
        self._reset_state()

    def _reset_state(self):
        p = self.protocol
        self.state = [p.neutral_unit] * p.n_channels
        self.last_refresh = [0.0] * p.n_channels   # per-channel: last time a `set` refreshed it (dead-man)

    def set_protocol(self, proto):
        """Switch the active protocol (from setup) and re-neutral the state to its shape."""
        self.protocol = proto
        self._reset_state()

    def neutral_state(self):
        p = self.protocol
        return [p.neutral_unit] * p.n_channels

    def build_raw(self):
        return self.protocol.build_motion_raw(self.state)

    def neutral_raw(self):
        return self.protocol.build_motion_raw(self.neutral_state())

    def slots_grid(self):
        # RAW-console display: per-channel VALUES (-7..+7), padded/reshaped to a 3x4 grid.
        # MK4 (12 units) -> exact 3x4 as before; MK6 (6 units) -> first 6 + neutral pad.
        p = self.protocol
        vals = [p.wire_to_value(u) for u in self.state]
        vals = (vals + [0] * 12)[:12]
        return [[vals[s * 4 + c] for c in range(4)] for s in range(3)]

    def set(self, slot, channel, value, now):
        p = self.protocol
        if isinstance(slot, int) and isinstance(channel, int) and 0 <= slot <= 2 and 0 <= channel <= 3:
            ci = p.channel_index(slot, channel)
            if 0 <= ci < p.n_channels:
                self.state[ci] = p.value_to_wire(value)
                self.last_refresh[ci] = now      # affirmative-keepalive: this channel is actively driven

    def reap_stale(self, now, timeout):
        """Per-channel dead-man's-switch: NEUTRALIZE any non-neutral channel not refreshed
        within `timeout`. A channel is held alive ONLY by active client refresh — gamepad
        death, frozen axis, stalled loop or client death all stop the refresh -> neutral.
        Returns True if anything changed."""
        p = self.protocol
        changed = False
        for ci in range(p.n_channels):
            if self.state[ci] != p.neutral_unit and (now - self.last_refresh[ci]) > timeout:
                self.state[ci] = p.neutral_unit
                changed = True
        return changed

    def stop(self):
        self._reset_state()


ipc = IPCClient(SOCK_PATH)
app = App()
clients = set()

# Per-channel refresh timeout (dead-man's-switch): a non-neutral channel auto-neutralizes
# if the client stops re-affirming it. The client re-sends active channels ~10/s; this
# must comfortably exceed that interval. Covers ALL input death (gamepad, frozen, stall, dead client).
CHANNEL_TIMEOUT = float(os.environ.get("MK4_CHANNEL_TIMEOUT", "0.3"))


def state_json():
    # include the resulting motion telegram (raw + on-air AD) so the RAW debug
    # console can show exact bytes without reinventing the crypt client-side.
    # BUILT via the active Protocol (MK4 nibble telegram / MK6 byte telegram).
    raw = app.build_raw()
    return json.dumps({"type": "state", "protocol": app.protocol.name, "slots": app.slots_grid(),
                       "raw": raw, "ad": ad_hex(raw)})


def lifecycle_json():
    return json.dumps({"type": "lifecycle", "state": app.lifecycle})


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
                     "paths": {"sock": SOCK_PATH, "assets": ASSETS_DIR, "web": WEB_DIR}})
    return json.dumps(info)


async def push(msg):
    if clients:
        await asyncio.gather(*(c.send(msg) for c in list(clients)), return_exceptions=True)


async def channel_watchdog():
    """Affirmative dead-man's-switch: per-channel, neutralize anything the client stopped
    re-affirming (CHANNEL_TIMEOUT). The ONE mechanism that covers gamepad death, frozen
    axis, stalled loop AND client death — a held control stays alive only while refreshed."""
    while True:
        await asyncio.sleep(0.05)
        if app.lifecycle == READY and app.reap_stale(time.monotonic(), CHANNEL_TIMEOUT):
            log.warning("channel(s) not refreshed > %dms -> NEUTRAL (dead-man's-switch)", int(CHANNEL_TIMEOUT * 1000))
            ipc.send_frame(app.build_raw(), app.neutral_raw())
            await push(state_json())


async def handler(websocket):
    clients.add(websocket)
    log.info("WS client connected; clients=%d", len(clients))
    try:
        await websocket.send(lifecycle_json())
        await websocket.send(state_json())
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            cmd = msg.get("cmd")
            if cmd == "setup":
                action = msg.get("action")
                if action in ("connect", "ready", "reset"):
                    # Protocol selection is a SESSION setting chosen at setup (default MK4 for
                    # back-compat). Applied whenever `protocol` is present; `device` (0/1/2)
                    # applies to MK6 (header/trailer). Re-neutrals the state to the new shape.
                    proto_name = msg.get("protocol")
                    if proto_name:
                        try:
                            app.set_protocol(make_protocol(proto_name, msg.get("device", 0)))
                        except (ValueError, TypeError) as e:
                            await websocket.send(json.dumps({"type": "error", "error": str(e)}))
                            continue
                    app.lifecycle = {"connect": CONNECTING, "ready": READY, "reset": IDLE}[action]
                    if action == "reset":
                        app.stop()
                    if action == "connect":
                        ipc.connect(app.protocol.connect_raw, app.neutral_raw())
                    elif action == "ready":
                        ipc.ready()
                    else:
                        ipc.reset()
                    await push(lifecycle_json())
                    await push(state_json())
            elif cmd == "set":                    # the ONLY motion primitive (raw slot/channel/value)
                if app.lifecycle == READY:        # motion only when READY
                    # optional per-command protocol MUST match the session's active protocol
                    # this step (single-protocol; mixing MK4+MK6 is step 5).
                    pc = msg.get("protocol")
                    if pc and pc != app.protocol.name:
                        await websocket.send(json.dumps({"type": "error",
                            "error": "protocol %r != active %r (single-protocol per session; mixing is step 5)"
                                     % (pc, app.protocol.name)}))
                        continue
                    app.set(msg.get("slot"), msg.get("channel"), msg.get("value"), time.monotonic())
                    ipc.send_frame(app.build_raw(), app.neutral_raw())
                    await push(state_json())
            elif cmd == "stop":
                app.stop()
                ipc.hard_stop()        # KILL the radio + RECONNECT at neutral (no stale state can be repeated)
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

    def _send_web_html(self, name):     # serve an HTML file, inject WS port + fullscreen flag
        # Placeholders are written so the files stay VALID even when served raw by a
        # plain static server (the port lives in a string). See web/clientconfig.js.
        with open(os.path.join(WEB_DIR, name)) as f:
            html = f.read().replace("__WS_PORT__", str(WS_PORT))
        # In-client Fullscreen button: shown on the web (default). A native host that
        # handles fullscreen itself (the Android app) injects "false" instead.
        html = html.replace("__SHOW_FULLSCREEN__", "true")
        if "__LAYOUTS_JSON__" in html:  # chooser cards from the manifest (raw-serve falls back to fetch)
            html = html.replace("__LAYOUTS_JSON__", LAYOUTS_JSON.replace("\\", "\\\\").replace('"', '\\"'))
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
        asyncio.create_task(channel_watchdog())   # per-channel dead-man's-switch
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
        ipc.reset()
        log.info("api stopped (sent reset)")


if __name__ == "__main__":
    main()
