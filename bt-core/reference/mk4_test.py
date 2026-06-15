#!/usr/bin/env python3
# SCRATCH — MK4 12-channel nibble telegram test (the protocol our hubs actually use).
# Builds telegrams with the verified mouldking_crypt.encode(); broadcasts on a chosen
# dongle via hcitool. App bytes (captured + decoded):
#   connect raw     = ad ae 18 80 80 80 f3 52
#   motion base raw = 7d ae 18 88 88 88 88 88 88 82   (0x8 nibble = neutral/stop)
# Channels: byte (3 + ch//2); even ch = HIGH nibble, odd ch = LOW nibble.
# Slot 0 = ch0-3 (hub A), slot 1 = ch4-7 (hub B), slot 2 = ch8-11.
#
#   dryrun                                  print raw + on-air bytes (connect, neutral, ch pulse)
#   drive --hci H --ch N --nib V --dwell S --dur S   connect, dwell, pulse, neutral, keep adv

import sys, time, subprocess, argparse

sys.path.insert(0, "/home/jrichter/scratch/mk-refs")
from mouldking_crypt import encode

MANUF_PREFIX = "1f 02 01 02 1b ff f0 ff"        # Flags AD + Manufacturer AD header (company 0xFFF0)
CONNECT_RAW = "adae18808080f352"
NIB_MIN, NIB_MAX = 0x5, 0xb                      # modest deviation cap for this round (|nib-8| <= 3)


def motion_raw(channels):
    nibbles = [8] * 12
    for ch, v in channels.items():
        nibbles[ch] = v
    bs = bytes((nibbles[2 * i] << 4) | nibbles[2 * i + 1] for i in range(6))
    return "7dae18" + bs.hex() + "82"


def parse_chans(s):
    d = {}
    for part in s.split(','):
        ch, nib = part.split(':')
        d[int(ch)] = int(nib, 16)
    return d


def ad_hex(raw):
    return (MANUF_PREFIX + " " + ' '.join(f'{b:02x}' for b in encode(raw))).strip()


def hxraw(raw):
    return ' '.join(raw[i:i + 2] for i in range(0, len(raw), 2))


def ts():
    return time.strftime('%H:%M:%S')


def run(hci, args):
    subprocess.run(f"hcitool -i {hci} cmd {args} >/dev/null 2>&1",
                   shell=True, check=False, executable="/bin/bash")


def set_data(hci, raw, label):
    ad = ad_hex(raw)
    print(f"[{ts()}] {hci} SET DATA {label:<16}: {ad}")
    run(hci, f"0x08 0x0008 {ad}")


def set_params(hci, interval=320):
    lo, hi = interval & 0xff, (interval >> 8) & 0xff
    p = f"{lo:02x} {hi:02x} {lo:02x} {hi:02x} 03 00 00 00 00 00 00 00 00 07 00"
    print(f"[{ts()}] {hci} SET PARAMS ({interval*0.625:.0f}ms): {p}")
    run(hci, f"0x08 0x0006 {p}")


def adv(hci, on):
    print(f"[{ts()}] {hci} ADV {'ENABLE' if on else 'DISABLE'}")
    run(hci, f"0x08 0x000a {'01' if on else '00'}")


ap = argparse.ArgumentParser()
ap.add_argument("mode")
ap.add_argument("--hci", default="hci1")
ap.add_argument("--ch", type=int, default=0)
ap.add_argument("--nib", type=lambda x: int(x, 0), default=0xb)
ap.add_argument("--dwell", type=float, default=10.0)
ap.add_argument("--dur", type=float, default=1.5)
ap.add_argument("--chans", default=None)   # e.g. "0:b" or "0:b,5:b" (multi-channel)
a = ap.parse_args()

NEUTRAL_RAW = motion_raw({})

if a.mode == "dryrun":
    pulse_raw = motion_raw({a.ch: a.nib})
    print("MK4 telegrams (NO transmit):\n")
    for label, raw in [("CONNECT", CONNECT_RAW), ("NEUTRAL (all 0x8)", NEUTRAL_RAW),
                       (f"PULSE ch{a.ch}=0x{a.nib:x}", pulse_raw)]:
        print(f"--- {label} ---")
        print(f"  raw      : {hxraw(raw)}")
        print(f"  on-air AD: {ad_hex(raw)}\n")

elif a.mode == "drive":
    if not (NIB_MIN <= a.nib <= NIB_MAX):
        raise SystemExit(f"REFUSED: nibble 0x{a.nib:x} outside modest range 0x{NIB_MIN:x}..0x{NIB_MAX:x}")
    pulse_raw = motion_raw({a.ch: a.nib})
    print(f"MK4 DRIVE on {a.hci}: connect, dwell {a.dwell}s, pulse ch{a.ch}=0x{a.nib:x} ~{a.dur}s, neutral, keep adv.\n")
    adv(a.hci, False)
    set_params(a.hci)
    set_data(a.hci, CONNECT_RAW, "CONNECT")
    adv(a.hci, True)
    print(f"[{ts()}] connect broadcasting; dwelling {a.dwell}s...")
    time.sleep(a.dwell)
    set_data(a.hci, pulse_raw, f"PULSE ch{a.ch}=0x{a.nib:x}")
    time.sleep(a.dur)
    set_data(a.hci, NEUTRAL_RAW, "NEUTRAL")
    time.sleep(0.5)
    print("\nDONE (advertising kept on, broadcasting neutral).")

elif a.mode == "pulse":
    # assumes advertising already live (connect already sent earlier). Pulse the
    # given channel(s) then return to neutral. Used for the sweep and the 2-hub shot.
    chans = parse_chans(a.chans) if a.chans else {a.ch: a.nib}
    for v in chans.values():
        if not (NIB_MIN <= v <= NIB_MAX):
            raise SystemExit(f"REFUSED: nibble 0x{v:x} outside modest range 0x{NIB_MIN:x}..0x{NIB_MAX:x}")
    spec = ",".join(f"ch{c}=0x{v:x}" for c, v in sorted(chans.items()))
    praw = motion_raw(chans)
    print(f"MK4 PULSE on {a.hci}: {spec} for ~{a.dur}s, then neutral (keep adv).\n")
    set_data(a.hci, praw, spec)
    time.sleep(a.dur)
    set_data(a.hci, NEUTRAL_RAW, "NEUTRAL")
    time.sleep(0.5)
    print("\nDONE.")

else:
    print("unknown mode:", a.mode)
