"""Broadcaster process (A) — owns the radio + authoritative state, with an explicit
connection lifecycle that the GUI drives (the service can't see the LED flashes).

Lifecycle:
  IDLE        advertising OFF, nothing transmitted.
  CONNECTING  broadcasting the MK4 connect telegram (ad ae 18 ...). User does the
              physical button promotion (one hub -> two flashes = slot 1) here.
  READY       broadcasting ONE MK4 motion telegram (7d ae 18 <12 nibbles> 82)
              reflecting current state; motion controls active.

Authoritative state: 12 nibbles (3 slots x 4 channels), default 0x8 neutral.
Transitions + motion come from the API over a local Unix socket (one-way).

SAFETY:
  - motion updates are only applied in READY;
  - non-READY lifecycle forces neutral;
  - if the API process disconnects -> reset to IDLE (advertising OFF, neutral).

--dry-run: log the telegrams it WOULD broadcast (on change), transmit nothing.
Run:  python -m mk4web.broadcaster [--dry-run] [--hci hci1]
"""
import os, json, time, socket, threading, subprocess, argparse, logging

from .telegram import CONNECT_RAW, motion_raw, ad_hex, ad_bytes, N_CHANNELS, NEUTRAL
from .config import SOCK_PATH, HCI, ADV_INTERVAL, REFRESH, RADIO_BACKEND

log = logging.getLogger("broadcaster")
NEUTRAL_STATE = [NEUTRAL] * N_CHANNELS
IDLE, CONNECTING, READY = "IDLE", "CONNECTING", "READY"


class Controller:
    """Lifecycle + 12-nibble state under one lock. `version` bumps on any change."""
    def __init__(self):
        self.lifecycle = IDLE
        self.nibbles = list(NEUTRAL_STATE)
        self.version = 0
        self._lock = threading.Lock()

    def set_lifecycle(self, lc):
        with self._lock:
            if lc != self.lifecycle:
                self.lifecycle = lc
                if lc != READY:
                    self.nibbles = list(NEUTRAL_STATE)   # safety: only READY may be non-neutral
                self.version += 1

    def set_nibbles(self, nb):
        nb = [int(n) & 0xF for n in nb][:N_CHANNELS]
        if len(nb) != N_CHANNELS:
            return
        with self._lock:
            if self.lifecycle == READY and nb != self.nibbles:   # motion only in READY
                self.nibbles = nb
                self.version += 1

    def neutral(self):
        with self._lock:
            if self.nibbles != NEUTRAL_STATE:
                self.nibbles = list(NEUTRAL_STATE)
                self.version += 1

    def reset_idle(self):
        with self._lock:
            if self.lifecycle != IDLE or self.nibbles != NEUTRAL_STATE:
                self.lifecycle = IDLE
                self.nibbles = list(NEUTRAL_STATE)
                self.version += 1

    def snapshot(self):
        with self._lock:
            return self.lifecycle, list(self.nibbles), self.version


# ---------------------------------------------------------------- radio backends
# The broadcaster needs exactly THREE BLE-advertising operations on one bound HCI
# adapter; RadioBackend is that minimal interface, and the broadcaster calls it —
# never hcitool directly. Two implementations:
#   - RawHciBackend  (DEFAULT): a raw AF_BLUETOOTH/BTPROTO_HCI socket that issues the
#     HCI commands WITHOUT hcitool — future-proof, since hcitool is deprecated in
#     BlueZ 5.64+. Hardware-proven (drives both hubs); the default since.
#   - HcitoolBackend (LEGACY): shells out to `hcitool` — the original path, kept as a
#     fallback for setups where the raw socket can't be used. Commands/bytes UNCHANGED.
# Pick with MK4_RADIO_BACKEND=rawhci|hcitool or --radio-backend (default rawhci).
#
# The three ops map to HCI LE commands (OGF 0x08): Set Advertising Parameters
# (OCF 0x0006), Set Advertising Data (0x0008), Set Advertise Enable (0x000a).
_OCF_PARAMS, _OCF_DATA, _OCF_ENABLE = 0x0006, 0x0008, 0x000a


def _hexb(b):
    return ' '.join(f'{x:02x}' for x in b)


def _adv_params_bytes():
    """The 15-byte LE Set Advertising Parameters payload (interval lo/hi twice, adv
    type 0x03 = non-connectable undirected, addr types 0, channel map 0x07, no filter).
    Single source of truth for both backends — same bytes hcitool sent before."""
    lo, hi = ADV_INTERVAL & 0xFF, (ADV_INTERVAL >> 8) & 0xFF
    return bytes([lo, hi, lo, hi, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0x07, 0])


class RadioBackend:
    """Minimal radio interface: three advertising ops on one bound adapter."""
    name = "base"
    preview_in_dry = False               # whether dry-run should dump this backend's HCI cmds
    def set_params(self): raise NotImplementedError      # LE Set Advertising Parameters
    def set_data(self, raw): raise NotImplementedError   # LE Set Advertising Data (from raw telegram)
    def adv(self, on): raise NotImplementedError         # LE Set Advertise Enable
    def plan(self, op, arg=None):                        # human render of the op (dry-run preview)
        raise NotImplementedError


class HcitoolBackend(RadioBackend):
    """LEGACY fallback — shells out to hcitool with the EXACT commands used before."""
    name = "hcitool"
    def __init__(self, hci):
        self.hci = hci
    def _cmd(self, ocf, params_hex):
        # Verbatim form: `hcitool -i <hci> cmd 0x08 0x000N <space-separated params>`.
        subprocess.run(f"hcitool -i {self.hci} cmd 0x08 0x{ocf:04x} {params_hex}",
                       shell=True, check=False, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, executable="/bin/bash")
    def set_params(self):    self._cmd(_OCF_PARAMS, _hexb(_adv_params_bytes()))
    def set_data(self, raw): self._cmd(_OCF_DATA, ad_hex(raw))          # ad_hex == the old 0x0008 payload
    def adv(self, on):       self._cmd(_OCF_ENABLE, "01" if on else "00")
    def plan(self, op, arg=None):
        if op == "params": return f"hcitool -i {self.hci} cmd 0x08 0x0006 {_hexb(_adv_params_bytes())}"
        if op == "data":   return f"hcitool -i {self.hci} cmd 0x08 0x0008 {ad_hex(arg)}"
        return f"hcitool -i {self.hci} cmd 0x08 0x000a {'01' if arg else '00'}"


class RawHciBackend(RadioBackend):
    """DEFAULT — issue the HCI commands over a raw AF_BLUETOOTH/BTPROTO_HCI socket, no
    hcitool. Hardware-proven (drives both hubs). Needs root/CAP_NET_RAW (the socket is
    opened lazily, never in dry-run); the adapter can stay UP. In dry-run it only prints
    the packets it WOULD send."""
    name = "rawhci"
    preview_in_dry = True
    _HCI_COMMAND_PKT = 0x01
    _BTPROTO_HCI = 1
    def __init__(self, hci):
        self.hci = hci
        self.dev_id = int(hci[3:]) if str(hci).startswith("hci") else int(hci)
        self._sock = None
    def _socket(self):
        if self._sock is None:
            s = socket.socket(socket.AF_BLUETOOTH, socket.SOCK_RAW, self._BTPROTO_HCI)
            s.bind((self.dev_id,))           # bind to hciN (may need a channel arg on some kernels)
            self._sock = s
        return self._sock
    def _packet(self, ocf, params):
        import struct
        opcode = (0x08 << 10) | ocf          # OGF 0x08 (LE Controller) << 10 | OCF
        return struct.pack("<BHB", self._HCI_COMMAND_PKT, opcode, len(params)) + params
    def _send(self, ocf, params):
        self._socket().send(self._packet(ocf, params))
    def set_params(self):    self._send(_OCF_PARAMS, _adv_params_bytes())
    def set_data(self, raw): self._send(_OCF_DATA, ad_bytes(raw))       # ad_bytes == the 0x0008 payload
    def adv(self, on):       self._send(_OCF_ENABLE, bytes([1 if on else 0]))
    def plan(self, op, arg=None):
        if op == "params":  ocf, p = _OCF_PARAMS, _adv_params_bytes()
        elif op == "data":  ocf, p = _OCF_DATA, ad_bytes(arg)
        else:               ocf, p = _OCF_ENABLE, bytes([1 if arg else 0])
        return (f"HCI ogf=0x08 ocf=0x{ocf:04x} plen={len(p)} params={_hexb(p)}"
                f"  (pkt={self._packet(ocf, p).hex()})")


def make_backend(name, hci):
    """Select a radio backend by name. "hcitool" -> the LEGACY fallback; anything else
    (incl. unknown/unset) -> rawhci, the DEFAULT."""
    if name == "hcitool":
        return HcitoolBackend(hci)       # legacy fallback
    return RawHciBackend(hci)            # default


# ---------------------------------------------------------------- transition -> ops
def _ops_for(prev, lc, nibbles):
    """The exact ordered radio operations a lifecycle transition performs — the single
    source of truth shared by live execution and the dry-run preview."""
    if lc == IDLE:
        return [("adv", False)]
    if lc == CONNECTING:
        return [("adv", False), ("params", None), ("data", CONNECT_RAW), ("adv", True)]
    if lc == READY:
        raw = motion_raw(nibbles)
        if prev == CONNECTING:
            return [("data", raw)]                                   # advertising already on
        return [("adv", False), ("params", None), ("data", raw), ("adv", True)]
    return []


def _run_ops(backend, ops):
    for op, arg in ops:
        if op == "adv":      backend.adv(arg)
        elif op == "params": backend.set_params()
        elif op == "data":   backend.set_data(arg)


def _preview(backend, ops):
    """Dry-run: dump the HCI commands the backend WOULD send (opt-in per backend, so
    the default hcitool dry-run output is unchanged)."""
    if not backend.preview_in_dry:
        return
    for op, arg in ops:
        log.info("[radio:%s] %s", backend.name, backend.plan(op, arg))


def _enter(prev, lc, nibbles, backend, dry):
    """Apply a lifecycle transition to the radio (or log it in dry-run)."""
    ops = _ops_for(prev, lc, nibbles)
    if lc == IDLE:
        if dry:
            log.info("[dry-run] -> IDLE (advertising OFF)")
        else:
            _run_ops(backend, ops)
        log.info("lifecycle -> IDLE")
    elif lc == CONNECTING:
        if dry:
            log.info("[dry-run] -> CONNECTING raw=%s | AD=%s", CONNECT_RAW, ad_hex(CONNECT_RAW))
        else:
            _run_ops(backend, ops)
        log.info("lifecycle -> CONNECTING (broadcasting connect telegram)")
    elif lc == READY:
        raw = motion_raw(nibbles)
        if dry:
            log.info("[dry-run] -> READY raw=%s | AD=%s", raw, ad_hex(raw))
        else:
            _run_ops(backend, ops)
        log.info("lifecycle -> READY (broadcasting motion; controls active)")
    if dry:
        _preview(backend, ops)


def broadcast_loop(ctrl, backend, dry, stop_evt):
    prev_lc, last_ver, last_refresh = None, -1, 0.0
    while not stop_evt.is_set():
        lc, nibbles, ver = ctrl.snapshot()
        now = time.monotonic()
        if lc != prev_lc:
            _enter(prev_lc, lc, nibbles, backend, dry)
            prev_lc, last_ver, last_refresh = lc, ver, now
        elif lc == READY and ver != last_ver:
            raw = motion_raw(nibbles)
            if dry:
                log.info("[dry-run] READY state v%d -> raw=%s | AD=%s", ver, raw, ad_hex(raw))
            else:
                backend.set_data(raw)
            last_ver, last_refresh = ver, now
        elif not dry and lc in (CONNECTING, READY) and (now - last_refresh) >= REFRESH:
            backend.set_data(CONNECT_RAW if lc == CONNECTING else motion_raw(nibbles))
            last_refresh = now
        time.sleep(0.05)


# ---------------------------------------------------------------- IPC (API -> here)
def ipc_server(ctrl, stop_evt):
    try:
        if os.path.exists(SOCK_PATH):
            os.unlink(SOCK_PATH)
    except OSError:
        pass
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(SOCK_PATH)
    srv.listen(1)
    srv.settimeout(1.0)
    try:
        os.chmod(SOCK_PATH, 0o660)
        uid, gid = os.environ.get("SUDO_UID"), os.environ.get("SUDO_GID")
        if os.geteuid() == 0 and uid and gid:      # hand socket to the launching user
            os.chown(SOCK_PATH, int(uid), int(gid))
    except OSError:
        pass
    log.info("IPC listening on %s", SOCK_PATH)
    while not stop_evt.is_set():
        try:
            conn, _ = srv.accept()
        except socket.timeout:
            continue
        except OSError:
            break
        log.info("API connected")
        conn.settimeout(1.0)
        buf = b""
        try:
            while not stop_evt.is_set():
                try:
                    data = conn.recv(4096)
                except socket.timeout:
                    continue
                if not data:
                    break
                buf += data
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    if not line.strip():
                        continue
                    try:
                        msg = json.loads(line)
                    except ValueError:
                        continue
                    cmd = msg.get("cmd")
                    if cmd == "connect":
                        ctrl.set_lifecycle(CONNECTING)
                    elif cmd == "ready":
                        ctrl.set_lifecycle(READY)
                    elif cmd == "reset":
                        ctrl.reset_idle()
                    elif msg.get("neutral"):
                        ctrl.neutral()
                    elif "state" in msg:
                        ctrl.set_nibbles(msg["state"])
        finally:
            conn.close()
            ctrl.reset_idle()      # SAFETY: API gone -> IDLE (advertising OFF, neutral)
            log.info("API disconnected -> IDLE (safety)")
    srv.close()
    try:
        os.unlink(SOCK_PATH)
    except OSError:
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="log telegrams, transmit nothing")
    ap.add_argument("--hci", default=HCI)
    ap.add_argument("--radio-backend", choices=["hcitool", "rawhci"], default=RADIO_BACKEND,
                    help="radio driver: rawhci (DEFAULT, no hcitool) or hcitool (legacy fallback)")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    backend = make_backend(a.radio_backend, a.hci)
    log.info("broadcaster start (hci=%s backend=%s dry_run=%s sock=%s) — lifecycle begins IDLE",
             a.hci, backend.name, a.dry_run, SOCK_PATH)
    if not a.dry_run:
        backend.adv(False)   # ensure clean (not advertising) at start

    ctrl = Controller()
    stop_evt = threading.Event()
    threading.Thread(target=ipc_server, args=(ctrl, stop_evt), daemon=True).start()
    try:
        broadcast_loop(ctrl, backend, a.dry_run, stop_evt)
    except KeyboardInterrupt:
        pass
    finally:
        stop_evt.set()
        if not a.dry_run:
            backend.adv(False)
        log.info("broadcaster stopped (advertising off)")


if __name__ == "__main__":
    main()
