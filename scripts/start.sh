#!/usr/bin/env bash
# moldqueen — friendly preflight + launcher for the MK4 control webservice.
#
# Gets you running with NO persistent system changes. For THIS SESSION it may
# mask bluetoothd (so it can't grab the adapter) and bring the BLE dongle up —
# both reversible, nothing installed, nothing survives a reboot. Auto-start via
# systemd is an OPTIONAL documented path (README → "Running as a service").
#
# Usage:
#   scripts/start.sh             preflight, fix what it safely can, launch (live)
#   scripts/start.sh --dry-run   same, but the broadcaster LOGS telegrams (no transmit)
#   scripts/start.sh --check     audit only — report state, change nothing, don't launch
#   scripts/start.sh --ws-only   API serves the WebSocket ONLY (no client web page)
#   scripts/start.sh --http-port N   serve the client page on port N (default 8080)
#
# The WebSocket API (the product) always runs; serving the client web page is
# optional. Env overrides (bt-core/mk4web/config.py): MK4_DONGLE_MAC, MK4_HCI,
# MK4_HTTP_PORT, MK4_WS_PORT, MK4_SOCK, MK4_SERVE_CLIENT (0 = ws-only).
set -euo pipefail

DONGLE_MAC="${MK4_DONGLE_MAC:-00:A6:44:02:21:25}"   # Realtek control dongle
HTTP_PORT="${MK4_HTTP_PORT:-8080}"
SOCK="${MK4_SOCK:-/tmp/moldqueen_mk4.sock}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BT_CORE="$REPO_ROOT/bt-core"
VENV_PY="$BT_CORE/.venv/bin/python"

MODE="live"; WS_ONLY=0; API_EXTRA=()
while [ $# -gt 0 ]; do
  case "$1" in
    --check)              MODE="check" ;;
    --dry-run)            MODE="dry-run" ;;
    --ws-only|--no-client) WS_ONLY=1; API_EXTRA+=(--ws-only) ;;
    --http-port)          shift; HTTP_PORT="$1"; API_EXTRA+=(--http-port "$1") ;;
    --http-port=*)        HTTP_PORT="${1#*=}"; API_EXTRA+=(--http-port "${1#*=}") ;;
    -h|--help)            sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^#\s\{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1 (try --help)"; exit 2 ;;
  esac
  shift
done

c_g=$'\033[32m'; c_y=$'\033[33m'; c_r=$'\033[31m'; c_b=$'\033[1m'; c_0=$'\033[0m'
pass(){ printf "  ${c_g}PASS${c_0} %s\n" "$*"; }
fixed(){ printf "  ${c_y}FIX ${c_0} %s\n" "$*"; }
fail(){ printf "  ${c_r}FAIL${c_0} %s\n" "$*"; ISSUES=$((ISSUES + 1)); }
info(){ printf "       %s\n" "$*"; }
hdr(){ printf "\n${c_b}== %s ==${c_0}\n" "$*"; }
ISSUES=0
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"

printf "${c_b}moldqueen launcher${c_0}  (mode: %s, repo: %s)\n" "$MODE" "$REPO_ROOT"

# ── 1. bluetoothd ───────────────────────────────────────────────
hdr "1. bluetoothd (must not own the adapter)"
if systemctl is-active --quiet bluetooth 2>/dev/null; then
  if [ "$MODE" = "check" ]; then
    fail "bluetoothd is ACTIVE — it grabs the adapter. Fix: sudo systemctl mask --now bluetooth"
  else
    fixed "bluetoothd active → masking + stopping for this session"
    info  "reversible later with: sudo systemctl unmask bluetooth"
    if $SUDO systemctl mask --now bluetooth 2>/dev/null; then pass "bluetoothd masked + stopped"; else fail "could not mask bluetooth (need sudo)"; fi
  fi
else
  en="$(systemctl is-enabled bluetooth 2>/dev/null || true)"; pass "bluetoothd inactive (${en:-not-enabled})"
fi

# ── 2. BLE control dongle (by MAC, not index) ───────────────────
hdr "2. BLE control dongle (found by MAC, so a reindex doesn't matter)"
HCI="${MK4_HCI:-}"
if [ -z "$HCI" ]; then
  for h in $(hciconfig 2>/dev/null | grep -oE '^hci[0-9]+' || true); do
    m="$(hciconfig "$h" 2>/dev/null | grep -oE '..(:..){5}' | head -1 || true)"
    if [ "$m" = "$DONGLE_MAC" ]; then HCI="$h"; break; fi
  done
fi
if [ -z "$HCI" ]; then
  fail "dongle $DONGLE_MAC NOT found. Plug it in; check 'lsusb' and 'hciconfig -a'."
else
  state="$(hciconfig "$HCI" 2>/dev/null | grep -oE 'UP RUNNING|DOWN' | head -1 || true)"
  if [ "$state" = "UP RUNNING" ]; then
    pass "dongle $DONGLE_MAC is $HCI — UP RUNNING"
  elif [ "$MODE" = "check" ]; then
    fail "dongle $DONGLE_MAC is $HCI but DOWN. Fix: sudo hciconfig $HCI up"
  elif [ "$MODE" = "dry-run" ]; then
    pass "dongle $DONGLE_MAC is $HCI (DOWN — fine for --dry-run, nothing transmits)"
  else
    fixed "dongle $HCI is DOWN → bringing up"
    if $SUDO hciconfig "$HCI" up 2>/dev/null; then pass "dongle $HCI now UP RUNNING"; else fail "could not bring $HCI up (need sudo)"; fi
  fi
fi

# ── 3. privileges ───────────────────────────────────────────────
hdr "3. privileges (raw-HCI transmit needs root or cap_net_raw,cap_net_admin)"
if [ "$(id -u)" -eq 0 ]; then
  pass "running as root"
elif [ "$MODE" != "live" ]; then
  pass "not root — fine for $MODE (no raw-HCI transmit)"
else
  info "not root — the broadcaster will be launched with sudo (you may be prompted for your password)"
fi

# ── 4. venv + websockets ────────────────────────────────────────
hdr "4. Python venv + dependencies"
if [ ! -x "$VENV_PY" ]; then
  fail "venv missing. Set it up: cd bt-core && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt"
elif "$VENV_PY" -c 'import websockets' 2>/dev/null; then
  pass "venv ok — websockets $("$VENV_PY" -c 'import websockets; print(websockets.__version__)' 2>/dev/null)"
else
  fail "websockets not installed. Run: cd bt-core && . .venv/bin/activate && pip install -r requirements.txt"
fi

# ── result / stop for --check ───────────────────────────────────
hdr "result"
if [ "$MODE" = "check" ]; then
  if [ "$ISSUES" -eq 0 ]; then pass "all checks passed — ready to launch (scripts/start.sh)"; else fail "$ISSUES issue(s) above — fix the FAIL lines"; fi
  [ "$ISSUES" -eq 0 ]; exit $?
fi
if [ "$ISSUES" -ne 0 ]; then fail "$ISSUES blocking issue(s) — NOT launching. Fix above, or run: scripts/start.sh --check"; exit 1; fi
pass "preflight clean — launching"

# ── 5. launch (broadcaster → socket → api) ──────────────────────
hdr "5. launch"
BC_SUDO=""; [ "$MODE" = "live" ] && BC_SUDO="$SUDO"
BC_PID=""; API_PID=""
cleanup(){ trap - EXIT INT TERM; printf "\nstopping…\n"; [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true; [ -n "$BC_PID" ] && $BC_SUDO kill -INT "$BC_PID" 2>/dev/null || true; rm -f "$SOCK" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

BC_ARGS=(--hci "$HCI"); [ "$MODE" = "dry-run" ] && BC_ARGS+=(--dry-run)
[ -S "$SOCK" ] && rm -f "$SOCK" 2>/dev/null || true   # drop a stale socket so the wait below tracks THIS broadcaster
( cd "$BT_CORE" && exec $BC_SUDO "$VENV_PY" -m mk4web.broadcaster "${BC_ARGS[@]}" ) &
BC_PID=$!
info "broadcaster started (mode: $MODE) — begins IDLE; transmits NOTHING until you do Connect→Ready in the GUI"

for _ in $(seq 1 50); do if [ -S "$SOCK" ]; then break; fi; sleep 0.1; done
if [ -S "$SOCK" ]; then pass "IPC socket up: $SOCK"; else info "socket not seen yet ($SOCK) — the api will keep retrying"; fi

( cd "$BT_CORE" && exec "$VENV_PY" -m mk4web.api "${API_EXTRA[@]}" ) &
API_PID=$!
ip="$(hostname -I 2>/dev/null | awk '{print $1}')"; ip="${ip:-localhost}"
pass "api started"
if [ "$WS_ONLY" = "1" ]; then
  hdr "READY — WebSocket API on ws://$ip:${MK4_WS_PORT:-8765} (no web page; bring your own client)"
else
  hdr "READY — open  http://$ip:$HTTP_PORT/"
fi
info "Cold-start in the browser: Connect → press ONE hub's button to TWO flashes (slot 1) → Ready → drive."
info "The big STOP button (and closing the page) forces neutral. Ctrl-C here stops both processes."
wait || true
