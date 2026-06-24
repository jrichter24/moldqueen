# android-core — the standalone Android radio core

A standalone Android app (`com.dnaevolutions.moldqueen`, **MoldQueen**) that is a **second
radio core**: it owns a **native BLE advertiser**, serves the **same thin-transport
WebSocket API** (`ws://127.0.0.1:8765`) and the **bundled web client** (`http://127.0.0.1:8080`,
single-sourced from [`../client/`](../client/) at build), and shows it in a full-screen
WebView. No Pi, no network — the phone does everything. One of the swappable cores behind
the shared contract (the other is [`../linux-core/`](../linux-core/)).

## Build & run

```bash
cd android-core
./gradlew installDebug         # build + install to a connected device  (Kotlin 1.9.22 · Gradle 8.1.1 · JDK 17)
```

Open the **MoldQueen** app → Connect → Ready → drive. Requires Android 12+ (grant the
Bluetooth permission).

**Full detail — what it is, the AdvertisingSet radio, the build toolchain, gamepad,
and release/signing — is in
[`../dev-docs/ANDROID.md`](../dev-docs/ANDROID.md).** Project overview:
[`../README.md`](../README.md).
