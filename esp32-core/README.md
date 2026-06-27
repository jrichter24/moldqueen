# esp32-core — the ESP32-S3 radio core (in progress)

The third moldqueen radio core, a peer to [`linux-core/`](../linux-core/) (Raspberry Pi)
and [`android-core/`](../android-core/), consuming the **same single-source client** over
the **same WebSocket contract**: *swap the radio core, keep the client*. It is **dumb
transport, smart client** — it will broadcast already-resolved telegrams and resolve
nothing itself.

**Status: in progress.** The **MouldKingCrypt C port** (byte-exact), the **NimBLE 0xFFF0
advertiser**, the **safety layer** (auto-neutral keepalive + STOP), the **WiFi WebSocket
server** mirroring `api.py`, **WiFi provisioning** (NVS creds + a fallback AP config page),
and **device discovery** (mDNS `moldqueenesp.local` + a **branded bilingual config/saved
page**) are in — the **unmodified** single-source client drives a real toy **over WiFi**
(drive + STOP + auto-neutral over the live path, no WiFi/BLE coexistence stutter, reached
via the `.local` name and a custom WS port), and the firmware is now **distributable** (no
creds compiled in — anyone flashes it and enters their own WiFi) — all hardware-confirmed.
Still to come (owned by the `esp32-core-dev` agent): a **Group B** web status/management
page (at `moldqueenesp.local:8080` — status link, change-network / force-AP / restart, the
re-provision path) and serving the client from flash.

## Layout
- `components/mouldking_crypt/` — the clean-room **C port of the MouldKing cipher**
  (`mk_crypt_encode` / `mk_crypt_decode`), pure portable C99 with no ESP-IDF
  dependencies. A derivative of J0EK3R/mkconnect-python (MIT) — see the file header and
  the repo-root [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md).
- `test/mk_crypt_selftest.{c,h}` — the shared byte-exact self-test (the repo's
  CONNECT / STOP / CH0 vectors), used by **both** the host test and the on-device app, so
  there is one source of vectors.
- `components/mk4_advertiser/` — the **NimBLE 0xFFF0 advertiser + safety layer**: builds
  the 12-nibble MK4 telegram, crypts it, wraps it as company-0xFFF0 manufacturer data, and
  broadcasts a legacy connectable advert. Telegram changes update the adv data **in place**
  on the continuously-running advertiser (`ble_gap_adv_set_data`) — **never** stop/start
  (the extended-adv path would `EBUSY` while active and force a stop/start; this is why we
  use legacy advertising). This is the SACRED no-runaway rule. **Safety:** a per-channel
  dead-man's-switch auto-neutrals any channel not refreshed within **300 ms** (matching
  `api.py` / `ApiCore`), and **STOP** tears the advertiser down + reconnects at neutral
  (the one deliberate teardown, distinct from per-change churn).
- `components/mk4_wifi/` — WiFi **station** + **SoftAP** + the **NVS store** (creds + the
  configurable **WS port**). Joins a home WiFi from creds stored in **NVS** (flash — never
  compiled in, never in git), gets a DHCP IP, prints it; brings up the SoftAP for
  provisioning; and provides the **pre-AP network scan** (SSID + RSSI, strongest-first) and
  the device **MAC** for the config page.
- `components/mk4_provision/` — **provisioning**: a SoftAP (`moldqueen-setup`, open) + a
  **branded, self-contained config page** at **`http://192.168.4.1/`** (it is NOT the
  moldqueen client). Fully offline (the AP has no internet): the **MoldQueen icon is inlined
  (base64)**, CSS/JS inlined, **EN/DE i18n**. It shows a **scrollable scanned-network list
  with signal strength** (tap to fill the SSID), a **show-password** toggle, a
  careful-password hint, a **WS-port** field (with helper text), and **copy buttons** for the
  device MAC and the resulting `ws://moldqueenesp.local:<port>` endpoint. On submit it saves
  the WiFi creds + WS port to NVS, shows a matching **branded Saved page** (endpoint + MAC,
  copyable), and reboots into station mode.
- `components/mk4_ws_server/` — the **WiFi WebSocket server** (`esp_http_server` WS, port
  **8765**) mirroring the `api.py` thin-transport contract (`setup`/`set`/`stop`/`state`/
  `info` + `lifecycle`/`state`/`info` pushes; `radio_backend` = `esp32-nimble`). `set`
  feeds the advertiser's 300 ms keepalive; `stop` fires the STOP teardown — the live WiFi
  command path is protected by the safety layer. The ESP32 does **not** serve the client
  (served elsewhere; point its endpoint at `ws://<esp32-ip>:8765`).
- `test/host_test.c` + `test/run_host_test.sh` — desktop build + run (no board, CI-able)
  for when a host C compiler (gcc/clang/cc) is available.
- `main/` — the ESP-IDF app + boot logic: **NVS creds → try station (30 s) → on success
  normal op (advertiser + safety + WS server + mDNS) / on empty-or-timeout → provisioning
  AP**. In normal op it advertises **mDNS** (hostname `moldqueenesp`, a `_ws._tcp` service on
  the configured port) so the client can use `ws://moldqueenesp.local:<port>` instead of an
  IP; it also prints the IP. (The crypt self-test lives in `test/` and runs via the host
  build.)

## Target / config
Heemol **ESP32-S3 N16R8 DevKitC-1** — 16 MB flash, 8 MB octal PSRAM. `sdkconfig.defaults`
selects `esp32s3`, 16 MB flash, and enables the octal PSRAM.

## Build / flash / verify
In an ESP-IDF **v5.5.4** environment (see the esp32 build-env notes for the Windows
activation), from `esp32-core/`:

```
idf.py set-target esp32s3
idf.py build
idf.py -p COM10 flash monitor    # first boot (empty NVS) -> provisioning AP
```

**First-time setup (no creds baked in):** on first boot (empty NVS) the board starts the
SoftAP **`moldqueen-setup`** (open). Join it, browse to **`http://192.168.4.1/`**, pick your
WiFi from the scanned list (or type it), enter the password, optionally set the WS port, and
Save — it saves to NVS, reboots, and joins your network. Point the client's WS endpoint at
**`ws://moldqueenesp.local:<port>`** (default port 8765; mDNS, so no IP needed — the printed
IP also works). The client is served elsewhere (the Pi / `client/serve.py`). Only **one**
0xFFF0 transmitter at a time — make sure the Pi broadcaster and the phone app are not also
advertising.

**Re-provisioning / changing WiFi:** there is **no physical override** yet — a
double-reset / BOOT-hold trigger was evaluated and **dropped as unreliable on this board**
(GPIO0 is the boot strap; the EN-pin reset clears RTC memory). A re-provision button on the
planned **web management page** will replace it. For now the board re-enters provisioning
**automatically when the saved network is unreachable**, or erase NVS to force it
(`idf.py -p COM10 erase-flash` + reflash).

Host test (when a desktop compiler exists), from `esp32-core/`:

```
sh test/run_host_test.sh         # exit 0 = every vector byte-exact
```
