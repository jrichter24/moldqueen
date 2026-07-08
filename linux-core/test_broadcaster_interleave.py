"""Pytest for the raw-blind LIST-interleave broadcaster (MK6 build step 5).

The broadcaster holds a LIST of opaque entries {current, neutral, connect} and interleaves
them on the one shared radio. These tests cover the SAFETY-critical bits with no real radio:
  1. STOP (request_restart) and the coarse dead-man (neutral_all) neutral EVERY entry — a bug
     that neutrals only one = the other box keeps running (the exact failure we must prevent).
  2. set_entries is READY-gated; IDLE clears the list.
  3. The kill+reconnect op sequence re-sends every connect + every neutral (and for ONE entry
     is byte-for-byte the step-3 order).
  4. The live loop actually INTERLEAVES two entries (neither starves) and, for a single entry,
     broadcasts it (step-3 single-protocol regression).

Run from linux-core/.
"""
import time, threading

from mk4web.broadcaster import Controller, broadcast_loop, _kill_reconnect_ops, _advertise_on_ops

IDLE, CONNECTING, READY = "IDLE", "CONNECTING", "READY"


def _entry(cur, neu, con):
    return {"current": cur, "neutral": neu, "connect": con}


# ───────────────────────────── SAFETY: neutral EVERY entry ─────────────────────────────
def test_neutral_all_neutralizes_both_entries():
    c = Controller()
    c.set_lifecycle(READY, [_entry("A", "na", "ca"), _entry("B", "nb", "cb")])
    c.neutral_all()
    _, ents, _ = c.snapshot()
    assert ents[0]["current"] == "na" and ents[1]["current"] == "nb"


def test_request_restart_neutrals_all_and_sets_flag():
    c = Controller()
    c.set_lifecycle(READY, [_entry("A", "na", "ca"), _entry("B", "nb", "cb")])
    c.request_restart()
    _, ents, _ = c.snapshot()
    assert ents[0]["current"] == "na" and ents[1]["current"] == "nb"   # BOTH neutral, not just one
    assert c.take_restart() is True and c.take_restart() is False


def test_set_entries_is_ready_gated():
    c = Controller()
    c.set_lifecycle(CONNECTING, [_entry("bind", "n", "c")])
    c.set_entries([_entry("motion", "n", "c")])          # not READY -> ignored (motion gate)
    _, ents, _ = c.snapshot()
    assert ents[0]["current"] == "bind"
    c.set_lifecycle(READY, [_entry("m0", "n", "c")])
    c.set_entries([_entry("m1", "n", "c")])
    _, ents, _ = c.snapshot()
    assert ents[0]["current"] == "m1"


def test_idle_clears_the_list():
    c = Controller()
    c.set_lifecycle(READY, [_entry("A", "na", "ca")])
    c.set_lifecycle(IDLE, None)
    lc, ents, _ = c.snapshot()
    assert lc == IDLE and ents == []


# ───────────────────────────── kill+reconnect op sequence ─────────────────────────────
def test_kill_reconnect_ops_single_matches_step3_order():
    ops = _kill_reconnect_ops([_entry("cur", "NEU", "CON")])
    assert ops == [("adv", False), ("params", None), ("data", "CON"), ("adv", True), ("data", "NEU")]


def test_kill_reconnect_ops_two_resends_and_neutrals_both():
    ops = _kill_reconnect_ops([_entry("a", "NA", "CA"), _entry("b", "NB", "CB")])
    assert ops == [("adv", False), ("params", None), ("data", "CA"), ("data", "CB"),
                   ("adv", True), ("data", "NA"), ("data", "NB")]


def test_advertise_on_ops():
    assert _advertise_on_ops("FIRST") == [("adv", False), ("params", None), ("data", "FIRST"), ("adv", True)]


# ───────────────────────────── live loop: interleave + single-entry regression ─────────────────────────────
class FakeBackend:
    name = "fake"; preview_in_dry = False
    def __init__(self): self.data = []; self.advs = []
    def set_params(self): pass
    def set_data(self, raw): self.data.append(raw)
    def adv(self, on): self.advs.append(on)
    def plan(self, *a): return ""


def _run_loop_for(ctrl, seconds):
    be = FakeBackend(); stop = threading.Event()
    t = threading.Thread(target=broadcast_loop, args=(ctrl, be, False, stop), daemon=True)
    t.start(); time.sleep(seconds); stop.set(); t.join(timeout=2)
    return be


def test_two_entries_interleave_neither_starves():
    c = Controller()
    c.set_lifecycle(READY, [_entry("AAA", "na", "ca"), _entry("BBB", "nb", "cb")])
    be = _run_loop_for(c, 0.6)
    # both entries broadcast repeatedly (round-robin) — neither box is starved
    assert be.data.count("AAA") >= 3 and be.data.count("BBB") >= 3


def test_single_entry_is_broadcast():
    c = Controller()
    c.set_lifecycle(READY, [_entry("M0", "n", "c")])
    be = _run_loop_for(c, 0.3)
    assert "M0" in be.data
    assert be.advs and be.advs[-1] is True        # advertising was enabled


def test_stop_mid_run_neutrals_and_reconnects():
    c = Controller()
    c.set_lifecycle(READY, [_entry("AAA", "na", "ca"), _entry("BBB", "nb", "cb")])
    be = FakeBackend(); stop = threading.Event()
    t = threading.Thread(target=broadcast_loop, args=(c, be, False, stop), daemon=True)
    t.start()
    time.sleep(0.2)
    c.request_restart()                            # STOP
    time.sleep(0.2)
    stop.set(); t.join(timeout=2)
    # after STOP the ONLY currents broadcast are the neutrals (na/nb), never AAA/BBB again
    tail = be.data[-4:]
    assert all(d in ("na", "nb", "ca", "cb") for d in tail)
