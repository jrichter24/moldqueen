# Running the client separately (remote / Docker)

The moldqueen UI (the **chooser**, the **excavator dashboard**, and the **RAW**
debug view) is a static web client that talks to the Pi's **WebSocket API**
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

A **client-only** image ([`Dockerfile.client`](../Dockerfile.client)) packages just
the static UI behind nginx — **no broadcaster, no radio**. nginx mirrors the Pi's
routes (`/` → chooser, `/excavator`, `/raw`; see
[`deploy/nginx-client.conf`](../deploy/nginx-client.conf)).

```bash
# from the repo root (build context must include bt-core/ and assets/)
docker build -f Dockerfile.client -t moldqueen-client .
docker run --rm -p 8080:80 moldqueen-client
```

Then:

1. Open **http://localhost:8080/** → pick a layout.
2. Open the endpoint setting (Settings / API connection) and enter your Pi's API,
   e.g. `ws://192.168.178.98:8765` → **Connect**.
3. Drive — the UI runs locally, the radio runs on the Pi.

Notes:
- The image is meant for a **desktop with Docker** (amd64/arm64). It does not need
  to be built on the Pi.
- The HTML is served raw by nginx (no server-side injection); that's fine — the
  endpoint just defaults to the container host until you set it, and the channel
  map loads from the API once connected.

The **Pi-served path is unchanged**: `python -m mk4web.api` still serves the same
UI at `http://<pi>:8080/` with the endpoint defaulting to the Pi.

## 4. No Docker — plain static server (development)

For a zero-tooling dev loop you can skip Docker entirely and serve the client folder
with any plain static server (`python -m http.server`, `npx serve`), then point it at
the Pi. See **[DEV_CLIENT.md](DEV_CLIENT.md)** for the exact command, which URL to open
(`/chooser.html`), and how the client degrades gracefully without the Pi's injection.
