# Porting & containerization — the API + radio core

How portable is the **server core** (broadcaster + WebSocket API)? Honestly: the API
is plain Python and goes anywhere, but the **broadcaster is hardware-bound** — it
needs raw BLE/HCI access to a real Bluetooth adapter. This is the opposite of the
client (pure static files), which we already containerize cleanly
([`REMOTE_CLIENT.md`](REMOTE_CLIENT.md)). Don't expect "run the core in the cloud."

## Where the core runs today

Raspberry Pi (aarch64) → a **USB BLE dongle** (Realtek RTL8761B, addressed by MAC
`00:A6:44:02:21:25` → an `hciN` index) → BlueZ. The broadcaster shells out to
**`hcitool`** to set advertising params/data and toggle advertising:

```python
# broadcaster.py
subprocess.run(f"hcitool -i {hci} cmd 0x08 0x0006/0x0008/0x000a ...")   # raw HCI
```

The onboard Pi BT (hci0) is **unreliable** (corrupts frames at the connect
transition) — a USB dongle is required.

## What the core depends on

| Dependency | Portable? | Notes |
|---|---|---|
| **Python 3.11+** (`websockets`, pure-Python; `pytest` for tests) | ✅ arch-agnostic | no native wheels; x86 and ARM both fine |
| `mouldking_crypt` / `telegram` (the codec) | ✅ pure Python | no hardware |
| **BlueZ userland** — `hcitool`, `hciconfig` | ⚠️ distro-dependent | **`hcitool` is deprecated** in newer BlueZ (≈5.64+); may be absent or need a deprecated-tools build. The Pi here runs BlueZ 5.82 where it works. |
| **Raw HCI access** | ❌ hardware/priv | needs **root** or `cap_net_raw,cap_net_admin`; `bluetoothd` **stopped + masked** (it grabs the adapter) |
| **A compatible BLE adapter** | ❌ hardware | must accept *manufacturer advertising data* via HCI (`0x08 0x0008`). Most USB BT4.0+ dongles do; behavior is firmware-dependent. |
| Adapter identity | — | found by MAC → `hciN` (`MK4_HCI`, `MK4_DONGLE_MAC`) so a USB re-enumeration doesn't matter |

**Split:** the WebSocket **API** (`api.py`) is portable and needs none of the radio
bits — it talks to the broadcaster over a local Unix socket. The **broadcaster** is
the only hardware-bound piece. (They can even run on different hosts only if they
share that socket — i.e. same machine; the IPC is local by design.)

## (a) Porting to another SBC / Linux box

Realistically: **any Linux with BlueZ + a compatible USB BLE adapter.**

1. Install Python 3.11+ and create the venv (`pip install -r bt-core/requirements.txt`).
2. Install BlueZ userland with `hcitool`/`hciconfig`. **Gotcha:** on modern distros
   these are deprecated/removed — you may need the distro's `bluez-deprecated`/
   compat package, or to build BlueZ with `--enable-deprecated`. If `hcitool` truly
   isn't available, the radio layer would need porting to `btmgmt`/raw `AF_BLUETOOTH`
   sockets (noted as a future option in `requirements.txt`; not done yet).
3. Plug in a USB BLE dongle; `sudo systemctl mask --now bluetooth`; bring the adapter
   up (`hciconfig hciN up`). `scripts/start.sh` does the preflight (finds the dongle
   *by MAC*, masks bluetoothd, checks the venv) and works on any such box.
4. Set `MK4_DONGLE_MAC` / `MK4_HCI` for your adapter; run `scripts/start.sh`.

**x86 vs ARM:** no difference for the code — it's pure Python + `hcitool` subprocess,
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
COPY bt-core/ /app/bt-core/
RUN pip install -r /app/bt-core/requirements.txt
WORKDIR /app/bt-core
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

## If we wanted true portability later

- Replace the `hcitool` subprocess with direct **`AF_BLUETOOTH`/`BTPROTO_HCI`** raw
  sockets (stdlib `socket`) — removes the `hcitool` dependency and its deprecation
  risk; still needs a real adapter + caps.
- Or a thin **radio-worker** abstraction so the adapter backend (hcitool / btmgmt /
  raw socket) is swappable per platform.
