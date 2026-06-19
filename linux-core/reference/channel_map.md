# Mould King 13112 — channel map (MK4 12-channel nibble protocol)

> Working snapshot. **Canonical map: [`../../docs/PROJECT.md`](../../docs/PROJECT.md) §5.**

Confirmed by capturing + decoding the official **MK+tech** app and by our own
transmits. These are **OUR hubs' exact app-captured bytes**.

- **Motion telegram (raw):** `7d ae 18 <6 channel bytes> 82`
- **Connect telegram (raw):** `ad ae 18 80 80 80 f3 52`
- The 6 channel bytes hold **12 nibbles = 3 slots × 4 channels**.
- Nibble: `0x8` = neutral/stop; `>0x8` = one direction, `<0x8` = the other (~`0x0`..`0xf`).
- Company id **`0xFFF0`**. **One telegram drives ALL slots at once.**

## Nibble → channel index
Channel byte = raw offset `3 + ch//2`; **even ch = HIGH nibble, odd ch = LOW nibble**.

| Channel | Raw byte offset | Nibble | Slot |
|---------|-----------------|--------|------|
| 0 | 3 | high | 0 |
| 1 | 3 | low  | 0 |
| 2 | 4 | high | 0 |
| 3 | 4 | low  | 0 |
| 4 | 5 | high | 1 |
| 5 | 5 | low  | 1 |
| 6 | 6 | high | 1 |
| 7 | 6 | low  | 1 |
| 8 | 7 | high | 2 |
| 9 | 7 | low  | 2 |
| 10 | 8 | high | 2 |
| 11 | 8 | low  | 2 |

Slot 0 = ch0–3, slot 1 = ch4–7, slot 2 = ch8–11. A hub's slot is chosen by its
**physical button** (1/2/3 flashes = slot 0/1/2). **Multi-hub precondition: the
hubs must be on DIFFERENT slots.**

## Confirmed channel map (by our own transmits)

| Slot | Box | Channel | Function | Status |
|------|-----|---------|----------|--------|
| 0 | arm/bucket box | ch0 | **Shovel / bucket** | CONFIRMED (moved @ nibble 0xb and 0x5) |
| 0 | arm/bucket box | ch1, ch2, ch3 | ? (turntable / boom / arm) | TBD sweep |
| 1 | track box | ch4 | **Left track** | CONFIRMED (moved @ nibble 0xb) |
| 1 | track box | ch5, ch6, ch7 | ? (right track + ?) | TBD sweep |
| 2 | — | ch8–11 | (no third hub present) | n/a |

## TWO-HUB SIMULTANEOUS — CONFIRMED (2026-06-16)

A single `0x7d` telegram with **ch0=0xb (arm box, shovel)** AND **ch4=0xb (track
box, left track)** — rest `0x8` — broadcast on ONE dongle (hci1) moved **both
hubs at once**. The project's core goal, achieved.

## Notes
- Radios: **hci1 = Realtek `00:A6:44:02:21:25`** (used for control),
  **hci2 = TP-Link `6C:4C:BC:87:D0:83`**. Onboard hci0 (Broadcom UART) to be
  disabled (`dtoverlay=disable-bt`). bluetoothd masked; raw-HCI via `hcitool -i <hciN>`.
- Telegrams built/decoded with `mouldking_crypt.py` (verified — reproduces the
  app's connect bytes exactly). Transmit tool: `mk4_test.py`.
- The earlier **MK6.0 device-0/1 model is SUPERSEDED** — see `CONNECT_PROCEDURE.md`.
