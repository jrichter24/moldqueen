# moldqueen client (independent web UI)

This is the **standalone web client** for moldqueen — the **chooser**, the **excavator
dashboard**, and the **RAW** debug view. It is an **independent peer**: it has **no
dependency on any core** and never reaches into one. Multiple hosts *consume* it (the
Pi service, the Android app, this folder's `serve.py`, Docker) — the direction is always
**host → client**, never the reverse.

## What the client depends on (its only contract)
- A **WebSocket API** that speaks the moldqueen control protocol — set the endpoint in
  the UI (Settings / API connection → `ws://<host>:8765`). The contract is published as
  **AsyncAPI**, served at `/asyncapi.yaml` by a full host (this dev server omits it, and
  the client is 404-tolerant).
- Its **own static files** (`web/`) + **art** (`assets/`), served at the **web root**.
- Four placeholders the serving host injects (it stays valid un-injected too):
  `__WS_PORT__`, `__SHOW_FULLSCREEN__`, `__LAYOUTS_JSON__`, `__INIT_JSON__`.

The client never imports, fetches, or assumes anything from a core — only the WS contract.

## Run it standalone (development)
```bash
cd client
python serve.py                 # http://localhost:8080  (WS endpoint injected as :8765)
# python serve.py --port 8080 --ws-port 8765 --host 127.0.0.1
```
`serve.py` reproduces the production serving contract exactly: it routes `/` and
`/index.html` → the chooser, **derives** each layout's route from `web/layouts.json`
(`/excavator`, `/raw`, …), serves `/layouts.json` with routes, and injects the four
placeholders. So the standalone client behaves identically to the Pi/Docker.

Then **open `http://localhost:8080/`**, pick a layout, and set the **API endpoint** to
your Pi (`ws://<pi-ip>:8765`). The UI runs locally; the radio runs on the Pi.

## Layout
```
client/
  web/        # chooser/dashboard/raw/template (html/js/css) + layouts.json — the client
  assets/     # served UI art (icons, LED gifs, dashboard background, banners)
  serve.py    # standalone dev server (the §contract above) — pure stdlib, no core import
  README.md
```
Add a layout: see [dev-docs/ADDING_A_LAYOUT.md](../dev-docs/ADDING_A_LAYOUT.md). Other serving
hosts: [dev-docs/REMOTE_CLIENT.md](../dev-docs/REMOTE_CLIENT.md), [dev-docs/DEV_CLIENT.md](../dev-docs/DEV_CLIENT.md).
