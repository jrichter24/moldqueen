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
