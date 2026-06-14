# moldqueen

Control a **Mould King 13112 RC excavator** (a building-block model) from a
Raspberry Pi, and later add a camera, a TOF sensor, and a local AI.

## How the model is actually controlled (read this first)

The excavator keeps its **two stock battery/Bluetooth hubs** in place. These hubs
are **not** driven over a normal BLE GATT connection. They are driven by
**broadcasting crafted BLE advertising packets** ("telegrams"): each telegram is
built with an encoding/crypto step and is **addressed per hub** (device 0 and
device 1).

To control **both hubs flawlessly and simultaneously**, we use **one radio per
hub** — broadcasting is connectionless, so two hubs sharing one adapter would
fight over airtime:

- **hci0** — the Pi's onboard Bluetooth — drives **hub A**.
- **hci1** — a USB BLE dongle (added later) — drives **hub B**.

## The three components (one repo)

| Folder | Language | Bound to hardware? | Responsibility |
|--------|----------|--------------------|----------------|
| [`java-core/`](java-core/) | Java + Gradle | **No** | Build telegrams (encoding/crypto, channel→speed mapping over −7..+7, the rolling counter) and orchestrate multiple hubs. Pure bytes + logic. Fully unit-testable. **No BLE.** |
| [`bt-core/`](bt-core/) | Python | **Yes** | Thin "radio worker" processes, one per adapter, that take payload bytes and continuously advertise them via **raw HCI sockets** (`AF_BLUETOOTH` / `BTPROTO_HCI`), each bound to a specific `hci` index. **The only code that touches the radios.** |
| [`web-gui/`](web-gui/) | Vanilla JS + minimal Node | No | A very light browser control panel to drive the excavator. Talks to java-core (wiring TBD). |

Data flow: **web-gui** → **java-core** (emits payload bytes) → **bt-core** worker
(re-broadcasts those bytes on its adapter until handed new bytes).

## The hardware-independence rule (java-core)

**java-core must never depend on Pi-only things.** No BLE, no HCI, no
`/dev`, no platform assumptions. It emits and consumes plain bytes + logic only.
It may later be developed on a Windows PC and the built artifact deployed to the
Pi, so it has to stay portable. All radio-specific code lives in **bt-core**, full
stop. If you ever feel tempted to import a BLE/socket thing into java-core, that
code belongs in bt-core instead.

The boundary between java-core and bt-core is intentionally simple: java-core
emits payload bytes; a worker re-broadcasts them. The exact IPC/protocol is
**TBD — keep it pluggable, don't over-design it yet.**

## First milestone

**One telegram out of `hci0` makes one motor move.** Everything here is
scaffolding in service of that — keep it minimal.

## The dev/runtime box

A **Raspberry Pi 3B (aarch64, 1 GB RAM)**. It is the radio appliance and, for now,
the dev box. Hardware constraints are real:

- It is a **weak JVM build machine** — Gradle is slow here (first `java-core`
  build was ~2.5 min). See [`java-core/CLAUDE.md`](java-core/CLAUDE.md).
- The radios need privileges (`root` or `cap_net_raw,cap_net_admin`) and
  `bluetoothd` must be stopped so it doesn't grab the adapter. See
  [`bt-core/CLAUDE.md`](bt-core/CLAUDE.md). **No radio is configured or brought
  up yet.**

## Build / test / run, per component

- **java-core:** `cd java-core && ./gradlew test`
- **bt-core:** `cd bt-core && source .venv/bin/activate && pytest`
- **web-gui:** `cd web-gui && npm start` → http://localhost:8080/

## Conventions

- **Keep the hardware boundary clean:** radio code → bt-core only; java-core stays
  portable.
- **Small, clear commits.** Conventional-style messages are welcome
  (`feat:`, `fix:`, `docs:`, `chore:`).
- Prefer **minimal dependencies** everywhere — this Pi has little RAM.
- **Secrets never get committed** (`.env`, keys). See `.gitignore`.
- There is **no git remote yet** — that's a deliberate, later decision.

## Toolchains (verified on this Pi)

JDK 21 (`openjdk-21-jdk-headless`), Node.js 20 LTS + npm, Python 3.13 + venv,
BlueZ 5.82 (`bluetoothctl`, `hciconfig`, `btmgmt`, `btmon`) — installed and ready,
radios untouched.
