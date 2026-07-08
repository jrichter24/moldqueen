"""MK4 telegram construction + value<->nibble mapping. Pure logic.

Reuses the verified `mouldking_crypt` codec — does NOT reinvent the crypt.

MK4 protocol (our 13112 hubs, captured + decoded from the MK+tech app):
  connect raw = ad ae 18 80 80 80 f3 52
  motion  raw = 7d ae 18 <6 channel bytes> 82
The 6 channel bytes hold 12 nibbles = 3 slots x 4 channels:
  even channel -> HIGH nibble, odd channel -> LOW nibble; byte = 3 + ch//2.
  slot 0 = ch 0-3, slot 1 = ch 4-7, slot 2 = ch 8-11.

Nibble value: 0x8 = neutral/stop.

VALUE<->NIBBLE MAP (exact):
  nibble = 0x8 + value, with value in [-7, +7]  ->  nibble in [0x1, 0xF]
    value  0 -> 0x8 (neutral)
    value +7 -> 0xF (full, one direction)
    value -7 -> 0x1 (full, other direction)
  (0x0 is unused.)
"""
from . import mouldking_crypt

CONNECT_RAW = "adae18808080f352"
N_CHANNELS = 12
NEUTRAL = 0x8
# Flags AD (02 01 02) + Manufacturer-Specific AD header (len, type FF, company F0 FF = 0xFFF0),
# total adv-data length 0x1f. The 24 crypted bytes follow.
_AD_PREFIX = bytes.fromhex("1f0201021bfff0ff")


def value_to_nibble(value):
    v = max(-7, min(7, int(value)))
    return NEUTRAL + v


def nibble_to_value(nib):
    return int(nib) - NEUTRAL


def channel_index(slot, channel):
    """(slot 0-2, channel 0-3) -> global channel index 0-11."""
    return slot * 4 + channel


def motion_raw(nibbles):
    """12 nibbles (ints 0x0..0xF) -> motion telegram raw hex."""
    assert len(nibbles) == N_CHANNELS
    bs = bytes(((nibbles[2 * i] & 0xF) << 4) | (nibbles[2 * i + 1] & 0xF) for i in range(6))
    return "7dae18" + bs.hex() + "82"


def ad_bytes(raw_hex):
    """raw telegram hex -> full on-air advertising-data bytes (the hcitool 0x0008 payload)."""
    return _AD_PREFIX + mouldking_crypt.encode(raw_hex)


def ad_hex(raw_hex):
    return ' '.join(f'{b:02x}' for b in ad_bytes(raw_hex))


# ───────────────────────── protocol seam (MK4 today, MK6 alongside) ─────────────────────────
# Telegram-building is protocol-pluggable: each Protocol maps a NORMALIZED value (-7..+7, what
# the WS `set` primitive carries) to its per-channel WIRE unit, and assembles wire units into a
# raw telegram hex. The crypt/advertising wrap (ad_bytes/ad_hex/encode) is protocol-AGNOSTIC and
# shared — it just crypts the raw bytes. This is the buildable+tested seam (MK6 build step 2);
# NOTHING in the running stack calls the MK6 impl yet (the wiring is steps 3/5). `MK4Protocol` is
# a ZERO-behavior-change wrapper of the functions above; MK6 per reference/mk6_protocol.md.

class Protocol:
    """A radio protocol: normalized value <-> wire unit, and wire units -> raw telegram hex."""
    name = "base"
    n_channels = 0
    neutral_unit = 0
    connect_raw = CONNECT_RAW
    def value_to_wire(self, value): raise NotImplementedError
    def wire_to_value(self, wire): raise NotImplementedError
    def build_motion_raw(self, state): raise NotImplementedError
    def channel_index(self, slot, channel): raise NotImplementedError   # (slot,channel) -> state index


class MK4Protocol(Protocol):
    """MK4 12-channel NIBBLE (our 13112 hubs). Delegates to the module functions above, so its
    output is BYTE-IDENTICAL to the current code — the running stack is unaffected."""
    name = "mk4"
    n_channels = N_CHANNELS            # 12
    neutral_unit = NEUTRAL             # 0x8
    connect_raw = CONNECT_RAW          # adae18808080f352
    def value_to_wire(self, value):   return value_to_nibble(value)   # 0x8 + clamp(-7,7)
    def wire_to_value(self, wire):    return nibble_to_value(wire)     # wire - 0x8
    def build_motion_raw(self, state): return motion_raw(state)        # 7dae18 + 6 packed bytes + 82
    def channel_index(self, slot, channel): return slot * 4 + channel  # 3 slots x 4 -> 0..11


class MK6Protocol(Protocol):
    """MK6 module: 6-channel BYTE, device-in-header — validated + write-proven on hardware
    (reference/mk6_protocol.md). raw = [0x61+device] ae 18 <6 channel bytes> [0xFF-header];
    byte-per-channel, 0x80 = neutral. device 0/1/2 (button-selected, like MK4 slots)."""
    name = "mk6"
    n_channels = 6                     # c0..c3 drivable + offsets 7-8 padding (app holds them 0x80)
    neutral_unit = 0x80
    # The MK6 CONNECT/BIND telegram is the "base" frame `6dae188080808092` (our `ae 18` analog of
    # J0EK3R's device-0 connect `6d7ba78080808092`): broadcast it while the box is in pairing mode
    # and the box binds to device 0 (MKtech_reverse_engineering_report.md §5-6). This is NOT the
    # MK4 shared connect `adae18...` (that binds MK4 nibble hubs). Device 1/2 use a device-dependent
    # connect prefix that is still TBD — only device-0 bind is proven, so keep the base for now.
    base_raw = "6dae188080808092"      # MK6 device-0 base / connect-bind frame
    connect_raw = base_raw             # <- MK6 connect = the base frame (device 0)
    _HDR0 = 0x61                       # 0x61/0x62/0x63 = device 0/1/2

    def __init__(self, device=0):
        if not (0 <= int(device) <= 2):
            raise ValueError("MK6 device must be 0, 1, or 2")
        self.device = int(device)
        self.header = self._HDR0 + self.device
        self.trailer = (0xFF - self.header) & 0xFF     # dev0 0x9e, dev1 0x9d, dev2 0x9c (computed)

    def value_to_wire(self, value):
        # normalized -7..+7 -> 8-bit byte, 0x80 center, +7 -> 0xFF, -7 -> 0x01 (proportional).
        # (Same normalized domain the client sends today; a finer client range is a later refinement.)
        v = max(-7, min(7, int(value)))
        return max(0x01, min(0xFF, 0x80 + round(v * 127 / 7)))

    def wire_to_value(self, wire):
        return max(-7, min(7, round((int(wire) - 0x80) * 7 / 127)))

    def build_motion_raw(self, state):
        if len(state) != self.n_channels:
            raise ValueError("MK6 build_motion_raw needs %d channel bytes" % self.n_channels)
        body = bytes(b & 0xFF for b in state)          # offsets 3-8 (c0..c3 + 2 padding at 0x80)
        return "%02xae18%s%02x" % (self.header, body.hex(), self.trailer)

    def channel_index(self, slot, channel):
        # single device per session THIS STEP: channel 0-3 -> c0..c3; slot picks the device,
        # which is fixed at setup (multi-device = multiple headers = step 5). So slot is ignored
        # here and the state index is just the channel.
        return channel


def make_protocol(name, device=0):
    """Instantiate the active Protocol for a session. name in {"mk4","mk6"} (default mk4 for
    back-compat); `device` (0/1/2) applies to MK6 only (sets header/trailer)."""
    key = (name or "mk4").lower()
    if key == "mk4":
        return MK4Protocol()
    if key == "mk6":
        return MK6Protocol(device=int(device or 0))
    raise ValueError("unknown protocol %r (expected 'mk4' or 'mk6')" % name)
