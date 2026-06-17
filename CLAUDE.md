# moldqueen

Control a **Mould King 13112 RC excavator** from a Raspberry Pi (then add a camera,
TOF sensor, and a local AI brain that drives it via the same API).

📖 **Full canonical reference: [`docs/PROJECT.md`](docs/PROJECT.md).** This file is
the terse must-knows for next session; PROJECT.md wins on any disagreement.

## Must-know facts

- **Protocol = MK4 12-channel NIBBLE** (NOT MK6.0 — every MK6 / "device 0/1" /
  promotion note is **SUPERSEDED**). Control = broadcasting manufacturer-specific
  BLE adverts, company **`0xFFF0`**. Motion telegram raw `7d ae 18 <6 channel
  bytes> 82`; connect `ad ae 18 80 80 80 f3 52`. `0x8` nibble = neutral; `>0x8` /
  `<0x8` = direction.
- **One telegram = 12 nibbles = 3 slots × 4 channels, drives ALL hubs at once** —
  no per-device addressing, **one radio is enough.** A hub's slot is set by its
  physical button (1/2/3 flashes = slot 0/1/2; resets to slot 0 on power-cycle).
- **Use the USB dongles, not the onboard radio.** hci1 = Realtek
  `00:A6:44:02:21:25` (control); hci2 = TP-Link `6C:4C:BC:87:D0:83` (spare). Onboard
  hci0 (Broadcom UART) corrupts frames at the connect transition → disable it
  (`dtoverlay=disable-bt`). Needs a solid **5 V/3 A PSU** (under-voltage caused
  failures). `bluetoothd` must be **stopped + masked**; raw HCI needs root/caps.
- **Codec verified:** `bt-core/reference/mouldking_crypt.py` (`encode`/`decode`)
  reproduces the app's bytes exactly (13/13 tests). Do NOT reinvent the crypt.
- **Channel map = DATA, PER-LAYOUT** (each function-mapped layout declares its
  function set in `bt-core/mk4web/web/layouts.json` + its default in
  [`config/channel_map.<id>.json`](config/), e.g. `channel_map.excavator.json`;
  editable live in the GUI). No global `FUNCTIONS` — `channelmap` is parameterized by
  the layout's set. Drive **by FUNCTION**; the **server** resolves
  function→(slot,channel,value) (+ invert, device-0/1 swap, `reverse_scale` trim,
  per-function `max`) — broadcaster stays dumb. Transmit-confirmed: **bucket =
  slot0/ch0** (shovel), **left_track = slot1/ch0** (= global ch4), **arm_lift =
  slot0/ch3**, **front_arm = slot0/ch1** (last two from the 2026-06-17 hardware test,
  swapped from the placeholders); rotation/right_track still placeholders.
  **Two-hub simultaneous CONFIRMED.**

## The working software: `bt-core/mk4web/`

The control stack is the **`bt-core/mk4web/`** Python webservice: a **broadcaster**
(owns the radio + 12-nibble state, lifecycle IDLE→CONNECTING→READY, auto-neutral
safety) + an **API** (the **WebSocket API `:8765` is the product**, always on;
resolves `drive`-by-function via `channelmap.py`; AsyncAPI at `/asyncapi.yaml`).
**WS commands:** `setup` (connect/ready/reset), `drive` (by function), `set` (raw
slot/ch), `stop`, `state`, `map` (get/set/swap/promote); pushes `lifecycle`/`state`/
`map`/`mapresult`. Serving the client web page is **OPTIONAL**: on by default,
`--ws-only` (=`MK4_SERVE_CLIENT=0`) runs WS-only, `--http-port N` overrides the page
port. Run from `bt-core/` in the venv (or `scripts/start.sh`):

```bash
python -m mk4web.broadcaster --dry-run    # logs telegrams, no transmit (start here)
sudo python -m mk4web.broadcaster          # live (needs hci1 up, bluetoothd masked)
python -m mk4web.api                        # page http://<pi>:8080/ + API ws://<pi>:8765
python -m mk4web.api --ws-only              # WebSocket only (bring-your-own-client)
```
**Routes:** `/` = **layout chooser** → `/dashboard` (excavator) or `/raw` (RAW debug
test bench). **Dashboard:** drag-joysticks (tracks/arms) + hold buttons (rotation/
bucket); a **connection wizard** for cold-start (**Connect → button one hub to slot
1 → Ready**); **Settings** to assign function→slot/channel (+ max, reverse-trim,
invert, EN/DE labels, device-swap, **configurable WS endpoint**, Save/Promote).
Responsive. The client can be served separately (Docker, point at the Pi via the
endpoint setting — see [`docs/REMOTE_CLIENT.md`](docs/REMOTE_CLIENT.md)). Detail in
[`bt-core/CLAUDE.md`](bt-core/CLAUDE.md).

## Components (one repo)

- **[`bt-core/`](bt-core/)** — Python; the radios + the `mk4web` control service.
  **The only code that touches the radios.**
- **[`java-core/`](java-core/)** — empty Java scaffold. The old "java-core builds
  telegrams" plan is **SUPERSEDED** (telegrams are built in Python). **Decision:**
  future API client (a JVM brain) OR retire. Not on the control path.
- **[`web-gui/`](web-gui/)** — original Node scaffold, superseded by mk4web's page.

## Open problems (see `docs/PROJECT.md` §8)

Finish the channel map · slot auto-detection (unsolved) · box-identity UX
(unsolved) · console/AI client of the WS API (TODO) · disable onboard BT ·
camera/sensors/AI (future).

## Conventions

Small, clear conventional commits (`feat:`/`fix:`/`docs:`/`chore:`). Minimal
dependencies (1 GB Pi). Secrets never committed (`.gitignore`). **No git remote
yet** — deliberate, later decision.

## Toolchains (on this Pi)

JDK 21, Node 20 LTS, Python 3.13 + venv, BlueZ 5.82 (`bluetoothctl`, `hciconfig`,
`btmgmt`, `btmon`). The bt-core venv has `websockets`.
