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
| Responsive shell + menu (`#app`/`#menu`, top-bar/sidebar) | `dashboard.css` | ✅ reusable (RAW reuses it) |
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

### 1. Create the client files (`bt-core/mk4web/web/`)

- `mytoy.html` — copy `raw.html`; it already pulls in the shell:
  ```html
  <link rel="icon" href="/assets/moldqueen_icon.png" />
  <link rel="stylesheet" href="/dashboard.css" />   <!-- shared shell + #menu -->
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
    classes in `dashboard.css`, LED-flash GIFs in `assets/*_flash.gif`).
- `mytoy.css` — only your layout-specific styles (the shell lives in `dashboard.css`).

### 2. Add ONE manifest entry (`bt-core/mk4web/web/layouts.json`)

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

### 3. (Optional) Serve it separately (Docker)

If you serve the client via the Docker image, add your files to `Dockerfile.client`
(it copies all of `web/`, so they're included) and a route line in
`deploy/nginx-client.conf` (`location = /mytoy { try_files /mytoy.html =404; }`) — the
**static nginx mirror is the one place that still needs a per-layout line** (the Pi's
api.py derives it automatically; a static server can't). Then point it at the Pi via
the in-app endpoint setting (see [`REMOTE_CLIENT.md`](REMOTE_CLIENT.md)).

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
- **Still client-side excavator-specific:** `dashboard.js` hardcodes its own `FN`
  list + pixel-perfect `rect`s for the 13112 HMI art and EN/DE labels. A *new*
  function-mapped toy still needs its own client (a layout **template** — not built
  yet) to draw its controls and (optionally) tell the server its `layout` id.

So the **server** no longer needs forking for a new function set; what remains for a
fully pluggable function-mapped toy is the client template + the CSS split (below).

**Generic-slot workaround** (no template needed): define your own function→(slot,
channel) table in your layout's JS and send raw `{cmd:set}` (like RAW). You skip the
server-side map persistence/Promote + the channel-assignment overlay, but stay pluggable.

---

## Limitations (rough edges a contributor will hit)

1. ✅ **Channel map is now per-layout** (Stage 3) — each layout declares its function
   set (manifest) + default map (`config/channel_map.<id>.json`); no global list.
2. ✅ **Generic static handler** (Stage 2) — a layout's files serve by filename; no
   per-file `api.py` plumbing. (The client **Docker** nginx still lists routes — a
   separate config to update for that deploy.)
3. ⏳ **`dashboard.css` mixes shell + excavator art** (Stage 4, pending). The shared
   shell (`#app`/`#menu`) and excavator-only styles (`.joy`, `.title`, HMI labels)
   live in one file, so a new layout pulls in unused dashboard CSS.
4. ✅ **Layout manifest** (Stage 1) — registration is one `web/layouts.json` entry.
5. ⏳ **One global lifecycle/state on the server.** All clients share it; layouts
   can't have independent sessions (fine for one driver, surprising for two).
6. ⏳ **No client template** — a new function-mapped layout still needs its own JS/art
   (the dashboard is excavator-specific). A reusable template is future work.

## Remaining refactors

- **Split CSS**: `shell.css` (shared `#app`/`#menu`/modal) vs per-layout styles (Stage 4).
- **Layout template**: a reusable client that reads its function set + default map and
  renders generic controls, so a new function-mapped toy needs no bespoke JS.

Until those land, **document and encourage the generic slot/channel path** (above) —
it's clean and needs no core changes.
