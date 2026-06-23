# Android — the standalone radio core

The `android-core/` app is a **second radio core**: it does on a phone what the Pi does,
behind the **same WebSocket contract**. No Pi, no laptop, no network — it owns the radio
*and* serves the UI, all on-device. (Back to the [README](../README.md) ·
architecture in [PROJECT.md](PROJECT.md).)

## What it is

One Android service (`Mk4Service`) wiring three things together:

- **Native BLE radio** (`BleBroadcaster`) — broadcasts Mould King MK4 telegrams
  (company `0xFFF0`) using Android's **`AdvertisingSet`** API. It updates the *running*
  advertiser **in place** (`setAdvertisingData`, on change only — no stop/start churn),
  legacy connectable adverts at ~100 ms (≈10/s), which is what holds a hub connected.
  STOP is **kill-and-reconnect-at-neutral** (kill the advertiser → settle → connect →
  neutral) — see [GAMEPAD.md](GAMEPAD.md)/the safety model. Codec: a Kotlin
  `MouldKingCrypt`, byte-exact against the stock app.
- **Local WebSocket API** on `ws://127.0.0.1:8765` (`Mk4WsServer`) — a clean-room port of
  `linux-core/mk4web/api.py`: the **identical thin-transport contract**
  (`setup`/`set`/`stop`/`state`/`info`; pushes `lifecycle`/`state`/`info`), the
  IDLE→CONNECTING→READY lifecycle, and the per-channel affirmative-keepalive
  dead-man's-switch. It holds **no** channel map — the client resolves everything.
- **Local HTTP server** on `http://127.0.0.1:8080` (`ClientHttpServer`, NanoHTTPD) — serves
  the **bundled client** (chooser, layouts, `/asyncapi.yaml`, assets), deriving routes from
  `layouts.json` exactly like the Pi, and injecting the WS port.

A full-immersive, landscape-locked **WebView** (`MainActivity`) loads
`http://localhost:8080/` — so on the phone you get the *same* chooser + layouts + MK4Chrome
as on the Pi, talking to the *same* contract.

**The client is single-sourced.** A Gradle `bundleClient` task copies `client/web` +
`client/assets` into the app's assets at build time — there is no second copy of the UI to
maintain; the phone serves the same `client/` the Pi does.

## Build & install

Zero-install toolchain (the wrapper fetches Gradle): **Kotlin 1.9.22 · Gradle 8.1.1 ·
JDK 17 · AGP 8.0.2 · minSdk 31 / targetSdk 33**. Package `com.dnaevolutions.moldqueen`
(app name **MoldQueen**); `versionName` is `0.1-radio-proof+build.<N>` (build number auto-
increments locally and is surfaced in the in-app server-info, so you can verify the exact
build on the device).

```bash
cd android-core
./gradlew installDebug        # build + install to a connected device (adb)
#   or: ./gradlew assembleDebug   → app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.dnaevolutions.moldqueen/.MainActivity
```

Then in the app: **Connect → Ready → drive** (the connect wizard guides the hub buttoning,
same as the Pi). Grant the **Bluetooth (advertise/connect)** permission when prompted.

Notes:
- Requires Android 12+ (runtime `BLUETOOTH_ADVERTISE` / `BLUETOOTH_CONNECT` + `INTERNET`).
  `network_security_config.xml` permits cleartext only to `localhost` (for the loopback
  HTTP/WS); everything else stays HTTPS-only.
- Verified on a **Samsung Galaxy S25**; landscape-locked on any device.
- **Gamepad gap:** Android **System WebView has no Gamepad API**, so controller input
  doesn't work in the in-app WebView — touch works fully, and it degrades gracefully
  ("no controller"). See [GAMEPAD.md](GAMEPAD.md). (Gamepad is a web/desktop feature.)

## Maturity & next steps

The radio/API/serving path is **working and feature-complete** (safety verified on S25);
the app is also a reference implementation for any future mobile core. **Future:** a
**signed release / Play-Store** build (today it's a local `installDebug`); see
[ROADMAP.md](ROADMAP.md).
