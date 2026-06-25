# esp32-core — the ESP32-S3 radio core (in progress)

The third moldqueen radio core, a peer to [`linux-core/`](../linux-core/) (Raspberry Pi)
and [`android-core/`](../android-core/), consuming the **same single-source client** over
the **same WebSocket contract**: *swap the radio core, keep the client*. It is **dumb
transport, smart client** — it will broadcast already-resolved telegrams and resolve
nothing itself.

**Status: foundation only.** This first slice is the **MouldKingCrypt C port** plus a
byte-exact self-test. There is **no NimBLE / radio / WS server yet** — those come next
(owned by the `esp32-core-dev` agent).

## Layout
- `components/mouldking_crypt/` — the clean-room **C port of the MouldKing cipher**
  (`mk_crypt_encode` / `mk_crypt_decode`), pure portable C99 with no ESP-IDF
  dependencies. A derivative of J0EK3R/mkconnect-python (MIT) — see the file header and
  the repo-root [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md).
- `test/mk_crypt_selftest.{c,h}` — the shared byte-exact self-test (the repo's
  CONNECT / STOP / CH0 vectors), used by **both** the host test and the on-device app, so
  there is one source of vectors.
- `test/host_test.c` + `test/run_host_test.sh` — desktop build + run (no board, CI-able)
  for when a host C compiler (gcc/clang/cc) is available.
- `main/` — the ESP-IDF app: runs the self-test at boot and prints PASS/FAIL over serial.

## Target / config
Heemol **ESP32-S3 N16R8 DevKitC-1** — 16 MB flash, 8 MB octal PSRAM. `sdkconfig.defaults`
selects `esp32s3`, 16 MB flash, and enables the octal PSRAM.

## Build / flash / verify
In an ESP-IDF **v5.5.4** environment (see the esp32 build-env notes for the Windows
activation), from `esp32-core/`:

```
idf.py set-target esp32s3
idf.py build
idf.py -p COM10 flash monitor    # prints the crypt self-test PASS/FAIL, then idles
```

Host test (when a desktop compiler exists), from `esp32-core/`:

```
sh test/run_host_test.sh         # exit 0 = every vector byte-exact
```
