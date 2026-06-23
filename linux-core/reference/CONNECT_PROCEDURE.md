# Mould King 13112 — BLE control procedure (MK4 nibble protocol)

> Working snapshot. **Canonical reference: [`../../dev-docs/PROJECT.md`](../../dev-docs/PROJECT.md).**

Status: **TWO-HUB SIMULTANEOUS CONTROL CONFIRMED (2026-06-16).** One MK4 telegram
on one radio drives both hubs at once.

---

## 1. Protocol — our hubs are MK4 12-channel nibble (confirmed)

Our 13112 hubs are controlled by **broadcasting manufacturer-specific BLE adverts**
(company id **`0xFFF0`**), built with `mouldking_crypt.encode()`. The hubs use the
**MK4 12-channel nibble protocol** — NOT the MK6.0 per-device model we first assumed
(see the superseded appendix). `bluetoothd` must be stopped/masked.

- **Connect telegram (raw):** `ad ae 18 80 80 80 f3 52`  — single, generic.
- **Motion telegram (raw):** `7d ae 18 <6 channel bytes> 82`  — `0x8` nibble = neutral/stop.
- The 6 channel bytes hold **12 nibbles = 3 slots × 4 channels** (even ch = high
  nibble, odd ch = low nibble). `>0x8` = one direction, `<0x8` = the other.
- **ONE telegram drives ALL hubs at once.** A hub is addressed by *which nibble
  block* moves: slot 0 = ch0–3, slot 1 = ch4–7, slot 2 = ch8–11. There is **no**
  per-hub device byte, **no** MK6 device-0/1, **no** promotion, and **no** second
  radio needed for control.
- A hub's **slot is selected by its physical button** (1/2/3 flashes = slot 0/1/2).
  **Multi-hub precondition: hubs must be on DIFFERENT slots.**

These are the exact captured/decoded bytes of OUR hubs; they differ from
mkconnect-python's generic MK4 in bytes 1–2 (`ae 18` vs `7b a7`) and connect byte 6
(`f3` vs `4f`) — a specific MK4 variant.

## 2. Control sequence

1. Pick a dongle (we use **hci1**, Realtek). `bluetoothd` masked, adapter UP.
2. Broadcast the **connect** telegram, dwell ~10 s (puts the hubs in listen mode).
3. Broadcast **motion** telegrams: set the nibble(s) for the channel(s) you want
   to drive, `0x8` everywhere else; re-broadcast neutral (all `0x8`) to hold/stop.
4. **Multi-hub:** with the hubs on different slots, set nibbles in each slot's
   block within the **same** telegram.

Scratch tool: `mk4_test.py` —
`drive --hci hci1 --ch 0 --nib 0xb --dwell 10` (connect+dwell+pulse),
`pulse --chans 0:b,4:b` (multi-channel pulse on the live stream).

## 3. TWO-HUB SIMULTANEOUS — CONFIRMED

A single `0x7d` telegram with **ch0=0xb (slot 0 = arm/bucket box → shovel)** AND
**ch4=0xb (slot 1 = track box → left track)**, rest `0x8`, broadcast on ONE dongle
(hci1), moved **both hubs at the same time**. Verified 2026-06-16 — the project's
core goal.

## 4. Confirmed channel/slot map

| Slot | Box | Confirmed channel | Function |
|------|-----|-------------------|----------|
| 0 | arm/bucket box | ch0 | shovel / bucket |
| 1 | track box | ch4 | left track |

Rest (ch1–3 arm box, ch5–7 track box) — **TBD** by sweep. Full table: `channel_map.md`.

## 5. Hardware

- **5 V / 3 A PSU** + two USB BT dongles. **hci1 = Realtek `00:A6:44:02:21:25`**
  (control), **hci2 = TP-Link `6C:4C:BC:87:D0:83`**. Onboard hci0 (Broadcom UART)
  is unreliable (frame-reassembly bursts at the connect transition) → to be
  disabled via `dtoverlay=disable-bt`, leaving the SoC radio WiFi-only.
- `bluetoothd` masked; raw-HCI broadcast via `hcitool -i <hciN> cmd 0x08 ...`.

## 6. Codec — `mouldking_crypt.py`

`encode(raw_hex) -> bytes` and `decode(bytes) -> raw_hex`: the exact MouldKing
crypt (fixed preamble `C1..C5`, bit-reversal, CRC-16/CCITT poly `0x1021`, two
7-bit LFSR whitening passes seeded 63/37) and its inverse. **Verified 13/13
self-tests** and **reproduces the app's captured connect/motion bytes exactly** —
this is what enabled the capture-decode that revealed the real (MK4) protocol.

---

## APPENDIX — SUPERSEDED: the MK6.0 investigation (historical)

Everything we did before the app capture assumed the **MK6.0 per-device model**
(`0x61`/`0x62` device bytes; "device 0/1"; a generic `6d 7b a7 …` connect; binding
a hub to "device 1" via button promotion). **The MK+tech app capture proved this
model WRONG for our hubs** — they are MK4 nibble (above).

What that detour established (now only of historical interest):
- Single-hub MK6.0 `0x61` motion telegrams *did* move a hub, so the hubs tolerate
  MK6-style telegrams for one device — but **two-hub addressing via `0x62`/device-1
  never worked**, because the device-1 model doesn't apply here.
- The onboard hci0 UART unreliability and the PSU/under-voltage findings (§5 above)
  remain valid hardware notes.
- The "promote to Module 2 / device-1 binding" saga is **abandoned** — superseded
  entirely by MK4 slot-by-nibble addressing.
