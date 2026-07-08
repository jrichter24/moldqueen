"""Broadcaster process (A) — owns the radio + authoritative state, with an explicit
connection lifecycle that the GUI drives (the service can't see the LED flashes).

RAW-BLIND (MK6 build step 3): the broadcaster is protocol-agnostic. It holds opaque
telegram hex handed over IPC by the API — current_raw (broadcast in READY), neutral_raw
(the protocol's all-neutral frame, for the coarse dead-man + STOP), connect_raw — and
knows NOTHING about protocols/nibbles/bytes. The API builds the telegram via the active
Protocol (MK4 nibble / MK6 byte) and sends the bytes; the broadcaster just repeats them.

Lifecycle:
  IDLE        advertising OFF, nothing transmitted.
  CONNECTING  broadcasting connect_raw (the shared connect telegram). User does the
              physical button promotion (one hub -> two flashes = slot 1) here.
  READY       broadcasting ONE motion telegram (current_raw) reflecting current state;
              motion controls active.

Authoritative state: opaque current_raw / neutral_raw (built by the API). Transitions +
frames come from the API over a local Unix socket (one-way).

SAFETY:
  - motion frames are only applied in READY;
  - non-READY lifecycle forces neutral_raw;
  - the coarse dead-man swaps to neutral_raw if the API goes silent;
  - if the API process disconnects -> reset to IDLE (advertising OFF, neutral).

--dry-run: log the telegrams it WOULD broadcast (on change), transmit nothing.
Run:  python -m mk4web.broadcaster [--dry-run] [--hci hci1]
"""
import os, json, time, socket, threading, subprocess, argparse, logging

from .telegram import CONNECT_RAW, ad_hex, ad_bytes
from .config import SOCK_PATH, HCI, ADV_INTERVAL, REFRESH, RADIO_BACKEND

log = logging.getLogger("broadcaster")
IDLE, CONNECTING, READY = "IDLE", "CONNECTING", "READY"
# Coarse dead-man's-switch (defense in depth): if the API goes silent (no IPC at all) while
# READY + non-neutral, NEUTRAL here too. Fed by the API's affirmative refreshes (~10/s while
# driving); longer than the API's per-channel window so the API neutralizes first normally.
WATCHDOG_TIMEOUT = float(os.environ.get("MK4_BCAST_WATCHDOG", "0.5"))


class Controller:
    """Lifecycle + opaque RAW telegram state under one lock (RAW-BLIND). `version` bumps on
    any change. Holds current_raw (broadcast in READY), neutral_raw (the active protocol's
    all-neutral frame, supplied by the API), connect_raw (the connect telegram). The
    broadcaster never builds these — the API hands them over IPC."""
    def __init__(self):
        self.lifecycle = IDLE
        self.current_raw = None                 # the frame to broadcast in READY (built by the API)
        self.neutral_raw = None                 # the protocol's neutral frame (dead-man / STOP target)
        self.connect_raw = CONNECT_RAW          # default; the API overrides on connect (per protocol)
        self.version = 0
        self.last_activity = time.monotonic()   # last IPC from the API (coarse dead-man's-switch)
        self.restart = False                    # STOP requested a radio teardown + reconnect-at-neutral
        self._lock = threading.Lock()

    def touch(self):
        self.last_activity = time.monotonic()   # any IPC message = API alive

    def request_restart(self):
        """STOP: force NEUTRAL and request a full radio kill+reconnect (the broadcast loop
        tears the advertiser down and re-establishes a clean neutral, so the keepalive can
        NEVER repeat a stale non-zero frame)."""
        with self._lock:
            self.current_raw = self.neutral_raw
            self.restart = True
            self.version += 1

    def take_restart(self):
        with self._lock:
            r = self.restart; self.restart = False; return r

    def set_connect(self, connect_raw, neutral_raw):
        """On connect: adopt the active protocol's connect + neutral frames."""
        with self._lock:
            if connect_raw:
                self.connect_raw = connect_raw
            if neutral_raw:
                self.neutral_raw = neutral_raw

    def set_lifecycle(self, lc):
        with self._lock:
            if lc != self.lifecycle:
                self.lifecycle = lc
                if lc != READY:
                    self.current_raw = self.neutral_raw     # safety: only READY may be non-neutral
                elif self.current_raw is None:
                    self.current_raw = self.neutral_raw     # enter READY at neutral until the first frame
                self.version += 1

    def set_raw(self, raw, neutral_raw):
        """Motion frame from the API (already built via the active Protocol)."""
        with self._lock:
            if neutral_raw:
                self.neutral_raw = neutral_raw
            if self.lifecycle == READY and raw and raw != self.current_raw:   # motion only in READY
                self.current_raw = raw
                self.version += 1

    def neutral(self):
        with self._lock:
            if self.neutral_raw is not None and self.current_raw != self.neutral_raw:
                self.current_raw = self.neutral_raw
                self.version += 1

    def reset_idle(self):
        with self._lock:
            if self.lifecycle != IDLE or self.current_raw != self.neutral_raw:
                self.lifecycle = IDLE
                self.current_raw = self.neutral_raw
                self.version += 1

    def snapshot(self):
        with self._lock:
            return self.lifecycle, self.current_raw, self.connect_raw, self.neutral_raw, self.version


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
def _ops_for(prev, lc, current_raw, connect_raw):
    """The exact ordered radio operations a lifecycle transition performs — the single
    source of truth shared by live execution and the dry-run preview. Operates on the
    opaque raw frames handed over IPC (RAW-BLIND — no telegram building here)."""
    if lc == IDLE:
        return [("adv", False)]
    if lc == CONNECTING:
        return [("adv", False), ("params", None), ("data", connect_raw), ("adv", True)]
    if lc == READY:
        if prev == CONNECTING:
            return [("data", current_raw)]                           # advertising already on
        return [("adv", False), ("params", None), ("data", current_raw), ("adv", True)]
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


def _enter(prev, lc, current_raw, connect_raw, backend, dry):
    """Apply a lifecycle transition to the radio (or log it in dry-run). RAW-BLIND: it
    broadcasts the opaque frames handed over IPC (connect_raw / current_raw)."""
    ops = _ops_for(prev, lc, current_raw, connect_raw)
    if lc == IDLE:
        if dry:
            log.info("[dry-run] -> IDLE (advertising OFF)")
        else:
            _run_ops(backend, ops)
        log.info("lifecycle -> IDLE")
    elif lc == CONNECTING:
        if dry:
            log.info("[dry-run] -> CONNECTING raw=%s | AD=%s", connect_raw, ad_hex(connect_raw))
        else:
            _run_ops(backend, ops)
        log.info("lifecycle -> CONNECTING (broadcasting connect telegram)")
    elif lc == READY:
        if dry:
            log.info("[dry-run] -> READY raw=%s | AD=%s", current_raw, ad_hex(current_raw) if current_raw else "-")
        else:
            _run_ops(backend, ops)
        log.info("lifecycle -> READY (broadcasting motion; controls active)")
    if dry:
        _preview(backend, ops)


def _kill_reconnect(backend, connect_raw, neutral_raw, dry):
    """STOP: tear the advertiser DOWN, then reconnect into a CLEAN neutral state — re-send the
    connect telegram, then broadcast the (opaque) all-neutral motion telegram. The
    repeated/keepalive state is now neutral, so no stale non-zero frame can survive anywhere."""
    ops = [("adv", False), ("params", None), ("data", connect_raw), ("adv", True), ("data", neutral_raw)]
    if dry:
        log.warning("[dry-run] STOP kill+reconnect: adv OFF -> connect=%s -> neutral motion=%s",
                    connect_raw, neutral_raw)
        _preview(backend, ops)
    else:
        _run_ops(backend, ops)
        log.warning("STOP: radio torn down + reconnected at NEUTRAL (held = %s)", neutral_raw)


def broadcast_loop(ctrl, backend, dry, stop_evt):
    prev_lc, last_ver, last_refresh = None, -1, 0.0
    while not stop_evt.is_set():
        lc, current_raw, connect_raw, neutral_raw, ver = ctrl.snapshot()
        now = time.monotonic()
        # STOP: kill the radio + reconnect at neutral (defeats the keepalive's stale-state repeat)
        if ctrl.take_restart():
            if lc == READY:
                _kill_reconnect(backend, connect_raw, neutral_raw, dry)
            lc, current_raw, connect_raw, neutral_raw, ver = ctrl.snapshot()   # neutral now
            prev_lc, last_ver, last_refresh = lc, ver, now   # resync (don't double-enter/re-broadcast)
            time.sleep(0.05); continue
        # coarse dead-man's-switch (defense in depth): API silent while READY+non-neutral -> NEUTRAL
        if lc == READY and neutral_raw is not None and current_raw != neutral_raw \
                and (now - ctrl.last_activity) > WATCHDOG_TIMEOUT:
            log.warning("API silent > %dms while READY -> NEUTRAL (broadcaster watchdog)", int(WATCHDOG_TIMEOUT * 1000))
            ctrl.neutral()
            lc, current_raw, connect_raw, neutral_raw, ver = ctrl.snapshot()   # re-read -> broadcast neutral
        if lc != prev_lc:
            _enter(prev_lc, lc, current_raw, connect_raw, backend, dry)
            prev_lc, last_ver, last_refresh = lc, ver, now
        elif lc == READY and ver != last_ver:
            if dry:
                log.info("[dry-run] READY state v%d -> raw=%s | AD=%s", ver, current_raw,
                         ad_hex(current_raw) if current_raw else "-")
            elif current_raw:
                backend.set_data(current_raw)
            last_ver, last_refresh = ver, now
        elif not dry and lc in (CONNECTING, READY) and (now - last_refresh) >= REFRESH:
            frame = connect_raw if lc == CONNECTING else current_raw
            if frame:
                backend.set_data(frame)
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
                    ctrl.touch()                       # any IPC = API alive (feeds the coarse watchdog)
                    cmd = msg.get("cmd")
                    if cmd == "connect":
                        ctrl.set_connect(msg.get("connect_raw"), msg.get("neutral_raw"))
                        ctrl.set_lifecycle(CONNECTING)
                    elif cmd == "ready":
                        ctrl.set_lifecycle(READY)
                    elif cmd == "reset":
                        ctrl.reset_idle()
                    elif msg.get("killreconnect"):
                        ctrl.request_restart()         # STOP: kill the radio + reconnect at neutral
                    elif msg.get("neutral"):
                        ctrl.neutral()
                    elif "raw" in msg:                 # RAW-BLIND motion frame (built by the API)
                        ctrl.set_raw(msg.get("raw"), msg.get("neutral_raw"))
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
