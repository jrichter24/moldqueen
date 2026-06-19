# Run the client standalone for development (no Docker)

The quickest way to hack on the web UI (**chooser**, **excavator dashboard**, **RAW**)
on your desktop: serve the client folder with any plain static file server and point
it at a running Pi's WebSocket API. No Docker, no build step. The **radio + API stay
on the Pi**; you're only serving the UI.

```
  your desktop                              Raspberry Pi
  ┌────────────────────────────┐  ws://    ┌──────────────┐  BLE
  │ static server :8080        │ ────────► │  api  :8765  │──► broadcaster ──► hubs
  │ (python http.server / serve)│ pi:8765  │  (no radio)  │
  └────────────────────────────┘           └──────────────┘
```

## Steps

1. **Serve the client folder** (one command, from the client dir):

   ```bash
   cd bt-core/mk4web/web
   python -m http.server 8080          # or:  npx serve -l 8080
   ```

2. **Open the chooser** — note the path:

   ```
   http://localhost:8080/chooser.html
   ```

   ⚠️ Open **`/chooser.html`**, not `/`. A plain static server has no `index.html`, so
   `/` shows a directory listing. (On the Pi, `/` is the chooser because `api.py` maps it
   server-side; a static server only has the real files.)

3. **Pick a layout** (Excavator or RAW). Cards navigate to the actual file
   (`dashboard.html` / `raw.html`) under a static serve — see *How it works* below.

4. **Set the API endpoint** to your Pi (saved per-browser in `localStorage`):
   - **Dashboard:** ⚙ **Settings** → **API endpoint** field → e.g. `ws://192.168.178.98:8765` → **Connect**.
   - **RAW:** the **API connection** panel at the top of the controls column.

   The default endpoint (when unset) is `ws://<this-page-host>:8765` = `ws://localhost:8765`,
   which points at *your desktop*, not the Pi — so you must set the Pi's IP here. A status
   line shows **connected / retrying / failed**. **Use page host** clears the override.

5. **Drive.** The UI runs locally; the radio runs on the Pi (start it there with
   `python -m mk4web.api`, or the full stack — see [QUICKSTART](QUICKSTART.md)).

## How it works without the Pi's injection

The Pi injects placeholders into the served HTML (`__WS_PORT__`, `__LAYOUTS_JSON__`,
`__INIT_JSON__`, `__SHOW_FULLSCREEN__`). A plain static server does **not** — and the
client degrades gracefully on every one:

| Concern | Raw-served behavior |
|---|---|
| **Chooser layouts** | `__LAYOUTS_JSON__` is unreplaced → the page falls back to `fetch('/layouts.json')` (the static file) and renders the cards. |
| **Layout routes** (`/excavator`, `/raw`) | Derived server-side by the Pi; a static server only has the files. Cards fall back to the layout's actual html file (`dashboard.html`, `raw.html`), so navigation works. |
| **WS port** | `__WS_PORT__` unreplaced → falls back to `8765`. You set the real endpoint anyway (step 4). |
| **Initial bootstrap** | `__INIT_JSON__` unreplaced → `MK4_INIT = null`; the dashboard renders immediately and fills in once the WS `map`/`state` arrives. |
| **Fullscreen button** | The optional flag is unreplaced → defaults **ON** (shown), same as the web. |

These are all client-side fallbacks — no host detection, single source, and they also
benefit the Docker/nginx path ([REMOTE_CLIENT.md](REMOTE_CLIENT.md)).

## Caveats

- **Open `/chooser.html`**, not `/` (no `index.html` in a plain static serve).
- **Decorative images 404.** The client references `/assets/**` (icons, dashboard art),
  which live in the repo's top-level `assets/` — *outside* `web/`, so a `web/`-rooted
  static serve returns 404 for them. **Functionality is unaffected** (controls, channel
  map, driving all work). If you want the images too, either use the Docker/nginx path
  (it maps `/assets`), or serve a directory that also exposes `assets/` at `/assets`.
- The Pi's API accepts any WebSocket origin (LAN hobby tool), so a desktop-served client
  connects fine — see [REMOTE_CLIENT.md §2](REMOTE_CLIENT.md).

The **Pi-served path is unchanged**: `python -m mk4web.api` still serves the same UI at
`http://<pi>:8080/` with the endpoint defaulting to the Pi.
