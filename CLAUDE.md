# moldqueen

Control a **Mould King 13112 RC excavator** from a Raspberry Pi (then add a camera,
TOF sensor, and a local AI brain that drives it via the same API).

📖 **Full canonical reference: [`dev-docs/PROJECT.md`](dev-docs/PROJECT.md).** This file is
the terse must-knows for next session; PROJECT.md wins on any disagreement.

## Session handover (do this every session)

We run **frequent fresh sessions** (the 1 GB Pi RAM thrashes in long ones), so context
must survive a restart via **[`dev-docs/HANDOVER.md`](dev-docs/HANDOVER.md)** — a short living
"where we are right now" doc.

- **At session START:** read `dev-docs/HANDOVER.md` (current state + next task) alongside
  this file + `PROJECT.md`.
- **Before WRAPPING UP:** **update `dev-docs/HANDOVER.md`** (move finished work to *Current
  state*, set the new *next task*, note new decisions/quirks) and **commit it** — that
  makes ending a session lossless. Prefer ending early over a long thrashy session.

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
- **Codec verified:** `linux-core/reference/mouldking_crypt.py` (`encode`/`decode`)
  reproduces the app's bytes exactly (13/13 tests). Do NOT reinvent the crypt.
- **Channel map = DATA, PER-LAYOUT** (each function-mapped layout declares its
  function set in `client/web/layouts.json` + its default in
  [`config/channel_map.<id>.json`](config/), e.g. `channel_map.excavator.json`;
  editable live in the GUI). No global `FUNCTIONS` — `channelmap` is parameterized by
  the layout's set. Drive **by FUNCTION**; the **server** resolves
  function→(slot,channel,value) (+ invert, device-0/1 swap, `reverse_scale` trim,
  per-function `max`) — broadcaster stays dumb. Transmit-confirmed: **bucket =
  slot0/ch0** (shovel), **left_track = slot1/ch0** (= global ch4), **arm_lift =
  slot0/ch3**, **front_arm = slot0/ch1** (last two from the 2026-06-17 hardware test,
  swapped from the placeholders); rotation/right_track still placeholders.
  **Two-hub simultaneous CONFIRMED.**

## The working software: `linux-core/mk4web/`

The control stack is the **`linux-core/mk4web/`** Python webservice: a **broadcaster**
(owns the radio + 12-nibble state, lifecycle IDLE→CONNECTING→READY, auto-neutral
safety) + an **API** (the **WebSocket API `:8765` is the product**, always on;
resolves `drive`-by-function via `channelmap.py`; AsyncAPI at `/asyncapi.yaml`).
**WS commands:** `setup` (connect/ready/reset), `drive` (by function), `set` (raw
slot/ch), `stop`, `state`, `map` (get/set/swap/promote); pushes `lifecycle`/`state`/
`map`/`mapresult`. Serving the client web page is **OPTIONAL**: on by default,
`--ws-only` (=`MK4_SERVE_CLIENT=0`) runs WS-only, `--http-port N` overrides the page
port. Run from `linux-core/` in the venv (or `scripts/start.sh`):

```bash
python -m mk4web.broadcaster --dry-run    # logs telegrams, no transmit (start here)
sudo python -m mk4web.broadcaster          # live (needs hci1 up, bluetoothd masked)
python -m mk4web.api                        # page http://<pi>:8080/ + API ws://<pi>:8765
python -m mk4web.api --ws-only              # WebSocket only (bring-your-own-client)
```
**Layouts = DATA** (`web/layouts.json` manifest: `{id,name,description,icon,kind,
category,active,functions?,files}`). The **server derives each route as `/<id>`**
(not a manifest field); `active:false` hides a layout (no route/card) — that's how
the inactive **template** (`template.{html,js,css}` + `channel_map.template.json`)
ships. Shared shell/menu/modal CSS = **`shell.css`** (each layout links it + its own
css); see [`dev-docs/ADDING_A_LAYOUT.md`](dev-docs/ADDING_A_LAYOUT.md). **Routes:** `/` =
**chooser** → `/excavator` or `/raw`. **Dashboard:** drag-joysticks + hold buttons; a
**connection wizard** (**Connect → button one hub to slot 1 → Ready**); **Settings**
to assign function→slot/channel (+ max, reverse-trim, invert, EN/DE labels,
device-swap, **configurable WS endpoint**, **ℹ server-info readout**, Save/Promote).
The client can be served separately (Docker, point at the Pi via the endpoint
setting — see [`dev-docs/REMOTE_CLIENT.md`](dev-docs/REMOTE_CLIENT.md)). Detail in
[`linux-core/CLAUDE.md`](linux-core/CLAUDE.md).

## Components (one repo)

- **[`client/`](client/)** — the **independent** web UI (chooser/dashboard/RAW). Depends
  ONLY on the WS API + its own files; the cores/Docker *consume* it (host → client, never
  the reverse). Has its own `serve.py` dev server.
- **[`linux-core/`](linux-core/)** — Python; the Linux/BlueZ radio core + `mk4web` control
  service (tested target: the Pi). The only code that touches the radios **on Linux**.
- **[`android-core/`](android-core/)** — Kotlin; standalone Android app (its own native
  radio + a local WS API that serves `client/`).
- **[`java-core/`](java-core/)** — empty Java scaffold. The old "java-core builds
  telegrams" plan is **SUPERSEDED** (telegrams are built in Python). **Decision:**
  future API client (a JVM brain) OR retire. Not on the control path.
- **[`web-gui/`](web-gui/)** — original Node scaffold, superseded by mk4web's page.

## Operational gotchas (running the live service)

- **Restart the API after changing `api.py` / routes / manifest / WS handlers** — the
  running process holds the old code and serves **stale** behavior (404 on new routes,
  missing response fields, old layout). Always restart the API **and verify live**
  before reporting done. (Static `.js`/`.css`/`.html` serve from disk per request — a
  browser **hard-refresh** suffices for those; no restart needed.)
- **Restart the API by EXACT PID only.** Never `pkill`/`kill` by name or backend
  substring — that has killed the **live broadcaster** twice. The broadcaster usually
  needs **no** restart; only the API does. Find the API pid, `kill -TERM <pid>`, relaunch.
- **The dongle re-enumerates** (`hci1`→`hci3` after replug/reboot) and comes up DOWN.
  **Resolve by MAC `00:A6:44:02:21:25`** (or just use `scripts/start.sh`, which finds
  it by MAC + brings it up); **never assume a fixed `hciN`**.

## Open problems (see `dev-docs/PROJECT.md` §8)

Finish the channel map · slot auto-detection (unsolved) · box-identity UX
(unsolved) · console/AI client of the WS API (TODO) · disable onboard BT ·
camera/sensors/AI (future).

## Conventions

Small, clear conventional commits (`feat:`/`fix:`/`docs:`/`chore:`). Minimal
dependencies (1 GB Pi). Secrets never committed (`.gitignore`). **No git remote
yet** — deliberate, later decision.

## Toolchains (on this Pi)

JDK 21, Node 20 LTS, Python 3.13 + venv, BlueZ 5.82 (`bluetoothctl`, `hciconfig`,
`btmgmt`, `btmon`). The linux-core venv has `websockets`.
