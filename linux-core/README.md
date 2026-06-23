# linux-core — the Raspberry Pi radio core

The Linux/BlueZ **radio core**: a **thin-transport WebSocket server** + a **raw-HCI BLE
broadcaster** that drive Mould King hubs by broadcasting MK4 telegrams. It's one of the
swappable cores behind the shared WS contract (the other is [`android-core/`](../android-core/)).
(Project overview: [`../README.md`](../README.md) · canonical reference:
[`../dev-docs/PROJECT.md`](../dev-docs/PROJECT.md).)

Two processes in [`mk4web/`](mk4web/):

- **`broadcaster.py`** — owns the radio + the 12-nibble state + the IDLE→CONNECTING→READY
  lifecycle + auto-neutral safety. Transmits over a **raw HCI socket** (default backend
  `rawhci`; `hcitool` legacy fallback) on the **USB dongle**.
- **`api.py`** — the **thin-transport** WebSocket API on `:8765` (the product): raw
  `setup`/`set`/`stop`/`state`/`info`, pushes `lifecycle`/`state`/`info`. It resolves
  **nothing** — the **client** owns the channel map and resolves function→channel. Also
  serves the web client at `:8080` (optional). Contract: [`mk4web/asyncapi.yaml`](mk4web/asyncapi.yaml).

## Run it

```bash
# from the repo root — preflight, then launch (frees the adapter, brings the dongle up BY MAC)
scripts/start.sh --check       # audit only (don't launch)
scripts/start.sh               # live: full control  → http://localhost:8080/
scripts/start.sh --dry-run     # log telegrams, transmit NOTHING
scripts/start.sh --ws-only     # WebSocket only (bring your own client) → ws://localhost:8765
```

Or manually, from `linux-core/` in the venv (two terminals):

```bash
python -m mk4web.broadcaster   # owns the radio (add --dry-run to not transmit)
python -m mk4web.api           # WS :8765 + page :8080  (--ws-only, --http-port N)
```

## Requirements / gotchas

- **Python 3.13** + a venv: `python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt`
  (only runtime dep: `websockets`). Tests: `pytest`.
- **Raw HCI needs root or caps** (`cap_net_raw,cap_net_admin`).
- **`bluetoothd` must be stopped + masked** so it doesn't fight for the adapter
  (`scripts/start.sh` does this, session-only).
- **Resolve the dongle by MAC, not `hciN`** — it re-enumerates (`hci1`→`hci3`) and comes up
  DOWN. Control dongle: Realtek `00:A6:44:02:21:25` (`start.sh` finds it by MAC).
- A solid **5 V/3 A PSU** (under-voltage caused radio failures); disable the onboard
  Broadcom BT (`dtoverlay=disable-bt`) — it corrupts frames at the connect transition.
- **All config is env-overridable** (`MK4_WS_PORT`, `MK4_HTTP_PORT`, `MK4_HCI`,
  `MK4_RADIO_BACKEND`, …) — see [`mk4web/config.py`](mk4web/config.py).

Full setup (boxes → driving): [`../dev-docs/QUICKSTART.md`](../dev-docs/QUICKSTART.md) ·
porting/other boards: [`../dev-docs/PORTING.md`](../dev-docs/PORTING.md) · agent/dev notes:
[`CLAUDE.md`](CLAUDE.md).
