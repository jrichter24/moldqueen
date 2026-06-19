# MK+tech (Mould King) BLE Protocol — Reverse-Engineering Report

**App:** `MK+tech` v2.6.4 (APKPure `.xapk`), package `com.yxkj` (`building_block_robot_26`)
**Date:** 2026-06-15
**Goal:** Determine how the app assigns a **second hub to "device 1"** on the broadcast-controlled (company ID `0xFFF0`) Mould King building-block hubs, and compare to the J0EK3R/mkconnect-python "MK6.0" reference.
**Scope:** Interoperating with hubs the user owns; focus on the addressing / device-assignment mechanism.

---

## 0. TL;DR

- The app is a **Flutter** app. All BLE *telegram content* logic is compiled Dart inside `libapp.so`; the *encryption + transmit* logic is in a custom Java plugin `com.flutter.h_ble`.
- The **MouldKingCrypt encryption was fully recovered** (from Java) and is **byte-for-byte identical to the reference**: fixed preamble `C1C2C3C4C5`, bit-reversal, CRC-16/CCITT (poly `0x1021`), two 7-bit LFSR whitening passes (tap seeds `63` and `37`), advertised under company ID `0xFFF0`. The crypt is **generic** — it is *not* where device-1 differs.
- Every telegram — connect, motion, and any set-device step — is sent through the **same** path: Dart builds a **raw hex string** and hands it to the plugin via the method `broadcast_sentHexStr`. The plugin encrypts and broadcasts it.
- The device identity lives in that **raw hex payload**. The reference's "generic connect" `6d 7b a7 80 80 80 80 92` decomposes into a **computed 3-byte prefix `6d 7b a7`** + the **shared constant `8080808092`** (the constant was found verbatim in `libapp.so`). The prefix and the motion first byte (`0x61`/`0x62`/`0x63`) are produced by **runtime arithmetic in Dart**, not stored as literals.
- **Limitation:** the exact Dart arithmetic for the device-1 prefix is not recoverable from static strings, and this APK ships **only 32-bit `armeabi-v7a`** Dart AOT, which current Dart-AOT decompilers don't handle. The exact device-1 bytes must be obtained by **capturing the app and decrypting** (the crypt is now fully known) or by **brute-forcing candidate telegrams** against the hardware.

---

## 1. Environment & Tooling Setup (Windows)

### Inputs / tools
- Source archive: `E:\claude-projects\moldqueen\MK+tech._2.6.4_APKPure.xapk` (119 MB)
- Java: Temurin **JDK 21** (`C:\Program Files\Eclipse Adoptium\jdk-21.0.1.12-hotspot`) — already installed
- Decompiler: **jadx 1.5.1** downloaded to `E:\tmp\tools\jadx\` (`bin\jadx.bat`, `bin\jadx-gui.bat`)

### Steps performed
1. **A `.xapk` is a ZIP.** Extracted with `System.IO.Compression.ZipFile` → `E:\tmp\mktech_xapk\`.
   Contents (base APK + per-arch / per-language splits):

   | File | Size | Role |
   |---|---|---|
   | `com.yxkj_main.building_block_robot.apk` | 95 MB | **base APK** (dex + Dart `libapp.so`) |
   | `config.armeabi_v7a.apk` | 24 MB | **native libraries** (`.so`) |
   | `config.*.apk` | small | language / density splits |

2. Downloaded + extracted jadx (release zip is a valid `PK..` archive).
3. Decompiled the base APK:
   ```
   E:\tmp\tools\jadx\bin\jadx.bat --no-res --show-bad-code -d E:\tmp\mktech_src com.yxkj_main.building_block_robot.apk
   ```
   Completed with 6 minor errors; **3,414 `.java` files** produced under `E:\tmp\mktech_src\sources\`.
4. Extracted native libs from the arch split → `E:\tmp\arch_split\lib\armeabi-v7a\`.
5. Extracted ASCII strings from `libapp.so` → `E:\tmp\libapp_strings.txt` (34,198 lines).

### Reproduce
```powershell
# extract xapk
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory("MK+tech._2.6.4_APKPure.xapk","E:\tmp\mktech_xapk")
# decompile base apk
E:\tmp\tools\jadx\bin\jadx.bat --no-res --show-bad-code -d E:\tmp\mktech_src `
  E:\tmp\mktech_xapk\com.yxkj_main.building_block_robot.apk
# (GUI alternative: E:\tmp\tools\jadx\bin\jadx-gui.bat, then File > Open the apk)
```

---

## 2. App Architecture — two layers

**Key finding:** the app is **Flutter** (`libflutter.so` + `libapp.so` present, and `com/yxkj/...` in the dex is empty). The control logic is split:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Dart  (libapp.so, AOT-compiled)                                      │
│  package building_block_robot_26 + package h_ble                      │
│  • decides WHICH device / WHAT command                                │
│  • builds a RAW HEX STRING  e.g. "6d7ba78080808092"                   │
└───────────────┬─────────────────────────────────────────────────────┘
                │  MethodChannel "com.flutter.h_ble.send.channel"
                │  invoke: { "type":"broadcast_sentHexStr", "data":"<hex>" }
                │  then:   { "type":"broadcast_start" }
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Java plugin  com.flutter.h_ble   (classes F4/i, U2/p, s/G0, x2/*)    │
│  • hex-decodes "data"                                                  │
│  • applies MouldKingCrypt (preamble, bit-reversal, CRC, 2× LFSR)      │
│  • addManufacturerData(0xFFF0, frame) → BLE advertise                 │
└─────────────────────────────────────────────────────────────────────┘
```

Relevant native libraries (from `config.armeabi_v7a.apk`):

| Lib | Size | Note |
|---|---|---|
| `libapp.so` | 10.4 MB | **compiled Dart** — app logic |
| `libflutter.so` | 7.5 MB | Flutter engine |
| `libmodpdfium.so`, `libmodft2.so`, `libmodpng.so` | — | PDF/manuals |
| others | small | camera/JNI utilities |

> Note the APK ships **only `armeabi-v7a` (32-bit)**. No `arm64-v8a` split, which matters for Dart decompilation (see §6).

The plugin also exposes a **second transport — GATT** (`BluetoothGatt`, `writeDescriptor`, characteristics in `F4/i.java` and `x2/a.java`). Newer/connected hubs may use GATT, where "device N" is simply a second BLE connection by MAC. **The user's broadcast hubs (`0xFFF0`) use the advertising path above**, which is what this report focuses on.

---

## 3. Plugin command interface (Java)

Method-channel command dispatch — [`F4/i.java:1428-1483`](file:///E:/tmp/mktech_src/sources/F4/i.java):

| `type` string | Action |
|---|---|
| `broadcast_offScan` | stop scan |
| `broadcast_sentHexStr` | **build the encrypted telegram from `data` hex** and store it |
| `broadcast_getBleBroadcastState` | query advertising state |
| `broadcast_onScan` | start scan |
| `broadcast_getBleState` | query adapter state |
| `broadcast_stop` | stop advertising |
| `broadcast_start` | **start advertising the stored telegram** |

Channels registered in [`x2/e.java:27-29`](file:///E:/tmp/mktech_src/sources/x2/e.java):
- send: `com.flutter.h_ble.send.channel`
- receive: `com.flutter.h_ble.receive.channel`

The advertise call — [`F4/i.java:1617-1630`](file:///E:/tmp/mktech_src/sources/F4/i.java):
```java
AdvertiseData.Builder builder2 = new AdvertiseData.Builder();
builder2.setIncludeDeviceName(false);
byte[] bArr6 = new byte[24];          // padded to 24 bytes (1..24 placeholder, overwritten)
System.arraycopy(bArr5, 0, bArr6, 0, bArr5.length);   // bArr5 = encrypted telegram
builder2.addManufacturerData(65520, bArr6);           // 65520 = 0xFFF0
bluetoothLeAdvertiser2.startAdvertising(settings, builder2.build(), callback);
```
Advertise settings: `TxPowerLevel = HIGH(3)`, `AdvertiseMode = LOW_LATENCY(2)`, `Timeout = 0` (continuous).

---

## 4. MouldKingCrypt — fully recovered

Implemented in **Java**, in [`F4/i.java:1493-1563`](file:///E:/tmp/mktech_src/sources/F4/i.java) (the `broadcast_sentHexStr` case) with helpers in [`s/G0.java`](file:///E:/tmp/mktech_src/sources/s/G0.java) and the hex decoder [`U2/p.java:91`](file:///E:/tmp/mktech_src/sources/U2/p.java).

### Inputs
- `preamble = hexdecode("C1C2C3C4C5")` → `C1 C2 C3 C4 C5` (fixed 5 bytes)
- `payload  = hexdecode(data)` → the raw command from Dart

### Algorithm (reconstructed exactly)
1. Build a working buffer; place a fixed frame header at the front:
   `0x71, 0x0F, 0x55`
2. Append the **preamble reversed**: `C5 C4 C3 C2 C1`
3. Append the `payload` bytes.
4. **Bit-reverse** (`G0.d`, swap bit *i* ↔ bit *7−i* in each byte) the header + reversed-preamble region (the first 8 bytes: `71 0F 55 C5 C4 C3 C2 C1`).
5. **CRC-16/CCITT** (`poly = 0x1021`, init `0xFFFF`):
   - fed with the **reversed preamble** bytes, then the **bit-reversed payload** bytes;
   - result is **bit-reversed (16-bit)** then **`XOR 0xFFFF`**;
   - appended **little-endian** (low byte, high byte).
6. **LFSR whitening** (`G0.j`, a 7-stage LFSR producing a keystream XORed bit-by-bit, LSB-first):
   - **pass 1** over the inner payload region with tap state derived from **`63`**;
   - **pass 2** over the whole frame with tap state derived from **`37`**.
7. The final advertised payload = buffer from the `0x71` header onward:
   `[71 0F 55] [crypted reversed-preamble (5)] [crypted payload (n)] [crc (2)]`.

### Helper: bit-reversal — [`G0.java:58`](file:///E:/tmp/mktech_src/sources/s/G0.java)
```java
static byte d(byte b) {                 // reverse the 8 bits of one byte
    byte r = 0;
    for (int i = 0; i < 8; i++)
        if ((b & (1<<i)) != 0) r |= (1 << (7-i));
    return r;
}
```

### Helper: LFSR whitening — [`G0.java:68`](file:///E:/tmp/mktech_src/sources/s/G0.java)
```java
static void j(byte[] buf, int[] s) {    // s = 7-element tap/state array
    for (int k = 0; k < buf.length; k++) {
        int in = buf[k], out = 0;
        for (int bit = 0; bit < 8; bit++) {
            int s3 = s[3], s6 = s[6];
            s[3]=s[2]; s[2]=s[1]; s[1]=s[0]; s[0]=s6;
            s[6]=s[5]; s[5]=s[4]; s[4]=s3 ^ s6;
            out += (((in >> bit) & 1) ^ s6) << bit;   // XOR keystream, LSB-first
        }
        buf[k] = (byte)(out & 255);
    }
}
```
The tap arrays are seeded from the constants **63** and **37**:
```java
state[0]=1; for (i=1;i<7;i++) state[i] = (SEED >> (6-i)) & 1;   // SEED = 37 or 63
```

### Match to reference
| Reference (`MouldKingCrypt`) | App | Match |
|---|---|---|
| Fixed preamble | `C1 C2 C3 C4 C5` | ✅ |
| Bit-reversal | `G0.d` per byte | ✅ |
| CRC-16/CCITT | poly `0x1021`, bit-reversed, `XOR 0xFFFF` | ✅ |
| Two LFSR streams "0x63 / 0x37" | tap seeds `63` / `37` (decimal) | ✅ |
| Company ID `0xFFF0` | `addManufacturerData(65520, …)` | ✅ |

**Conclusion:** the encryption is generic and identical to the reference. Device-1 differences are **not** in the crypt.

---

## 5. Device addressing — what was found

### Strings evidence (`libapp.so`)
Dart package paths (un-obfuscated — AOT keeps them):
- `package:h_ble/h_ble.dart`, `h_ble_broadcast_base.dart`, `h_ble_send_handle.dart`, `h_ble_missive_manage.dart`, `native_send_to_device_listen.dart`
- `…/h_bluetooth_ble/ble_device_data.dart`
- `…/ble_device/ble_device_13130/ble_device_13130.dart`, `ble_device_control_13130.dart`, `ble_device_history_13130.dart`
- `…/data/local_missive_manage/local_missive_bluetooth_broadcast.dart`
- symbols: `deviceNumber`, `deviceId`, `setDeviceInformation`, `getConnect`, `_listStringToDeviceAction`, `deviceList[deviceNumber].stateType = …`

**Pure-hex constants** present in `libapp.so` (the *only* hex literals — everything else is built at runtime):

| Constant | Meaning |
|---|---|
| `8080808092` | **tail of the reference connect** `6d 7b a7 ‖ 80 80 80 80 92` |
| `808080` | repeated `0x80` filler (motion neutral/centre values) |
| `0000000055`, `0000000080`, `000000` | command templates |
| `0AAAAA`, `AABBCC`, `A000000000000005` | other command templates |
| `0123456789ABCDEF` | hex-formatting charset |

### Interpretation
- The reference's "generic connect" `6d 7b a7 80 80 80 80 92` = **computed prefix `6d 7b a7`** + **constant `8080808092`**. The constant is shared; **the prefix is computed per device**.
- Motion telegrams differ by first byte `0x61` (dev0) / `0x62` (dev1) / `0x63` (dev2) — also computed, consistent with `0x61 + deviceIndex`.
- The device identity is therefore carried in the **raw hex `data`** that Dart passes to `broadcast_sentHexStr`. It is produced by Dart arithmetic, **not** stored as a literal, so the exact device-1 bytes can't be read directly from strings.

### Comparison with the MK6.0 reference

| Aspect | J0EK3R / mkconnect (MK6.0) | MK+tech app | Difference |
|---|---|---|---|
| Transport | BLE advertise, company `0xFFF0` | same | none |
| Crypt | MouldKingCrypt | identical (recovered) | none |
| Connect telegram | treated as **generic** `6d7ba78080808092` | constant tail `8080808092` + **computed prefix** | app's connect prefix is **device-dependent** → reference's "generic" assumption is the likely gap |
| Motion | first byte `0x61/0x62/0x63` | computed first byte (matches) | none |
| Set-device telegram | **absent** (reference relies on button) | goes through the same `broadcast_sentHexStr` path; bytes not statically recoverable | app likely **does** send a distinct device-1 telegram; exact bytes TBD |

**Most likely mechanism:** the connect/assign telegram is **not generic** — it encodes the target device slot in its prefix. When the app targets "device 1" and the hub is in pairing mode (just powered / button pressed), the connect telegram it broadcasts binds the hub to slot 1. This is reproducible byte-for-byte once the exact telegram is observed.

---

## 6. Why the exact device-1 bytes aren't in the static dump

- The command bodies are **assembled at runtime** in Dart (integer arithmetic + `toRadixString`-style formatting), so only the constant *fragments* appear as strings.
- This APK ships **only `armeabi-v7a` (32-bit ARM)** Dart AOT. The practical Dart-AOT decompilers (e.g. **Blutter**) target **arm64-v8a**; legacy tools (Doldrums/darter) don't support modern Flutter snapshots. So there is no clean path to read the Dart arithmetic from this binary.

This is a **hard limitation of static analysis here** — not a dead end, because the crypt is fully known (next section).

---

## 7. Recommended path to reliably bind device 1

Because **MouldKingCrypt is now completely known and deterministic**, two reliable routes exist. Both need a faithful re-implementation of the crypt (encoder + decoder), which can be written directly from §4.

### Route A — Capture + decrypt (definitive)
1. On the Android phone: enable **Developer options → Bluetooth HCI snoop log** (or use an **nRF52840 / nRF Sniffer** + Wireshark).
2. In the app, add a **second hub to "device 1"** and drive it.
3. Capture the `0xFFF0` advertisements emitted during assign + motion.
4. Run the **MouldKingCrypt decoder** (invert §4: undo LFSR pass 2 → undo CRC/append → undo LFSR pass 1 → un-bit-reverse → strip header/preamble) to read the **raw device-1 telegrams** verbatim. No guessing.

### Route B — Brute-force generate (no capture needed)
1. Implement the **encoder** (§4) and verify it round-trips the known device-0 connect (`data = 6d7ba78080808092`) and a device-0 motion (`61…`).
2. Generate candidate **device-1 connect** telegrams (e.g. prefix variations around `6d 7b a7`, or `+1` index transforms analogous to `0x61→0x62`).
3. Broadcast each while a hub is in pairing mode; observe which makes the hub respond to the `0x62`-first-byte motion telegrams (i.e. it became device 1).

### Self-test vector for any implementation
Encrypting `data = "6d7ba78080808092"` (device-0 connect) must reproduce the device-0 advertisement the real app sends / that the reference uses. Use this as the regression check before trusting device-1 output.

---

## 8. Artifacts on disk

| Path | Contents |
|---|---|
| `E:\tmp\mktech_xapk\` | extracted `.xapk` (base APK + splits) |
| `E:\tmp\mktech_src\sources\` | decompiled Java (3,414 files) |
| `E:\tmp\arch_split\lib\armeabi-v7a\` | native libs (`libapp.so`, `libflutter.so`, …) |
| `E:\tmp\libapp_strings.txt` | extracted Dart strings (34,198 lines) |
| `E:\tmp\tools\jadx\` | jadx 1.5.1 |

### Key source locations
- Crypt + command build: [`E:\tmp\mktech_src\sources\F4\i.java`](file:///E:/tmp/mktech_src/sources/F4/i.java) lines **1428-1483** (dispatch), **1493-1563** (crypt), **1617-1630** (advertise)
- Crypt helpers: [`E:\tmp\mktech_src\sources\s\G0.java`](file:///E:/tmp/mktech_src/sources/s/G0.java) lines **58** (`d`), **68** (`j`)
- Hex decode: [`E:\tmp\mktech_src\sources\U2\p.java`](file:///E:/tmp/mktech_src/sources/U2/p.java) line **91** (`d`)
- Channel registration: [`E:\tmp\mktech_src\sources\x2\e.java`](file:///E:/tmp/mktech_src/sources/x2/e.java) lines **27-29**

---

## 9. Open questions / next actions

- **Implement MouldKingCrypt encoder+decoder** (Python recommended) from §4, with the §7 self-test. *Unblocks both Route A and Route B.*
- Decide Route A (capture) vs Route B (brute-force) — Route A is definitive and recommended first.
- Confirm whether the assign step is a **distinct connect prefix** vs a **separate set-device telegram** (the capture will show this directly).
- If feasible later, obtain an `arm64-v8a` build of the same app to enable Blutter-based Dart decompilation and read the prefix arithmetic outright.
