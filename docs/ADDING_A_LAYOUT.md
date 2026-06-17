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
  **excavator** dashboard): **not cleanly pluggable yet** — the server's function
  set is hardcoded to the 13112's six functions. You'd be editing the core. See
  *Limitations* + *Refactors*.

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
| **`drive`-by-function + channel map** | `channelmap.py`, `config/channel_map.json` | ❌ **hardcoded** to 6 functions |
| **Function names / labels / art coordinates** | `dashboard.js` (`FN`, `JOYS`, `TITLES`, px `rect`s) | ❌ excavator-specific |
| **Per-layout HTTP routes** | `api.py` `do_GET` (one branch per file) | ⚠️ manual per layout |

The **RAW** layout (`raw.{html,js,css}`) is the proof that a generic layout works
with zero server coupling: it drives raw `{cmd:set, slot, channel, value}` / `stop`,
reuses the shell + menu + lifecycle + endpoint config, and knows nothing about
"excavator." **Copy RAW, not the dashboard, as your starting point.**

---

## The clean path: a generic (slot/channel) layout

You write 3 client files and touch 2 small registration points. **No Python/protocol
changes.**

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
    classes in `dashboard.css`, images in `assets/wizard/`).
- `mytoy.css` — only your layout-specific styles (the shell lives in `dashboard.css`).

### 2. Register the routes (`bt-core/mk4web/api.py`, `do_GET`)

Add three branches next to the `raw` ones:
```python
elif path in ("/mytoy", "/mytoy.html"): self._send_web_html("mytoy.html")
elif path == "/mytoy.js":  self._send_web_file("mytoy.js",  "text/javascript; charset=utf-8")
elif path == "/mytoy.css": self._send_web_file("mytoy.css", "text/css; charset=utf-8")
```
(`__WS_PORT__` is injected by `_send_web_html`; served raw by nginx it falls back via
`clientconfig.js`.)

### 3. Add the chooser card (`bt-core/mk4web/web/chooser.html`)

- Add your route to the skip map: `var routes = { excavator:"/dashboard", raw:"/raw", mytoy:"/mytoy" };`
- Add a `<button class="card" data-layout="mytoy" data-route="/mytoy">` with an icon
  (`/assets/<your>.png` or an inline SVG), an UPPERCASE title, and a one-line desc.

### 4. (Optional) Serve it separately

If you serve the client via the Docker image, add your files to `Dockerfile.client`
+ a route in `deploy/nginx-client.conf` (`location = /mytoy { try_files /mytoy.html =404; }`).
Then point it at the Pi via the in-app endpoint setting (see
[`REMOTE_CLIENT.md`](REMOTE_CLIENT.md)).

That's the whole clean path. You inherit the radio, lifecycle, safety, endpoint
config, and responsive chrome; you only write the toy's control surface over
slot/channel.

---

## The hard path: a function-mapped layout (and why it's not clean yet)

The excavator dashboard drives **by function** (`{cmd:"drive",function:"left_track",…}`)
and the server resolves the function → (slot, channel) via a **channel map** with a
**hardcoded set of six functions**:

- `bt-core/mk4web/channelmap.py` → `FUNCTIONS = ["left_track","right_track","arm_lift",
  "front_arm","rotation","bucket"]` and `validate()`/`resolve()` assume exactly these.
- `config/channel_map.json` is a **single global** map (one toy at a time).
- `dashboard.js` hardcodes the same `FN` plus pixel-perfect `rect`s for the 13112 HMI
  art (`assets/moldqueen_dashboard_v2.png`, 1672×941) and EN/DE labels.

So a *different* toy with different functions can't reuse the `drive`/channel-map
machinery without editing the server's `FUNCTIONS` and replacing the global map —
that's not "bring your own," that's forking the core.

**Workaround today:** a function-mapped feel *without* server changes — define your
own function→(slot,channel) table **in your layout's JS** and send raw `{cmd:set}`
yourself (exactly what RAW does at the slot/channel level). You lose the server-side
map persistence/Promote and the channel-assignment overlay, but you stay pluggable.

---

## Limitations (rough edges a contributor will hit)

1. **Channel map is single-toy + server-hardcoded.** `FUNCTIONS` is one list; the
   default map is one file. No per-layout/per-toy maps.
2. **HTTP routes are per-file, hardcoded** in `api.py` — no "serve `web/<layout>/`"
   static handler. Three lines per layout, and the same again in nginx for Docker.
3. **`dashboard.css` mixes shell + excavator art.** The shared shell (`#app`/`#menu`)
   and the excavator-only styles (`.joy`, `.title`, HMI labels) live in one file, so
   a new layout pulls in unused dashboard CSS.
4. **No layout manifest.** Registration is spread across `chooser.html` (card +
   route map) and `api.py` (routes) — easy to get out of sync.
5. **One global lifecycle/state on the server.** All clients share it; layouts can't
   have independent sessions (fine for one driver, surprising for two).

## Refactors that would make function-mapped layouts cleanly pluggable

- **Layout manifest/registry** (e.g. `config/layouts.json`: `{id,title,icon,route,
  files}`) read by both the chooser and `api.py` → register once.
- **Generic static handler** in `api.py`: serve `web/<layout>/…` so new layouts need
  no Python edits.
- **Per-layout function sets.** Make `channelmap` data-driven: a layout declares its
  functions (and the channel map is namespaced per toy), instead of the hardcoded
  `FUNCTIONS`. The `drive` resolver then works for any toy.
- **Split CSS**: `shell.css` (shared `#app`/`#menu`/modal) vs per-layout styles.

Until those land, **document and encourage the generic slot/channel path** (above) —
it's clean and needs no core changes.
