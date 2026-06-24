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
- **Channel map = DATA, PER-LAYOUT, CLIENT-OWNED** (each function-mapped layout declares
  its function set in `client/web/layouts.json` + its default in
  `client/web/channel_map.<id>.json`, e.g. `channel_map.excavator.json`; editable live in
  the GUI). No global `FUNCTIONS` — the client's resolver is parameterized by the layout's
  set. Drive **by FUNCTION**; the **smart client** resolves function→(slot,channel,value)
  (+ invert, device-0/1 swap, `reverse_scale` trim, per-function `max`) and sends raw
  `set` — the server is **thin transport** (it never sees the map). Transmit-confirmed: **bucket =
  slot0/ch0** (shovel), **left_track = slot1/ch0** (= global ch4), **arm_lift =
  slot0/ch3**, **front_arm = slot0/ch1** (last two from the 2026-06-17 hardware test,
  swapped from the placeholders); rotation/right_track still placeholders.
  **Two-hub simultaneous CONFIRMED.**

## The working software: `linux-core/mk4web/`

The control stack is the **`linux-core/mk4web/`** Python webservice: a **broadcaster**
(owns the radio + 12-nibble state, lifecycle IDLE→CONNECTING→READY, auto-neutral
safety) + an **API** (the **WebSocket API `:8765` is the product**, always on; **thin
transport** — raw `set` only, no function/map resolution; AsyncAPI at `/asyncapi.yaml`).
**WS commands:** `setup` (connect/ready/reset), `set` (raw slot/ch/value — the only
motion primitive), `stop`, `state`, `info`; pushes `lifecycle`/`state`/`info`. The
**smart client** resolves function→channel + owns the map. Serving the client web page is **OPTIONAL**: on by default,
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

> The retired `java-core/` (telegrams are built in Python now) and `web-gui/`
> (superseded by mk4web's page / `client/`) scaffolds were **removed**. `bt-core/`
> never existed — the radio core is `linux-core/`.

## Agents (Claude Code subagents — `.claude/agents/`)

One specialist per **active** component; each fires on its own domain (auto-delegation
keys off the agent's `description`). Use the matching agent for non-trivial work in its
area; for a small one-file edit you already understand, just go direct.

| Work | Agent |
|---|---|
| `client/` web UI — dashboard, layouts, chooser, MK4Chrome, auto-assign, gamepad, **channel maps + function→channel resolution**, i18n | **client-dev** |
| `linux-core/` — Pi radio core: the Python **broadcaster** (raw HCI), the **thin-transport WS server** (`mk4web/api.py`), bluetoothd/caps, the dongle-by-MAC | **linux-core-dev** |
| `android-core/` — Kotlin standalone app: native BLE `AdvertisingSet`, the on-device WS server, `bundleClient`, the WebView, the Gradle build | **android-core-dev** |
| `dev-docs/` + `docs/` (the GitHub Pages site) + `README` | **docs-dev** |
| Review a finished chunk against the plan/standards | **code-reviewer** |

Boundaries: the **client owns the maps + resolution** (thin transport, smart client) —
radio agents never resolve functions; the **UI is single-sourced** (`client/`) and the
cores *consume* it — don't fork it per platform. There is **no** agent for the removed
`java-core/` / `web-gui/` scaffolds (and `bt-core/` never existed — radio = `linux-core/`);
if a request smells like those, it's really client-/linux-/android-/docs-dev.

> **`code-reviewer` name collision:** a built-in `code-reviewer` *and*
> `superpowers:code-reviewer` also exist — if you specifically want the user-level one,
> name it explicitly.

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

**Keep [`CONTRIBUTING.md`](CONTRIBUTING.md) updated** when the contribution flow, the
agent roster (`.claude/agents/`), or the AI-assisted-workflow conventions change.

**Keep [`WORKBOARD.md`](WORKBOARD.md) updated** — the single living backlog so cross-session
items don't get lost. Move items between FUTURE / IN-PROGRESS / STALE / FINISHED as work
starts, stalls, or completes.

## Toolchains (on this Pi)

JDK 21, Node 20 LTS, Python 3.13 + venv, BlueZ 5.82 (`bluetoothctl`, `hciconfig`,
`btmgmt`, `btmon`). The linux-core venv has `websockets`.
