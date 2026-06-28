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
- **Optional — discovery by name** (`sudo apt install avahi-utils`): lets the Pi advertise
  **`moldqueenrasp.local`** so the client can point at `ws://moldqueenrasp.local:8765` instead of
  the IP — mirroring the ESP32's `moldqueenesp.local`. `avahi-daemon` ships with Raspberry Pi OS;
  `start.sh` advertises the name automatically while the core runs (additive — the Pi's own
  `<hostname>.local` and the IP still work). Skip it and the core still works by IP. See
  [§ mDNS](#mdns--reach-the-pi-by-name) below.

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

Browse to **`http://<pi-ip>:8080/`** (or **`http://moldqueenrasp.local:8080/`** with
`avahi-utils` installed) → the **layout chooser** → **Excavator (13112)** (opens
`/excavator`). (Your choice is remembered next time.)

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

### mDNS — reach the Pi by name

With `avahi-utils` installed (`sudo apt install avahi-utils`; `avahi-daemon` already ships
with Raspberry Pi OS), the Pi advertises **`moldqueenrasp.local`** so you can use the name
instead of the IP — `ws://moldqueenrasp.local:8765` (or `http://moldqueenrasp.local:8080/`),
mirroring the ESP32's `moldqueenesp.local`.

- **How:** `scripts/start.sh` launches `scripts/mdns.sh` in the background while the core runs.
  It's an **additive** alias (`avahi-publish -a moldqueenrasp.local <ip>`) — the Pi's own
  `<hostname>.local` and the IP keep working, and the system hostname is **not** renamed.
- **Graceful:** if `avahi-utils` isn't installed, mDNS is skipped and the core still works by IP.
  Disable it explicitly with `MK4_NO_MDNS=1`; change the name with `MK4_MDNS_NAME=foo`.
- **Always-on (optional, survives reboot, no need to run the core):** install the shipped
  systemd unit template —

  ```bash
  sed "s|__REPO__|$(pwd)|; s|__USER__|$USER|" scripts/moldqueen-mdns.service \
    | sudo tee /etc/systemd/system/moldqueen-mdns.service >/dev/null
  sudo systemctl enable --now moldqueen-mdns
  ```
- **Check it:** `avahi-resolve -n moldqueenrasp.local` (on the Pi or any LAN machine with mDNS).

**Run the client elsewhere (e.g. your desktop).** Run the API websocket-only on the
Pi and serve the UI separately, then point it at the Pi:

```bash
# on the Pi — WebSocket only, no web page:
scripts/start.sh --ws-only            # (or: python -m mk4web.api --ws-only)
# on your desktop — the client-only Docker image:
docker build -f Dockerfile.client -t moldqueen-client .
docker run --rm -p 8080:8080 moldqueen-client
```

Open `http://localhost:8080/`, then in **Settings → API endpoint** (or the RAW **API
connection** panel) set `ws://<pi-ip>:8765` → **Connect**. See
[`REMOTE_CLIENT.md`](REMOTE_CLIENT.md). `--http-port N` changes the served page port.

**Bring your own client.** Skip the web UI entirely and talk to the WebSocket
(`ws://<pi>:8765`) from your own code. The full contract is in
[`../linux-core/mk4web/asyncapi.yaml`](../linux-core/mk4web/asyncapi.yaml): the thin-transport
primitives `setup` / `set` / `stop` / `state` / `info`. The server is thin transport, so your
client resolves function→channel and owns the channel map (it sends only raw `set`).

**Troubleshooting.** `scripts/check.sh` audits the radio/service state without
changing anything. Common gotchas: `bluetoothd` re-grabbing the adapter (it's masked
by the launcher), the dongle DOWN after a reboot, and under-voltage from a weak PSU —
see the README *Troubleshooting* section.
