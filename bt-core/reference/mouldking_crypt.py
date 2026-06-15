#!/usr/bin/env python3
"""Faithful MouldKing BLE telegram codec (MK6.0 / company 0xFFF0).

encode(raw_hex) -> bytes   : raw command hex  -> 24-byte on-air manufacturer data
decode(crypted)  -> raw_hex: 24-byte on-air manufacturer data -> raw command hex

Ported byte-for-byte from J0EK3R/mkconnect-python `MouldKingCrypt` and
cross-checked against §4 of MKtech_reverse_engineering_report.md. `decode` is the
exact inverse, which unblocks Route A (capture the app's device-1 adverts and
read the raw telegrams verbatim). NO BLE here — pure software.

Frame layout inside the 33/35-byte working buffer `t` (for payload length L):
    t[15..17]      = header 0x71 0x0F 0x55              (bit-reversed in step 4)
    t[18..22]      = preamble reversed C5 C4 C3 C2 C1   (bit-reversed in step 4)
    t[23..23+L-1]  = raw payload                        (NOT bit-reversed)
    t[23+L..+1]    = CRC-16 (little-endian)
  ciphers: LFSR(63) over t[18:], then LFSR(37) over all of t.
  on-air  = t[15:15+L+10], right-padded to 24 with filler byte[i]=i+1.
"""

PREAMBLE = bytes([0xC1, 0xC2, 0xC3, 0xC4, 0xC5])


def _revert_bits_byte(v):
    r = 0
    for i in range(8):
        if (1 << i) & v:
            r |= 1 << (7 - i)
    return r


def _revert_bits_int(v):
    r = 0
    for i in range(16):
        if (1 << i) & v:
            r |= 1 << (15 - i)
    return r & 0xFFFF


def _make_magic(seed):
    m = [0] * 7
    m[0] = 1
    for i in range(1, 7):
        m[i] = (seed >> (6 - i)) & 1
    return m


def _shift_magic(s):
    r1 = s[3] ^ s[6]
    s[3] = s[2]; s[2] = s[1]; s[1] = s[0]; s[0] = s[6]
    s[6] = s[5]; s[5] = s[4]; s[4] = r1
    return s[0]


def _crypt_array(buf, magic):
    # XOR stream cipher, LSB-first; data-independent keystream -> self-inverse.
    for k in range(len(buf)):
        cur = buf[k]
        res = 0
        for bit in range(8):
            res += (((cur >> bit) & 1) ^ _shift_magic(magic)) << bit
        buf[k] = res & 0xFF


def _crc(preamble, payload):
    # CRC-16/CCITT (poly 0x1021, init 0xFFFF), fed reversed-preamble then
    # bit-reversed payload; final value bit-reversed (16) then XOR 0xFFFF.
    result = 0xFFFF
    for i in range(len(preamble)):
        result = (result ^ (preamble[len(preamble) - 1 - i] << 8)) & 0xFFFF
        for _ in range(8):
            cur = result & 0x8000
            result <<= 1
            if cur:
                result ^= 0x1021
    for b in payload:
        result = ((_revert_bits_byte(b) << 8) ^ result) & 0xFFFF
        for _ in range(8):
            cur = result & 0x8000
            result <<= 1
            if cur:
                result ^= 0x1021
    return _revert_bits_int(result) ^ 0xFFFF


def encode(raw_hex):
    raw = bytes.fromhex(raw_hex)
    L = len(raw)
    t = bytearray(5 + L + 20)            # length L + 25
    t[15], t[16], t[17] = 0x71, 0x0F, 0x55
    for i in range(5):                   # reversed preamble at t[18..22]
        t[18 + i] = PREAMBLE[5 - i - 1]
    for i in range(L):                   # raw payload at t[23..]
        t[23 + i] = raw[i]
    for i in range(15, 23):              # bit-reverse header + reversed-preamble
        t[i] = _revert_bits_byte(t[i])
    crc = _crc(PREAMBLE, raw)
    t[23 + L] = crc & 0xFF
    t[24 + L] = (crc >> 8) & 0xFF
    sub = bytearray(t[18:])              # LFSR pass 1 (seed 63) over t[18:]
    _crypt_array(sub, _make_magic(63))
    t[18:] = sub
    _crypt_array(t, _make_magic(37))     # LFSR pass 2 (seed 37) over all of t
    out = bytearray(24)
    keep = 5 + L + 5                     # = L + 10 meaningful bytes
    out[:keep] = t[15:15 + keep]
    for i in range(keep, 24):
        out[i] = i + 1                   # filler
    return bytes(out)


def decode(crypted, verify=True):
    b = bytearray(crypted)
    n = len(b)
    # detect meaningful length by stripping the trailing filler (byte[i] == i+1)
    keep = n
    i = n - 1
    while i >= 0 and b[i] == ((i + 1) & 0xFF):
        keep = i
        i -= 1
    L = keep - 10
    if L <= 0:
        raise ValueError("could not detect payload length (filler run too long?)")
    t = bytearray(L + 25)
    t[15:15 + keep] = b[:keep]           # 15 + keep == L + 25
    _crypt_array(t, _make_magic(37))     # invert LFSR pass 2 (whole)
    sub = bytearray(t[18:])              # invert LFSR pass 1 (t[18:])
    _crypt_array(sub, _make_magic(63))
    t[18:] = sub
    raw = bytes(t[23:23 + L])
    if verify:
        crc = _crc(PREAMBLE, raw)
        if t[23 + L] != (crc & 0xFF) or t[24 + L] != ((crc >> 8) & 0xFF):
            decode.last_crc_ok = False
        else:
            decode.last_crc_ok = True
    return raw.hex()


decode.last_crc_ok = None


# ─────────────────────────── self-tests ───────────────────────────
if __name__ == "__main__":
    # known device-0 on-air bytes we have been broadcasting (from today's logs)
    CONNECT_RAW = "6d7ba78080808092"
    CONNECT_AIR = "6db643cf7e8f471188665938d17aaa26495e131415161718"
    STOP_RAW    = "617ba78080808080809e"            # device-0 motion base (all 0x80)
    STOP_AIR    = "6db643cf7e8f471184665938d17aaa34674a55bf15161718"
    CH0_RAW     = "617ba7b980808080809e"            # device-0 ch0 +0.45 (offset3 = 0xb9)
    CH0_AIR     = "6db643cf7e8f471184665901d17aaa34674a262815161718"

    passed = failed = 0

    def check(name, got, want):
        global passed, failed
        ok = got == want
        passed += ok; failed += (not ok)
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
        if not ok:
            print(f"        got : {got}")
            print(f"        want: {want}")

    print("Self-test 1 — encode(device-0 CONNECT) == known on-air bytes")
    check("encode(6d7ba78080808092)", encode(CONNECT_RAW).hex(), CONNECT_AIR)

    print("Self-test 2 — encode(device-0 motion base & ch0 +0.45) == known on-air bytes")
    check("encode(617ba78080808080809e)  [all-stop]", encode(STOP_RAW).hex(), STOP_AIR)
    check(f"encode({CH0_RAW}) [ch0 +0.45]", encode(CH0_RAW).hex(), CH0_AIR)

    print("Self-test 3 — decode(encode(x)) == x  (round-trip)")
    for nm, raw in [("connect", CONNECT_RAW), ("all-stop", STOP_RAW), ("ch0+0.45", CH0_RAW)]:
        check(f"round-trip {nm}", decode(encode(raw)), raw)

    print("Self-test 4 — decode(captured on-air bytes) == raw")
    check("decode(connect air)", decode(bytes.fromhex(CONNECT_AIR)), CONNECT_RAW)
    print(f"        (CRC check on connect: {'OK' if decode.last_crc_ok else 'MISMATCH'})")
    check("decode(all-stop air)", decode(bytes.fromhex(STOP_AIR)), STOP_RAW)
    print(f"        (CRC check on all-stop: {'OK' if decode.last_crc_ok else 'MISMATCH'})")
    check("decode(ch0 +0.45 air)", decode(bytes.fromhex(CH0_AIR)), CH0_RAW)
    print(f"        (CRC check on ch0: {'OK' if decode.last_crc_ok else 'MISMATCH'})")

    # ── cross-check against mkconnect-python's own MouldKingCrypt ──
    print("Cross-check — our encode() == mkconnect-python MouldKingCrypt.Crypt()")
    try:
        import importlib.util
        _src = "/home/jrichter/scratch/mk-refs/mkconnect-python/MouldKing/MouldKingCrypt.py"
        _spec = importlib.util.spec_from_file_location("mkc_ref", _src)
        _mod = importlib.util.module_from_spec(_spec)
        _spec.loader.exec_module(_mod)             # MouldKingCrypt.py has no imports -> clean load
        MouldKingCrypt = _mod.MouldKingCrypt
        for nm, raw in [("connect", CONNECT_RAW), ("all-stop", STOP_RAW),
                        ("ch0+0.45", CH0_RAW), ("dev1 ch0", "627ba7b980808080809d")]:
            ref = bytes(MouldKingCrypt.Crypt(bytes.fromhex(raw))).hex()
            check(f"vs mkconnect Crypt({nm})", encode(raw).hex(), ref)
    except Exception as e:
        print(f"  [WARN] mkconnect cross-check skipped: {e}")

    print(f"\nTOTAL: {passed} passed, {failed} failed")
    raise SystemExit(1 if failed else 0)
