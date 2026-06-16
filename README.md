# 🦾 moldqueen

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Python 3.13](https://img.shields.io/badge/python-3.13-3776AB?logo=python&logoColor=white)
![Raspberry Pi](https://img.shields.io/badge/Raspberry%20Pi-3B-C51A4A?logo=raspberrypi&logoColor=white)
[![status: two-hub control working](https://img.shields.io/badge/status-two--hub%20control%20working-brightgreen)](#highlights)

**Drive a [Mould King 13112](https://www.mouldking.com/) RC excavator from a Raspberry Pi — over a reverse-engineered BLE protocol, through a clean WebSocket API.**

<p align="center">
  <img src="assets/excavator.jpg" alt="Mould King 13112 RC crawler excavator (the model this project controls)" width="640">
</p>

`moldqueen` turns a Lego-compatible building-block excavator (two stock
battery/Bluetooth hubs, ~6 motorised functions) into a programmable machine. The
hubs aren't connected to over GATT — they're commanded by **broadcasting crafted
BLE advertising "telegrams."** We captured and decoded the official app's
protocol, rebuilt its crypto, and wrapped it in a small two-process control
service with a web GUI and a documented API — the foundation for later adding a
camera, a TOF sensor, and a local AI brain that drives the machine through the
same API.

> **Status:** ✅ **core goal achieved** — *two hubs driven simultaneously from a
> single telegram on a single radio.* Working webservice with a cold-start GUI and
> joystick controls. 🔜 Next: finish the channel map, slot auto-detection, an
> AI/console client, then camera + sensors.

## Disclaimer

> [!WARNING]
> **Independent, unofficial project — no warranty, use at your own risk.**
>
> - **Not affiliated.** This is an independent, unofficial hobby project. It is
>   **not** affiliated with, authorized by, endorsed by, or sponsored by **Mould
>   King**, **Shenzhen Yuxing**, or any related entity. "Mould King" and "MK+tech"
>   are trademarks of their respective owners, used here **only descriptively** for
>   interoperability.
> - **Interoperability / reverse-engineering.** The BLE protocol was
>   reverse-engineered for **interoperability with hardware the author owns**, and
>   is provided for **educational and personal use** only.
> - **No warranty.** This software is provided **"as is", without warranty of any
>   kind.** The author is **not liable** for any damage to hardware, hubs, models,
>   property, or anything else arising from its use — **you assume all risk.** This
>   complements, and does not replace, the MIT license's no-warranty clause.

📖 **Canonical, exhaustive reference: [`docs/PROJECT.md`](docs/PROJECT.md).** This
README is the tour; PROJECT.md is the source of truth.

---

## Table of contents

- [Disclaimer](#disclaimer)
- [Highlights](#highlights)
- [How it works](#how-it-works)
- [The protocol (MK4 12-channel nibble)](#the-protocol-mk4-12-channel-nibble)
- [Architecture](#architecture)
- [Hardware](#hardware)
- [Quick start](#quick-start)
- [The WebSocket API](#the-websocket-api)
- [Channel map](#channel-map)
- [How the protocol was reverse-engineered](#how-the-protocol-was-reverse-engineered)
- [Safety model](#safety-model)
- [Repository layout](#repository-layout)
- [Roadmap & open problems](#roadmap--open-problems)
- [Development](#development)
- [Credits & license](#credits--license)

---

## Highlights

- **Reverse-engineered the real control protocol.** The hubs use the **MK4
  12-channel nibble** protocol (not the MK6.0 "per-device" model we — and the
  public reference — first assumed). One telegram carries **12 nibbles = 3 slots ×
  4 channels** and drives **all hubs at once**.
- **Recovered + verified the cipher.** `mouldking_crypt.py` (`encode`/`decode`)
  reproduces the official app's on-air bytes **exactly** (13/13 self-tests) — which
  is what let us decode captured adverts and discover the protocol.
- **Two-hub simultaneous control, one radio.** A single advert with two channel
  blocks set moves both boxes at the same time. No per-device addressing, no second
  dongle required.
- **A real service, not a script.** A `broadcaster` (owns the radio, holds state,
  auto-neutral safety) + a `WebSocket API` (the product) + a thin web client +
  an **AsyncAPI 3.0 spec**.
- **Safety first.** Disconnect / no-clients / API-death → motors go **neutral**.
  A dry-run mode logs every telegram and transmits nothing.

---

## How it works

The excavator's two hubs are **broadcast receivers**: they listen for BLE
advertising packets whose manufacturer data (company id **`0xFFF0`**) is a crafted,
obfuscated **telegram**. To control them you:

1. Stop/mask `bluetoothd` and take a Bluetooth adapter raw.
2. Broadcast a **connect** telegram so the hubs enter listen mode.
3. Continuously broadcast a **motion** telegram whose 12 nibbles encode every
   channel's speed/direction. Re-broadcast a neutral telegram to hold/stop.

That's it — connectionless, one-to-many. One adapter can drive every hub.

```
 phone app  ──(BLE adverts, 0xFFF0)──►  ┌─────────┐   we replaced the phone with:
                                        │  hubs   │
 Raspberry Pi ──(BLE adverts, 0xFFF0)──►└─────────┘   moldqueen on a USB dongle
```

## The protocol (MK4 12-channel nibble)

Telegrams are **raw bytes → `MouldKingCrypt` → 24-byte manufacturer data** (company
`0xFFF0`). The raw bytes are what carry meaning:

| Telegram | Raw bytes | Meaning |
|----------|-----------|---------|
| **Connect** | `ad ae 18 80 80 80 f3 52` | put hubs in listen mode |
| **Motion**  | `7d ae 18 ⟨6 channel bytes⟩ 82` | drive channels |
| **Neutral** | `7d ae 18 88 88 88 88 88 88 82` | all stop |

The **6 channel bytes hold 12 nibbles = 3 slots × 4 channels** (even channel = high
nibble, odd = low; byte offset `3 + ch//2`):

```
            byte3   byte4   byte5   byte6   byte7   byte8
nibbles:   [c0 c1] [c2 c3] [c4 c5] [c6 c7] [c8 c9] [c10 c11]
slots:     └── slot 0 ──┘ └── slot 1 ──┘ └──── slot 2 ────┘
```

- **`0x8` = neutral/stop**; `>0x8` = one direction, `<0x8` = the other.
- **One telegram drives all hubs at once** — a hub is addressed by *which nibble
  block* moves. A hub's slot is chosen by its **physical button** (1/2/3 flashes =
  slot 0/1/2) and resets to slot 0 on power-cycle.
- **value ↔ nibble** (used by the API): `nibble = 0x8 + value`, value `-7..+7` →
  nibble `0x1..0xF` (`0`→`0x8`, `+7`→`0xF`, `-7`→`0x1`).

The **`MouldKingCrypt`** obfuscation (recovered from the app and verified): fixed
preamble `C1..C5`, per-byte bit-reversal, CRC-16/CCITT (poly `0x1021`), and two
7-bit LFSR whitening passes (seeds 63 / 37). See
[`bt-core/reference/mouldking_crypt.py`](bt-core/reference/mouldking_crypt.py).

> **Why this matters:** the widely-referenced
> [`J0EK3R/mkconnect-python`](https://github.com/J0EK3R/mkconnect-python) MK6.0
> model (`0x61`/`0x62` "device 0/1", button "promotion") **does not apply to these
> hubs** — chasing it cost real time. Our hubs are MK4 nibble. Full post-mortem in
> [`docs/PROJECT.md`](docs/PROJECT.md) §3.

## Architecture

Two processes over a local Unix socket — deliberately split so the **WebSocket API
is the product** and the web page is merely its first client (a console or AI brain
uses the *same* API):

```
┌────────────────────────────────────────────────────────────────────┐
│  bt-core/mk4web/                                                     │
│                                                                      │
│   web page / AI brain / CLI                                          │
│        │  WebSocket  (JSON, :8765)                                   │
│        ▼                                                             │
│   ┌──────────┐   Unix socket    ┌──────────────┐    BLE adverts     │
│   │   api    │ ───────────────► │  broadcaster │ ──(hcitool, hci1)─► hubs
│   │  :8080   │   12-nibble      │  owns radio  │     company 0xFFF0  │
│   │  :8765   │   state + setup  │  + state +   │                     │
│   └──────────┘                  │  lifecycle   │                     │
│   serves page +                 └──────────────┘                     │
│   the WS API                    IDLE→CONNECTING→READY, auto-neutral  │
└────────────────────────────────────────────────────────────────────┘
```

- **`broadcaster.py`** — owns the radio and the authoritative 12-nibble state; runs
  a lifecycle **IDLE → CONNECTING → READY**; keepalive-broadcasts (~5/s) one MK4
  telegram reflecting state. Reverts to neutral/IDLE if the API goes away.
- **`api.py`** — the WebSocket server (the product), also serves the static page;
  owns/drives the lifecycle, maps `value→nibble`, enforces motion-only-in-READY,
  and pushes state to clients. Disconnect/no-clients → NEUTRAL.

## Hardware

| Part | Detail |
|------|--------|
| Control box | Raspberry Pi 3B (aarch64, 1 GB RAM) |
| **Radio (use this)** | **hci1 = Realtek RTL8761B USB dongle** `00:A6:44:02:21:25` |
| Spare radio | hci2 = TP-Link USB dongle `6C:4C:BC:87:D0:83` (one radio is enough) |
| Avoid | Onboard Broadcom UART BT (hci0) — corrupts frames *at the connect transition*; plan to disable via `dtoverlay=disable-bt` |
| Power | **Solid 5 V / 3 A** — under-voltage caused real failures; a weak PSU is the #1 gremlin |

`bluetoothd` must be **stopped + masked** (it's dbus/socket-activated and will
re-grab the adapter); raw HCI needs root or `cap_net_raw,cap_net_admin`.

## Quick start

```bash
# Prereqs on the Pi: stop + mask bluetoothd, bring up the dongle
sudo systemctl mask --now bluetooth
sudo hciconfig hci1 up

cd bt-core
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt        # websockets (+ pytest)
```

**Dry-run first** (logs the telegrams, transmits *nothing*):

```bash
python -m mk4web.broadcaster --dry-run   # terminal 1
python -m mk4web.api                       # terminal 2  →  http://<pi-ip>:8080/
```

**Live** (drives the dongle):

```bash
sudo python -m mk4web.broadcaster          # starts IDLE — no transmit until "Connect"
python -m mk4web.api
```

**Cold-start flow** in the browser at `http://<pi-ip>:8080/`:

1. Power-cycle both hubs (each shows one long flash).
2. **Connect** → hubs fast-flash.
3. Press **one** hub's button to **two** fast flashes (→ slot 1); leave the other
   on one flash (→ slot 0). *(Different slots are required for independent control.)*
4. **Ready** → hold the Forward/Reverse buttons to drive; release snaps to stop;
   **STOP** = all neutral.

All ports/HCI are env-overridable (`MK4_HCI`, `MK4_HTTP_PORT`, `MK4_WS_PORT`, … —
see [`bt-core/mk4web/config.py`](bt-core/mk4web/config.py)).

## The WebSocket API

The product. Connect to `ws://<pi>:8765`; messages are JSON. Full machine-readable
contract: **[`bt-core/mk4web/asyncapi.yaml`](bt-core/mk4web/asyncapi.yaml)** (AsyncAPI
3.0), also served at `GET /asyncapi.yaml`.

**Client → server**

```jsonc
{ "cmd": "setup", "action": "connect" }              // IDLE → CONNECTING
{ "cmd": "setup", "action": "ready"   }              // CONNECTING → READY
{ "cmd": "setup", "action": "reset"   }              // → IDLE (all neutral)
{ "cmd": "set", "slot": 1, "channel": 0, "value": 5 } // motion; honored only in READY
{ "cmd": "stop" }                                     // all neutral (any state)
{ "cmd": "state" }                                    // re-send current state
```

**Server → client (pushed)**

```jsonc
{ "type": "lifecycle", "state": "READY" }            // on connect + every transition
{ "type": "state", "slots": [[0,0,0,0],[5,0,0,0],[0,0,0,0]] }  // 3 slots × 4 signed values
```

`value` is `-7..+7` (mapped to a nibble); `slot` is `0..2`, `channel` is `0..3`.

## Channel map

Confirmed by our own transmits (the rest is an open sweep; boxes/slots are
swappable, so this is *per current setup*):

| Slot | Box | Channel | Function |
|------|-----|---------|----------|
| 0 | arm/bucket | **ch0** | shovel / bucket ✅ |
| 0 | arm/bucket | ch1–3 | turntable / boom / arm — *unmapped* |
| 1 | track | **ch4** | left track ✅ |
| 1 | track | ch5–7 | right track + … — *unmapped* |

**Two-hub simultaneous, confirmed:** one telegram with `ch0` *and* `ch4` set moved
both boxes at once.

## How the protocol was reverse-engineered

A compact case study (details in [`docs/PROJECT.md`](docs/PROJECT.md) and
[`bt-core/reference/MKtech_reverse_engineering_report.md`](bt-core/reference/MKtech_reverse_engineering_report.md)):

1. **Sniffed** the hubs with `btmon` + `hcitool lescan` — they don't advertise;
   they're pure receivers. Dead end for passive discovery.
2. **Followed the public reference** ([mkconnect-python](https://github.com/J0EK3R/mkconnect-python))
   and got *single-hub* motion working with the MK6.0 model — but two-hub
   addressing never worked.
3. **Decompiled** the official `MK+tech` Android app (`jadx`), recovered the
   `MouldKingCrypt` cipher from the Java BLE plugin, and re-implemented it in Python
   (`encode`/`decode`, verified byte-exact).
4. **Captured** the app driving the real hubs and **decoded** the adverts with our
   `decode()` — revealing the true **MK4 12-channel nibble** protocol (one telegram,
   slot-addressed by nibble block). The MK6.0 detour was the wrong model all along.
5. **Re-transmitted** the decoded telegrams from our own dongle → both hubs moved,
   simultaneously, from one advert.

## Safety model

- **Dry-run** (`--broadcaster --dry-run`) transmits nothing; it logs every telegram.
- **Motion is gated** to the `READY` lifecycle state; setup/connect alone never moves a motor.
- **Auto-neutral** on: client disconnect, zero clients, `stop`, or lifecycle leaving READY.
- **Auto-IDLE** (advertising off) if the API process dies (broadcaster sees the socket drop).
- Big **STOP** button in the GUI; per-channel **release-to-stop** on the joystick holds.

## Repository layout

```
moldqueen/
├── docs/PROJECT.md            # canonical project reference (read this)
├── bt-core/                   # Python — the radios + the control service
│   ├── mk4web/                # broadcaster + api + web client + asyncapi.yaml
│   └── reference/             # verified protocol snapshots, the codec, the APK report
├── java-core/                 # empty Java scaffold — future API client OR retire
├── web-gui/                   # original Node scaffold — superseded by mk4web's page
└── CLAUDE.md                  # terse agent/dev notes (per folder too)
```

`java-core/` and `web-gui/` are bootstrap scaffolds the project outgrew; the working
stack is entirely in `bt-core/mk4web/`.

## Roadmap & open problems

- **Finish the channel map** — sweep the remaining slot-0 and slot-1 channels.
- **Slot auto-detection — unsolved.** Slots are set by physical button and reset on
  power-cycle; today the GUI guides it manually.
- **Box identity UX — unsolved.** Which physical box is on which slot is operator
  knowledge; the UI labels by slot + channel only.
- **Console / AI client** of the WebSocket API (the API is ready; the client isn't).
- **Hardware:** disable onboard BT; keep the 5 V/3 A PSU.
- **Future phases:** camera, TOF sensor, local AI brain — all driving via the WS API.

## Development

- **Minimal dependencies** (1 GB Pi): the service needs only `websockets`.
- **Tests:** `cd bt-core && source .venv/bin/activate && pytest`.
- **Conventions:** small, clear conventional commits (`feat:`/`fix:`/`docs:`/`chore:`);
  secrets never committed.
- Agent/working notes live in the `CLAUDE.md` files (root + per folder).

## Credits & license

- Protocol groundwork: [`J0EK3R/mkconnect-python`](https://github.com/J0EK3R/mkconnect-python)
  (the MK4/MK6 reference and the original `MouldKingCrypt`). Our hubs turned out to be
  the MK4 variant; the codec here is re-implemented and verified against the app.
- **Independent & unofficial** — not affiliated with Mould King / Shenzhen Yuxing;
  trademarks used descriptively. Provided **as-is, no warranty, use at your own
  risk** — see the full [Disclaimer](#disclaimer).

**License:** [MIT](LICENSE) © 2026 Jens Richter.
