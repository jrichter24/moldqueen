# bt-core

Hardware-**bound** Python. The **only** code in the project that touches the radios.
It builds and broadcasts **MK4 BLE "telegrams"** that drive the excavator's hubs.

📖 Canonical reference: [`../docs/PROJECT.md`](../docs/PROJECT.md).

## Purpose

The working control stack is **[`mk4web/`](mk4web/)** (see below). It broadcasts the
**MK4 12-channel nibble protocol** — **one** telegram drives **all** hubs at once
(company `0xFFF0`) — on a USB dongle (**hci1**) via raw HCI (`hcitool`). The verified
codec is [`reference/mouldking_crypt.py`](reference/mouldking_crypt.py).
(`radio_worker.py` is a leftover stub from the bootstrap — not used.)

## Stack

- Python **3.13**; **`websockets`** for the API; `hcitool` (subprocess) for raw-HCI
  broadcast. (A future worker may talk raw HCI via the stdlib `socket` module —
  `AF_BLUETOOTH`/`BTPROTO_HCI` — directly.)
- **pytest** for tests; a per-folder virtualenv at **`.venv/`** (gitignored).

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

## mk4web — the MK4 control webservice

[`mk4web/`](mk4web/) is the working control service. **The WebSocket API is the
product**; the web page is just its first client (a console/AI brain uses the same
API). It reuses the verified codec (`mk4web/mouldking_crypt.py`, identical to
`reference/`) — the crypt is **not** reinvented.

**Two processes, talking over a local Unix socket** (`/tmp/moldqueen_mk4.sock`):

- **`broadcaster.py`** — owns the radio + authoritative state (12 nibbles =
  3 slots × 4 channels, default `0x8` neutral) and an explicit **lifecycle**:
  **IDLE** (advertising off) → **CONNECTING** (broadcasts the MK4 connect telegram)
  → **READY** (broadcasts ONE motion telegram reflecting state, ~5/sec via the
  200 ms adv interval, on hci1 / `0xFFF0`). Motion is applied only in READY.
  **SAFETY:** if the API process disconnects → reset to IDLE (advertising off, neutral).
- **`api.py`** — WebSocket server + serves the page; **owns/drives the lifecycle**,
  forwards transitions + motion to the broadcaster, pushes state to clients.
  **SAFETY:** on a client disconnect (or no clients) it commands NEUTRAL.

**WebSocket API:** `{"cmd":"setup","action":"connect"|"ready"|"reset"}` (lifecycle),
`{"cmd":"set","slot":0-2,"channel":0-3,"value":-7..7}` (motion, honored only in
READY), `{"cmd":"stop"}`, `{"cmd":"state"}`. Server pushes
`{"type":"lifecycle","state":…}` and `{"type":"state","slots":[[v×4]×3]}`.
**Value→nibble map:** `nibble = 0x8 + value` (`-7..+7` → `0x1..0xF`; `0`=`0x8`
neutral, `+7`=`0xF`, `-7`=`0x1`). The web client uses **press-and-hold** Forward/
Reverse buttons (release/leave → neutral; several can be held at once) at a
selectable speed; controls are locked until READY.

Run (from `bt-core/`, in the venv):
```bash
python -m mk4web.broadcaster --dry-run   # log telegrams, transmit NOTHING (start here)
python -m mk4web.broadcaster             # live: drives the dongle (needs hci1 up, bluetoothd masked)
python -m mk4web.api                      # web page http://<pi>:8080/ , API ws://<pi>:8765
```

### Slots — guided manually (auto-detect unsolved)
- A hub's **slot** (which nibble block it obeys) is set by its **physical button**
  and **resets to slot 0 on power-cycle**. The **Setup panel guides this** (Connect →
  user buttons one hub to two fast flashes = slot 1 → Ready), because the service
  can't see the LED flash state — only the user can. The user confirms the hubs are
  on different slots before READY.
- **TODO / unsolved:** *automatic* slot detection/assignment. For now it is the
  guided manual flow above.
- **Boxes are exchangeable**; mapping *slot → friendly name → physical box* is a
  **later UX step** — the UI labels by SLOT + channel only, no device-identity guessing.
- **One dongle, one telegram drives all slots at once** — no second radio needed.

## Layout

```
bt-core/
├── mk4web/                # the working control webservice (broadcaster + api + web + asyncapi.yaml)
│   ├── broadcaster.py  api.py  telegram.py  mouldking_crypt.py  config.py
│   └── web/index.html  web/app.js
├── reference/             # verified snapshots: CONNECT_PROCEDURE.md, channel_map.md,
│                          #   mouldking_crypt.py, mk4_test.py, MKtech_reverse_engineering_report.md
├── radio_worker.py        # leftover bootstrap stub (stdin → log hex; NOT used)
├── test_radio_worker.py   # pytest, passing
├── requirements.txt       # websockets + pytest
└── .venv/                 # virtualenv (gitignored)
```

## Boundaries

- **The boundary is the WebSocket API** (`mk4web/api.py`), not java-core. Clients
  (the web page now; a console/AI brain later) drive the hubs through that API; the
  `mouldking_crypt` codec + raw-HCI broadcast stay **here and nowhere else**.
- The old "java-core emits payload bytes, bt-core re-broadcasts" boundary is
  **superseded** — telegrams are built in Python. See
  [`../docs/PROJECT.md`](../docs/PROJECT.md) §6.
