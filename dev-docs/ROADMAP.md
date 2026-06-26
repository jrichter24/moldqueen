# Roadmap

Direction, not commitment — intent for where moldqueen goes next. The through-line is the
**API-first design**: one WebSocket contract, a thin-transport radio core, a smart client.
Everything below either adds a **new radio core** behind that contract or a **new client**
that speaks it. (Back to the [README](../README.md) · canonical state in
[PROJECT.md](PROJECT.md).)

## Protocol

- **MK6 protocol support.** Our hubs are the MK4 12-channel nibble variant; Mould King also
  ships an **MK6 per-byte** protocol on other hubs. Adding an MK6 codec + telegram path
  (behind the same thin-transport `set` contract) would let moldqueen drive MK6 toys. This
  is what the **greyed "MK6" badges** on the generic chooser cards promise — present in the
  UI, not yet wired to a radio.

## Radio cores (more transports behind the same contract)

- **ESP32 core — WORKING (third radio core).** A small, cheap, always-on standalone ESP32-S3
  that runs the NimBLE `0xFFF0` advertiser + the same thin-transport WebSocket API, so neither a
  Pi nor a phone is needed. Same client, same contract. **It already drives a real toy over WiFi
  with the unmodified client** — four hardware-proven slices: clean-room C `MouldKingCrypt`,
  in-place NimBLE advertiser, 300 ms auto-neutral keepalive + STOP, and the WiFi WS server
  mirroring `api.py` (`esp32-core/`; see [PROJECT.md](PROJECT.md) §6b). **Forward-looking
  polish:** WiFi provisioning (NVS creds + fallback config AP) and serving the client from
  ESP32 flash — to make it a fully standalone appliance like the Pi/Android cores.

## Sensing & autonomy (new clients of the API)

- **Camera (FPV).** A camera on the machine streaming first-person video to the client —
  drive by what the toy sees, and a feed an autonomous driver could consume.
- **ToF / distance sensor.** A time-of-flight sensor for distance/obstacle awareness —
  telemetry alongside the control API (and an input for stop-before-you-hit behaviors).
- **AI brain / agent.** A console/AI client that **speaks the same WebSocket contract** to
  drive the toy autonomously (or assistively). The whole point of the thin-transport /
  smart-client split is that *anything* that can open the WS — a script, an agent, a model —
  is a first-class driver with no special access. The API-first design is what makes this
  the natural next step rather than a rewrite.

## Smaller / in-flight

- **Android release — signed APKs SHIPPED; Play-Store still forward-looking.** Signed
  releases **v0.1.0 / v0.1.1 / v0.1.2** ship via the gated CI release workflow, and the
  **F-Droid MR !41291** is under maintainer review. A **Play-Store** listing remains the
  forward-looking item. See [ANDROID.md](ANDROID.md).
- **Finish the excavator channel map** — a couple of functions are still placeholders to
  sweep on hardware (see [PROJECT.md](PROJECT.md)).
- **Slot auto-detection** — today the connect wizard guides hub→slot buttoning manually.
