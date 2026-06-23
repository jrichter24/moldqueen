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

- **ESP32 core.** A small, cheap, always-on **third radio core** — a standalone ESP32 that
  runs the BLE advertiser + the same WebSocket API, so neither a Pi nor a phone is needed.
  Same client, same contract; just another swappable transport.

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

- **Signed Android release** — a Play-Store / signed APK (today it's a local
  `installDebug`; see [ANDROID.md](ANDROID.md)).
- **Finish the excavator channel map** — a couple of functions are still placeholders to
  sweep on hardware (see [PROJECT.md](PROJECT.md)).
- **Slot auto-detection** — today the connect wizard guides hub→slot buttoning manually.
