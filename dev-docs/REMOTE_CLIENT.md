# Running the client separately (remote / Docker)

The moldqueen UI (the **chooser**, the **excavator dashboard**, the **generic** layouts,
and the **RAW** debug view) is a static web client that talks to the Pi's **WebSocket API**
(`ws://<pi>:8765`). You can serve that UI from anywhere — your laptop, a Docker
container, any static host — and point it at the Pi over the LAN. The
**broadcaster stays on the Pi** (it owns the radio); only the API faces clients.

```
  your desktop                         Raspberry Pi
  ┌───────────────────┐   WebSocket    ┌──────────────┐   BLE
  │ moldqueen-client  │ ──────────────►│  api  :8765  │──► broadcaster ──► hubs
  │ (nginx, port 8080)│  ws://pi:8765  │  (no radio)  │
  └───────────────────┘                └──────────────┘
```

## 1. Configurable API endpoint (in the UI)

Both layouts share one setting (`web/clientconfig.js`):

- **Default:** when unset, the endpoint is derived from the page's own host
  (`ws://<this-host>:8765`). So serving the UI **from the Pi** still just works.
- **Override:** set the endpoint explicitly to use a remote Pi.
  - **Dashboard:** open **⚙ Settings** → the **API endpoint** field at the top.
  - **RAW:** the **API connection** panel at the top of the controls column.
  - Enter e.g. `ws://192.168.178.98:8765` and press **Connect**.
- The value is saved in the browser's **localStorage** (per browser), and the
  WebSocket **reconnects** immediately. A status line shows
  **connected / retrying / failed** next to the field. **Use page host** clears
  the override (back to the default).

## 2. CORS / WS origin on the Pi (api.py)

The Pi's API is **permissive by design** for a LAN hobby tool:

- The **WebSocket** server accepts connections from **any Origin** (no `origins=`
  allowlist), so a client served from another host/container can connect.
- The **HTTP** endpoints send `Access-Control-Allow-Origin: *` and answer
  `OPTIONS` preflights, so cross-origin fetches (e.g. `/asyncapi.yaml`) work.

> ⚠️ This is open on your LAN. It assumes a trusted home network. Tightening to a
> specific origin allowlist / network is a future option; don't expose the Pi's
> API to the open internet.

## 3. Run the client in Docker (on your desktop)

A **client-only** image ([`Dockerfile.client`](../Dockerfile.client)) packages the
independent client (`client/`) served by its own [`client/serve.py`](../client/serve.py) —
**no broadcaster, no radio**. `serve.py` **derives** the routes from `layouts.json` and
injects the placeholders exactly like the Pi, so a **new layout works with no Docker/route
config** (the old hardcoded nginx mirror is retired).

```bash
# from the repo root (build context must include client/)
docker build -f Dockerfile.client -t moldqueen-client .
docker run --rm -p 8080:8080 moldqueen-client
```

Then:

1. Open **http://localhost:8080/** → pick a layout.
2. Open the endpoint setting (Settings / API connection) and enter your Pi's API,
   e.g. `ws://192.168.178.98:8765` → **Connect**.
3. Drive — the UI runs locally, the radio runs on the Pi.

Notes:
- The image is meant for a **desktop with Docker** (amd64/arm64). It does not need
  to be built on the Pi.
- `serve.py` injects the endpoint placeholder; until you set an endpoint it defaults to
  the container host, and the channel map loads from the API once connected.

The **Pi-served path is unchanged**: `python -m mk4web.api` still serves the same
UI at `http://<pi>:8080/` with the endpoint defaulting to the Pi.

## 4. No Docker — the client's own dev server

For a zero-tooling dev loop, run the client's own server: `cd client && python serve.py`,
then point it at the Pi. It reproduces the full serving contract (route derivation +
injection). See **[DEV_CLIENT.md](DEV_CLIENT.md)**.
