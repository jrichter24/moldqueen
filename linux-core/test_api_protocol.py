"""Pytest for the protocol-aware API state (MK6 build steps 3 + 5).

Step 3 made the server EMIT MK4 or MK6; step 5 makes it hold a SET of active protocols and
build a LIST of telegram entries for the raw-blind broadcaster to interleave. These tests
exercise `ProtoState` (one protocol's state) and `App` (the active set) end-to-end (set ->
build) with NO radio:

  1. MK4 regression: a single MK4 ProtoState is byte-identical to before (12 @ 0x8; the same
     motion telegrams) — the guard that the refactor didn't move MK4.
  2. MK6: a MK6 ProtoState produces the CAPTURED + WRITE-PROVEN frames (device 0 and 1).
  3. Mix (step 5): MK4 + MK6 active together produce TWO correct entries (each with the right
     current/neutral/connect); an MK6 `set` ACTIVATES MK6 on first use; the per-channel
     dead-man runs PER protocol independently; stop/reset neutral/clear all.

Run from linux-core/ so `mk4web` is importable.
"""
from mk4web.api import App, ProtoState
from mk4web.telegram import make_protocol, MK4Protocol

MK4_NEUTRAL = "7dae18888888888888" + "82"
MK4_CONNECT = "adae18808080f352"
MK6_NEUTRAL = "61ae188080808080809e"
MK6_BIND = "6dae188080808092"


# ───────────────────────────── ProtoState — MK4 regression (byte-identical) ─────────────────────────────
def test_protostate_mk4_neutral_and_motion():
    ps = ProtoState(MK4Protocol(), device=0)
    ps.phase = "ready"
    assert ps.state == [0x8] * 12
    assert ps.motion_raw() == MK4_NEUTRAL
    assert ps.neutral_raw() == MK4_NEUTRAL
    ps.set(0, 0, 7, now=1.0)                      # slot0/ch0 full -> nibble 0xF
    assert ps.state[0] == 0xF
    assert ps.motion_raw() == "7dae18f8888888888882"
    ps.set(1, 0, -7, now=1.0)                     # slot1/ch0 = ch4 -> nibble 0x1 (byte2 high)
    assert ps.motion_raw() == "7dae18f8881888888882"


def test_protostate_mk4_connect_and_bind_phase():
    ps = ProtoState(MK4Protocol(), device=0)      # default phase = connecting
    assert ps.phase == "connecting"
    assert ps.current_raw() == MK4_CONNECT        # while connecting -> the connect telegram
    assert ps.entry() == {"current": MK4_CONNECT, "neutral": MK4_NEUTRAL, "connect": MK4_CONNECT}
    ps.phase = "ready"
    assert ps.current_raw() == MK4_NEUTRAL        # ready + no motion -> neutral


# ───────────────────────────── ProtoState — MK6 proven frames ─────────────────────────────
def test_protostate_mk6_frames():
    ps = ProtoState(make_protocol("mk6", 0), device=0)
    ps.phase = "ready"
    assert ps.state == [0x80] * 6
    assert ps.motion_raw() == MK6_NEUTRAL
    ps.set(0, 0, 7, now=1.0)
    assert ps.motion_raw() == "61ae18ff80808080809e"   # c0 forward-full (hardware-proven)
    ps.set(0, 0, -7, now=1.0)
    assert ps.motion_raw() == "61ae180180808080809e"   # c0 reverse-full


def test_protostate_mk6_connect_is_the_bind_frame():
    ps = ProtoState(make_protocol("mk6", 0), device=0)   # connecting
    assert ps.current_raw() == MK6_BIND                  # MK6 bind telegram (NOT the MK4 connect)
    assert ps.entry()["connect"] == MK6_BIND
    ps.phase = "ready"
    assert ps.current_raw() == MK6_NEUTRAL


def test_protostate_mk6_device1():
    ps = ProtoState(make_protocol("mk6", 1), device=1)
    ps.phase = "ready"
    ps.set(0, 2, -7, now=1.0)                     # dev1 header 0x62, c2=0x01, trailer 0x9d
    assert ps.motion_raw() == "62ae188080018080809d"


def test_protostate_mk6_set_accepts_channels_4_and_5():
    # the `set` channel range is now 0-5 (api.py widened): MK6 c4/c5 reachable via set{channel:4/5}.
    ps = ProtoState(make_protocol("mk6", 0), device=0)
    ps.phase = "ready"
    ps.set(0, 4, 7, now=1.0)                      # c4 -> offset 7
    assert ps.state[4] == 0xFF
    assert ps.motion_raw() == "61ae1880808080ff809e"
    ps.set(0, 5, -7, now=1.0)                     # c5 -> offset 8
    assert ps.state[5] == 0x01
    assert ps.motion_raw() == "61ae1880808080ff019e"


def test_protostate_reap_neutralizes_mk6():
    ps = ProtoState(make_protocol("mk6", 0)); ps.phase = "ready"
    ps.set(0, 0, 7, now=0.0)
    assert ps.reap_stale(1.0, 0.3) is True
    assert ps.state == [0x80] * 6
    assert ps.reap_stale(2.0, 0.3) is False


# ───────────────────────────── App — MK4-only single entry (regression) ─────────────────────────────
def test_app_mk4_only_single_entry():
    app = App()
    app.activate("mk4", 0, phase="connecting")
    ent = app.entries()
    assert len(ent) == 1
    assert ent[0]["current"] == MK4_CONNECT and ent[0]["connect"] == MK4_CONNECT   # bind phase
    app.ready_all(); app.lifecycle = "READY"
    app.route_set(None, 0, 0, 0, 7, now=1.0)      # protocol-less set -> mk4 (back-compat)
    ent = app.entries()
    assert len(ent) == 1
    assert ent[0]["current"] == "7dae18f8888888888882"
    assert ent[0]["neutral"] == MK4_NEUTRAL


# ───────────────────────────── App — the MIX (step 5) ─────────────────────────────
def test_app_mix_two_entries_correct_raws():
    app = App()
    app.activate("mk4", 0, phase="ready")
    app.activate("mk6", 0, phase="ready")
    app.lifecycle = "READY"
    app.route_set("mk4", 0, 0, 0, 7, now=1.0)     # MK4 slot0/ch0 -> nibble F
    app.route_set("mk6", 0, 0, 0, 7, now=1.0)     # MK6 c0 -> 0xFF
    ent = app.entries()
    assert len(ent) == 2
    # activation order preserved: mk4 first, mk6 second
    assert ent[0] == {"current": "7dae18f8888888888882", "neutral": MK4_NEUTRAL, "connect": MK4_CONNECT}
    assert ent[1] == {"current": "61ae18ff80808080809e", "neutral": MK6_NEUTRAL, "connect": MK6_BIND}


def test_app_mk6_set_activates_on_first_use():
    app = App()
    app.activate("mk4", 0, phase="ready"); app.lifecycle = "READY"
    assert len(app.entries()) == 1
    app.route_set("mk6", 0, 0, 0, 7, now=1.0)     # first MK6 set -> MK6 JOINS the interleave
    ent = app.entries()
    assert len(ent) == 2 and ent[1]["current"] == "61ae18ff80808080809e"


def test_app_reap_all_independent_per_protocol():
    app = App()
    app.activate("mk4", 0, phase="ready"); app.activate("mk6", 0, phase="ready"); app.lifecycle = "READY"
    app.route_set("mk4", 0, 0, 0, 7, now=0.0)
    app.route_set("mk6", 0, 0, 0, 7, now=0.5)     # MK6 refreshed later
    assert app.reap_all(0.4, 0.3) is True         # MK4 stale (0.4>0.3), MK6 not (0.4<0.5+0.3)
    ent = app.entries()
    assert ent[0]["current"] == ent[0]["neutral"]          # MK4 neutralized
    assert ent[1]["current"] == "61ae18ff80808080809e"     # MK6 still driving
    assert app.reap_all(1.0, 0.3) is True
    assert app.entries()[1]["current"] == MK6_NEUTRAL      # now MK6 too


def test_app_stop_all_and_reset():
    app = App()
    app.activate("mk4", 0, phase="ready"); app.activate("mk6", 0, phase="ready"); app.lifecycle = "READY"
    app.route_set("mk4", 0, 0, 0, 7, now=1.0); app.route_set("mk6", 0, 0, 0, 7, now=1.0)
    app.stop_all()
    for e in app.entries():
        assert e["current"] == e["neutral"]       # EVERY protocol neutral on stop
    app.reset()
    assert app.entries() == [] and app.lifecycle == "IDLE"
