"""Pytest for the verified MouldKing BLE telegram codec (mk4web/mouldking_crypt.py).

These mirror the module's in-file self-test (run standalone via
`python mk4web/mouldking_crypt.py`) as real pytest assertions, so the linux-core
`pytest` CI step has genuine value and collects > 0 tests. The known-good vectors
below are copied verbatim from that self-test — they are NOT new/invented bytes:
the raw command hex and its captured on-air manufacturer-data are our hubs' exact
app-captured telegrams (see reference/MKtech_reverse_engineering_report.md).

Imported the way the rest of linux-core imports the codec (package-relative); run
from linux-core/ so `mk4web` is on the path (pytest prepends the rootdir).
"""

import os

import pytest

from mk4web import mouldking_crypt
from mk4web.mouldking_crypt import encode, decode

# ── known-good vectors (verbatim from mouldking_crypt.py's self-test) ──────────
# device-0 on-air bytes we have been broadcasting (from the app-capture logs).
CONNECT_RAW = "6d7ba78080808092"
CONNECT_AIR = "6db643cf7e8f471188665938d17aaa26495e131415161718"
STOP_RAW    = "617ba78080808080809e"            # device-0 motion base (all 0x80)
STOP_AIR    = "6db643cf7e8f471184665938d17aaa34674a55bf15161718"
CH0_RAW     = "617ba7b980808080809e"            # device-0 ch0 +0.45 (offset3 = 0xb9)
CH0_AIR     = "6db643cf7e8f471184665901d17aaa34674a262815161718"

# (name, raw, on-air) triples — the encode/decode vectors.
VECTORS = [
    ("connect", CONNECT_RAW, CONNECT_AIR),
    ("all-stop", STOP_RAW, STOP_AIR),
    ("ch0+0.45", CH0_RAW, CH0_AIR),
]


# ── Self-test 1 & 2 — encode(raw) == known on-air bytes (byte-exact) ──────────
@pytest.mark.parametrize("name,raw,air", VECTORS)
def test_encode_matches_known_on_air_bytes(name, raw, air):
    assert encode(raw).hex() == air


# ── Self-test 3 — decode(encode(x)) == x  (round-trip) ────────────────────────
@pytest.mark.parametrize("name,raw,air", VECTORS)
def test_encode_decode_round_trip(name, raw, air):
    assert decode(encode(raw)) == raw


# ── Self-test 4 — decode(captured on-air bytes) == raw, with CRC OK ───────────
@pytest.mark.parametrize("name,raw,air", VECTORS)
def test_decode_captured_on_air_matches_raw(name, raw, air):
    got = decode(bytes.fromhex(air))
    assert got == raw
    # decode() records whether the embedded CRC-16 validated against the payload.
    assert decode.last_crc_ok is True


# ── output shape: encode() always yields 24-byte on-air manufacturer data ─────
@pytest.mark.parametrize("name,raw,air", VECTORS)
def test_encode_output_is_24_bytes(name, raw, air):
    out = encode(raw)
    assert isinstance(out, bytes)
    assert len(out) == 24


# ── Cross-check vs mkconnect-python's reference MouldKingCrypt ─────────────────
# This needs the external mkconnect-python repo (via MK_REFS_DIR); it is absent on
# CI runners, so SKIP cleanly there (the standalone self-test warns-and-skips the
# same way). When the repo is present locally, it runs as a real assertion.
def _load_mkconnect_crypt():
    import importlib.util
    refs = os.environ.get("MK_REFS_DIR", os.path.expanduser("~/scratch/mk-refs"))
    src = os.path.join(refs, "mkconnect-python/MouldKing/MouldKingCrypt.py")
    if not os.path.isfile(src):
        pytest.skip(f"mkconnect-python reference not found at {src} (set MK_REFS_DIR)")
    spec = importlib.util.spec_from_file_location("mkc_ref", src)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.MouldKingCrypt


@pytest.mark.parametrize("name,raw", [
    ("connect", CONNECT_RAW),
    ("all-stop", STOP_RAW),
    ("ch0+0.45", CH0_RAW),
    ("dev1 ch0", "627ba7b980808080809d"),
])
def test_encode_matches_mkconnect_reference(name, raw):
    MouldKingCrypt = _load_mkconnect_crypt()
    ref = bytes(MouldKingCrypt.Crypt(bytes.fromhex(raw))).hex()
    assert encode(raw).hex() == ref
