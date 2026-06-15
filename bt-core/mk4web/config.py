"""Shared configuration (env-overridable). Keep defaults Pi-friendly."""
import os

HOST       = os.environ.get("MK4_HOST", "0.0.0.0")
HTTP_PORT  = int(os.environ.get("MK4_HTTP_PORT", "8080"))     # web page
WS_PORT    = int(os.environ.get("MK4_WS_PORT", "8765"))       # WebSocket API (the product)
SOCK_PATH  = os.environ.get("MK4_SOCK", "/tmp/moldqueen_mk4.sock")   # broadcaster <-> api IPC
HCI        = os.environ.get("MK4_HCI", "hci1")                # control dongle (Realtek)
DWELL      = float(os.environ.get("MK4_DWELL", "10"))         # connect-telegram dwell, seconds
ADV_INTERVAL = int(os.environ.get("MK4_ADV_INTERVAL", "320")) # 0.625ms slots; 320 = 200ms (~5/sec)
REFRESH    = float(os.environ.get("MK4_REFRESH", "0.5"))      # re-issue set-data at least this often (live)
