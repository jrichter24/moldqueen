"""Pytest for the protocol seam in mk4web/telegram.py (MK6 build step 2).

Two guarantees:
  1. MK4Protocol is BYTE-IDENTICAL to the pre-seam functions (motion_raw / value_to_nibble)
     — the refactor is provably behavior-preserving; the running MK4 stack is unaffected.
  2. MK6Protocol produces telegrams byte-identical to our CAPTURED + WRITE-PROVEN frames
     (reference/mk6_protocol.md): device 0 neutral, the c0 forward/reverse bytes we drove on
     real hardware (0xC0/0xFF/0x40/0x01), the computed trailers (dev0 0x9e / dev1 0x9d), and a
     captured dev1 frame. The crypt path (protocol-agnostic) round-trips MK6 raw frames CRC-OK.

Run from linux-core/ so `mk4web` is importable (pytest prepends the rootdir).
"""
import pytest

from mk4web import telegram
from mk4web.telegram import (MK4Protocol, MK6Protocol, motion_raw, value_to_nibble,
                             nibble_to_value, CONNECT_RAW, N_CHANNELS, NEUTRAL)
from mk4web.mouldking_crypt import encode, decode


# ───────────────────────────── MK4Protocol — byte-identical parity ─────────────────────────────
def test_mk4_metadata():
    p = MK4Protocol()
    assert p.name == "mk4" and p.n_channels == N_CHANNELS == 12
    assert p.neutral_unit == NEUTRAL == 0x8
    assert p.connect_raw == CONNECT_RAW == "adae18808080f352"


def test_mk4_value_to_wire_is_value_to_nibble():
    p = MK4Protocol()
    for v in range(-9, 10):                      # includes out-of-range to prove identical clamping
        assert p.value_to_wire(v) == value_to_nibble(v)
    for nib in range(0x0, 0x10):
        assert p.wire_to_value(nib) == nibble_to_value(nib)


def test_mk4_build_motion_raw_is_motion_raw():
    p = MK4Protocol()
    states = [
        [0x8] * 12,                                          # neutral
        [0xF] + [0x8] * 11,                                  # ch0 full one way
        [0x1] + [0x8] * 11,                                  # ch0 full other way
        [0x8, 0x8, 0x8, 0x8, 0xB, 0x8, 0x8, 0x8, 0x8, 0x8, 0x8, 0x8],  # a slot-1 channel
    ]
    for st in states:
        assert p.build_motion_raw(st) == motion_raw(st)
    # spot-check the actual bytes so a regression in BOTH would still be caught
    assert p.build_motion_raw([0x8] * 12) == "7dae18888888888888" + "82"


# ───────────────────────── MK6Protocol — byte-match vs proven frames ─────────────────────────
# state = the 6 channel BYTES (c0..c3 + 2 padding). Neutral = all 0x80.
def _mk6_state(c0=0x80, c1=0x80, c2=0x80, c3=0x80, c4=0x80, c5=0x80):
    return [c0, c1, c2, c3, c4, c5]


def test_mk6_metadata_and_trailer():
    p = MK6Protocol()                    # device 0 default
    assert p.name == "mk6" and p.n_channels == 6 and p.neutral_unit == 0x80
    assert p.base_raw == "6dae188080808092"
    assert p.connect_raw == "6dae188080808092"   # MK6 connect = the base/bind frame, NOT the MK4 shared connect
    assert p.connect_raw != CONNECT_RAW          # explicitly distinct from the MK4 connect (adae18...)
    assert p.device == 0 and p.header == 0x61 and p.trailer == 0x9e     # 0xFF - 0x61
    assert MK6Protocol(1).header == 0x62 and MK6Protocol(1).trailer == 0x9d
    assert MK6Protocol(2).header == 0x63 and MK6Protocol(2).trailer == 0x9c
    for bad in (-1, 3, 5):
        with pytest.raises(ValueError):
            MK6Protocol(bad)


def test_mk6_build_motion_raw_matches_captured_and_driven_frames():
    p = MK6Protocol()   # device 0, trailer 0x9e
    # device-0 neutral — captured from the app AND driven by us
    assert p.build_motion_raw(_mk6_state()) == "61ae188080808080809e"
    # c0 forward/reverse bytes WE DROVE on the real motor (hardware-proven), reference/mk6_protocol.md
    assert p.build_motion_raw(_mk6_state(c0=0xC0)) == "61ae18c080808080809e"   # forward-half
    assert p.build_motion_raw(_mk6_state(c0=0xFF)) == "61ae18ff80808080809e"   # forward-full
    assert p.build_motion_raw(_mk6_state(c0=0x40)) == "61ae184080808080809e"   # reverse-half
    assert p.build_motion_raw(_mk6_state(c0=0x01)) == "61ae180180808080809e"   # reverse-full (also captured)


def test_mk6_device1_frame_matches_capture():
    # captured during the device-switch: dev1 (header 0x62), c2=0x01, trailer 0x9d
    p = MK6Protocol(device=1)
    assert p.build_motion_raw(_mk6_state(c2=0x01)) == "62ae188080018080809d"


def test_mk6_build_motion_raw_bad_length():
    with pytest.raises(ValueError):
        MK6Protocol().build_motion_raw([0x80] * 5)     # wrong channel count


def test_mk6_value_to_wire_endpoints_and_monotonic():
    p = MK6Protocol()
    assert p.value_to_wire(0) == 0x80          # neutral
    assert p.value_to_wire(7) == 0xFF          # full one way
    assert p.value_to_wire(-7) == 0x01         # full other way (mirrors the captured 0x01)
    assert p.value_to_wire(100) == 0xFF and p.value_to_wire(-100) == 0x01   # clamped
    seq = [p.value_to_wire(v) for v in range(-7, 8)]
    assert seq == sorted(seq)                  # proportional / monotonic non-decreasing
    assert p.wire_to_value(0x80) == 0 and p.wire_to_value(0xFF) == 7 and p.wire_to_value(0x01) == -7


# ───────────────────────── crypt path is protocol-agnostic (closes the loop) ─────────────────────────
def test_mk6_frames_crypt_roundtrip_crc_ok():
    """encode -> decode round-trips every proven MK6 raw frame, CRC-OK — the existing codec drives
    MK6 unchanged. (A stored captured *crypted* MK6 frame isn't in the repo — the /tmp capture logs
    cleared — so we close the loop via round-trip + CRC; the on-air==our-encode match was verified
    live this session.)"""
    p0, p1 = MK6Protocol(0), MK6Protocol(1)
    frames = [
        p0.build_motion_raw(_mk6_state()),                 # dev0 neutral
        p0.build_motion_raw(_mk6_state(c0=0xFF)),
        p0.build_motion_raw(_mk6_state(c0=0x01)),
        p1.build_motion_raw(_mk6_state(c2=0x01)),          # dev1
        p0.connect_raw, p0.base_raw,
    ]
    for raw in frames:
        assert decode(encode(raw)) == raw
        assert decode.last_crc_ok is True
