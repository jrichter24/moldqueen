# Run the client standalone for development (no Docker)

Hack on the web UI (**chooser**, **excavator dashboard**, the **generic** layouts, **RAW**) on your desktop with
the client's own dev server, pointed at a running Pi's WebSocket API. No Docker, no build.
The **radio + API stay on the Pi**; you only serve the UI.

```
  your desktop                          Raspberry Pi
  ┌──────────────────────┐  ws://       ┌──────────────┐  BLE
  │ client/serve.py :8080│ ───────────► │  api  :8765  │──► broadcaster ──► hubs
  └──────────────────────┘  pi:8765     │  (no radio)  │
                                        └──────────────┘
```

## Steps

1. **Serve the client** (from `client/`):

   ```bash
   cd client
   python serve.py                       # http://localhost:8080  (WS injected as :8765)
   # python serve.py --port 8080 --ws-port 8765 --host 127.0.0.1
   ```

   `serve.py` reproduces the production serving contract **exactly** (same as the Pi's
   `mk4web/api.py` and Docker): it routes `/` → the chooser, **derives** each layout's
   route from `web/layouts.json` (`/excavator`, `/raw`, …), serves `/layouts.json` with
   routes, and injects all four placeholders (`__WS_PORT__`, `__SHOW_FULLSCREEN__`,
   `__LAYOUTS_JSON__`, `__INIT_JSON__`). Adding a layout needs **no** serve config.

2. **Open** `http://localhost:8080/` → pick a layout.

3. **Set the API endpoint** to your Pi (saved per-browser in `localStorage`):
   - **Dashboard:** ⚙ **Settings** → **API endpoint** → e.g. `ws://192.168.178.98:8765` → **Connect**.
   - **RAW:** the **API connection** panel at the top of the controls column.

   The default endpoint (unset) is `ws://<page-host>:8765` = `ws://localhost:8765`, which
   points at *your desktop* — so set the Pi's IP. **Use page host** clears the override.

4. **Drive.** The UI runs locally; the radio runs on the Pi (start it there with
   `python -m mk4web.api`, or the full stack — see [QUICKSTART](QUICKSTART.md)).

## Notes
- `serve.py` is pure stdlib (no pip deps) and imports **no** core code — the client is
  independent (see [client/README.md](../client/README.md)).
- `/asyncapi.yaml` is a server-side artifact and is **not** served by `serve.py`; the RAW
  console's contract viewer is 404-tolerant (it just shows nothing in standalone dev).
- The Pi's API accepts any WebSocket origin (LAN hobby tool) — see [REMOTE_CLIENT.md §2](REMOTE_CLIENT.md).
- A bare `python -m http.server` from `client/web/` also works for quick edits, but it
  does **not** derive routes or inject — open `/chooser.html` (not `/`), and `/assets/**`
  won't resolve (they live in `client/assets`, not `client/web`). Prefer `serve.py`.

The **Pi-served path is unchanged**: `python -m mk4web.api` serves the same UI at
`http://<pi>:8080/` with the endpoint defaulting to the Pi.
