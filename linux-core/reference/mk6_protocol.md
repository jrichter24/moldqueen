# MK6 module — protocol (reverse-engineered + write-proven, 2026-07)

Ground truth from **our own captures** of the native Mould King app driving a real
**MK6 module**, plus a **hardware write-proof** (a telegram *we* built drove the motor).
Corroborated by J0EK3R/mkconnect-python (MIT). **Canonical doc:
[`../../dev-docs/PROJECT.md`](../../dev-docs/PROJECT.md) §3.**

> **Different hardware from our MK4 13112 hubs — both real.** MK4 hubs = NIBBLE / 4-bit /
> slot-in-nibble-block (see [`CONNECT_PROCEDURE.md`](CONNECT_PROCEDURE.md)). MK6 module =
> BYTE / 8-bit / device-in-header. The MK6.0 "byte/device" model that was a **wrong detour
> for the MK4 hubs** is **correct for the actual MK6 module**. Don't let the old
> "MK6.0 superseded" warnings confuse this: they're about the MK4 *hubs*, not the MK6 module.

## Same as MK4 (no new crypto, same radio path)
- Company id **`0xFFF0`**, connectionless **broadcast** manufacturer-data adverts (no GATT).
  (The app rotates its BLE random MAC per advert, but it is connectionless — captured + decoded.)
- **MouldKingCrypt — identical codec.** Every captured MK6 frame decoded **CRC-OK** with the
  existing `mouldking_crypt.py`, and our built frames re-encode **byte-identical** to the app's
  on-air bytes.
- Same advertising / raw-HCI broadcast path. MK6 hubs also **time out without repeats** → need a
  keepalive (~10/s), like MK4.
- **Bytes 2–3 = constant `ae 18`** — the same fixed field our MK4 hubs use. (J0EK3R's variant
  documents `7b a7`; both are fixed constants, ours is `ae 18`. Not a counter/nonce — a HELD
  channel value repeated the *identical* frame ×73 in capture.)

## MK6 motion telegram (raw, pre-crypt) — MEASURED
```
[header] ae 18 [c0] [c1] [c2] [c3] 80 80 [trailer]        (10 raw bytes)
```
- **header** = `0x61 + device` → `0x61` / `0x62` / `0x63` = device **0 / 1 / 2**, selected by the
  hub button (analogous to MK4 slots).
- **trailer** = `0xFF − header` — **computed, not constant**: dev0 `0x61`→`0x9e`, dev1 `0x62`→`0x9d`
  (verified for every frame, independent of the channel bytes).
- **c0..c3** = **BYTE-per-channel (8-bit): `0x80` = neutral**, →`0xFF` one way, →`0x00/0x01` the
  other, proportional in between. (MK4 is nibble / 4-bit / `0x8`-center.)
- **offsets 7–8** = `0x80` padding (constant across all captures).

## Connect / handshake frames observed
- **MK6 device-0 CONNECT/BIND telegram = the base frame `6d ae 18 80 80 80 80 92`.** Broadcast it
  while the box is in pairing mode (blinking blue+green) and the box **binds to device 0** (LED →
  single fast blue flash). This is the `ae 18` analog of J0EK3R's device-0 connect
  `6d 7b a7 80 80 80 80 92` (MKtech_reverse_engineering_report.md §5-6). **HARDWARE-CONFIRMED
  2026-07-08**: this frame is what binds the box; then `0x61…`-header motion drives it.
- **NOT** the MK4 shared connect `ad ae 18 80 80 80 f3 52` — that binds MK4 *nibble* hubs (it does
  nothing for the MK6 box; an early attempt using it left the box blinking + never bound).
- The app broadcasts connect **then** motion; the working drive mirrors that ordering.
- Device 1/2 connect prefix is **device-dependent and still TBD** (only device-0 bind is proven);
  motion header is `0x61 + device`, but the dev1/2 *connect* prefix is not yet captured.

## Evidence — measured, not proposed
- **READ:** passive captures (idle baseline vs app-driving) on the spare dongle (hci1); every
  `0xFFF0` MK6 frame decoded **CRC-OK**. A dedicated timestamped capture confirmed bytes 2–3 =
  constant `ae 18` across **138 motion frames**, both channels, **both devices** (`0x61` dev0 +
  `0x62` dev1, via a device switch), and `trailer == 0xFF − header` throughout.
- **WRITE (hardware-proven):** a telegram we **built + `MouldKingCrypt`-encoded + broadcast** on
  the control dongle **drove the real MK6 module's motor** — both directions, proportional
  (half + full), on channel **c0 (offset 3)**, device 0. Cross-check: our `encode(raw)`
  reproduced the app's **exact on-air bytes** for all captured frames — the write path is
  byte-identical to the app. So both **decode (read)** and **drive (write)** are proven.
- *(The reverse-engineering spike was a scratch script in `/tmp` — deliberately **not**
  committed; this file is the durable record.)*

## MK6 vs MK4 — for the protocol abstraction
| | MK4 hubs (13112) | MK6 module |
|---|---|---|
| channel resolution | nibble / 4-bit, `0x8` center | **byte / 8-bit, `0x80` center** |
| addressing | slot in nibble-block (0/1/2) | **device in header byte** (`0x61/62/63`) |
| trailer | constant (`0x82` motion) | **computed** `0xFF − header` |
| channels | 12 (3 slots × 4) | ~6 (c0..c3 + 2 padding) |
| header (motion) | `0x7d` | `0x61/62/63` |
| company id / crypt / broadcast path | `0xFFF0` / MouldKingCrypt / adverts | **same** |

## Provenance / licensing
Primary ground truth = **our own capture + hardware write-proof**. **J0EK3R/mkconnect-python**
(MIT — the upstream of our crypt) **corroborates** the byte-per-channel + device-0/1/2 addressing
model. Same MIT-attribution discipline as the crypt (see
[`../../THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md)); our capture is primary, J0EK3R
documents the addressing.
