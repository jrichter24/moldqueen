# Handover — where we are right now

> Living "current state" doc for starting fresh sessions without losing context.
> **Not** a project reference — that's [`PROJECT.md`](PROJECT.md). Read this first
> (~30s) at the start of a session; update + commit it before ending one.
> **Last updated: 2026-06-18.**

## Current state (done / working)
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
  controller** section (ToC + `assets/ps5_controller.png`) — PS5/DualSense via browser
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
  added **`docs/SCREENSHOTS.md`** (captioned visual tour: start page → dashboard → connect
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
- **Repo about to go PUBLIC.** Pending: push the handover commit (f266d13 already on
  origin), confirm `local==origin` + clean tree. Then the **USER** flips visibility to
  public (manual) and does a front-door skim of the rendered repo.

## Recent decisions still relevant
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
- systemd auto-start of the service.
- Cosmetic: `cmd:info`'s `hci` field reads the config default, not the broadcaster's
  real bound adapter.
- Move resolve-by-MAC into the broadcaster itself (today `start.sh` does it).
- camera / TOF sensor / AI-brain roadmap.
- Possible board upgrade (more RAM) — though SSH/desktop dev largely solves the memory
  issue, so low priority.
