<h1><img src="client/assets/moldqueen_icon.png" alt="" height="34" align="top"> moldqueen</h1>

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Raspberry Pi](https://img.shields.io/badge/Raspberry%20Pi-Linux%2FBlueZ-C51A4A?logo=raspberrypi&logoColor=white)
![Android](https://img.shields.io/badge/Android-standalone%20APK-3DDC84?logo=android&logoColor=white)
![Gamepad](https://img.shields.io/badge/gamepad-DualSense%20%2F%20any-5865F2)
![Python 3.13](https://img.shields.io/badge/python-3.13-3776AB?logo=python&logoColor=white)
[![status: two-hub control working](https://img.shields.io/badge/status-two--hub%20control%20working-brightgreen)](#what-it-does)

**Drive a [Mould King](https://www.mouldking.com/) building-block RC toy — over a reverse-engineered BLE protocol, through one clean WebSocket API.**

<p align="center">
  <img src="client/assets/moldqueen_banner_v2.png" alt="moldqueen — Mould King RC control" width="760">
</p>

## The idea: API-first — thin transport, smart client

moldqueen is built around **one documented WebSocket contract** and an unusual split:

- **The radio core is a _thin transport_.** It takes a raw `set {slot, channel, value}`,
  turns it into a Mould King BLE "telegram," crypts it, and broadcasts it. It knows
  **nothing** about functions, channel maps, inversion, caps, or your specific toy.
- **A single web client is the _smart_ half.** It resolves *function → (slot, channel,
  value)*, owns the per-layout channel map, and runs the keepalive + STOP safety latch.

Because all the smarts live above the contract, **the radio core is swappable**: a
**Raspberry Pi** (raw HCI/BlueZ) and a **standalone Android app** (native BLE) expose the
*identical* WebSocket API and serve the *same* client — so the UI is written once and the
hardware is pluggable. (The hubs are driven by *broadcasting* crafted BLE adverts, not over
GATT.) The **Mould King 13112 excavator** is the hardware-proven reference; the
layout system + auto-assign let you drive **any** Mould King toy on these hubs.

## Quickstart

**Raspberry Pi (primary path)** — Pi with a USB BLE dongle, Python 3.13, a solid 5 V/3 A PSU:

```bash
git clone https://github.com/jrichter24/moldqueen && cd moldqueen
scripts/start.sh        # frees the adapter from bluetoothd, brings the dongle up by MAC, runs both processes
# → open http://<pi>:8080/  →  Connect  →  button one hub to slot 1  →  Ready  →  drive
```

Full prep (disable onboard BT, mask `bluetoothd`, caps) and a dry-run mode:
**[`dev-docs/QUICKSTART.md`](dev-docs/QUICKSTART.md)**.

**Android (standalone — no Pi)** — own native radio + bundled client in one APK:

```bash
cd android-core && ./gradlew installDebug    # build + install to a connected device
# → open the MoldQueen app  →  Connect  →  Ready  →  drive
```

Build/device detail: **[`dev-docs/ANDROID.md`](dev-docs/ANDROID.md)** *(coming soon)*.

> **Just exploring?** Run the client alone against a Pi —
> **[`dev-docs/DEV_CLIENT.md`](dev-docs/DEV_CLIENT.md)** (dev server) or
> **[`dev-docs/REMOTE_CLIENT.md`](dev-docs/REMOTE_CLIENT.md)** (Docker).

## What it does

- **Layouts** — pick one from the start-page chooser:
  - **Excavator** (model-specific): landscape HMI dashboard, drag-joysticks + hold buttons.
  - **12-axis** and **Brick / PS-like** (model-agnostic): generic gamepads with **12 motors**
    you map to any toy.
  - **RAW** (debug): a protocol bench over the raw `set`/`stop` path (slot/channel/value,
    telegram + on-air bytes console).
- **Chooser / start page** — cards with a **Generic / Model** badge and **MK4 / MK6**
  protocol badges (MK6 greyed = coming soon), a **jump-to-layout** dropdown, and the RAW
  bench behind a debug icon.
- **One shared chrome (MK4Chrome)** — every layout gets the same menu, settings, connect
  wizard, status light, language picker, keyboard STOP, and gamepad path.
- **Profile-driven auto-assign** — map a generic controller's 12 motors to channels by
  toy *profile* (vehicle / car / custom) with an inline editor and a zero-box guide.
- **Gamepad** — drive with a DualSense (or any) controller on the excavator **and** the
  generic layouts (web/desktop; Android System WebView lacks the Gamepad API → graceful
  fallback to touch). *(detail: [`dev-docs/GAMEPAD.md`](dev-docs/GAMEPAD.md) — coming soon)*
- **6 languages** (EN/DE complete; ZH/KO/ES/FR seeded, EN fallback), editable per-layout
  title + colour.
- **Safety** — affirmative keepalive (the client re-affirms intent ~10/s; the server
  auto-neutralizes any un-refreshed channel) + STOP = kill-and-reconnect-at-neutral.
  [More ↓](#architecture) · 📸 [Screenshots](dev-docs/SCREENSHOTS.md).

## Architecture

Thin transport (server) + smart client (UI), with a swappable radio core behind one
WebSocket contract:

```
client/        # the INDEPENDENT smart web client (chooser · layouts · MK4Chrome · channel maps)
   │  ws://…:8765  (the contract: setup · set · stop · state · info)
   ├── linux-core/   # Pi radio core — raw HCI/BlueZ; serves the client (Python)
   └── android-core/ # standalone Android radio core — native BLE; serves the client (Kotlin)
```

The client resolves *function → channel* and sends only low-level `set`; the core makes a
nibble, crypts it (`MouldKingCrypt`), and broadcasts the BLE telegram. One telegram drives
all hubs at once (12 nibbles = 3 slots × 4 channels). Deep dive — protocol, crypto, the
dual-radio finding, the WS contract: **[`dev-docs/PROJECT.md`](dev-docs/PROJECT.md)** (the
source of truth) and the machine-readable **[`asyncapi.yaml`](linux-core/mk4web/asyncapi.yaml)**.

| Run it… | How | Detail |
|---|---|---|
| On the Pi (served) | `scripts/start.sh` → `http://<pi>:8080/` | [QUICKSTART](dev-docs/QUICKSTART.md) |
| Android (standalone) | `./gradlew installDebug` | [ANDROID](dev-docs/ANDROID.md) *(soon)* |
| Client on the desktop | `client/serve.py` → point at a Pi | [DEV_CLIENT](dev-docs/DEV_CLIENT.md) |
| Client in Docker | `Dockerfile.client` → point at a Pi | [REMOTE_CLIENT](dev-docs/REMOTE_CLIENT.md) |
| On another board | — (the radio core is hardware-bound) | [PORTING](dev-docs/PORTING.md) |
| Add your own toy/layout | a generic slot/channel layout, no core fork | [ADDING_A_LAYOUT](dev-docs/ADDING_A_LAYOUT.md) |

## Roadmap

- **MK6 protocol support** — the greyed *MK6* card badges; second Mould King BLE variant.
- **ESP32 radio core** — a third thin-transport core behind the same contract.
- **Camera, ToF sensor** — telemetry over/alongside the API.
- **AI brain / console client** — an agent driving the toy through the same WebSocket API.

Detail + status: **[`dev-docs/ROADMAP.md`](dev-docs/ROADMAP.md)** *(coming soon)*.

## Credits, license & disclaimer

- **Author:** Dr. Jens Richter — physics & electrical engineering; by day, tour optimization
  with genetic/AI algorithms at [DNA Evolutions](https://www.dna-evolutions.com/)
  ([LinkedIn](https://www.linkedin.com/in/li-jens-richter)). *Built for my son Jonas, who
  loves excavators.* Built with AI assistance.
- **Protocol groundwork:** [`J0EK3R/mkconnect-python`](https://github.com/J0EK3R/mkconnect-python)
  — our `mouldking_crypt.py` is a **port/derivative of `MouldKingCrypt`, used under the MIT
  License** (© 2024 J0EK3R), verified byte-exact against the MK+tech app; see
  [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). Additional reference:
  [BrickController2](https://github.com/imurvai/brickcontroller2).
- **Independent & unofficial** — **not** affiliated with, authorized by, or endorsed by
  Mould King / Shenzhen Yuxing; trademarks used descriptively. The BLE protocol was
  reverse-engineered for interoperability with hardware the author owns, for educational /
  personal use. Provided **"as is", without warranty — you assume all risk.**

**License:** [MIT](LICENSE) © 2026 Jens Richter. Bundled third-party code keeps its own
license — see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
