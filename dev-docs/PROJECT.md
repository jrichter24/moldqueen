# moldqueen — project document (canonical reference)

> This is the authoritative project document. Where any other doc (the CLAUDE.md
> files, or the snapshots in `linux-core/reference/`) disagrees, **this file wins.**
> Last major update: 2026-06-29 (the **ESP32 binary/release pipeline is shipped** —
> `.github/workflows/esp32-release.yml` builds one flashable `.bin` on `esp-v*` tags, and
> **`esp-v0.1.0` is published**; the next ESP32 item is serve-client-from-flash. Prior
> milestone: the **esp32-core** is a usable standalone appliance — WiFi provisioning, mDNS
> discovery `moldqueenesp.local`, a management page on :8080, all hardware-verified; **Pi mDNS
> `moldqueenrasp.local` shipped** for linux-core; signed Android releases v0.1.0-v0.1.2;
> F-Droid MR !41291 under maintainer review; §1/§6b/§8 reconciled to the release-pipeline
> milestone).

---

## 1. Overview

**Goal:** control a **Mould King 13112 RC excavator** (a Lego-like building-block
model with two stock battery/Bluetooth hubs) from a Raspberry Pi, and later add a
camera, a TOF sensor, and a local AI "brain" that drives it through the same API.

**Status:**
- ✅ **Core goal achieved** — **two hubs driven simultaneously from one telegram on
  one radio.** The full control chain works end-to-end: captured app protocol →
  verified codec → one BLE advertising telegram → both hubs move.
- ✅ A working **control webservice** (`linux-core/mk4web/`) with a WebSocket API and a
  **landscape dashboard GUI** served at `/excavator` (a layout chooser is at `/`): proportional drag-joysticks + hold
  buttons, a **connection wizard** for cold-start, and an in-GUI **channel-assignment**
  settings overlay (assign function → slot/channel, per-function max speed, reverse
  trim, invert, EN/DE labels). Drive **by function**: the **smart client** resolves it
  against a **configurable channel map it owns** (shipped default + client overrides) and
  sends raw `set` — the server is **thin transport**.
- ✅ **RAW** debug layout, a layout **chooser**, a **configurable API endpoint**
  (run the client separately / in Docker), and a **two-piece split** (mandatory
  WebSocket API + optional client web page via `--ws-only` / `--http-port`).
- ✅ **Pluggable layouts**: a `layouts.json` manifest, **server-derived `/<id>`
  routes**, **per-layout function maps**, an `active`/`category` schema, a copyable
  **inactive template**, and a shared **`shell.css`**. Radio behind a backend
  abstraction with **rawhci** (raw HCI socket, no hcitool) the default. Tiered
  **server-info** over the WS (`{cmd:info}`) + a client readout.
- ✅ **Three radio cores behind one WS contract** — the Pi (`linux-core`), Android
  (`android-core`), and now a working **ESP32-S3** (`esp32-core`, drives a real toy over
  WiFi today; see §6b) — all consuming the **same single-source client**.
- ✅ **Shipped:** signed Android releases **v0.1.0 / v0.1.1 / v0.1.2** via the gated CI
  release workflow (package `io.github.jrichter24.moldqueen`); F-Droid MR **!41291** is
  open and under maintainer review.
- ✅ **Pi mDNS shipped** — linux-core now advertises **`moldqueenrasp.local`** (additive
  avahi alias via `scripts/mdns.sh`, wired into `scripts/start.sh`; optional
  `scripts/moldqueen-mdns.service`), mirroring the ESP32's `moldqueenesp.local`.
- ✅ **ESP32 binary/release pipeline shipped** — `.github/workflows/esp32-release.yml`
  builds one flashable `.bin` (merged bootloader + partition-table + app, flashed at `0x0`)
  on **`esp-v*`** tags, version from the tag; **`esp-v0.1.0` is published** (asset
  `moldqueen-esp32-esp-v0.1.0.bin`). See §6b.
- 🔜 Next: finish the channel→function map (sweep placeholders); slot
  auto-detection; esp32-core — serve-client-from-flash; a console/AI client; then the
  camera/sensor/AI phases.

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
analysis: `linux-core/reference/MKtech_reverse_engineering_report.md`.

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

## 5. Channel map — DATA, now PER-LAYOUT (not hardcoded, not global)

The map of **function → (slot, channel)** is **data**, owned **per layout**, and lives
**on the client**. Each function-mapped layout declares its **function set** in the
manifest (`web/layouts.json`) and ships a default at
[`client/web/channel_map.<id>.json`](../client/web/channel_map.excavator.json) — the
excavator's is [`channel_map.excavator.json`](../client/web/channel_map.excavator.json).
There is **no hardcoded function list** — the client's resolver is parameterized by the
active layout's function set, and `resolve` just looks a function up in the map. The
server never sees the map (it is **thin transport** — raw `set` only).
The excavator's six functions: `left_track`, `right_track`, `arm_lift`, `front_arm`,
`rotation`, `bucket`. Per function: `{slot 0-2, channel 0-3, invert, max (1-7),
reverse_scale, label_en, label_de}`. **(slot, channel)** is within-slot; the global
nibble index = `slot*4 + channel`. A layout with no functions (RAW) uses none of this.

**Current default** (function → assignment). `bucket`, `left_track`, `arm_lift`,
`front_arm` are **transmit-confirmed**; `rotation`/`right_track` are placeholders to
be swept/confirmed:

| Function | Slot | Ch | Global nib | invert | Status |
|----------|------|----|-----------:|--------|--------|
| **bucket** (shovel) | 0 | 0 | ch0 | – | ✅ CONFIRMED (moved @ 0xb / 0x5) |
| **arm_lift** | 0 | 3 | ch3 | – | ✅ CONFIRMED (hardware test 2026-06-17) |
| rotation | 0 | 2 | ch2 | – | placeholder |
| **front_arm** | 0 | 1 | ch1 | – | ✅ CONFIRMED (hardware test 2026-06-17) |
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
  by driving. **`max_fwd` / `max_rev`** cap full-deflection speed per direction (1–7);
  **both default to 5** (gentle, controllable, anti-stall) — raise per-channel in the
  Channels tab. (Legacy single `max` migrates to both.)
- **device-0/1 swap** (session-only, not persisted) swaps slots 0↔1 at resolution.

> Reconciliation: `linux-core/reference/channel_map.md` and `…/CONNECT_PROCEDURE.md`
> are the protocol-level snapshots (nibble↔global-channel). **This file is
> canonical** for the function map; if they ever drift, trust PROJECT.md.

---

## 6. Architecture

The real, working control stack is **`linux-core/mk4web/`** (Python). Two processes
over a local Unix socket (`/tmp/moldqueen_mk4.sock`):

- **broadcaster** (`mk4web/broadcaster.py`) — owns the radio + the authoritative
  12-nibble state; lifecycle **IDLE → CONNECTING → READY**; broadcasts one MK4
  telegram reflecting state (~5/sec keepalive). **Safety:** API gone → IDLE/neutral.
  The radio sits behind a small **`RadioBackend`** abstraction (three ops: set adv
  params / set adv data / enable adv). Two backends, picked by **`MK4_RADIO_BACKEND`**
  (or `--radio-backend`): **`rawhci`** (**DEFAULT** — the *same* HCI commands over a raw
  `AF_BLUETOOTH`/`BTPROTO_HCI` socket, **no hcitool**, future-proof against hcitool's
  deprecation in BlueZ 5.64+; now **hardware-proven**, needs root/CAP_NET_RAW) and
  **`hcitool`** (**legacy** fallback — shells out to hcitool, unchanged commands/bytes).
  Unknown/unset → rawhci. In `--dry-run` the `rawhci` backend prints the exact HCI
  packets it *would* send; dry-run telegram bytes are identical regardless of backend.
- **API** (`mk4web/api.py`) — the **WebSocket API is the product** (`:8765`, always
  on). Serving the client web page (`:8080`) is **OPTIONAL**: on by default, disabled
  with `--ws-only` / `--no-client` / `MK4_SERVE_CLIENT=0` (no HTTP server opened);
  `--http-port N` (CLI > `MK4_HTTP_PORT`) overrides the page port. Owns/drives the
  lifecycle; takes raw `set {slot, channel, value}`, maps `value→nibble`, crypts, and
  hands it to the broadcaster. It is **thin transport**: it holds **no** channel map and
  resolves **nothing** (no functions, invert, caps, device-swap, or labels) — the **smart
  client** owns all of that and sends only raw `set`.
  **Safety:** client disconnect / no clients → NEUTRAL. Reuses `mouldking_crypt.py`.
  Also answers **`{"cmd":"info"}`** with a tiered **server-info** message over the WS
  (works in `--ws-only`): **`MK4_INFO_LEVEL`** / `--info-level` = `safe` (app/version/
  lifecycle), `light` (DEFAULT; + backend/dry_run/hci/ports, no MAC) or `debug`
  (+ MAC/hostname/paths/bluetoothd). Unknown → light.
  > **Version note:** the `version` reported here (from `mk4web/config.py`'s `VERSION`) is the
  > **WS-contract / server** version and is **intentionally decoupled** from the app-release
  > versions (the signed Android releases v0.1.x). They track different things — the WS
  > protocol/server vs the shipped app — so a mismatch is **by design, not drift.**
  > **ESP32 has two distinct version surfaces (by design):** its **management page** shows a
  > **git-describe firmware version** (e.g. `v0.1.2-NN-gSHA`, via `esp_app_get_description`),
  > while its **WS `info.version`** is the literal marker **`esp32-core`** — the firmware
  > build identity vs the WS-contract marker, not a mismatch.
- **Channel map (client-side)** — per-layout `client/web/channel_map.<id>.json` shipped
  default + the **active** map (default + the client's overrides), persisted in the
  browser; `promote` saves it as the new default. The **smart client** loads / validates /
  resolves it (rejecting duplicate `(slot, channel)` pairs) and sends raw `set`. **No
  hardcoded toy knowledge anywhere — and the server never sees the map.**
- **Layouts + manifest + chooser.** Layouts are declared in **`client/web/
  layouts.json`** (single source of truth): per entry `{id, name, description, icon,
  kind: function-mapped|generic|placeholder, category, active, functions?, files}`.
  The **server DERIVES each route as `/<id>`** (not a manifest field; title is
  display-only) and serves the files by filename; `active:false` hides a layout
  entirely (no route, no card). `/` serves a **layout chooser** (`chooser.html`) whose
  cards are built from the (active) manifest — Excavator → `/excavator`, the **generic**
  controllers (12-axis → `/generic_12axis`, brick → `/generic_brick`), RAW → `/raw`, and a
  "bring your own" placeholder — remembering the last pick; an **About** overlay
  (disclaimer, credits, licensing, AI note, author). `/raw` (`raw.{html,js,css}`) is a
  **RAW debug** layout over the low-level `set`/`stop` path (pick 1-3 slots, set
  channels, build + send, console logs raw + on-air AD). A **TEMPLATE** layout ships
  `active:false` (`template.{html,js,css}` + `client/web/channel_map.template.json`, one
  function) as a copyable function-mapped starter — see
  [`ADDING_A_LAYOUT.md`](ADDING_A_LAYOUT.md). Every layout gets the shared chrome/runtime
  **MK4Chrome** (`chrome.js` + `chrome.css`: menu, tabbed settings, connect wizard, status
  light, language picker, keyboard STOP, gamepad path) over the shared shell CSS
  **`shell.css`** (each layout links `shell.css` + `chrome.css` + its own css). The
  model-agnostic **generic** layouts (12-axis, brick) share one engine (`generic.js`) and
  map themselves to any twelve-motor toy via a guided **auto-assign**. `clientconfig.js` is the
  configurable WS endpoint (persisted in localStorage — serve a client anywhere and
  point it at the Pi; see "Two-piece split" below + [`REMOTE_CLIENT.md`](REMOTE_CLIENT.md)).
- **Dashboard** (`client/web/dashboard.{html,js,css}`, served at `/excavator`) — the
  main driving GUI, the first client of the API. Laid out over an HMI
  background (`client/assets/moldqueen_dashboard_v3.png`,
  [`dev-docs/mould_king_13112_hmi_layout_spec.md`](mould_king_13112_hmi_layout_spec.md))
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
    toggle. *(The old dummy simple page is retired; the **RAW** layout (`/raw`) is the slot/channel test bench.)*
- **AsyncAPI spec** (`mk4web/asyncapi.yaml`, served at `GET /asyncapi.yaml`)
  documents the **thin-transport** WS contract — client→server `setup` / `set` / `stop` /
  `state` / `info`, and the pushed `lifecycle` / `state` / `info`. The server resolves
  nothing: the client maps function→(slot,channel,value) and sends raw `set`. Verified to
  match `api.py`.
- **Two-piece split (server vs client).** The **WebSocket API is mandatory** (owns
  the radio, always on). Serving the client web page is **OPTIONAL**: on by default;
  `--ws-only` / `--no-client` / `MK4_SERVE_CLIENT=0` runs the WebSocket only (no HTTP
  server); `--http-port N` (CLI > `MK4_HTTP_PORT`) overrides the page port. So you can
  (a) let the API serve the page, (b) serve the client elsewhere — script or the
  client-only **Docker** image — and point it at any core via the in-app endpoint, or (c)
  bring your own WebSocket client. The client-only image is **published + public** at
  `ghcr.io/jrichter24/moldqueen-client` (tags `:latest` / `:0.1.0`,
  [package page](https://github.com/jrichter24/moldqueen/pkgs/container/moldqueen-client)),
  the realized "no-Python, one-command" client-hosting option the split always envisioned;
  it is still built from [`../Dockerfile.client`](../Dockerfile.client). It serves over
  `http://localhost`, so it can reach a `ws://` LAN core (same-protocol, no mixed-content
  block); that is local hosting, distinct from an https Pages client which a browser would
  block from a `ws://` core. Details: [`REMOTE_CLIENT.md`](REMOTE_CLIENT.md), CORS/WS-origin
  permissive for LAN.

The retired **`java-core/`** (Java/Gradle scaffold) and **`web-gui/`** (minimal Node
scaffold) were **removed**. Telegram building lives in Python (`mouldking_crypt.py`),
not Java; the UI is the independent `client/`, served by `mk4web` — so neither scaffold
was on the control path. (A future JVM "API client" / "brain," if ever wanted, would be
a fresh client of the WebSocket contract, not a revival of `java-core`.)

### 6a. Safety / STOP architecture (verified on Pi + S25, 2026-06-20)

The control radio is **broadcast advertising that REPEATS the last held state forever**
(the broadcaster keepalive re-emits the held 12 nibbles continuously, ~10/s). Everything
below follows from that fact — a motor keeps moving as long as a non-neutral frame is the
held/repeated state, so safety = **make the held state neutral**, not "send a zero once."

- **Held-state, not one-shot.** A release MUST update the broadcaster's **held nibble** to
  neutral (Pi `Controller.set_nibbles`; Android `RadioController` nibbles + advertise). A lone
  `cmd:set 0` that the held state doesn't absorb is overwritten by the next keepalive repeat.
- **Affirmative motion-keepalive.** The CLIENT re-sends each active **non-neutral** channel
  ~10/s; the SERVER **per-channel auto-neutralizes** any channel not refreshed within ~300 ms.
  One mechanism covers gamepad death, frozen axis, stalled loop, and dead client — there is **no
  blind heartbeat** (the refresh IS the liveness signal). Held controls keep refreshing, so they
  are not falsely stopped.
- **STOP = KILL + RECONNECT at neutral** (never "send a zero"). Pi: `cmd:stop` → IPC
  `{killreconnect}` → advertiser OFF → connect telegram → all-neutral motion. Android:
  `radio.hardStop()` tears down the advertiser then re-establishes connect → neutral. The
  client STOP is an **absolute latch** — nothing re-drives (refresher, held touch, gamepad)
  until a fresh deliberate input — and it disables the gamepad.
- **Android advertiser = `AdvertisingSet`.** Legacy `startAdvertising` can't change data in
  place, so stop/start **per payload change** dropped frames (`ALREADY_STARTED`) *and* gapped
  the carrier (hub starves → slow-flash disconnect). Fix: start the set **once** and update via
  **`AdvertisingSet.setAdvertisingData()` IN PLACE** on the continuously-running advertiser;
  **only STOP tears down** (`BleBroadcaster`). The Pi (raw-HCI `set_data`) overwrites the adv-data
  register in place and never had this problem.
- Gamepad disconnect is detected by **absence / `connected:false`** (a dying battery drifts —
  do NOT rely on a "frozen axis" heuristic). The Android APK stamps an auto-increment **build
  number** into `versionName` (`+build.N`) and Server-info so the running build is verifiable.

### 6b. esp32-core — the third radio core (WORKING, drives toys over WiFi today)

[`esp32-core/`](../esp32-core/) is a **third radio core**, a peer to `linux-core` (Pi) and
`android-core`: a standalone **ESP32-S3** (no Pi, no phone) that runs the MK4 advertiser **and**
the same thin-transport WebSocket API, consuming the **same single-source client**. It is a
**usable standalone appliance** — hardware-confirmed: the **unmodified** client drove a **real
toy over WiFi**, reached by name over a self-provisioned WiFi join, with no creds baked in.
The four control slices, all hardware-proven:

1. **Clean-room C `MouldKingCrypt` port** — a from-scratch C implementation of the same crypt
   (preamble / bit-reversal / CRC-16-CCITT / dual LFSR whitening), **byte-exact** against the
   Python reference (9/9 on-device self-tests). Same "don't reinvent the crypt" rule —
   it reproduces the verified bytes, not a new scheme.
2. **NimBLE `0xFFF0` advertiser** — broadcasts the MK4 telegrams (company `0xFFF0`) via
   **legacy** advertising, updating the running advertiser **IN PLACE** with
   **`ble_gap_adv_set_data`** (no stop/start). Legacy is deliberate: **extended** advertising
   returned `EBUSY` runaways while active, so the core holds one legacy advertiser and overwrites
   its data register — the ESP32 analogue of the Pi's raw-HCI `set_data` and Android's
   `AdvertisingSet.setAdvertisingData()`.
3. **Auto-neutral keepalive + STOP** — the same safety model: a **300 ms per-channel** keepalive
   re-asserts neutral on any channel not refreshed in time, and **STOP = kill the advertiser +
   reconnect at neutral** (not "send a zero").
4. **WiFi WebSocket server on `:8765`** — **mirrors `api.py`'s thin-transport contract**:
   client→server `setup` / `set` / `stop` / `state` / `info` and pushed `lifecycle` / `state` /
   `info`; it holds **no** channel map (the smart client resolves everything). Server-info reports
   `radio_backend = esp32-nimble`.

On top of those four, the board is now **self-provisioning and self-managing** (all
hardware-verified):

5. **WiFi provisioning (no creds baked in)** — credentials live in **NVS** (flash, never in
   git or the binary). Boot logic: **force-AP flag / no creds / a 30 s station connect-timeout
   → provisioning AP**, else station → normal op. The fallback is an open SoftAP
   **`moldqueen-setup`** at **`192.168.4.1`**. So the firmware is **distributable** — anyone
   flashes the same binary and enters their own WiFi.
6. **Group A — discovery + a branded bilingual setup page.** The provisioning page at
   `http://192.168.4.1/` is **self-contained and offline** (the MoldQueen icon inlined as
   base64, CSS/JS inlined, **EN/DE** i18n). It shows a **scanned-network list with signal
   strength** (tap to fill the SSID), a **show-password** toggle, a **configurable WS port**,
   and **copy buttons** for the device MAC and the resulting `ws://moldqueenesp.local:<port>`
   endpoint; on save it stores creds + port to NVS, shows a matching branded **Saved** page,
   and reboots into station mode. In normal op the board advertises **mDNS** (hostname
   **`moldqueenesp`**, a `_ws._tcp` service on the configured port) so the client uses
   **`ws://moldqueenesp.local:<port>`** instead of an IP — proven end-to-end (the client drives
   via the `.local` name).
7. **Group B — a device management page** at **`http://moldqueenesp.local:8080`** (normal op),
   branded + bilingual + favicon: cards for live **status** (IP/MAC/SSID/signal/uptime/firmware/
   WS endpoint, with copy buttons for the endpoint, the management URL, the IP and the MAC),
   **restart**, **switch-to-setup**, and **change-network** (scan + new creds → reboot to the new
   network, with the boot logic's AP fallback so bad creds never brick it). **Unauthenticated +
   LAN-only by design**, consistent with the unauthenticated WS API.

> **Decision — re-provision trigger: software, not hardware.** A **physical** re-provision
> trigger (a double-reset / BOOT-hold to force the setup AP) was evaluated and **DROPPED as
> unreliable on this board**: GPIO0 is the boot strap (BOOT-hold drops the chip into ROM
> download mode) and the EN-pin reset clears RTC memory, so neither an RTC- nor an NVS-flag
> double-reset detected the EN double-tap cleanly. It was **replaced by a software
> switch-to-setup** — a **one-shot NVS force-AP flag** that the boot logic checks (set from the
> management page); the next boot enters provisioning. The board also re-enters provisioning
> **automatically** when the saved network is unreachable.

**Components** (seven) live in `esp32-core/components/{mouldking_crypt, mk4_advertiser,
mk4_wifi, mk4_ws_server, mk4_provision, mk4_mgmt, mk4_webui}` + `main/` (`mk4_webui` holds the
shared web-UI assets so the provisioning pages and the management page render as one product).
**Target:** ESP32-S3 **N16R8**, **ESP-IDF v5.5.4**.

**Pi mDNS — SHIPPED.** linux-core now advertises **`moldqueenrasp.local`** (an additive
`avahi-publish` alias via `scripts/mdns.sh`, wired into `scripts/start.sh`; optional
`scripts/moldqueen-mdns.service` to survive reboot), mirroring this ESP32's
`moldqueenesp.local` — no system-hostname rename, graceful no-op without `avahi-utils`.

**Binary/release pipeline — SHIPPED.** `.github/workflows/esp32-release.yml` (on main)
triggers on **`esp-v*`** tags, builds in `espressif/idf:v5.5.4`, and merges
**bootloader + partition-table + app into one flashable `.bin`** (flash the whole image at
offset `0x0` — `esptool.py --chip esp32s3 write_flash 0x0 moldqueen-esp32-<tag>.bin`). The
**version is derived from the tag** (`esp-v0.1.0` → `0.1.0` via `MK_PROJECT_VER`,
parity-checked) and the **prerelease flag keys off the stripped version** (a dry-run
`esp-v0.1.0-rc1` caught + fixed a prerelease bug first). First real release: **`esp-v0.1.0`**,
a FULL release, asset **`moldqueen-esp32-esp-v0.1.0.bin`** (~1.14 MB):
<https://github.com/jrichter24/moldqueen/releases/tag/esp-v0.1.0>.

**Remaining (honestly not-done):** **serving the client from flash** (today the client is
served elsewhere and pointed at the ESP32's WS endpoint) — the next ESP32 item.

---

## 7. How to run

From `linux-core/` in the venv (`source .venv/bin/activate`):

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
env-overridable (`MK4_HCI`, `MK4_RADIO_BACKEND`, `MK4_INFO_LEVEL`, `MK4_HTTP_PORT`, `MK4_WS_PORT`, `MK4_SERVE_CLIENT`, …;
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

- ✅ **RAW page + configurable API endpoint — SHIPPED.** The retired simple page was
  replaced by the dedicated **RAW** slot/channel layout (`/raw`), and the configurable WS
  endpoint (`clientconfig.js`, persisted in localStorage) ships alongside it — see §6.
- **esp32-core (third radio core) — a usable standalone appliance.** The four control slices
  (clean-room C crypt, NimBLE `0xFFF0` in-place advertiser, 300 ms keepalive + STOP, WiFi WS
  server mirroring `api.py`) **plus** WiFi provisioning (NVS creds, no creds baked in, fallback
  `moldqueen-setup` AP), mDNS discovery (`moldqueenesp.local`), and the management page
  (`moldqueenesp.local:8080` — status/restart/switch-to-setup/change-network) are **done and
  hardware-proven** (drives a real toy over WiFi with the unmodified client, reached by name;
  see §6b). **Pi mDNS is also shipped** (`moldqueenrasp.local` for linux-core — additive avahi
  alias via `scripts/mdns.sh`/`start.sh`), and the **binary/release pipeline is shipped** too
  (`.github/workflows/esp32-release.yml` builds one flashable `.bin` on `esp-v*` tags;
  **`esp-v0.1.0` published**). **Remaining:** serve-client-from-flash.
- **Finish the channel map** — sweep the placeholder channels (slot-0 ch1–3, slot-1
  ch1/ch3+) and confirm each function by driving it via Settings → Test.
- **Reverse-speed calibration** — `reverse_scale` defaults to identity; measure the
  forward-vs-reverse ratio per track and set the trim so speeds match.
- **Slot auto-detection — UNSOLVED.** Slots are set by physical button and reset on
  power-cycle; today the **wizard** guides it manually. No telegram-only way yet.
- **Box identity — UNSOLVED UX.** Which physical box is on which slot is operator
  knowledge; the map labels by function (EN/DE) but the operator still wires it.
- **Console / AI client of the WS API** — intended, not built. (The API is ready: the
  thin-transport `setup`/`set`/`stop`/`state` contract is documented in `asyncapi.yaml`.)
- **Hardware:** disable onboard BT (`dtoverlay=disable-bt`, needs reboot); keep the
  5 V/3 A PSU; hci2 (TP-Link) is spare for control.
- **Future phases:** camera, TOF sensor, local AI brain (driving via the WS API).

---

## 9. Where things live

```
moldqueen/
├── dev-docs/PROJECT.md            # THIS FILE — canonical
│   └── mould_king_13112_hmi_layout_spec.md   # dashboard layout coordinates
├── CLAUDE.md                  # terse must-knows (points here)
├── assets/                    # a legacy doc screenshot (excavator_layout_settings_channels.PNG); current site/doc images live in docs/assets/
├── scripts/                   # start.sh / check.sh (preflight + launch)
├── client/                    # INDEPENDENT smart web client (consumed by the cores + Docker; depends only on the WS API)
│   ├── web/{chooser.html, shell.css, chrome.*, clientconfig.js, layouts.json, channel_map.<id>.json, dashboard.*, generic.*, raw.*, template.*}  # the client OWNS the channel maps
│   ├── assets/                # served UI art (icons, LED gifs, dashboard background, banners)
│   └── serve.py               # standalone dev server (route derivation + 4-placeholder injection)
├── linux-core/
│   ├── CLAUDE.md              # linux-core must-knows
│   ├── mk4web/                # the control webservice (points at client/ to serve the UI)
│   │   ├── broadcaster.py  api.py  telegram.py  mouldking_crypt.py  config.py
│   │   └── asyncapi.yaml      # WS API contract (served at /asyncapi.yaml)
│   └── reference/             # verified snapshots: CONNECT_PROCEDURE.md, channel_map.md,
│                              #   mouldking_crypt.py, mk4_test.py, MKtech_reverse_engineering_report.md
├── android-core/              # Kotlin — standalone Android app (radio + local WS API + serves client/)
└── esp32-core/                # ESP-IDF/C — third radio core: NimBLE 0xFFF0 advertiser + WiFi WS API (mirrors api.py); self-provisioning standalone appliance
    ├── components/{mouldking_crypt, mk4_advertiser, mk4_wifi, mk4_ws_server,  # crypt + advertiser + WiFi/NVS + thin-transport WS
    │               mk4_provision, mk4_mgmt, mk4_webui}                        # setup AP/page + management page (:8080) + shared branded web-UI
    └── main/                  # app entry + boot logic (force-AP/no-creds/timeout → setup AP) — ESP32-S3 N16R8, ESP-IDF v5.5.4
```

Other docs: [`QUICKSTART.md`](QUICKSTART.md) (boxes → driving),
[`REMOTE_CLIENT.md`](REMOTE_CLIENT.md) (run the client separately),
[`ADDING_A_LAYOUT.md`](ADDING_A_LAYOUT.md) (contribute a layout/toy — a layout is just
client files; the client owns the map, no core fork), [`PORTING.md`](PORTING.md) (other
boards / containers — the radio core is hardware-bound).

Scratch working copies live outside the repo in `~/scratch/mk-refs/` (the
`mkconnect-python` reference clone, the test tools, capture parsers). Not version-
controlled; the repo's `linux-core/reference/` holds the durable snapshots.
