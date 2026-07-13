# Mixed mode (driving an MK4 box and an MK6 box at once)

Plain-language explainer. Sets honest expectations about a genuinely unique feature that
is not free and whose status differs by platform. For the protocol-level detail (telegram
shapes, the interleave, connect frames) see
[`../linux-core/reference/mk6_protocol.md`](../linux-core/reference/mk6_protocol.md).

## What mixed mode is

One moldqueen client driving a **Mould King MK4 box** and a **Mould King MK6 box** at the
**same time**, from the same screen. The official Mould King app cannot do this. moldqueen
can, because its radio core weaves both protocols onto the one shared radio.

## Why it is hard (the core constraint)

MK4 and MK6 both broadcast on the **same Bluetooth manufacturer id (`0xFFF0`)**, so they
share one radio "voice". You cannot say two things at once. So mixed mode **alternates**:
send an MK4 telegram, then an MK6 telegram, then MK4 again, over and over. Each box obeys
only its own telegrams and ignores the other's.

The catch is that each box also **times out and stops** if it does not hear from you often
enough (roughly 10 times a second). So mixed mode is really a **time-sharing problem**: can
we alternate fast enough to keep BOTH boxes happy at the same time? How well that works
depends on how much control the platform gives us over the radio's send timing.

## Where it stands, per platform

Read the difference between **measured** and **expected** carefully. Only the Pi has been
tested on hardware. Android and ESP32 are reasoned from how their radio stacks work, and
are not built yet.

### Raspberry Pi (linux-core): works, proven

The Pi software talks to the Bluetooth adapter directly (raw HCI) and controls the send
timing itself. It holds both telegrams and alternates them at about **20 frames per second**
so each box still gets its own ~10 per second. **Hardware-verified on 2026-07-08:** one MK4
box and one MK6 box driven at once, smooth, with no stutter and no dropout. This is
**measured, not theoretical**. This is the proven case: one MK4 box plus one MK6 box.

### Android (android-core): not yet implemented; expected experimental when added

Today the Android app is **MK4-only**: its server understands only MK4 commands, so mixed
mode **does not run there yet**.

When it is added, expect it to be **experimental**. The app must update the advertising
payload **in place** on an advertiser that keeps running (moldqueen already learned the hard
way that stopping and restarting the advertiser raced and dropped frames, starving the hub).
Alternating two protocols means swapping payloads on that same running advertiser. Android's
BLE stack gives **less precise timing** than the Pi's raw HCI, and the phone is doing many
other things at the same time, so the alternation may not stay reliably fast enough for both
boxes. This is reasoned, not measured.

### ESP32 (esp32-core): not yet implemented; expected experimental when added

Today the ESP32 core is **MK4-only**, with no MK6 at all, so mixed mode **does not run there
yet**.

When it is added, expect it to be **experimental**. The ESP32's Bluetooth controller repeats
the last payload on its own schedule, and the app can only swap **what is being repeated** (it
uses "legacy advertising" on purpose, because that allows updating the payload in place; the
alternative dropped frames). Each swapped payload should sit long enough to be heard on all
the advertising channels, so the achievable per-box rate is tighter and depends on the
advertising interval. The ESP32 also shares its 2.4 GHz radio with WiFi, which adds
contention. Expect experimental, and more likely to stutter than the Pi. This is reasoned,
not measured.

## What we recommend

For reliable everyday use, drive a **single box type** (all MK4, or all MK6). That path is
simple, fast, and proven on every platform.

Mixed mode is a genuinely unique capability, but treat it as **experimental / showcase**, and
it is **Pi-only for now**. If a box stutters or drops out in mixed mode, that is the
time-sharing limit doing its thing, not a broken setup. Switch to a single box type.

## Summary

| Platform | Mixed today | When added |
|---|---|---|
| **Raspberry Pi** (linux-core) | **Works, hardware-verified** (measured) | already here |
| **Android** (android-core) | Not implemented (MK4-only) | expected experimental (reasoned) |
| **ESP32** (esp32-core) | Not implemented (MK4-only) | expected experimental (reasoned) |
