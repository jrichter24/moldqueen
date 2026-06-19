# java-core

Hardware-**independent** Java library: the brains that build telegrams and
orchestrate the hubs. **No BLE, no HCI, no Pi-only anything** — pure bytes + logic.

## Purpose

- Build BLE-advertising **telegrams**: the encoding/crypto step, the
  channel→speed mapping over the **−7..+7** range, and the rolling counter.
- Address telegrams **per hub** (device 0 / device 1).
- Orchestrate **multiple hubs** so both can be driven at once.
- Emit **payload bytes** for a linux-core radio worker to broadcast. That's the
  whole contract on this side: bytes out.

## The one hard rule

This module **must stay portable**. It may be developed on a Windows PC and the
built artifact deployed to the Pi. So:

- No `java.net` BLE, no raw sockets, no `/dev`, no OS assumptions.
- No dependency that only exists or only works on the Pi.
- If it touches a radio, it does **not** belong here — it belongs in
  [`../linux-core/`](../linux-core/).

Everything here must be **unit-testable without hardware**. Test-first is the
expectation: write the failing test, then the telegram logic.

## Stack

- Java **21** (compiled with `sourceCompatibility`/`targetCompatibility` = 21).
- **Gradle** via the committed wrapper (`./gradlew`), distribution **8.10.2**.
- **JUnit 5 (Jupiter)** for tests.

## Build / test

```bash
./gradlew test          # compile + run the JUnit tests
./gradlew build         # full build
```

### ⚠️ Gradle is slow on this Pi

This Raspberry Pi 3B (1 GB RAM) is a weak JVM build machine. The **first** build
downloads the Gradle distribution and dependencies and took **~2.5 minutes**;
later builds are faster but still not snappy. To keep the Pi healthy,
[`gradle.properties`](gradle.properties) caps the heap (`-Xmx512m`) and **disables
the Gradle daemon** so it doesn't sit resident eating RAM the radio workers need.

If you develop java-core on a roomier machine, feel free to raise the heap and
re-enable the daemon in a **local, uncommitted** `gradle.properties` override —
just don't commit Pi-hostile defaults.

## Layout

```
java-core/
├── build.gradle           # java-library, JUnit 5, Java 21
├── settings.gradle        # rootProject.name = 'java-core'
├── gradle.properties      # Pi-friendly JVM/daemon settings
├── gradlew, gradlew.bat   # committed wrapper (Gradle 8.10.2)
├── gradle/wrapper/        # wrapper jar + properties
└── src/
    ├── main/java/com/dnaevolutions/moldqueen/   # CoreInfo.java (placeholder)
    └── test/java/com/dnaevolutions/moldqueen/   # CoreInfoTest.java (passing)
```

`CoreInfo` is a deliberate placeholder that just proves the toolchain builds and
tests. Telegram construction + multi-hub orchestration replace it.

## Boundaries

- **Downstream:** emits payload bytes to a [`../linux-core/`](../linux-core/) radio
  worker. The IPC/protocol is **TBD — keep it pluggable.**
- **Upstream:** [`../web-gui/`](../web-gui/) will ask java-core to produce
  telegrams (wiring TBD).
- Never reach into radios directly. That's linux-core's job, always.
