# esp32-core — the ESP32-S3 radio core (in progress)

The third moldqueen radio core, a peer to [`linux-core/`](../linux-core/) (Raspberry Pi)
and [`android-core/`](../android-core/), consuming the **same single-source client** over
the **same WebSocket contract**: *swap the radio core, keep the client*. It is **dumb
transport, smart client** — it will broadcast already-resolved telegrams and resolve
nothing itself.

**Status: in progress.** The **MouldKingCrypt C port** (byte-exact) and the **NimBLE
0xFFF0 advertiser** are in — the ESP32 connects + drives a real hub (hardware-confirmed).
Still to come (owned by the `esp32-core-dev` agent): auto-neutral keepalive + STOP, the
WiFi WebSocket server mirroring `api.py`, and serving the client from flash.

## Layout
- `components/mouldking_crypt/` — the clean-room **C port of the MouldKing cipher**
  (`mk_crypt_encode` / `mk_crypt_decode`), pure portable C99 with no ESP-IDF
  dependencies. A derivative of J0EK3R/mkconnect-python (MIT) — see the file header and
  the repo-root [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md).
- `test/mk_crypt_selftest.{c,h}` — the shared byte-exact self-test (the repo's
  CONNECT / STOP / CH0 vectors), used by **both** the host test and the on-device app, so
  there is one source of vectors.
- `components/mk4_advertiser/` — the **NimBLE 0xFFF0 advertiser**: builds the 12-nibble
  MK4 telegram, crypts it, wraps it as company-0xFFF0 manufacturer data, and broadcasts a
  legacy connectable advert. Telegram changes update the adv data **in place** on the
  continuously-running advertiser (`ble_gap_adv_set_data`) — **never** stop/start (the
  extended-adv path would `EBUSY` while active and force a stop/start; this is why we use
  legacy advertising). This is the SACRED no-runaway rule.
- `test/host_test.c` + `test/run_host_test.sh` — desktop build + run (no board, CI-able)
  for when a host C compiler (gcc/clang/cc) is available.
- `main/` — the ESP-IDF **advertiser test harness**: broadcasts CONNECT, then a short
  finite drive demo on slot0/ch0, then holds neutral. (The crypt self-test lives in
  `test/` and runs via the host build.)

## Target / config
Heemol **ESP32-S3 N16R8 DevKitC-1** — 16 MB flash, 8 MB octal PSRAM. `sdkconfig.defaults`
selects `esp32s3`, 16 MB flash, and enables the octal PSRAM.

## Build / flash / verify
In an ESP-IDF **v5.5.4** environment (see the esp32 build-env notes for the Windows
activation), from `esp32-core/`:

```
idf.py set-target esp32s3
idf.py build
idf.py -p COM10 flash monitor    # advertiser harness: CONNECT, a short drive demo, then holds neutral
```

> Driving a real hub: only **one** 0xFFF0 transmitter at a time — make sure the Pi
> broadcaster and the phone app are not also advertising.

Host test (when a desktop compiler exists), from `esp32-core/`:

```
sh test/run_host_test.sh         # exit 0 = every vector byte-exact
```
