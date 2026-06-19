# Adding a layout (bring your own dashboard)

This is the guide the chooser's *"Bring your own"* card promises: how to add a new
toy/layout. **Read the honest assessment first** — there are two very different
paths, and only one of them is clean today.

## TL;DR

- **Generic layout** (slot/channel, like the existing **RAW** view): **clean** —
  add client files + 2-3 route lines + a chooser card. **No server change.** The
  generic core (WS API, lifecycle, telegram building, responsive shell) is yours
  for free. **Start here.**
- **Function-mapped layout** (named functions + the channel-assignment UI, like the
  **excavator** dashboard): the **server is now data-driven** — a layout declares its
  function set (manifest) + default map (`config/channel_map.<id>.json`), no core fork.
  What's still missing is a reusable **client template** (the dashboard's JS/art is
  excavator-specific). See *Limitations*.

---

## What's generic vs hardcoded-to-13112

| Concern | Where | Generic? |
|---|---|---|
| WebSocket API (`setup`/`set`/`stop`/`state`) | `api.py` | ✅ generic — raw slot/channel |
| Connect lifecycle IDLE→CONNECTING→READY, auto-neutral safety | `broadcaster.py` + `api.py` | ✅ generic |
| Telegram building (12 nibbles = 3 slots × 4 ch) | `telegram.py` | ✅ generic to MK4 hubs |
| Responsive shell + menu + modal/wizard base (`#app`/`#menu`, top-bar/sidebar) | `shell.css` | ✅ shared by all layouts |
| Configurable WS endpoint | `clientconfig.js` (`window.MK4`) | ✅ shared by all layouts |
| Chooser landing + remember/skip | `chooser.html` | ✅ generic |
| **`drive`-by-function + channel map** | `channelmap.py` + per-layout `config/channel_map.<id>.json` + manifest `functions` | ✅ data-driven (per-layout set) |
| **Function names / labels / art coordinates** | `dashboard.js` (`FN`, `JOYS`, `TITLES`, px `rect`s) | ❌ excavator-specific (needs a template) |
| **HTTP routes / file serving** | `api.py` generic static handler + manifest | ✅ by filename, no per-layout plumbing |

The **RAW** layout (`raw.{html,js,css}`) is the proof that a generic layout works
with zero server coupling: it drives raw `{cmd:set, slot, channel, value}` / `stop`,
reuses the shell + menu + lifecycle + endpoint config, and knows nothing about
"excavator." **Copy RAW, not the dashboard, as your starting point.**

---

## The clean path: a generic (slot/channel) layout

You write 3 client files and add **one manifest entry**. **No Python/route/chooser
edits** — the server derives the route from the id, serves the files by filename, and
the chooser builds the card from the manifest.

### 1. Create the client files (`client/web/`)

- `mytoy.html` — copy `raw.html`; it already pulls in the shell:
  ```html
  <link rel="icon" href="/assets/moldqueen_icon.png" />
  <link rel="stylesheet" href="/shell.css" />       <!-- shared shell + #menu + modal/wizard base -->
  <link rel="stylesheet" href="/mytoy.css" />
  <script>window.MK4_WS_PORT = "__WS_PORT__";</script>
  ...
  <div id="app"><nav id="menu"></nav><div id="main"></div></div>
  <script src="/clientconfig.js"></script>
  <script src="/mytoy.js"></script>
  ```
- `mytoy.js` — your controls. The core gives you:
  - `MK4.wsEndpoint()` / `MK4.setStatus()` / `MK4.buildEndpointRow()` — connection.
  - `new WebSocket(MK4.wsEndpoint())`, then send `{cmd:"setup",action:"connect"|"ready"|"reset"}`
    to drive the lifecycle, and `{cmd:"set",slot,channel,value}` / `{cmd:"stop"}` to move motors.
  - The server pushes `{type:"lifecycle"}` and `{type:"state",slots,raw,ad}` — gate
    your controls on `READY`, snap to neutral on disconnect.
  - Build your toolbar into `#menu` (reuse `.tgroup`/`.dot`/`#stopBtn` classes) — you
    get the top-bar/sidebar responsive behavior for free.
  - Optional: copy RAW's condensed connection **wizard** (`.modal`/`.sheet.wiz`
    classes in `shell.css`, LED-flash GIFs in `client/assets/*_flash.gif`).
- `mytoy.css` — only your layout-specific styles (the shared shell lives in `shell.css`).

### 2. Add ONE manifest entry (`client/web/layouts.json`)

```json
{ "id": "mytoy", "name": "My Toy", "description": "One line.",
  "icon": "/assets/mytoy_icon.png", "kind": "generic",
  "files": { "html": "mytoy.html", "js": "mytoy.js", "css": "mytoy.css" } }
```
That's the whole registration. The server then, with **no api.py change**:
- **derives the route** `/mytoy` from the `id` (server-generated — `id` must be
  URL-safe; the `name`/title is display-only and never affects the route). On the
  off chance two ids collide, later ones get `-2`, `-3` appended.
- **serves the files by filename** (`/mytoy.html` injected, `/mytoy.js`, `/mytoy.css`
  via the generic static handler).
- **builds the chooser card** from the entry (icon, name, description) and wires it to
  the derived route (the chooser reads the route the server injects, or falls back to
  `/<id>` when served raw).

### 3. (Optional) Serve it separately (Docker / standalone)

Nothing to do for routing: the Docker image and the standalone dev server both run
[`client/serve.py`](../client/serve.py), which **derives** your layout's route from
`layouts.json` automatically (same as the Pi's api.py) — **no per-layout serve config**.
Your files under `client/web/` are picked up as-is. Then point it at the Pi via the
in-app endpoint setting (see [`REMOTE_CLIENT.md`](REMOTE_CLIENT.md)).

That's the whole clean path. You inherit the radio, lifecycle, safety, endpoint
config, responsive chrome, and routing; you only write the toy's control surface over
slot/channel.

---

## The function-mapped path (server side now data-driven)

The excavator dashboard drives **by function** (`{cmd:"drive",function:"left_track",…}`)
and the server resolves the function → (slot, channel) via a **per-layout channel map**:

- A function-mapped layout declares its **function set** in the manifest
  (`web/layouts.json`, e.g. excavator's six) and its **default map** in
  `config/channel_map.<layout_id>.json` (`channel_map.excavator.json`).
- `channelmap.py` has **no global `FUNCTIONS`** — `validate()`/`load()` are
  parameterized by the active layout's set; `resolve()` just looks a function up.
  The server validates/persists/promotes against the active layout's set.
- **The client is still per-toy:** the excavator's `dashboard.js` hardcodes its `FN`
  list + pixel-perfect art `rect`s. A new function-mapped toy needs its own (small)
  client — and there's now a **TEMPLATE** to start from (below).

So the **server** no longer needs forking for a new function set; you copy the template
client and edit it.

**Generic-slot workaround** (no functions at all): define your own function→(slot,
channel) table in your layout's JS and send raw `{cmd:set}` (like RAW). You skip the
server-side map persistence/Promote, but stay pluggable.

---

## Start from the TEMPLATE (copy → rename → modify → activate)

A minimal **function-mapped** starter ships in the repo, **inactive**, so it doesn't
show on the chooser or get a route until you turn it on:

- manifest entry `id:"template"`, `active:false`, `category:"template"`, one function
  `knob_1`
- `client/web/template.{html,js,css}` — connect/lifecycle wiring + ONE knob
  that drives `knob_1` by name + a client channel-map override, all marked with `TODO`
- `config/channel_map.template.json` — that one function's placeholder default map

It's a *working skeleton*: set `active:true` and it would connect + drive one channel.

### 1. Copy + rename to a unique id
```bash
cp client/web/template.html client/web/mytoy.html
cp client/web/template.js   client/web/mytoy.js
cp client/web/template.css  client/web/mytoy.css
cp config/channel_map.template.json config/channel_map.mytoy.json
```
In `mytoy.html` point the `<link>`/`<script>` at `mytoy.css` / `mytoy.js`. The **route
auto-derives to `/mytoy`** from the id — you never write a route.

### 2. Declare it in the manifest (`web/layouts.json`)
Copy the `template` entry, then: set `id:"mytoy"` (URL-safe + unique), your `name`,
`description`, `icon`, `category`, and the `functions` list + `files` (your renamed
files). Keep `active:false` for now.

### 3. Define your channel map
Edit `config/channel_map.mytoy.json`: one entry per function in your `functions` list,
each `{slot 0-2, channel 0-3, invert, max 1-7, reverse_scale, label_en, label_de}`. You
don't have to know the real channels yet — drive each control and read which motor
moves (the override UI in the template helps), then set them.

### 4. Modify the controls (`mytoy.js`)
- Extend `FN = ["knob_1"]` to **one name per motor/channel** you control (mirror it in
  the manifest `functions` and the channel-map file). **More motors = more functions +
  more knobs** — this is the modular path; add a knob per function in `buildMain()`.
- Drive each by name: `send({cmd:"drive", function:<name>, value:-7..7})` (READY-only).
- Optional, copy from `raw.js`/`dashboard.js`: the connection **wizard**, Save/Promote
  of the map, joysticks instead of sliders.

### 5. Activate
Set `active:true` in the manifest and **restart the API** (it reads the manifest at
startup — see *Operational gotchas* in `CLAUDE.md`). `/mytoy` now serves and a card
appears on the chooser automatically — **no `api.py` edits**.

### Current limitations (be honest)
- The **client is hand-written** (no auto-generated controls from the function set yet).
- One **global** lifecycle/state on the server — fine for one driver.
- Routes are derived from `layouts.json` on every host (Pi `api.py`, `client/serve.py`,
  Docker) — no per-layout serve config anywhere.

---

## Limitations (rough edges a contributor will hit)

1. ✅ **Channel map is now per-layout** (Stage 3) — each layout declares its function
   set (manifest) + default map (`config/channel_map.<id>.json`); no global list.
2. ✅ **Generic static handler** (Stage 2) — a layout's files serve by filename; no
   per-file `api.py` plumbing. (The client **Docker** nginx still lists routes — a
   separate config to update for that deploy.)
3. ✅ **CSS split** (Stage 4) — the shared shell/menu/modal/wizard is `shell.css`;
   `dashboard.css`/`raw.css`/`template.css` hold only their layout's styles. A new
   layout links `shell.css` + its own.
4. ✅ **Layout manifest** (Stage 1) — registration is one `web/layouts.json` entry.
5. ✅ **Layout template** — `web/template.{html,js,css}` + `channel_map.template.json`,
   shipped `active:false`; copy it (above).
6. ⏳ **One global lifecycle/state on the server.** All clients share it; layouts
   can't have independent sessions (fine for one driver, surprising for two).
7. ⏳ **No auto-generated controls** — a function-mapped layout's JS/art is still
   hand-written (the template gives you a one-knob starting point).

## Remaining refactors

- **Auto-generated controls**: a layout client that reads its function set + default
  map and renders generic knobs, so a new function-mapped toy needs no bespoke JS.
- **Per-session layout state** so two layouts can be driven independently.

Until those land, **document and encourage the generic slot/channel path** (above) —
it's clean and needs no core changes.
