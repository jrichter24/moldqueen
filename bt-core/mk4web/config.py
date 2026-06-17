"""Shared configuration (env-overridable). Keep defaults Pi-friendly."""
import os

REPO_ROOT  = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

HOST       = os.environ.get("MK4_HOST", "0.0.0.0")
HTTP_PORT  = int(os.environ.get("MK4_HTTP_PORT", "8080"))     # web page (optional client server)
WS_PORT    = int(os.environ.get("MK4_WS_PORT", "8765"))       # WebSocket API (the product) — always on
# Whether the API ALSO serves the client web UI (optional convenience). 0/false/no
# = WebSocket-only (no HTTP server). CLI --ws-only / --http-port override this.
SERVE_CLIENT = os.environ.get("MK4_SERVE_CLIENT", "1").strip().lower() not in ("0", "false", "no", "off")
SOCK_PATH  = os.environ.get("MK4_SOCK", "/tmp/moldqueen_mk4.sock")   # broadcaster <-> api IPC
HCI        = os.environ.get("MK4_HCI", "hci1")                # control dongle (Realtek)
# Radio backend: "rawhci" (DEFAULT — raw AF_BLUETOOTH/BTPROTO_HCI socket, NO hcitool
# dependency; future-proof against hcitool's deprecation in BlueZ 5.64+; now hardware-
# proven) or "hcitool" (LEGACY fallback — shells out to hcitool). Unknown/unset ->
# rawhci. --radio-backend wins.
RADIO_BACKEND = os.environ.get("MK4_RADIO_BACKEND", "rawhci").strip().lower()
DWELL      = float(os.environ.get("MK4_DWELL", "10"))         # connect-telegram dwell, seconds
ADV_INTERVAL = int(os.environ.get("MK4_ADV_INTERVAL", "320")) # 0.625ms slots; 320 = 200ms (~5/sec)
REFRESH    = float(os.environ.get("MK4_REFRESH", "0.5"))      # re-issue set-data at least this often (live)

# Persisted DEFAULT channel map (function -> slot/channel/invert/labels) and the
# assets dir the web server may serve (dashboard background lives here).
CONFIG_DIR       = os.environ.get("MK4_CONFIG_DIR", os.path.join(REPO_ROOT, "config"))
ASSETS_DIR       = os.environ.get("MK4_ASSETS_DIR", os.path.join(REPO_ROOT, "assets"))


def channel_map_path(layout_id):
    """PER-LAYOUT default channel map: config/channel_map.<layout_id>.json. Each
    function-mapped layout owns its default map; the excavator's is
    channel_map.excavator.json. Legacy fallback: if a layout's file is absent but the
    old global config/channel_map.json exists, use that (one-time migration safety)."""
    p = os.path.join(CONFIG_DIR, "channel_map.%s.json" % layout_id)
    legacy = os.path.join(CONFIG_DIR, "channel_map.json")
    if not os.path.exists(p) and os.path.exists(legacy):
        return legacy
    return p

# Server identity + WS {"cmd":"info"} disclosure tier.
VERSION = "0.1.0"
# Disclosure tier for the server-info message: "safe" (minimal/non-identifying),
# "light" (DEFAULT; + radio backend, dry-run, hci index, ports — NO MAC), or "debug"
# (+ adapter MAC, hostname, paths, bluetoothd state). Unknown -> light. --info-level wins.
INFO_LEVEL = os.environ.get("MK4_INFO_LEVEL", "light").strip().lower()
if INFO_LEVEL not in ("safe", "light", "debug"):
    INFO_LEVEL = "light"
# Configured dry-run intent, reported in the info message (light+). NOTE: this is the
# API server's configured view (env); the broadcaster's own --dry-run is a separate
# process flag — start the service via one path (env or scripts/start.sh) to keep them aligned.
DRY_RUN = os.environ.get("MK4_DRY_RUN", "0").strip().lower() in ("1", "true", "yes", "on")
