# Quickstart — from boxes to driving

The fastest path to driving the Mould King 13112 from a Raspberry Pi. (Deep detail:
[`PROJECT.md`](PROJECT.md); tour: [`../README.md`](../README.md).)

## 0. Prerequisites

- **Raspberry Pi** + a **USB BLE dongle** (this build uses a Realtek RTL8761B,
  MAC `00:A6:44:02:21:25`). The onboard Pi BT is unreliable — use a dongle.
- A solid **5 V / 3 A** power supply (under-voltage = flaky radio).
- Both excavator **hubs charged**, model assembled.
- One-time: Python venv

  ```bash
  cd linux-core && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
  ```

## 1. Start the API server (owns the radio)

The launcher preflights the radio (masks `bluetoothd`, brings the dongle up *by MAC*,
checks the venv) and starts the broadcaster + API. **No persistent system changes.**

```bash
scripts/start.sh            # preflight + launch  →  prints  http://<pi-ip>:8080/
# scripts/start.sh --check  # audit only, change nothing
# scripts/start.sh --dry-run# log telegrams, transmit NOTHING
```

The broadcaster starts **IDLE** — nothing is transmitted until you connect in step 3.

## 2. Open the page, pick a layout

Browse to **`http://<pi-ip>:8080/`** → the **layout chooser** → **Excavator (13112)**
(opens `/excavator`). (Your choice is remembered next time.)

## 3. Cold-start with the wizard

Press **Connect** to launch the connection wizard, then:

1. **Power on both hubs** (each shows one long flash) → **Next**.
2. *Connecting…* — both hubs **fast-flash**.
3. Press **ONE** hub's button until it shows **two fast flashes** (= slot 1); leave
   the other on one flash (= slot 0). *(Different slots are required.)*
4. **Ready** → controls unlock.

## 4. Drive

- **Tracks / arms** = drag joysticks (drag = speed, release snaps to neutral).
- **Rotation / bucket** = press-and-hold buttons.
- **STOP** (or Space/Esc) = all neutral. Closing the page also neutralizes.
- **Settings (⚙)** → assign each function to a slot/channel: drive a control, see
  which motor moves, set it, **Save** (this session) or **Promote** (new default).

That's it. 🦾

---

## Advanced

**Run the client elsewhere (e.g. your desktop).** Run the API websocket-only on the
Pi and serve the UI separately, then point it at the Pi:

```bash
# on the Pi — WebSocket only, no web page:
scripts/start.sh --ws-only            # (or: python -m mk4web.api --ws-only)
# on your desktop — the client-only Docker image:
docker build -f Dockerfile.client -t moldqueen-client .
docker run --rm -p 8080:80 moldqueen-client
```

Open `http://localhost:8080/`, then in **Settings → API endpoint** (or the RAW **API
connection** panel) set `ws://<pi-ip>:8765` → **Connect**. See
[`REMOTE_CLIENT.md`](REMOTE_CLIENT.md). `--http-port N` changes the served page port.

**Bring your own client.** Skip the web UI entirely and talk to the WebSocket
(`ws://<pi>:8765`) from your own code — the full contract is in
[`../linux-core/mk4web/asyncapi.yaml`](../linux-core/mk4web/asyncapi.yaml) (drive by function,
manage the channel map, raw set/stop).

**Troubleshooting.** `scripts/check.sh` audits the radio/service state without
changing anything. Common gotchas: `bluetoothd` re-grabbing the adapter (it's masked
by the launcher), the dongle DOWN after a reboot, and under-voltage from a weak PSU —
see the README *Troubleshooting* section.
