# bt-core

Hardware-**bound** Python. The **only** code in the project that touches the
radios. Everything here is about turning payload bytes into actual BLE
advertising on a specific adapter.

## Purpose

A thin **"radio worker"** process owns exactly **one** Bluetooth adapter:

- **hci0** (Pi onboard) → hub A.
- **hci1** (USB BLE dongle, added later) → hub B.

A worker takes **payload bytes** (from java-core) and **continuously advertises**
them as BLE telegrams via a **raw HCI socket** (`socket.AF_BLUETOOTH` /
`socket.BTPROTO_HCI`), bound to its one `hci` index, until it is handed new bytes.
Broadcasting is connectionless, which is exactly why each hub gets its own radio
and its own worker — no sharing, no contention between hubs.

## Stack

- Python **3.13**, standard-library **`socket`** for raw HCI (no third-party BLE
  stack — we talk to the kernel directly).
- **pytest** for tests (dev-only; see `requirements.txt`).
- A per-folder virtualenv at **`.venv/`** (gitignored).

## Setup / test / run

```bash
cd bt-core
python3 -m venv .venv            # already created during bootstrap
source .venv/bin/activate
pip install -r requirements.txt  # pytest
pytest                           # all tests pass

# stub smoke test (no BLE): pipe newline-framed payloads to the worker
printf '\x01\x02\x03\n' | python radio_worker.py
```

## ⚠️ Privileges & bluetoothd contention (real, not yet done)

The real worker needs raw HCI access, so when radio work begins you must:

1. **Stop `bluetoothd`** (the BlueZ daemon) so it doesn't grab the adapter —
   e.g. `sudo systemctl stop bluetooth`. A running `bluetoothd` and our raw HCI
   worker will fight over the same `hci` device.
2. Run the worker with privileges: either as **root**, or grant the binary/Python
   the capabilities **`cap_net_raw,cap_net_admin`**.
3. Bind each worker to a **specific** `hci` index (hci0 / hci1) so hub A and hub B
   never cross radios.

BlueZ tooling is already installed for inspection/bring-up later:
`bluetoothctl`, `hciconfig`, `btmgmt`, `btmon`. **No radio is configured or
brought up yet** — that's a separate, deliberate step.

## Current state — PLACEHOLDER

[`radio_worker.py`](radio_worker.py) does **no BLE yet**. It reads newline-framed
payloads from stdin and logs each as hex, so the toolchain is provable without
hardware. The pure `format_payload()` seam is what the tests exercise.

## Layout

```
bt-core/
├── radio_worker.py        # stub worker (stdin → log hex; no BLE yet)
├── test_radio_worker.py   # pytest, passing
├── requirements.txt       # pytest only
└── .venv/                 # virtualenv (gitignored)
```

## Boundaries

- **Upstream:** receives payload bytes from [`../java-core/`](../java-core/). The
  IPC/protocol is **TBD** — currently stdin (newline-framed), expected to change;
  **keep it pluggable, don't over-design.**
- All radio/HCI/BLE specifics live **here and nowhere else**. java-core must stay
  hardware-independent — if radio logic is leaking upstream, pull it back into
  bt-core.
