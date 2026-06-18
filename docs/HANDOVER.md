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
