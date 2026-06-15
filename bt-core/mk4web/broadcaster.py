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

from .telegram import CONNECT_RAW, motion_raw, ad_hex, N_CHANNELS, NEUTRAL
from .config import SOCK_PATH, HCI, ADV_INTERVAL, REFRESH

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


# ---------------------------------------------------------------- radio
def _hcitool(hci, args):
    subprocess.run(f"hcitool -i {hci} cmd {args}", shell=True, check=False,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, executable="/bin/bash")


def _set_params(hci):
    lo, hi = ADV_INTERVAL & 0xFF, (ADV_INTERVAL >> 8) & 0xFF
    _hcitool(hci, f"0x08 0x0006 {lo:02x} {hi:02x} {lo:02x} {hi:02x} 03 00 00 00 00 00 00 00 00 07 00")


def _adv(hci, on):
    _hcitool(hci, f"0x08 0x000a {'01' if on else '00'}")


def _set_data(hci, raw):
    _hcitool(hci, f"0x08 0x0008 {ad_hex(raw)}")


def _enter(prev, lc, nibbles, hci, dry):
    """Apply a lifecycle transition to the radio (or log it in dry-run)."""
    if lc == IDLE:
        if dry:
            log.info("[dry-run] -> IDLE (advertising OFF)")
        else:
            _adv(hci, False)
        log.info("lifecycle -> IDLE")
    elif lc == CONNECTING:
        if dry:
            log.info("[dry-run] -> CONNECTING raw=%s | AD=%s", CONNECT_RAW, ad_hex(CONNECT_RAW))
        else:
            _adv(hci, False)
            _set_params(hci)
            _set_data(hci, CONNECT_RAW)
            _adv(hci, True)
        log.info("lifecycle -> CONNECTING (broadcasting connect telegram)")
    elif lc == READY:
        raw = motion_raw(nibbles)
        if dry:
            log.info("[dry-run] -> READY raw=%s | AD=%s", raw, ad_hex(raw))
        elif prev == CONNECTING:
            _set_data(hci, raw)                # advertising already on
        else:
            _adv(hci, False); _set_params(hci); _set_data(hci, raw); _adv(hci, True)
        log.info("lifecycle -> READY (broadcasting motion; controls active)")


def broadcast_loop(ctrl, hci, dry, stop_evt):
    prev_lc, last_ver, last_refresh = None, -1, 0.0
    while not stop_evt.is_set():
        lc, nibbles, ver = ctrl.snapshot()
        now = time.monotonic()
        if lc != prev_lc:
            _enter(prev_lc, lc, nibbles, hci, dry)
            prev_lc, last_ver, last_refresh = lc, ver, now
        elif lc == READY and ver != last_ver:
            raw = motion_raw(nibbles)
            if dry:
                log.info("[dry-run] READY state v%d -> raw=%s | AD=%s", ver, raw, ad_hex(raw))
            else:
                _set_data(hci, raw)
            last_ver, last_refresh = ver, now
        elif not dry and lc in (CONNECTING, READY) and (now - last_refresh) >= REFRESH:
            _set_data(hci, CONNECT_RAW if lc == CONNECTING else motion_raw(nibbles))
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
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    log.info("broadcaster start (hci=%s dry_run=%s sock=%s) — lifecycle begins IDLE",
             a.hci, a.dry_run, SOCK_PATH)
    if not a.dry_run:
        _adv(a.hci, False)   # ensure clean (not advertising) at start

    ctrl = Controller()
    stop_evt = threading.Event()
    threading.Thread(target=ipc_server, args=(ctrl, stop_evt), daemon=True).start()
    try:
        broadcast_loop(ctrl, a.hci, a.dry_run, stop_evt)
    except KeyboardInterrupt:
        pass
    finally:
        stop_evt.set()
        if not a.dry_run:
            _adv(a.hci, False)
        log.info("broadcaster stopped (advertising off)")


if __name__ == "__main__":
    main()
