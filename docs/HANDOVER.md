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
