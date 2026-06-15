# moldqueen — project document (canonical reference)

> This is the authoritative project document. Where any other doc (the CLAUDE.md
> files, or the snapshots in `bt-core/reference/`) disagrees, **this file wins.**
> Last major update: 2026-06-16 (end of the protocol-discovery + webservice session).

---

## 1. Overview

**Goal:** control a **Mould King 13112 RC excavator** (a Lego-like building-block
model with two stock battery/Bluetooth hubs) from a Raspberry Pi, and later add a
camera, a TOF sensor, and a local AI "brain" that drives it through the same API.

**Status:**
- ✅ **Core goal achieved** — **two hubs driven simultaneously from one telegram on
  one radio.** The full control chain works end-to-end: captured app protocol →
  verified codec → one BLE advertising telegram → both hubs move.
- ✅ A working **control webservice** (`bt-core/mk4web/`) with a WebSocket API and a
  thin web GUI, including a guided cold-start flow and joystick controls.
- 🔜 Next: finish the channel→function map, slot auto-detection, console/AI client,
  then the camera/sensor/AI phases.

---

## 2. Hardware

- **Control box:** Raspberry Pi 3B (aarch64, 1 GB RAM). Radio appliance + current
  dev box. Weak JVM build machine (Gradle ~2.5 min).
- **Radios — use the USB dongles, not the onboard BT:**
  - **hci1 = Realtek RTL8761B dongle, `00:A6:44:02:21:25`** — primary control radio.
  - **hci2 = TP-Link dongle, `6C:4C:BC:87:D0:83`** — second dongle (a single radio
    is enough for control; see §3, so hci2 is spare/optional).
  - **hci0 = onboard Broadcom UART BT, `B8:27:EB:CA:3B:93`** — **unreliable.** It
    corrupts frames in bursts *at the connect/enable transition* (the moment that
    matters). Plan: disable it with `dtoverlay=disable-bt` (SoC radio → WiFi-only).
- **Power:** must be a solid **5 V / 3 A** supply. Under-voltage caused real
  failures earlier (`vcgencmd get_throttled` showed under-voltage/throttling); a
  proper PSU was installed and fixed it. Two dongles + Pi 3 need the headroom.
- **bluetoothd must be stopped AND masked** before raw-HCI use (it is dbus/socket-
  activated and will re-grab the adapter): `systemctl mask bluetooth` + kill it.
  Raw-HCI broadcast needs root or `cap_net_raw,cap_net_admin`.

---

## 3. PROTOCOL — the big finding: MK4 12-channel NIBBLE (not MK6.0)

Our 13112 hubs use the **MK4 12-channel nibble protocol**, proven by capturing and
decoding the official **MK+tech** app's BLE adverts. This is *the* key result.

- Control = **broadcasting manufacturer-specific BLE advertising "telegrams"**,
  company id **`0xFFF0`**. No GATT connection.
- **Connect telegram (raw):** `ad ae 18 80 80 80 f3 52` (single, generic).
- **Motion telegram (raw):** `7d ae 18 <6 channel bytes> 82`.
- The 6 channel bytes hold **12 nibbles = 3 slots × 4 channels**
  (even channel = high nibble, odd = low; byte offset = `3 + ch//2`).
- **Nibble value:** `0x8` = neutral/stop; `>0x8` = one direction, `<0x8` = the other.
- **ONE telegram drives ALL hubs at once.** A hub is addressed by *which nibble
  block* moves: slot 0 = ch0–3, slot 1 = ch4–7, slot 2 = ch8–11. **No** per-device
  byte, **no** MK6 "device 0/1", **no** promotion, and **one radio is enough.**
- **value ↔ nibble map** (used by the API): `nibble = 0x8 + value`, value `-7..+7`
  → nibble `0x1..0xF` (`0`=`0x8` neutral, `+7`=`0xF`, `-7`=`0x1`).
- These are OUR hubs' *exact* captured bytes; they differ from the generic
  J0EK3R/mkconnect-python MK4 in bytes 1–2 (`ae 18` vs `7b a7`) and connect byte 6
  (`f3` vs `4f`) — a specific MK4 variant.

**Crypt (recovered + verified):** every telegram's raw bytes are wrapped by the
**MouldKingCrypt** obfuscation (fixed preamble `C1..C5`, per-byte bit-reversal,
CRC-16/CCITT poly `0x1021`, two 7-bit LFSR whitening passes seeded 63/37), then
advertised as manufacturer data. `mouldking_crypt.py` implements `encode()`/
`decode()` and **reproduces the app's captured bytes exactly** (13/13 self-tests).
The decoder is what let us read the app's adverts and discover the MK4 model. APK
analysis: `bt-core/reference/MKtech_reverse_engineering_report.md`.

### The MK6.0 detour (why it was wrong — do not repeat)
We spent a long time on J0EK3R/mkconnect-python's **MK6.0 per-device model**
(`0x61`/`0x62` first byte = "device 0/1", a `6d 7b a7 …` connect, binding a hub to
"device 1" by button promotion). Single-hub MK6.0 telegrams *did* move a hub, so it
looked right — but **two-hub addressing via `0x62`/device-1 never worked**, because
our hubs don't use that model. The app capture settled it: they're **MK4 nibble**.
All MK6.0 "device-1 / promotion" guidance is **SUPERSEDED**.

---

## 4. Slots & hub LED

- A hub's **slot** (which 4-nibble block it obeys) is selected by its **physical
  button**: **one flash = slot 0, two = slot 1, three = slot 2** (cycles/wraps).
- **Slot resets to slot 0 on power-cycle.** For multi-hub control the hubs must be
  on **different** slots — currently a **guided manual** step (the GUI walks it).
- **LED meanings (operator observation; the service can't see the LED):**
  - **long single flash** = idle / powered, not yet connected;
  - **fast flash** = connected (receiving the connect telegram);
  - **fast double flash** = slot 1 (after one button press while connected).

---

## 5. Confirmed channel map (CANONICAL)

Only two channels are confirmed by our own transmits; the rest are **UNMAPPED**
(the boxes/slots are exchangeable, so this map is per current physical setup).

| Slot | Physical box | Channel | Function | Status |
|------|--------------|---------|----------|--------|
| 0 | arm/bucket box | **ch0** | **shovel / bucket** | CONFIRMED (moved @ nibble 0xb and 0x5) |
| 0 | arm/bucket box | ch1, ch2, ch3 | ? (turntable / boom / arm) | UNMAPPED |
| 1 | track box | **ch4** | **left track** | CONFIRMED (moved @ nibble 0xb) |
| 1 | track box | ch5, ch6, ch7 | ? (right track + ?) | UNMAPPED |
| 2 | (no third hub) | ch8–11 | — | n/a |

**Two-hub simultaneous CONFIRMED (2026-06-16):** one telegram with `ch0=0xb` (arm
box → shovel) **and** `ch4=0xb` (track box → left track) moved both at once on hci1.

> Reconciliation: `bt-core/reference/channel_map.md` and `…/CONNECT_PROCEDURE.md`
> are the working snapshots and agree with this table. **This file is canonical**;
> if they ever drift, trust PROJECT.md.

---

## 6. Architecture

The real, working control stack is **`bt-core/mk4web/`** (Python). Two processes
over a local Unix socket (`/tmp/moldqueen_mk4.sock`):

- **broadcaster** (`mk4web/broadcaster.py`) — owns the radio + the authoritative
  12-nibble state; lifecycle **IDLE → CONNECTING → READY**; broadcasts one MK4
  telegram reflecting state (~5/sec keepalive). **Safety:** API gone → IDLE/neutral.
- **API** (`mk4web/api.py`) — the **WebSocket API is the product** (`:8765`), also
  serves the web page (`:8080`). Owns/drives the lifecycle; maps `value→nibble`;
  **Safety:** client disconnect / no clients → NEUTRAL. Reuses `mouldking_crypt.py`
  (the crypt is never reinvented).
- **Web page** (`mk4web/web/`) — the **first client** of the API: cold-start Setup
  panel + press-and-hold joystick buttons + STOP. A console/AI brain will use the
  **same** WS API.
- **AsyncAPI spec** (`mk4web/asyncapi.yaml`, served at `GET /asyncapi.yaml`)
  documents the WS protocol; verified to match `api.py`.

**`java-core/`** (Java/Gradle scaffold) is **empty** beyond a placeholder + passing
test. The original idea (java-core builds telegrams, bt-core re-broadcasts) was
**superseded** — telegram building lives in Python (`mouldking_crypt.py`). **Decision
needed:** either repurpose java-core as a future **API client** (a JVM "brain") or
**retire it**. It is NOT on the control path.

`web-gui/` (the original minimal Node scaffold) is also superseded by `mk4web`'s
own served page; retire or repurpose later.

---

## 7. How to run

From `bt-core/` in the venv (`source .venv/bin/activate`):

```bash
# DRY-RUN (logs telegrams, transmits NOTHING — always start here):
python -m mk4web.broadcaster --dry-run     # terminal 1
python -m mk4web.api                         # terminal 2  →  http://<pi-ip>:8080/

# LIVE (drives hci1; needs hci1 UP + bluetoothd masked; broadcaster needs sudo):
sudo python -m mk4web.broadcaster            # starts IDLE — no transmit until "Connect"
python -m mk4web.api
```
Ports/HCI/etc. are env-overridable (`MK4_HCI`, `MK4_HTTP_PORT`, `MK4_WS_PORT`, …;
see `mk4web/config.py`).

**Cold-start GUI flow** (open `http://<pi-ip>:8080/`):
1. Power-cycle both hubs (each shows one long flash).
2. **Connect** → broadcaster sends the connect telegram; both hubs fast-flash.
3. Button **one** hub to **two** fast flashes (→ slot 1); leave the other on one
   (→ slot 0). (Different slots are required.)
4. **Ready** → controls unlock; hold Fwd/Rev to drive; release → stop; **STOP** =
   all neutral. Disconnect/close → auto-neutral.

---

## 8. Open problems / next steps

- **Finish the channel map** — sweep slot-0 ch1–3 and slot-1 ch5–7 to label every
  function (turntable / boom / arm / right track / …).
- **Slot auto-detection — UNSOLVED.** Slots are set by physical button and reset on
  power-cycle; today it's a guided manual flow. No telegram-only way found yet.
- **Box identity — UNSOLVED UX.** Which physical box is on which slot (and friendly
  names) is operator knowledge; the UI labels by SLOT + channel only.
- **Console / AI client of the WS API** — intended, not built. (Audit TODO: confirm
  a non-GUI client can fully drive the documented API.)
- **Live `/asyncapi.yaml`** — the route is committed; a running API launched before
  that commit must be restarted to serve it.
- **Hardware:** disable onboard BT (`dtoverlay=disable-bt`, needs reboot); keep the
  5 V/3 A PSU; hci2 (TP-Link) is spare for control.
- **Retire/repurpose** `java-core/` and `web-gui/` (see §6).
- **Future phases:** camera, TOF sensor, local AI brain (driving via the WS API).

---

## 9. Where things live

```
moldqueen/
├── docs/PROJECT.md            # THIS FILE — canonical
├── CLAUDE.md                  # terse must-knows (points here)
├── bt-core/
│   ├── CLAUDE.md              # bt-core must-knows
│   ├── mk4web/                # the working control webservice (broadcaster + api + web + asyncapi)
│   └── reference/             # verified snapshots: CONNECT_PROCEDURE.md, channel_map.md,
│       │                      #   mouldking_crypt.py, mk4_test.py, MKtech_reverse_engineering_report.md
│       └── ...
├── java-core/                 # empty Java scaffold — future API client OR retire
└── web-gui/                   # original Node scaffold — superseded by mk4web's page
```

Scratch working copies live outside the repo in `~/scratch/mk-refs/` (the
`mkconnect-python` reference clone, the test tools, capture parsers). Not version-
controlled; the repo's `bt-core/reference/` holds the durable snapshots.
