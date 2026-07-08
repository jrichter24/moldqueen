# Handover — where we are right now

> Living "current state" doc for starting fresh sessions without losing context.
> **Not** a project reference — that's [`PROJECT.md`](PROJECT.md). Read this first
> (~30s) at the start of a session; update + commit it before ending one.
> **Last updated: 2026-07-08.**

## TL;DR — where we are right now (2026-07-08)

- **Repo is PUBLIC** ([github.com/jrichter24/moldqueen](https://github.com/jrichter24/moldqueen)).
- **Three radio cores, one WS contract:** Pi (`linux-core`), Android (`android-core`), and the
  **ESP32-S3** (`esp32-core`) — all consuming the same single-source client.
- **MK6 module NOW DRIVES THROUGH THE REAL STACK (steps 1-3 done, HARDWARE-VERIFIED 2026-07-08).**
  The actual **MK6 module** is a *different* hub from our MK4 13112 (byte/device model, not
  nibble/slot) — same `0xFFF0` + same MouldKingCrypt, different telegram shape
  (`[0x61+device] ae 18 [c0..c3] 80 80 [0xFF-header]`, byte-per-channel `0x80`-center). Build
  progress: **step 1** (write-proof) ✅, **step 2** (Protocol seam in `telegram.py`) ✅, **step 3**
  (server EMITS MK4/MK6; raw-blind broadcaster; `protocol`/`device` on the WS `setup`/`set`) ✅ and
  **hardware-verified** — MK4 hub still drives identically (regression), and the MK6 module **binds
  + drives c0 both directions** through the real api/broadcaster path. **KEY MK6 CONNECT FINDING:**
  the MK6 device-0 **bind telegram is the base frame `6dae188080808092`** (broadcast while the box
  is in blue+green pairing mode → it binds to device 0, LED → single fast blue flash) — **NOT** the
  MK4 shared connect `adae18...` (that binds MK4 nibble hubs; an attempt with it left the box
  blinking + never bound). Full spec + evidence: `linux-core/reference/mk6_protocol.md`; §3 + §8 of
  PROJECT.md. **NEXT = MK6 build step 4** (client: protocol-per-function in the channel map + MK4/MK6
  box-image selection UX) — see PROJECT.md §8. (Step 5 = broadcaster interleaves BOTH protocols'
  keepalives on the shared radio — simultaneous MK4+MK6 — hardware-verify LAST.)
- **Shipped:** signed Android releases **v0.1.0 / v0.1.1 / v0.1.2** via the gated CI release
  workflow; package renamed to **`io.github.jrichter24.moldqueen`**.
- **F-Droid MR !41291** is **merged** at `fdroid/fdroiddata` (maintainer linsui review
  addressed); the app is now **available on F-Droid** at
  [f-droid.org/packages/io.github.jrichter24.moldqueen](https://f-droid.org/packages/io.github.jrichter24.moldqueen/).
- **esp32-core is now a usable standalone appliance** — drives a real toy over WiFi with the
  unmodified client, and is **self-provisioning + self-managing**: WiFi provisioning (no creds
  baked in), mDNS discovery `moldqueenesp.local`, and a management page on :8080 are all in and
  hardware-verified (details below).
- **Pi mDNS DONE (`moldqueenrasp.local`)** — the linux-core now advertises the sibling name
  (`ws://moldqueenrasp.local:8765`), mirroring the ESP32. Additive avahi alias (`scripts/mdns.sh`
  via `start.sh`; optional systemd unit), no hostname rename, graceful without `avahi-utils`
  (the one new apt dep, installed on the test Pi). Hardware-verified on the LAN.
- **ESP32 binary/release pipeline SHIPPED + first release published** — `.github/workflows/esp32-release.yml`
  (on main) triggers on **`esp-v*`** tags, builds in `espressif/idf:v5.5.4`, and merges
  bootloader + partition-table + app into **one flashable `.bin`** (flash at offset `0x0`).
  Version comes from the tag (`esp-v0.1.0` → `0.1.0` via `MK_PROJECT_VER`, parity-checked); the
  prerelease flag keys off the stripped version (a dry-run `esp-v0.1.0-rc1` caught + fixed a
  prerelease bug first). First real release: **`esp-v0.1.0`**, FULL release, asset
  **`moldqueen-esp32-esp-v0.1.0.bin`** (~1.14 MB), flash command in the release body
  (`esptool.py --chip esp32s3 write_flash 0x0 moldqueen-esp32-<tag>.bin`). **The ESP32 core is
  now complete — no pending ESP32 task;** serve-client-from-flash was **decided against** (see
  "Recent decisions still relevant" below).
- **Client fix shipped:** the WS-endpoint field (`client/web/clientconfig.js`) no longer
  clears/overwrites while you're editing it.
- **Process:** a read-only **`auditor`** agent + a **documentation-currency** rule now exist
  (docs are part of every change; the auditor flags drift, owners fix it).

### esp32-core — a usable standalone appliance (2026-06-27)
A standalone ESP32-S3 (no Pi, no phone) running the MK4 advertiser **and** the same
thin-transport WS API, consuming the **same client**. **Hardware-confirmed: the unmodified
client drove a real toy over WiFi**, reached by name over a self-provisioned WiFi join, no creds
baked in. The four control slices, all hardware-proven:
1. **Clean-room C `MouldKingCrypt`** — byte-exact vs the Python reference (9/9 on-device).
2. **NimBLE `0xFFF0` advertiser** — in-place `ble_gap_adv_set_data` (no stop/start runaway);
   **legacy** advertising on purpose (extended advertising `EBUSY`'d while active).
3. **300 ms per-channel auto-neutral keepalive**; **STOP = kill + reconnect at neutral**.
4. **WiFi WebSocket server `:8765`** mirroring `api.py`'s thin-transport contract
   (`setup`/`set`/`stop`/`state`/`info` + `lifecycle`/`state`/`info` pushes;
   `radio_backend = esp32-nimble`).

On top of those, **done + hardware-verified**:
5. **WiFi provisioning (no creds baked in)** — NVS creds; boot logic = **force-AP flag / no
   creds / 30 s connect-timeout → provisioning AP**, else station → normal op. Fallback = open
   SoftAP **`moldqueen-setup`** at `192.168.4.1`. The firmware is **distributable**.
6. **Group A — discovery + a branded bilingual setup page** at `192.168.4.1` (inlined MoldQueen
   icon rendering offline, EN/DE, scanned-network list with signal strength, show-password,
   configurable WS port, copy MAC/endpoint, a matching Saved page) + **mDNS** discovery as
   **`moldqueenesp.local`** (proven end-to-end — the client drives via the name).
7. **Group B — a management page** at **`moldqueenesp.local:8080`** (normal op): status / restart
   / **switch-to-setup** (a **software** force-AP via a one-shot NVS flag) / change-network, with
   AP fallback so bad creds never brick it. Unauthenticated + LAN-only, like the WS API.
A **hardware** re-provision trigger (double-reset / BOOT-hold) was evaluated and **dropped as
unreliable** (GPIO0 is the boot strap; the EN reset clears RTC) — **replaced by the software
switch-to-setup**. Two version surfaces by design: the management page shows a **git-describe
firmware version** (`esp_app_get_description`), the WS `info.version` is the literal marker
**`esp32-core`**.
Components (seven): `esp32-core/components/{mouldking_crypt, mk4_advertiser, mk4_wifi,
mk4_ws_server, mk4_provision, mk4_mgmt, mk4_webui}` + `main/`. Target **ESP32-S3 N16R8**,
**ESP-IDF v5.5.4**. Detail in [`PROJECT.md`](PROJECT.md) §6b.

## Earlier state (done / working — history preserved below)
- **SAFETY: gamepad runaway / STOP failures FIXED — verified on Pi + S25 (2026-06-20).**
  Hard-won insights (do NOT re-learn):
  * **The broadcaster REPEATS its last held state forever** (keepalive re-broadcasts the
    held 12 nibbles continuously). So a **release must update the broadcaster's HELD nibble
    to neutral** — a one-shot `cmd:set 0` that the held-state doesn't absorb is overwritten
    by the next keepalive repeat. (Pi: `Controller.set_nibbles`; Android: `RadioController`
    nibbles + advertise.)
  * **STOP = KILL the radio + RECONNECT at neutral** — NOT "send a zero" (a zero loses to the
    repeating loop). Pi: `cmd:stop`→`{killreconnect}`→adv OFF→connect telegram→neutral motion.
    Android: `radio.hardStop()` tears down the advertiser, then re-establishes connect→neutral.
  * **Android root cause = advertiser race.** Legacy `startAdvertising` can't update data in
    place, so stop/start **per payload change** dropped frames (ALREADY_STARTED) AND starved the
    hub (gaps → slow-flash disconnect). **Fix: the `AdvertisingSet` API** — start ONCE, update
    via `setAdvertisingData()` IN PLACE on the continuously-running advertiser; **only STOP tears
    down.** (`BleBroadcaster`.)
  * **Affirmative motion-keepalive:** the CLIENT re-sends each active non-neutral channel ~10/s;
    the SERVER per-channel auto-neutralizes any channel not refreshed within ~300ms (covers
    gamepad death / frozen axis / stalled loop / dead client — one mechanism, no blind ping).
  * Client STOP is an **absolute latch** (nothing re-drives until a fresh deliberate input; STOP
    also disables the gamepad). Gamepad disconnect detected by **absence/connected:false** (not
    a "frozen axis" — a dying battery drifts).
  * **Default `max_fwd` is now 5** (matches `max_rev=5`; gentler — raise per-channel in Channels).
  * Android APK carries an auto-increment **build number** in `versionName` (`+build.N`) +
    Server-info, so the running build is verifiable on-device.
- **Pluggable layout system complete** — Stages 1–4: manifest (`web/layouts.json`),
  **server-derived `/<id>` routes**, per-layout function maps, `active`/`category`
  schema, an **inactive template** (`template.*` + `channel_map.template.json`), shared
  **`shell.css`**, and the contributor guide ([`ADDING_A_LAYOUT.md`](ADDING_A_LAYOUT.md)).
- **Radio backend `rawhci`** (raw `AF_BLUETOOTH` socket, no hcitool) is the **default**
  and hardware-proven; `hcitool` is the legacy fallback (`MK4_RADIO_BACKEND`).
- **Server-info** WS message (`{cmd:info}`) with **safe/light/debug** tiers + a client
  readout (Server info tab).
- **Tabbed settings** overlay: Connection · Channels · Labels · Server info.
- **Pre-public secret audit PASSED** — zero secrets in 46 commits of history; the
  dev-path username leak (`/home/jrichter/...`) is fixed (`MK_REFS_DIR`).
- **README game controller (2026-06-18):** added a "What you get" bullet + a **Game
  controller** section (ToC + `client/assets/ps5_controller.png`) — PS5/DualSense via browser
  Gamepad API; emphasizes the controller talks to the CLIENT not the Pi (API-first demo);
  notes calibration UI + same channel-map/caps/safety. Docs+asset only; banner/badges/
  disclaimer/credits/author/license untouched.
- **Per-direction max caps (2026-06-18):** schema `max` → **`max_fwd`/`max_rev`** (1–7 each;
  excavator + template migrated, **max_rev default 5 = anti-stall**). `channelmap.py`: `migrate()`
  splits legacy `max` to BOTH (backward-compat) else 7/5; `resolve()` caps the OUTPUT/nibble
  direction (out>0→max_fwd, out<0→max_rev) — so the motor-stall polarity (reverse nibble 0x1-side)
  is capped regardless of invert. Dry-run: full reverse −7 → −5 (**nibble 0x1 → 0x3**), forward
  unchanged; old `max` files migrate; 3 tests pass. asyncapi.yaml updated. Client: `migrateCaps`,
  direction+invert-aware **`scaleVal`** (replaces `funcMax` in joystick/gamepad/buttons; Test uses
  max_fwd) so all input paths respect caps smoothly; Channels tab now has **Max ▲ / Max ▼** columns
  + a **stall warning** (don't set Max ▼ too high). **API restarted** (5526→6557); broadcaster 1929
  untouched/IDLE. NOTE: relates to the reverse-speed audit below — caps are the anti-stall lever
  (full reverse can't be boosted, only capped down out of the stall zone).
- **Reverse-speed audit + Rev× fix (2026-06-18):** AUDIT found `reverse_scale` was gated
  on the POST-invert sign, so on inverted functions (left_track) it trimmed the user's
  FORWARD not reverse — "Rev× does nothing" symptom explained. Also Rev× clamps at full
  scale so it can NEVER fix a slow FULL reverse (only partial-throttle). Nibble math is
  symmetric internally (−7→0x1 mirrors +7→0xF); 0x0 is never emitted though the code's own
  cited reference says full reverse = 0x00 — **possible one-step-short, UNCONFIRMED without
  a stock capture.** FIX (committed): `resolve()` now applies Rev× on the PRE-invert
  (user-intended) reverse; rs=1.0 is byte-identical to before (0 regressions, verified),
  left_track partial-reverse now scales, right_track unchanged. UI/docstring note added:
  Rev× tunes partial-throttle only. **PART A capture PENDING (decisive):** sniffer ready at
  `/tmp/sniff_stock.py`. **v1 hit `setsockopt(HCI_FILTER)` Errno 22** — kernel
  `struct hci_filter` is 16 bytes (padded) and rejects optlen<sizeof; v2 packs 16 (`<IIIH2x`).
  Now **guided/interactive**: self-test ("LISTENING" once it sees any advert) → prompts
  STEP 1 FULL FORWARD / STEP 2 FULL REVERSE → decodes 0xFFF0 nibbles → SUMMARY (stock fwd vs
  rev nibble; flags if stock uses 0x0 at full reverse vs our 0x1). `--parsetest` (no-root)
  PASSES end-to-end. Run: `sudo python3 /tmp/sniff_stock.py`. **API restarted** for the resolve
  fix; broadcaster 1929 untouched (SPARE hci1 only).
  **FIRST CAPTURE (2026-06-18):** CONFOUNDER found — our broadcaster was **READY (advertising
  neutral on hci0)** during the capture, co-transmitting 0xFFF0 WITH the phone → hub alternated
  move/stop = the interleaved `all-neutral` AND the user's "not fluent" stutter. Reset to **IDLE**
  via WS `setup/reset` (no kill). Stock app nibbles seen: one direction reached **0xF (v+7)** —
  **does NOT use 0x0**, so the "we're one step short at full reverse" hypothesis is **DISPROVEN**;
  encoding is symmetric & matches stock. BUT the other direction only reached **0x7 (v-1)** (user
  pushed gently / conflict masked it) → **need a CLEAN recapture** (broadcaster IDLE, push FULL to
  the stop BOTH ways) to confirm the other full extreme is 0x1 (not 0x0). Encoding still NOT changed.
  **Lesson: only ONE 0xFFF0 transmitter at a time** — keep broadcaster IDLE when driving the stock app.
  **SECOND capture (clean, broadcaster IDLE):** still only reached **0x7 (v-1)** on the slow
  direction (3rd time) while the other hit **0xF** — press-and-hold keeps missing that extreme.
  Added **`--sweep` mode** (`sudo python3 /tmp/sniff_stock.py --sweep`): ONE slow stick-to-stick
  sweep, lists EVERY nibble per channel + min/max, flags 0x0 vs 0x1 vs capped. This is the way to
  get the slow direction's bottom value (the decisive 0x1-vs-0x0 datum).
  **RESOLVED (2 sweeps):** across ALL 5 captures the lowest stock nibble ever = **0x3**; **0x0
  NEVER seen** → "stock uses 0x0 / we're one step short" is **DISPROVEN — encoding NOT changed.**
  Forward extreme = 0xF (confirmed). Twist: **our app already drives reverse to 0x1 (v-7), a MORE
  extreme nibble than the stock app produced (0x3, v-5)** → we are not under-driving reverse, so the
  slow reverse is NOT an encoding deficit. Root cause is the **Rev× direction bug (FIXED, Part B)**
  and/or a **hub/motor reverse-PWM asymmetry** (hardware; Rev×-now-working compensates mid-throttle;
  full extreme 0x1 can't be boosted). **NEXT (pivot off stock capture):** drive KNOWN nibbles via the
  RAW layout `/raw` (phone off, single TX) — slot1/ch0 at value +7 (0xF) vs -7 (0x1), watch motor
  speed each way → isolates motor-vs-nibble symmetry directly. Broadcaster left IDLE.
- **Gamepad / DualSense control (2026-06-18):** client-only (dashboard.js + dashboard.css,
  NO Pi/API change). Gamepad API rAF poll loop reads a controller paired to the CLIENT
  device and calls the SAME `driveFn` (WS drive-by-function) as the joysticks → reuses
  channel map / invert / max / reverse_scale + all safety (READY-gated; snap-to-neutral on
  release/disconnect/lifecycle-exit/blur). Dead-zone 0.18 with past-dead-zone rescale.
  **Anti-stomp arbitration** (`padOwns`): a resting pad never writes 0 over an active
  on-screen joystick — both inputs coexist. New **Gamepad settings tab**: enable toggle,
  live axes/buttons readout (per-browser mapping varies — user SEES real values), and an
  input→function map (axis+invert OR button±), persisted in localStorage (`mk4_pad_map`,
  `mk4_pad_enabled`) SEPARATE from the channel map; DualSense defaults seeded + "Reset to
  defaults". Topbar **🎮 chip** (shown only when a pad is present) = status + quick toggle.
  Verified: JS syntax + dead-zone/invert/arbitration math unit-tested; static served live.
  Needs a real controller for full browser verification (couldn't exercise hardware here).
- **README "What you get" (2026-06-18):** added a skimmable feature-bullets section
  before Highlights (+ ToC entry) — multi-hub control, API-first, 6-lang client, RAW mode,
  raw-HCI radio, portable core (honest "architected to / proven on Pi"), pluggable layouts,
  3-slot multi-device, safe-by-default, AI-assisted setup. Docs-only; banner/badges/
  disclaimer/credits/author/license untouched.
- **6-language labels (2026-06-18):** per-function labels moved from flat `label_en`/
  `label_de` to a **`labels: {en,de,zh,ko,es,fr}`** object. `channelmap.py` gained
  `migrate()` (legacy flat → `labels.{en,de}`, run on load + save) + lenient `validate()`
  (accepts either shape; `REQUIRED_KEYS` no longer demands labels); `config/channel_map.
  excavator.json` + template migrated (EN/DE preserved byte-exact; zh/ko/es/fr are
  **editable seeded placeholders**). Client (`dashboard.js`): mirrored `migrateLabels`,
  `funcLabel` fallback (picked→en→legacy→fn name), EN/DE **toggle replaced by a 6-language
  `<select>` picker** (persists `mk4_lang`), `tr()` falls back to en for new langs, and the
  **Labels tab restructured** into per-function cards with a labelled auto-fit language grid
  (clean on fixed-height panel + mobile). asyncapi.yaml schema updated. **API restarted**
  (was 1936 → now ~4680) — broadcaster 1929 untouched. Verified: drive/resolve unchanged,
  3 tests pass, WS set/promote round-trip the labels object, default serves all 6 langs.
  Note: a client holding an OLD localStorage active map keeps its en/de and starts the new
  langs empty until Reset-to-default or editing (by design).
- **Screenshot gallery (2026-06-18):** committed the four `assets/*.PNG` screenshots and
  added **`dev-docs/SCREENSHOTS.md`** (captioned visual tour: start page → dashboard → connect
  wizard → channel settings; `../assets/` paths). README links it (ToC + a "Screenshots"
  section after Highlights) with one clickable hero image (the dashboard → gallery). Docs-only.
- **README messaging (2026-06-18):** reframed as a **multi-purpose, toy-agnostic
  platform** (drives the Mould King BLE hubs, not just the 13112; excavator = reference
  layout; others add their own via the pluggable system + `ADDING_A_LAYOUT.md`) — intro
  paragraph + a Highlights bullet, kept honest (only the excavator is hardware-proven).
  Added an **"Set it up with an AI assistant"** section (hand the repo/README to an agent;
  QUICKSTART/PROJECT/CLAUDE.md make it agent-friendly) + ToC entry. Docs-only; banner/
  badges/disclaimer/credits/author/license untouched.
- **"Connect API" tab + vertical endpoint form (2026-06-18):** settings tab renamed
  **"Connection" → "Connect API"** (de "API verbinden") so it pairs unambiguously with the
  top-left "Connect Excavator"; startup step-1 wording updated to match. The shared endpoint
  editor (`MK4.buildEndpointRow` + `.eprow`, used by Connect-API tab / startup / RAW /
  template) is now a tidy **vertical stacked form** — label · full-width input · buttons row
  (Connect + Use page host) · status · hint — replacing the old cramped single row. Markup
  change in `clientconfig.js`, layout in `shell.css`. All behavior preserved (IDs unchanged).
  Endpoint input is **full width** — a `.sheet .eprow input[type=text]` override in
  `dashboard.css` beats the compact `.sheet input[type=text]` (7.5rem, channel-table) rule
  that was capping it, so a long `ws://host:port` URL fits.
- **Connect-disambiguation + startup overlay (2026-06-18):** the two "connect" concepts
  are now distinct — top-left BLE cold-start is **"Connect Excavator"** (en) / "Bagger
  verbinden" (de), styled prominent (`#menu .connectExc`, bright-blue glow); the settings
  **"Connection"** tab stays the API endpoint. New **startup overlay** (`#startup`, built in
  `buildStartup()`) greets the excavator page with two labelled steps — **Step 1 reach the
  API** (reuses the endpoint editor; "Next" gated until ws connected, auto-advances on
  connect) → **Step 2 connect the excavator** (hands off to the existing wizard). Fully
  **skippable** (Skip button + backdrop click); auto-closes if already READY. The wizard
  title is now "Excavator setup". All reuse — no behavior change to wizard/lifecycle/endpoint.
- **Chooser mobile LANDSCAPE fix (2026-06-18):** added `@media (orientation: landscape) and
  (max-height: 600px)` — the prior `max-width:768px` rule missed wide-but-short landscape
  phones, so desktop centering clipped the cards' top and made them over-wide. Now scrolls
  with the top reachable and lays cards ~2-up scaled. Portrait + desktop unchanged.
- **Cosmetic UI polish (2026-06-18):** excavator settings overlay is now **fixed-height**
  (`.spanel min-height: 26rem`, sized to the tallest = Channels) so switching tabs
  no longer jumps; tab bar **wraps** instead of showing a side scrollbar; taller tab
  captions. Chooser (`/`) is **mobile-fixed** — `@media (max-width:768px)` lets the
  page scroll (`height:auto`, `justify-content:flex-start`) and shrinks cards to one
  readable column; added a **⛶ Fullscreen** button (matches the dashboard). Chooser
  stays self-contained (NOT shell.css — its `body{overflow:hidden}` would break the
  new scroll, and the page must also render raw via nginx). Static-only; verified live.

## In progress / next task
- **esp32-core — COMPLETE (no pending ESP32 task).** The core is a usable standalone appliance
  (drives a real toy over WiFi; provisioning + Group A + Group B all done and hardware-verified),
  **Pi mDNS is shipped** (`moldqueenrasp.local` for linux-core — additive avahi alias via
  `scripts/mdns.sh` wired into `start.sh`, optional `scripts/moldqueen-mdns.service`), and the
  **binary/release pipeline is shipped** (`.github/workflows/esp32-release.yml` builds one
  flashable `.bin` on `esp-v*` tags; **`esp-v0.1.0` published**). **serve-client-from-flash is
  decided against** — the ESP32 stays a thin-transport radio core that a hosted client drives
  (see "Recent decisions still relevant"). **No ESP32-specific next task.**
- **MK6 integration — the active thrust (steps 1-3 DONE + hardware-verified).** MK6 is fully
  reverse-engineered, driving-proven, and now **emitted through the real server stack** (see the
  TL;DR + PROJECT.md §3/§8 + `linux-core/reference/mk6_protocol.md`). **Step 1** (write-proof) ✅,
  **step 2** (Protocol seam) ✅, **step 3** (server EMITS MK4/MK6 via the seam; raw-blind broadcaster;
  IPC carries built raw + neutral_raw; `protocol`/`device` on WS `setup`/`set`; single protocol per
  session) ✅ hardware-verified. **NEXT = step 4:** client — protocol-per-function in the channel
  map + MK4/MK6 box-image selection UX. Then **step 5:** the broadcaster holds BOTH protocols' state
  + interleaves both keepalives on the shared radio (simultaneous MK4+MK6) — **hardware-verify LAST**.
  Full agreed design in **PROJECT.md §8**. Commit: `866976a` (linux-core; from the Pi — desktop needs
  a `git pull`).
- **F-Droid MR !41291 — merged; app is live.** The MR at `fdroid/fdroiddata` is merged (maintainer
  linsui review addressed); MoldQueen is now **available on F-Droid** at
  [f-droid.org/packages/io.github.jrichter24.moldqueen](https://f-droid.org/packages/io.github.jrichter24.moldqueen/).
- **Recurring:** after the next `v*` tag, bump the README + website (`docs/`) Download/Install
  sections + version badge and verify release-download links (see `WORKBOARD.md` → RECURRING).

## Recent decisions still relevant
- **Serve-client-from-flash on ESP32 — DECIDED AGAINST (won't-do, 2026-07-06).** The long-
  documented "next ESP32" item is now decided against. The ESP32 works cleanly as a pure radio
  core that any hosted client (Pi / Docker / desktop / Android) drives, so an on-board client
  adds little value; and the page-load asset burst coexisting with BLE on the shared 2.4 GHz
  radio is the heaviest, most stutter-prone moment, on top of the client-size problem (several
  MB vs limited flash). The ESP32 stays a thin-transport radio core. See PROJECT.md §6b.
- **DUAL-RADIO finding (2026-06-19) — don't re-investigate.** The Mould King hub is
  **dual-radio**. **BLE** (company `0xFFF0`) = the MK+tech app path that moldqueen
  controls → reaches **FAST-FLASH** (drivable). The physical **remote** uses a
  **SEPARATE proprietary 2.4 GHz radio** → drives the hub to **SOLID-LED**, invisible
  to a BLE/HCI dongle (zero correlated BLE traffic on remote power-on, confirmed by
  capture). **Solid-LED is NOT reachable over BLE/`0xFFF0`** (not a telegram or
  keepalive trick) → our keepalive design stands. Capturing the remote would need an
  **nRF24 sniffer / SDR**, out of scope.
- **Dev over plain SSH / on the desktop**, not long on-Pi sessions (1 GB Pi RAM
  thrashes). **Prefer frequent short sessions** — this doc makes ending lossless.
- Routes derive from layout **id**; **rawhci** default; server-info **tiers**.
- **Client/server split**: the WebSocket **API is mandatory** (owns the radio); the
  web client is **optional** (`--ws-only` to skip it; serve it separately + point at
  the Pi via the in-app endpoint).

## Live operational state
- Bring up: **`scripts/start.sh`** (needs sudo). Resolves the dongle **by MAC
  `00:A6:44:02:21:25`** — it **RE-ENUMERATES across reboots** (was **hci0** this boot;
  has been hci1/hci3 before — never assume an index). Boots **IDLE, no transmit** until
  a GUI cold-start (Connect → button one hub to two flashes → Ready).
- Default channel map confirmed incl. **arm_lift = slot0/ch3, front_arm = slot0/ch1**
  (swapped from placeholders by the 2026-06-17 hardware test).

## Open / deferred (non-urgent)
- **Doc-vs-reality nit:** the docs say the Pi's onboard BT is disabled via `dtoverlay=disable-bt`,
  but it still **enumerates as `hci2`** (Bus UART) — the overlay isn't actually applied. Harmless
  (it's DOWN; control is the USB dongle by MAC) and unrelated to MK6; fix the overlay or the doc later.
- systemd auto-start of the service.
- Cosmetic: `cmd:info`'s `hci` field reads the config default, not the broadcaster's
  real bound adapter.
- Move resolve-by-MAC into the broadcaster itself (today `start.sh` does it).
- camera / TOF sensor / AI-brain roadmap.
- Possible board upgrade (more RAM) — though SSH/desktop dev largely solves the memory
  issue, so low priority.
