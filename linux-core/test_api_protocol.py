"""Pytest for the protocol-aware API state (MK6 build step 3).

Step 3 makes the server EMIT MK4 or MK6: `api.App` holds the active Protocol's per-channel
WIRE units (MK4: 12 nibbles @ 0x8 / MK6: 6 bytes @ 0x80), scales the client's NORMALIZED
value via the Protocol, and BUILDS the raw telegram (the broadcaster is raw-blind). These
tests exercise that App end-to-end (set -> build) with NO radio involved:

  1. MK4 regression: default App is byte-identical to before (12 @ 0x8; the same motion
     telegrams). This is the guard that the refactor didn't move MK4.
  2. MK6: switching the protocol re-shapes the state (6 @ 0x80) and the set->build path
     produces the CAPTURED + WRITE-PROVEN frames (reference/mk6_protocol.md), device 0 and 1.
  3. The per-channel dead-man (reap_stale) operates on the protocol-sized state.

Run from linux-core/ so `mk4web` is importable.
"""
from mk4web.api import App
from mk4web.telegram import make_protocol, MK4Protocol, MK6Protocol


# ───────────────────────────── MK4 — regression (byte-identical) ─────────────────────────────
def test_app_defaults_to_mk4_neutral():
    app = App()
    assert app.protocol.name == "mk4"
    assert app.state == [0x8] * 12
    assert app.build_raw() == "7dae18888888888888" + "82"       # neutral MK4 motion telegram
    assert app.neutral_raw() == app.build_raw()


def test_app_mk4_set_builds_same_nibble_telegram():
    app = App()
    app.lifecycle = "READY"
    app.set(0, 0, 7, now=1.0)                    # slot0/ch0 full one way -> nibble 0xF
    assert app.state[0] == 0xF
    assert app.build_raw() == "7dae18f8888888888882"
    app.set(1, 0, -7, now=1.0)                   # slot1/ch0 = global ch4 -> nibble 0x1 (byte2 high)
    assert app.state[4] == 0x1
    assert app.build_raw() == "7dae18f8881888888882"


def test_app_mk4_channel_index_is_slot_times_4():
    app = App()
    app.lifecycle = "READY"
    app.set(2, 3, 7, now=1.0)                    # slot2/ch3 -> global ch11 (last nibble)
    assert app.state[11] == 0xF
    assert app.build_raw() == "7dae1888888888888f82"


# ───────────────────────────── MK6 — protocol switch + proven frames ─────────────────────────────
def test_app_switch_to_mk6_reshapes_state():
    app = App()
    app.set_protocol(make_protocol("mk6", 0))
    assert app.protocol.name == "mk6"
    assert app.state == [0x80] * 6
    assert app.build_raw() == "61ae188080808080809e"            # dev0 neutral (captured + driven)
    assert app.neutral_raw() == "61ae188080808080809e"


def test_app_mk6_set_builds_driven_frames():
    app = App()
    app.set_protocol(make_protocol("mk6", 0))
    app.lifecycle = "READY"
    app.set(0, 0, 7, now=1.0)                    # c0 forward-full -> 0xFF (hardware-proven)
    assert app.state[0] == 0xFF
    assert app.build_raw() == "61ae18ff80808080809e"
    app.set(0, 0, -7, now=1.0)                   # c0 reverse-full -> 0x01 (captured)
    assert app.state[0] == 0x01
    assert app.build_raw() == "61ae180180808080809e"
    app.set(0, 0, 0, now=1.0)                    # back to neutral
    assert app.build_raw() == "61ae188080808080809e"


def test_app_mk6_channel_index_is_the_channel():
    app = App()
    app.set_protocol(make_protocol("mk6", 0))
    app.lifecycle = "READY"
    app.set(0, 2, -7, now=1.0)                   # c2 -> state[2]=0x01 (the captured dev-switch byte)
    assert app.state[2] == 0x01
    assert app.build_raw() == "61ae188080018080809e"


def test_app_mk6_device1_header_and_trailer():
    app = App()
    app.set_protocol(make_protocol("mk6", 1))
    app.lifecycle = "READY"
    app.set(0, 2, -7, now=1.0)                   # dev1 (header 0x62), c2=0x01, trailer 0x9d
    assert app.build_raw() == "62ae188080018080809d"


# ───────────────────────────── the per-channel dead-man is protocol-sized ─────────────────────────────
def test_reap_stale_neutralizes_mk6_bytes():
    app = App()
    app.set_protocol(make_protocol("mk6", 0))
    app.lifecycle = "READY"
    app.set(0, 0, 7, now=0.0)                    # drive c0
    assert app.state[0] == 0xFF
    assert app.reap_stale(now=1.0, timeout=0.3) is True     # 1.0s > 0.3s stale
    assert app.state == [0x80] * 6                          # neutralized to MK6 neutral (0x80, not 0x8)
    assert app.reap_stale(now=2.0, timeout=0.3) is False    # already neutral -> no change


def test_reap_stale_neutralizes_mk4_nibbles():
    app = App()
    app.lifecycle = "READY"
    app.set(0, 0, 7, now=0.0)
    assert app.reap_stale(now=1.0, timeout=0.3) is True
    assert app.state == [0x8] * 12


def test_stop_reneutrals_current_protocol():
    app = App()
    app.set_protocol(make_protocol("mk6", 0))
    app.lifecycle = "READY"
    app.set(0, 0, 7, now=0.0)
    app.stop()
    assert app.state == [0x80] * 6
    assert app.build_raw() == "61ae188080808080809e"
