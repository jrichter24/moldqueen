# Porting & containerization — the API + radio core

How portable is the **server core** (broadcaster + WebSocket API)? Honestly: the API
is plain Python and goes anywhere, but the **broadcaster is hardware-bound** — it
needs raw BLE/HCI access to a real Bluetooth adapter. This is the opposite of the
client (pure static files), which we already containerize cleanly
([`REMOTE_CLIENT.md`](REMOTE_CLIENT.md)). Don't expect "run the core in the cloud."

## Where the core runs today

Raspberry Pi (aarch64) → a **USB BLE dongle** (Realtek RTL8761B, addressed by MAC
`00:A6:44:02:21:25` → an `hciN` index) → BlueZ. By default the broadcaster issues the
HCI advertising commands over a **raw `AF_BLUETOOTH` socket** (the `rawhci` backend, no
`hcitool`); a legacy `hcitool` backend is optional (see *Radio backends* below):

```python
# broadcaster.py (rawhci backend) — HCI 0x08 0x0006/0x0008/0x000a over a raw socket
#   legacy: MK4_RADIO_BACKEND=hcitool shells out to `hcitool -i <hci> cmd 0x08 ...`
```

The onboard Pi BT (hci0) is **unreliable** (corrupts frames at the connect
transition) — a USB dongle is required.

## What the core depends on

| Dependency | Portable? | Notes |
|---|---|---|
| **Python 3.11+** (`websockets`, pure-Python; `pytest` for tests) | ✅ arch-agnostic | no native wheels; x86 and ARM both fine |
| `mouldking_crypt` / `telegram` (the codec) | ✅ pure Python | no hardware |
| **BlueZ userland** — `hciconfig` (bring-up); `hcitool` only for the *legacy* backend | ⚠️ distro-dependent | The **default `rawhci` backend needs NO `hcitool`** (raw socket). `hcitool` is deprecated in newer BlueZ (≈5.64+) and only required if you opt into `MK4_RADIO_BACKEND=hcitool`. |
| **Raw HCI access** | ❌ hardware/priv | needs **root** or `cap_net_raw,cap_net_admin`; `bluetoothd` **stopped + masked** (it grabs the adapter) |
| **A compatible BLE adapter** | ❌ hardware | must accept *manufacturer advertising data* via HCI (`0x08 0x0008`). Most USB BT4.0+ dongles do; behavior is firmware-dependent. |
| Adapter identity | — | found by MAC → `hciN` (`MK4_HCI`, `MK4_DONGLE_MAC`) so a USB re-enumeration doesn't matter |

**Split:** the WebSocket **API** (`api.py`) is portable and needs none of the radio
bits — it talks to the broadcaster over a local Unix socket. The **broadcaster** is
the only hardware-bound piece. (They can even run on different hosts only if they
share that socket — i.e. same machine; the IPC is local by design.)

## (a) Porting to another SBC / Linux box

Realistically: **any Linux with BlueZ + a compatible USB BLE adapter.**

1. Install Python 3.11+ and create the venv (`pip install -r linux-core/requirements.txt`).
2. Install BlueZ for `hciconfig` (adapter bring-up). The **default `rawhci` backend
   needs no `hcitool`**, so hcitool's deprecation on modern distros is a non-issue
   unless you opt into the legacy backend (`MK4_RADIO_BACKEND=hcitool`), which then
   needs a `bluez-deprecated`/`--enable-deprecated` build.
3. Plug in a USB BLE dongle; `sudo systemctl mask --now bluetooth`; bring the adapter
   up (`hciconfig hciN up`). `scripts/start.sh` does the preflight (finds the dongle
   *by MAC*, masks bluetoothd, checks the venv) and works on any such box.
4. Set `MK4_DONGLE_MAC` / `MK4_HCI` for your adapter; run `scripts/start.sh`.

**x86 vs ARM:** no difference for the code — it's pure Python over a raw HCI socket,
no compiled extensions. The variable is the **adapter + BlueZ**, not the CPU.

**What's hard / may not work:** an adapter whose firmware rejects custom adv-data HCI
commands; distros without `hcitool`; SoC-integrated BT that misbehaves (like the Pi's
onboard). Validate with a known-good USB BT4.0+ dongle first.

## (b) Containerizing the core (with host BLE)

Possible, but it's **not** the "ship anywhere" win the client container is — the
container still needs the host's real Bluetooth adapter and elevated privileges.

Requirements:
- **`--net=host`** (BlueZ/HCI is not namespaced like TCP; easiest is host net).
- **`--privileged`**, or at minimum **`--cap-add=NET_RAW --cap-add=NET_ADMIN`** (raw
  HCI). Privileged is the reliable path for HCI.
- The **HCI device must be reachable** from the container (host networking + caps
  generally suffices; some setups also map `/dev` / the rfkill/bt sysfs).
- **`bluetoothd` masked on the HOST** — the host daemon and the container can't both
  own the adapter.
- **`hcitool` + BlueZ in the image** (same deprecation caveat as above).
- Run **broadcaster as root** in the container (raw HCI).

Sketch (illustrative — not shipped):
```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y bluez && rm -rf /var/lib/apt/lists/*
COPY linux-core/ /app/linux-core/
RUN pip install -r /app/linux-core/requirements.txt
WORKDIR /app/linux-core
# run BOTH processes (broadcaster needs the radio; api serves the WS)
```
```bash
sudo systemctl mask --now bluetooth                 # on the HOST
docker run --rm --net=host --privileged moldqueen-core
```

**Why not arbitrary cloud:** the broadcaster transmits over a **physical BLE radio**.
No BLE hardware → nothing to advertise on. Cloud/CI hosts have no adapter, so the
core can't run there meaningfully (the API would start, but `hcitool` has no radio).
The container only helps on a machine that **already has the dongle** — so it buys
you reproducible deps, not portability.

**Honest bottom line:** containerizing the core gives little isolation benefit over
running it natively (it still needs host net, privileges, the host's adapter, and
host bluetoothd masked). For most setups, **run the core natively via `scripts/start.sh`**
and containerize only the *client*. Port the core to a new SBC the normal way: Linux
+ BlueZ + a good USB dongle.

## Radio backends (the abstraction exists)

The radio layer is behind a small **`RadioBackend`** abstraction (`broadcaster.py`),
selectable with **`MK4_RADIO_BACKEND`** / `--radio-backend`:

- **`rawhci`** (**DEFAULT**) — issues the HCI commands over a raw
  `AF_BLUETOOTH`/`BTPROTO_HCI` socket (stdlib `socket`), **no hcitool**, so a fresh
  install has **no BlueZ-`hcitool` dependency** and is future-proof against its
  deprecation. Hardware-proven; needs **root / `CAP_NET_RAW`** (the adapter can stay
  UP). In `--dry-run` it prints the exact HCI packets it would send.
- **`hcitool`** (**legacy** fallback) — shells out to `hcitool`; select with
  `MK4_RADIO_BACKEND=hcitool` for setups where the raw socket can't be used.

So the default no longer depends on `hcitool`; the table's `hcitool` row above applies
only when you opt into the legacy backend. A future `btmgmt` backend could be a third option.
