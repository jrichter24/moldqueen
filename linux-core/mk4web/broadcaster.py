"""Broadcaster process (A) — owns the radio + authoritative state, with an explicit
connection lifecycle that the GUI drives (the service can't see the LED flashes).

RAW-BLIND, LIST-INTERLEAVE (MK6 build steps 3 + 5): the broadcaster is protocol-agnostic.
It holds a LIST of opaque telegram ENTRIES handed over IPC by the API — each entry =
{current, neutral, connect} — and knows NOTHING about protocols/nibbles/bytes. The API
builds every frame via its Protocols (MK4 nibble / MK6 byte) and hands the whole list; the
broadcaster INTERLEAVES it on the one shared 0xFFF0 radio (time-multiplexed, one advertiser).
ONE entry = step-3 single-protocol behavior EXACTLY; TWO+ = round-robin so each protocol keeps
its ~10/s keepalive (simultaneous MK4 + MK6).

Lifecycle:
  IDLE        advertising OFF, nothing transmitted (no active entries).
  CONNECTING  advertising the connecting protocol's bind telegram (its entry's `current`).
              User does the physical button promotion / box pairing here.
  READY       interleaving each active protocol's motion telegram; controls active.

Authoritative state: the opaque entry LIST (built by the API). Transitions + frames come
from the API over a local Unix socket (one-way).

SAFETY:
  - motion updates are only applied in READY;
  - STOP and the coarse dead-man neutral EVERY entry (never just one — the other box would
    keep running); STOP = kill + reconnect with ALL entries at neutral;
  - if the API process disconnects -> reset to IDLE (advertising OFF, all neutral).

--dry-run: log the telegrams it WOULD broadcast, transmit nothing.
Run:  python -m mk4web.broadcaster [--dry-run] [--hci hci1]
"""
import os, json, time, socket, threading, subprocess, argparse, logging

from .telegram import ad_hex, ad_bytes
from .config import SOCK_PATH, HCI, ADV_INTERVAL, REFRESH, RADIO_BACKEND

log = logging.getLogger("broadcaster")
IDLE, CONNECTING, READY = "IDLE", "CONNECTING", "READY"
# Coarse dead-man's-switch (defense in depth): if the API goes silent (no IPC at all) while
# READY + non-neutral, NEUTRAL here too. Fed by the API's affirmative refreshes (~10/s while
# driving); longer than the API's per-channel window so the API neutralizes first normally.
WATCHDOG_TIMEOUT = float(os.environ.get("MK4_BCAST_WATCHDOG", "0.5"))


class Controller:
    """Lifecycle + a LIST of opaque telegram ENTRIES under one lock (RAW-BLIND, step 5). Each
    entry = {current, neutral, connect}: `current` is the frame to broadcast for that protocol
    right now (its bind telegram while CONNECTING, its motion while READY), `neutral` is that
    protocol's all-neutral frame (dead-man / STOP target), `connect` is its connect/bind
    telegram (re-sent on the STOP reconnect). The broadcaster INTERLEAVES the list on the one
    shared radio (one entry = step-3 single-protocol behavior exactly). The API builds every
    frame and hands the whole list over IPC; the broadcaster never builds or inspects them."""
    def __init__(self):
        self.lifecycle = IDLE
        self.entries = []                       # [{current, neutral, connect}] — the interleave list
        self.version = 0
        self.last_activity = time.monotonic()   # last IPC from the API (coarse dead-man's-switch)
        self.restart = False                    # STOP requested a radio teardown + reconnect-at-neutral
        self._lock = threading.Lock()

    def touch(self):
        self.last_activity = time.monotonic()   # any IPC message = API alive

    def request_restart(self):
        """STOP: force EVERY entry to NEUTRAL and request a full radio kill+reconnect (the
        broadcast loop tears the advertiser down and re-establishes ALL entries at neutral, so
        the interleave can NEVER repeat a stale non-zero frame for ANY protocol)."""
        with self._lock:
            for e in self.entries:
                e["current"] = e["neutral"]
            self.restart = True
            self.version += 1

    def take_restart(self):
        with self._lock:
            r = self.restart; self.restart = False; return r

    def set_lifecycle(self, lc, entries):
        """Lifecycle change from the API (connect/ready/reset) carrying the full entry list.
        IDLE clears the list; CONNECTING/READY adopt the entries the API built."""
        with self._lock:
            self.lifecycle = lc
            if lc == IDLE:
                self.entries = []
            elif entries is not None:
                self.entries = [dict(e) for e in entries]
            self.version += 1

    def set_entries(self, entries):
        """Motion update from the API (built frames). Applied only in READY (motion gate)."""
        with self._lock:
            if self.lifecycle == READY and entries is not None:
                self.entries = [dict(e) for e in entries]
                self.version += 1

    def neutral_all(self):
        """Coarse dead-man / client-disconnect: force EVERY entry's current -> its neutral."""
        with self._lock:
            changed = False
            for e in self.entries:
                if e["current"] != e["neutral"]:
                    e["current"] = e["neutral"]; changed = True
            if changed:
                self.version += 1

    def reset_idle(self):
        with self._lock:
            if self.lifecycle != IDLE or self.entries:
                self.lifecycle = IDLE
                self.entries = []
                self.version += 1

    def snapshot(self):
        with self._lock:
            return self.lifecycle, [dict(e) for e in self.entries], self.version


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
def _advertise_on_ops(first_current):
    """Fresh advertise: down -> params -> first frame -> up (the clean start choreography)."""
    return [("adv", False), ("params", None), ("data", first_current), ("adv", True)]


def _kill_reconnect_ops(entries):
    """STOP: tear the advertiser DOWN, re-send EVERY entry's connect telegram, bring it UP, then
    broadcast EVERY entry's neutral. For ONE entry this is EXACTLY the step-3 order
    (down, params, connect, up, neutral). For N it re-affirms + neutrals all protocols."""
    ops = [("adv", False), ("params", None)]
    ops += [("data", e["connect"]) for e in entries if e.get("connect")]
    ops += [("adv", True)]
    ops += [("data", e["neutral"]) for e in entries]
    return ops


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


def _enter_advertising(backend, entries, dry):
    """Start the advertiser cleanly on the first active entry (down -> params -> frame -> up)."""
    first = entries[0]["current"]
    ops = _advertise_on_ops(first)
    if dry:
        log.info("[dry-run] advertising ON (%d entr%s) first=%s | AD=%s", len(entries),
                 "y" if len(entries) == 1 else "ies", first, ad_hex(first) if first else "-")
        _preview(backend, ops)
    else:
        _run_ops(backend, ops)


def _kill_reconnect(backend, entries, dry):
    """STOP: tear the advertiser DOWN, then reconnect with EVERY entry at neutral (re-send each
    connect, then each neutral). No stale non-zero frame can survive for ANY protocol."""
    ops = _kill_reconnect_ops(entries)
    if dry:
        log.warning("[dry-run] STOP kill+reconnect: %d entr%s -> ALL neutral", len(entries),
                    "y" if len(entries) == 1 else "ies")
        _preview(backend, ops)
    else:
        _run_ops(backend, ops)
        log.warning("STOP: radio torn down + reconnected at NEUTRAL (%d entr%s)", len(entries),
                    "y" if len(entries) == 1 else "ies")


def broadcast_loop(ctrl, backend, dry, stop_evt):
    """RAW-BLIND interleave loop. ONE entry -> step-3 cadence EXACTLY (broadcast on change +
    REFRESH keepalive floor). TWO+ entries -> round-robin one frame per ~50 ms tick, so each
    active protocol keeps its ~10/s effective keepalive (~20/s total for two) on the one radio."""
    prev_lc, advertising, last_ver, last_refresh, rot = None, False, -1, 0.0, 0
    while not stop_evt.is_set():
        lc, entries, ver = ctrl.snapshot()
        now = time.monotonic()
        n = len(entries)

        # STOP: kill radio + reconnect ALL entries at neutral (request_restart already neutraled them)
        if ctrl.take_restart():
            if advertising or n:
                _kill_reconnect(backend, entries, dry)
                advertising = True
            lc, entries, ver = ctrl.snapshot()
            prev_lc, last_ver, last_refresh, rot = lc, ver, now, 0
            time.sleep(0.05); continue

        # coarse dead-man (READY only, like step 3): API silent while ANY entry non-neutral -> neutral ALL
        if lc == READY and n and any(e["current"] != e["neutral"] for e in entries) \
                and (now - ctrl.last_activity) > WATCHDOG_TIMEOUT:
            log.warning("API silent > %dms while READY -> NEUTRAL all (broadcaster watchdog)", int(WATCHDOG_TIMEOUT * 1000))
            ctrl.neutral_all()
            lc, entries, ver = ctrl.snapshot(); n = len(entries)

        if lc != prev_lc:
            log.info("lifecycle -> %s (%d protocol%s)", lc, n, "" if n == 1 else "s")

        want_adv = lc in (CONNECTING, READY) and n > 0
        if want_adv and not advertising:
            _enter_advertising(backend, entries, dry)
            advertising = True; last_ver = ver; last_refresh = now; rot = 0
        elif not want_adv and advertising:
            if dry:
                log.info("[dry-run] advertising OFF")
            else:
                backend.adv(False)
            advertising = False
        elif advertising and n:
            if n == 1:
                # SINGLE entry = step-3 cadence EXACTLY: broadcast on change + REFRESH floor
                cur = entries[0]["current"]
                if ver != last_ver:
                    if dry:
                        log.info("[dry-run] v%d -> raw=%s | AD=%s", ver, cur, ad_hex(cur) if cur else "-")
                    elif cur:
                        backend.set_data(cur)
                    last_ver, last_refresh = ver, now
                elif not dry and cur and (now - last_refresh) >= REFRESH:
                    backend.set_data(cur); last_refresh = now
            else:
                # INTERLEAVE: one frame per tick, round-robin (each entry ~= tick*n period)
                idx = rot % n
                cur = entries[idx]["current"]
                if dry:
                    if ver != last_ver:
                        log.info("[dry-run] interleave v%d [%d/%d] -> raw=%s", ver, idx, n, cur)
                elif cur:
                    backend.set_data(cur)
                rot += 1; last_ver = ver
        prev_lc = lc
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
                    if cmd == "lc":                    # lifecycle change + the full entry list
                        ctrl.set_lifecycle(msg.get("state"), msg.get("entries"))
                    elif msg.get("killreconnect"):
                        ctrl.request_restart()         # STOP: kill the radio + reconnect ALL at neutral
                    elif msg.get("neutral"):
                        ctrl.neutral_all()             # client disconnect -> every entry neutral
                    elif "entries" in msg:             # RAW-BLIND motion update (built by the API)
                        ctrl.set_entries(msg["entries"])
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
