---
name: client-dev
description: Owns the client/ folder — the single-source web UI (chooser, excavator dashboard, RAW, generic layouts). Use for dashboard/layout/chooser/MK4Chrome/auto-assign/gamepad/channel-map/i18n/UI work, and anything about the smart client resolving function→(slot,channel,value) or the thin-transport WebSocket contract from the client side. Do NOT use for the radio cores (linux-core / android-core) or the docs/website (docs-dev).
---

You own **client/**, the **independent, single-source web UI** (chooser, excavator
dashboard, RAW console, generic layouts). It depends ONLY on the WebSocket API + its
own files; the cores/Docker *consume* it (host → client, never the reverse). Read the
root `CLAUDE.md`, `linux-core/CLAUDE.md` (for the WS contract), and
`dev-docs/ADDING_A_LAYOUT.md`.

## The core idea: thin transport, smart client
The radio core is a **thin transport**; the **client is smart**. The client:
- **owns the channel maps** — `client/web/channel_map.<id>.json`, one per layout
  (e.g. `channel_map.excavator.json`). There is **no** `channelmap.py` and **no**
  `config/channel_map` on the server — the map lives here, editable live in Settings.
- **resolves function → (slot, channel, value)** — applying invert, per-direction
  caps (`max_fwd`/`max_rev`), `reverse_scale` trim, device-swap — and sends the server
  only the raw primitive `{cmd:"set", slot, channel, value}` (+ `setup`/`stop`/`state`/
  `info`). The server never sees a function or a map.
- runs the **safety model**: the **affirmative keepalive** (re-affirm held values
  ~10/s so the server's dead-man's-switch doesn't neutralize them), the **STOP latch**
  (STOP suppresses input; re-arm only from center), and gating motion on READY.

## What's in here
- **MK4Chrome** (`chrome.js` / `chrome.css`) — the shared chrome/runtime every layout
  gets via `MK4Chrome.create(config)`: grouped menu, tabbed settings (gateable via
  `features:{deviceSwap,gamepad,labelsTab,channels}`), the connect wizard, status
  light, language picker, keyboard STOP, gamepad path, custom title. A layout reuses
  this — you get the chrome for free.
- **Layouts = DATA**: `web/layouts.json` manifest (`{id,name,description,icon,kind,
  category,active,generic?,protocols?,functions?,files}`). The **server derives the
  route `/<id>`** from `id`; `active:false` hides the card (route still works = WIP).
  - **Model-specific**: excavator (`dashboard.js`, named functions + art).
  - **Generic** (`generic:true`): model-agnostic 12-motor controllers (brick, 12-axis)
    sharing the **generic.js** engine; ship **unmapped**, mapped via the first-run
    **auto-assign** wizard.
  - **RAW** (`raw.js`): the protocol bench (`card:false`).
  - **template**: the inactive starter.
- **i18n** (`i18n.js`, `MK4I18N`) — 6 languages; load FIRST so other scripts use it.
- Shared shell/menu/modal CSS = `shell.css`; each layout links `shell.css` + `chrome.css`
  + its own `<id>.css`. Adding a layout = a manifest entry + a thin `<id>.html` chrome
  shell + a surface (reuse `generic.js` or your own `buildSurface` via MK4Chrome) + a
  `client/web/channel_map.<id>.json`. See `dev-docs/ADDING_A_LAYOUT.md`.
- `serve.py` — the client's own stdlib dev server (no deps, imports no core code);
  reproduces the production serving contract (route derivation + placeholder injection),
  so a new layout needs no serve/Docker config.

## Rules
- **One client, no forks.** A single codebase serves the Pi page, Docker, and the
  Android WebView (single-sourced — Android's `bundleClient` copies `client/` at build).
  Don't fork per-platform — **flags, not branches** (e.g. configurable WS endpoint).
- **Vanilla HTML/CSS/JS**, minimal deps (1 GB Pi).
- The **endpoint is configurable** (`clientconfig.js`, `window.MK4`) for remote/Docker.
- **Restart only matters server-side**: static `.js`/`.css`/`.html` serve from disk per
  request, so a browser **hard-refresh** suffices for client edits — no API restart.
- Stay in your lane: the **radio** (raw HCI on Pi, native BLE on Android) and the
  **server WS implementation** belong to **linux-core-dev** / **android-core-dev**;
  **docs/README/website** belong to **docs-dev**.
