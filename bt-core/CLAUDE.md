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
`bluetoothctl`, `hciconfig`, `btmgmt`, `btmon`.

## Verified radio findings — MK4 protocol, two-hub control WORKING

The control protocol is solved and **two-hub simultaneous control is confirmed**.
The full write-up + the verified codec are committed under
[`reference/`](reference/): `CONNECT_PROCEDURE.md`, `channel_map.md`,
`mouldking_crypt.py`, `mk4_test.py`. The real `radio_worker` should match these.

- **Protocol: MK4 12-channel nibble** (company id **0xFFF0**). Motion telegram raw
  = `7d ae 18 <6 channel bytes> 82` (`0x8` nibble = neutral; `>0x8`/`<0x8` =
  direction); connect = `ad ae 18 80 80 80 f3 52`. These are OUR hubs' exact
  app-captured bytes; `mouldking_crypt.py` reproduces them (verified, 13/13 tests).
- **One telegram drives all hubs at once** — 12 nibbles = 3 slots × 4 channels
  (slot 0 = ch0–3, slot 1 = ch4–7, slot 2 = ch8–11). A hub's slot is set by its
  physical button (1/2/3 flashes). Multi-hub precondition: hubs on different slots.
  **No** per-hub device byte, **no** MK6 device-0/1, **no** second radio needed.
- **Confirmed two-hub move:** one telegram with `ch0=0xb` (arm box → shovel) +
  `ch4=0xb` (track box → left track) moved both hubs at once on hci1.
- **Radios:** hci1 = Realtek `00:A6:44:02:21:25`, hci2 = TP-Link `6C:4C:BC:87:D0:83`;
  onboard hci0 (Broadcom UART) is unreliable → to be disabled (`dtoverlay=disable-bt`).
  5 V/3 A PSU installed. `bluetoothd` must be **stopped + masked**; broadcast via
  raw HCI (`hcitool -i <hciN> cmd 0x08 0x0006/0x0008/0x000a`).
- The earlier **MK6.0 device-0/1 model was a dead end and is SUPERSEDED** (see the
  appendix in `reference/CONNECT_PROCEDURE.md`).

**No radio bring-up is wired into the `radio_worker` yet** — the proven method
lives in [`reference/`](reference/) and needs porting into the worker.

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
