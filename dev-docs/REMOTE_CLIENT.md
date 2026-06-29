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

## 3. Run the client in Docker (the "no Python, one command" path)

A **client-only** image packages the independent client (`client/`) served by its own
[`client/serve.py`](../client/serve.py), with **no broadcaster, no radio**. `serve.py`
**derives** the routes from `layouts.json` and injects the placeholders exactly like the Pi,
so a **new layout works with no Docker/route config** (the old hardcoded nginx mirror is
retired). This is the **no-Python, one-command** way to host the client, sitting alongside
[`serve.py`](#4-no-docker--the-clients-own-dev-server) (needs Python) and the Pi-served page
(needs the full core).

### 3a. Run the published image (recommended)

A public image is published to the GitHub Container Registry, so you don't have to build
anything:

```bash
docker run --rm -p 8080:8080 ghcr.io/jrichter24/moldqueen-client:latest
```

- **Tags:** `:latest` tracks the newest build; `:0.1.0` pins the current version.
- **Port:** the container listens on `8080`; the **host** port is the **left** number, so
  remap freely (e.g. `-p 9090:8080`).
- **Package page** (not a GitHub Release; it lives on the repo's Packages tab):
  <https://github.com/jrichter24/moldqueen/pkgs/container/moldqueen-client>.

### 3b. Or build it yourself

The image is built from [`Dockerfile.client`](../Dockerfile.client):

```bash
# from the repo root (build context must include client/)
docker build -f Dockerfile.client -t moldqueen-client .
docker run --rm -p 8080:8080 moldqueen-client
```

### Then, either way

1. Open **http://localhost:8080/** → pick a layout.
2. Open the endpoint setting (Settings / API connection) and point it at your device, e.g.
   `ws://moldqueenrasp.local:8765` (Pi), `ws://moldqueenesp.local:8765` (ESP32), or the IP
   form `ws://192.168.178.98:8765` → **Connect**.
3. Drive. The UI runs locally, the radio runs on your device.

### Why local hosting works (same-protocol, no mixed content)

The Docker image serves the client over **`http://localhost`**, so the browser lets it open
a plain **`ws://` LAN device** (same insecure scheme, **no mixed-content block**). That's the
key difference from an **https** Pages-hosted client, which a browser **would block** from
reaching a `ws://` device. Docker (or `serve.py`) is therefore the real **local-hosting**
answer for driving **your own** device. It is **not** a hosted demo and does **not** drive a
toy without a device.

Notes:
- The image is meant for a **desktop with Docker** (the published image is `linux/amd64`).
  It does not need to be built on the Pi.
- `serve.py` injects the endpoint placeholder; until you set an endpoint it defaults to
  the container host, and the channel map loads from the API once connected.

The **Pi-served path is unchanged**: `python -m mk4web.api` still serves the same
UI at `http://<pi>:8080/` with the endpoint defaulting to the Pi.

## 4. No Docker — the client's own dev server

For a zero-tooling dev loop, run the client's own server: `cd client && python serve.py`,
then point it at the Pi. It reproduces the full serving contract (route derivation +
injection). See **[DEV_CLIENT.md](DEV_CLIENT.md)**.
