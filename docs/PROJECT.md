# moldqueen — project document (canonical reference)

> This is the authoritative project document. Where any other doc (the CLAUDE.md
> files, or the snapshots in `bt-core/reference/`) disagrees, **this file wins.**
> Last major update: 2026-06-16 (protocol discovery + webservice + the landscape
> **dashboard** GUI and the configurable **channel map**).

---

## 1. Overview

**Goal:** control a **Mould King 13112 RC excavator** (a Lego-like building-block
model with two stock battery/Bluetooth hubs) from a Raspberry Pi, and later add a
camera, a TOF sensor, and a local AI "brain" that drives it through the same API.

**Status:**
- ✅ **Core goal achieved** — **two hubs driven simultaneously from one telegram on
  one radio.** The full control chain works end-to-end: captured app protocol →
  verified codec → one BLE advertising telegram → both hubs move.
- ✅ A working **control webservice** (`bt-core/mk4web/`) with a WebSocket API and a
  **landscape dashboard GUI** served at `/dashboard` (a layout chooser is at `/`): proportional drag-joysticks + hold
  buttons, a **connection wizard** for cold-start, and an in-GUI **channel-assignment**
  settings overlay (assign function → slot/channel, per-function max speed, reverse
  trim, invert, EN/DE labels). Drive **by function**; the server resolves it against
  a **configurable channel map** (persisted default + client overrides).
- ✅ **RAW** debug layout, a layout **chooser**, a **configurable API endpoint**
  (run the client separately / in Docker), and a **two-piece split** (mandatory
  WebSocket API + optional client web page via `--ws-only` / `--http-port`).
- 🔜 Next: finish the channel→function map (sweep placeholders); slot
  auto-detection; a console/AI client; then the camera/sensor/AI phases.

---

## 2. Hardware

- **Control box:** Raspberry Pi 3B (aarch64, 1 GB RAM). Radio appliance + current
  dev box. Weak JVM build machine (Gradle ~2.5 min).
- **Radios — use the USB dongles, not the onboard BT:**
  - **hci1 = Realtek RTL8761B dongle, `00:A6:44:02:21:25`** — primary control radio.
  - **hci2 = TP-Link dongle, `6C:4C:BC:87:D0:83`** — second dongle (a single radio
    is enough for control; see §3, so hci2 is spare/optional).
  - **hci0 = onboard Broadcom UART BT, `B8:27:EB:CA:3B:93`** — **unreliable.** It
    corrupts frames in bursts *at the connect/enable transition* (the moment that
    matters). Plan: disable it with `dtoverlay=disable-bt` (SoC radio → WiFi-only).
- **Power:** must be a solid **5 V / 3 A** supply. Under-voltage caused real
  failures earlier (`vcgencmd get_throttled` showed under-voltage/throttling); a
  proper PSU was installed and fixed it. Two dongles + Pi 3 need the headroom.
- **bluetoothd must be stopped AND masked** before raw-HCI use (it is dbus/socket-
  activated and will re-grab the adapter): `systemctl mask bluetooth` + kill it.
  Raw-HCI broadcast needs root or `cap_net_raw,cap_net_admin`.

---

## 3. PROTOCOL — the big finding: MK4 12-channel NIBBLE (not MK6.0)

Our 13112 hubs use the **MK4 12-channel nibble protocol**, proven by capturing and
decoding the official **MK+tech** app's BLE adverts. This is *the* key result.

- Control = **broadcasting manufacturer-specific BLE advertising "telegrams"**,
  company id **`0xFFF0`**. No GATT connection.
- **Connect telegram (raw):** `ad ae 18 80 80 80 f3 52` (single, generic).
- **Motion telegram (raw):** `7d ae 18 <6 channel bytes> 82`.
- The 6 channel bytes hold **12 nibbles = 3 slots × 4 channels**
  (even channel = high nibble, odd = low; byte offset = `3 + ch//2`).
- **Nibble value:** `0x8` = neutral/stop; `>0x8` = one direction, `<0x8` = the other.
- **ONE telegram drives ALL hubs at once.** A hub is addressed by *which nibble
  block* moves: slot 0 = ch0–3, slot 1 = ch4–7, slot 2 = ch8–11. **No** per-device
  byte, **no** MK6 "device 0/1", **no** promotion, and **one radio is enough.**
- **value ↔ nibble map** (used by the API): `nibble = 0x8 + value`, value `-7..+7`
  → nibble `0x1..0xF` (`0`=`0x8` neutral, `+7`=`0xF`, `-7`=`0x1`).
- These are OUR hubs' *exact* captured bytes; they differ from the generic
  J0EK3R/mkconnect-python MK4 in bytes 1–2 (`ae 18` vs `7b a7`) and connect byte 6
  (`f3` vs `4f`) — a specific MK4 variant.

**Crypt (recovered + verified):** every telegram's raw bytes are wrapped by the
**MouldKingCrypt** obfuscation (fixed preamble `C1..C5`, per-byte bit-reversal,
CRC-16/CCITT poly `0x1021`, two 7-bit LFSR whitening passes seeded 63/37), then
advertised as manufacturer data. `mouldking_crypt.py` implements `encode()`/
`decode()` and **reproduces the app's captured bytes exactly** (13/13 self-tests).
The decoder is what let us read the app's adverts and discover the MK4 model. APK
analysis: `bt-core/reference/MKtech_reverse_engineering_report.md`.

### The MK6.0 detour (why it was wrong — do not repeat)
We spent a long time on J0EK3R/mkconnect-python's **MK6.0 per-device model**
(`0x61`/`0x62` first byte = "device 0/1", a `6d 7b a7 …` connect, binding a hub to
"device 1" by button promotion). Single-hub MK6.0 telegrams *did* move a hub, so it
looked right — but **two-hub addressing via `0x62`/device-1 never worked**, because
our hubs don't use that model. The app capture settled it: they're **MK4 nibble**.
All MK6.0 "device-1 / promotion" guidance is **SUPERSEDED**.

---

## 4. Slots & hub LED

- A hub's **slot** (which 4-nibble block it obeys) is selected by its **physical
  button**: **one flash = slot 0, two = slot 1, three = slot 2** (cycles/wraps).
- **Slot resets to slot 0 on power-cycle.** For multi-hub control the hubs must be
  on **different** slots — currently a **guided manual** step (the GUI walks it).
- **LED meanings (operator observation; the service can't see the LED):**
  - **long single flash** = idle / powered, not yet connected;
  - **fast flash** = connected (receiving the connect telegram);
  - **fast double flash** = slot 1 (after one button press while connected).

---

## 5. Channel map — now DATA (configurable), not hardcoded

The map of **function → (slot, channel)** is **data**: a persisted default in
[`config/channel_map.json`](../config/channel_map.json), editable live in the GUI
(see §6). The server has **no hardcoded toy knowledge** — it resolves a `drive`
command's function against the active map. Six functions: `left_track`,
`right_track`, `arm_lift`, `front_arm`, `rotation`, `bucket`. Per function:
`{slot 0-2, channel 0-3, invert, max (1-7), reverse_scale, label_en, label_de}`.
**(slot, channel)** is within-slot; the global nibble index = `slot*4 + channel`.

**Current default** (function → assignment). Only `bucket` and `left_track` are
**transmit-confirmed**; the rest are placeholders to be swept/confirmed:

| Function | Slot | Ch | Global nib | invert | Status |
|----------|------|----|-----------:|--------|--------|
| **bucket** (shovel) | 0 | 0 | ch0 | – | ✅ CONFIRMED (moved @ 0xb / 0x5) |
| arm_lift | 0 | 1 | ch1 | – | placeholder |
| rotation | 0 | 2 | ch2 | – | placeholder |
| front_arm | 0 | 3 | ch3 | – | placeholder |
| **left_track** | 1 | 0 | ch4 | **true** | ✅ CONFIRMED (moved @ 0xb) |
| right_track | 1 | 2 | ch6 | – | placeholder |

**Two-hub simultaneous CONFIRMED (2026-06-16):** one telegram with `ch0=0xb` (arm
box → shovel) **and** `ch4=0xb` (track box → left track) moved both at once on hci1.

- **`invert`** negates a function's value (flip a motor's direction).
- **`reverse_scale`** (default `1.0` = identity) is a **reverse-speed trim** applied
  at resolution: the nibble map (`0x8 + value`) is byte-symmetric (verified against
  the app capture and the mkconnect encoder: `0xFF` fwd / `0x00` rev / `0x80` stop),
  so any forward/reverse *speed* difference is the **hub PWM curve / motor**, not the
  encoding. `reverse_scale > 1` boosts reverse magnitude to match forward; calibrate
  by driving. **`max`** caps a function's full-deflection speed (joystick scaling).
- **device-0/1 swap** (session-only, not persisted) swaps slots 0↔1 at resolution.

> Reconciliation: `bt-core/reference/channel_map.md` and `…/CONNECT_PROCEDURE.md`
> are the protocol-level snapshots (nibble↔global-channel). **This file is
> canonical** for the function map; if they ever drift, trust PROJECT.md.

---

## 6. Architecture

The real, working control stack is **`bt-core/mk4web/`** (Python). Two processes
over a local Unix socket (`/tmp/moldqueen_mk4.sock`):

- **broadcaster** (`mk4web/broadcaster.py`) — owns the radio + the authoritative
  12-nibble state; lifecycle **IDLE → CONNECTING → READY**; broadcasts one MK4
  telegram reflecting state (~5/sec keepalive). **Safety:** API gone → IDLE/neutral.
- **API** (`mk4web/api.py`) — the **WebSocket API is the product** (`:8765`, always
  on). Serving the client web page (`:8080`) is **OPTIONAL**: on by default, disabled
  with `--ws-only` / `--no-client` / `MK4_SERVE_CLIENT=0` (no HTTP server opened);
  `--http-port N` (CLI > `MK4_HTTP_PORT`) overrides the page port. Owns/drives the
  lifecycle; maps `value→nibble`;
  holds the **channel map** (persisted default + session active + device-swap) and
  **resolves `drive` by function → (slot, channel, value)** via `channelmap.py`
  (applying invert + device-swap + reverse_scale) — the broadcaster stays dumb.
  **Safety:** client disconnect / no clients → NEUTRAL. Reuses `mouldking_crypt.py`.
- **Channel map** (`mk4web/channelmap.py` + `config/channel_map.json`) — load /
  validate / save / resolve. **No hardcoded toy knowledge.** The client owns the
  **active** map (default + its overrides) and **pushes it on every connect**;
  `promote` persists it as the new default. Validation rejects duplicate
  `(slot, channel)` pairs.
- **Layouts + chooser.** `/` serves a **layout chooser** (`mk4web/web/chooser.html`)
  — pluggable cards (Excavator → `/dashboard`, RAW → `/raw`, "bring your own") that
  remember the last pick; an **About** overlay (disclaimer, credits, licensing, AI
  note, author). `/raw` (`raw.{html,js,css}`) is a **RAW debug** layout: a
  protocol-level test bench over the low-level `set`/`stop` path — pick 1-3 slots,
  set each channel directly, build + send the telegram, and a console logs the exact
  bytes (raw + on-air AD). All clients share `clientconfig.js` (the configurable WS
  endpoint, persisted in localStorage — so a client can be served anywhere and
  pointed at the Pi; see "Two-piece split" below + [`REMOTE_CLIENT.md`](REMOTE_CLIENT.md)).
- **Dashboard** (`mk4web/web/dashboard.{html,js,css}`, served at `/dashboard`) — the
  main driving GUI, the first client of the API. Laid out over an HMI
  background (`assets/moldqueen_dashboard_v2.png`,
  [`docs/mould_king_13112_hmi_layout_spec.md`](mould_king_13112_hmi_layout_spec.md))
  with percent coordinates:
  - **Controls bind to FUNCTIONS** (not raw channels) via the active map. Tracks +
    arm-lift + front-arm are **proportional drag joysticks** (drag = speed up to the
    function's `max`, release snaps to NEUTRAL); rotation + bucket are press-and-hold
    buttons. Nothing latches.
  - **Connection wizard** — a centered modal walking cold-start to READY (power on →
    connect → assign slots → ready), with real **LED-flash GIFs** per step
    (`assets/{long_flash,short_flash,double_short_flash}.gif`), EN/DE text.
  - **Settings** — a centered overlay = the channel-assignment tool: drag/Test a
    control, see which motor moves, set slot/channel + max + reverse-trim + invert;
    a separate **Labels** page (EN/DE); **Save** (session) / **Promote** (default) /
    Reset; session **device-0/1 swap**. Test pulses the *in-progress* edit (raw set).
  - **Responsive shell** — viewport-sized (`100dvh`); menu is a **top bar on wide
    screens, a left sidebar on small ones** (portrait *and* landscape); the stage
    contain-fits the remaining space (STOP + fullscreen always reachable). **EN/DE**
    toggle. *(The old dummy simple page is retired; a RAW slot/channel page is planned.)*
- **AsyncAPI spec** (`mk4web/asyncapi.yaml`, served at `GET /asyncapi.yaml`)
  documents the WS protocol (setup / set / **drive** / stop / state / **map** + the
  pushed lifecycle / state / map / mapresult, incl. `max`/`reverse_scale`/device-swap);
  verified to match `api.py`.
- **Two-piece split (server vs client).** The **WebSocket API is mandatory** (owns
  the radio, always on). Serving the client web page is **OPTIONAL**: on by default;
  `--ws-only` / `--no-client` / `MK4_SERVE_CLIENT=0` runs the WebSocket only (no HTTP
  server); `--http-port N` (CLI > `MK4_HTTP_PORT`) overrides the page port. So you can
  (a) let the API serve the page, (b) serve the client elsewhere — script or the
  client-only **Docker** image ([`../Dockerfile.client`](../Dockerfile.client)) — and
  point it at the Pi via the in-app endpoint, or (c) bring your own WebSocket client.
  Details: [`REMOTE_CLIENT.md`](REMOTE_CLIENT.md), CORS/WS-origin permissive for LAN.

**`java-core/`** (Java/Gradle scaffold) is **empty** beyond a placeholder + passing
test. The original idea (java-core builds telegrams, bt-core re-broadcasts) was
**superseded** — telegram building lives in Python (`mouldking_crypt.py`). **Decision
needed:** either repurpose java-core as a future **API client** (a JVM "brain") or
**retire it**. It is NOT on the control path.

`web-gui/` (the original minimal Node scaffold) is also superseded by `mk4web`'s
own served page; retire or repurpose later.

---

## 7. How to run

From `bt-core/` in the venv (`source .venv/bin/activate`):

```bash
# DRY-RUN (logs telegrams, transmits NOTHING — always start here):
python -m mk4web.broadcaster --dry-run     # terminal 1
python -m mk4web.api                         # terminal 2  →  http://<pi-ip>:8080/

# LIVE (drives hci1; needs hci1 UP + bluetoothd masked; broadcaster needs sudo):
sudo python -m mk4web.broadcaster            # starts IDLE — no transmit until "Connect"
python -m mk4web.api                          # WS :8765 + client page :8080 (default)
python -m mk4web.api --ws-only                # WS :8765 only — no web page (BYO client)
python -m mk4web.api --http-port 9000         # serve the page on :9000 instead
```
The **WebSocket API (required)** and **client web page (optional)** are separable:
see README → "API server (required) + client UI (optional)". Ports/HCI/etc. are
env-overridable (`MK4_HCI`, `MK4_HTTP_PORT`, `MK4_WS_PORT`, `MK4_SERVE_CLIENT`, …;
see `mk4web/config.py`).

**Cold-start GUI flow** — open the **dashboard** at `http://<pi-ip>:8080/` and press
**Connect** to launch the wizard:
1. Power on both hubs (each shows one long flash) → **Next**.
2. *Connecting…* — broadcaster sends the connect telegram; both hubs fast-flash.
3. Button **one** hub to **two** fast flashes (→ slot 1); leave the other on one
   (→ slot 0). (Different slots are required.)
4. **Ready** → controls unlock, wizard closes. Drag a joystick (release → neutral),
   hold rotation/bucket; **STOP** (or Space/Esc) = all neutral. Disconnect/close →
   auto-neutral. Assign functions to channels in **Settings**.

(The launcher `scripts/start.sh` does the preflight + starts both processes.)

---

## 8. Open problems / next steps

- **RAW page + configurable API endpoint — PLANNED.** The retired simple page is to
  be replaced by a dedicated **RAW** slot/channel page; expose a configurable API
  endpoint alongside it.
- **Finish the channel map** — sweep the placeholder channels (slot-0 ch1–3, slot-1
  ch1/ch3+) and confirm each function by driving it via Settings → Test.
- **Reverse-speed calibration** — `reverse_scale` defaults to identity; measure the
  forward-vs-reverse ratio per track and set the trim so speeds match.
- **Slot auto-detection — UNSOLVED.** Slots are set by physical button and reset on
  power-cycle; today the **wizard** guides it manually. No telegram-only way yet.
- **Box identity — UNSOLVED UX.** Which physical box is on which slot is operator
  knowledge; the map labels by function (EN/DE) but the operator still wires it.
- **Console / AI client of the WS API** — intended, not built. (The API is ready:
  `drive` by function + `map` management are documented in `asyncapi.yaml`.)
- **Hardware:** disable onboard BT (`dtoverlay=disable-bt`, needs reboot); keep the
  5 V/3 A PSU; hci2 (TP-Link) is spare for control.
- **Retire/repurpose** `java-core/` and `web-gui/` (see §6).
- **Future phases:** camera, TOF sensor, local AI brain (driving via the WS API).

---

## 9. Where things live

```
moldqueen/
├── docs/PROJECT.md            # THIS FILE — canonical
│   └── mould_king_13112_hmi_layout_spec.md   # dashboard layout coordinates
├── CLAUDE.md                  # terse must-knows (points here)
├── config/channel_map.json    # persisted DEFAULT channel map (function → slot/channel/…)
├── assets/                    # moldqueen_banner.png, moldqueen_icon.png, excavator_icon.png, moldqueen_dashboard_v2.png, wizard/
├── scripts/                   # start.sh / check.sh (preflight + launch)
├── bt-core/
│   ├── CLAUDE.md              # bt-core must-knows
│   ├── mk4web/                # the control webservice
│   │   ├── broadcaster.py  api.py  telegram.py  channelmap.py  mouldking_crypt.py  config.py
│   │   ├── asyncapi.yaml      # WS API contract (served at /asyncapi.yaml)
│   │   └── web/{chooser.html, dashboard.*, raw.*, clientconfig.js}   # chooser (/), dashboard (/dashboard), RAW (/raw)
│   └── reference/             # verified snapshots: CONNECT_PROCEDURE.md, channel_map.md,
│                              #   mouldking_crypt.py, mk4_test.py, MKtech_reverse_engineering_report.md
├── java-core/                 # empty Java scaffold — future API client OR retire
└── web-gui/                   # original Node scaffold — superseded by mk4web's dashboard
```

Other docs: [`QUICKSTART.md`](QUICKSTART.md) (boxes → driving),
[`REMOTE_CLIENT.md`](REMOTE_CLIENT.md) (run the client separately),
[`ADDING_A_LAYOUT.md`](ADDING_A_LAYOUT.md) (contribute a layout/toy — generic path
is clean, function-mapped is core-coupled), [`PORTING.md`](PORTING.md) (other
boards / containers — the radio core is hardware-bound).

Scratch working copies live outside the repo in `~/scratch/mk-refs/` (the
`mkconnect-python` reference clone, the test tools, capture parsers). Not version-
controlled; the repo's `bt-core/reference/` holds the durable snapshots.
