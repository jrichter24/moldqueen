# Roadmap

Direction, not commitment — intent for where moldqueen goes next. The through-line is the
**API-first design**: one WebSocket contract, a thin-transport radio core, a smart client.
Everything below either adds a **new radio core** behind that contract or a **new client**
that speaks it. (Back to the [README](../README.md) · canonical state in
[PROJECT.md](PROJECT.md).)

## Protocol

- **MK6: delivered on the Pi + client; still ahead on ESP32 & Android.** Our first hubs are
  the MK4 12-channel nibble variant; Mould King also ships an **MK6 per-byte** protocol on
  other hubs. The MK6 codec + telegram path now ships on the **Raspberry Pi radio core and
  the web client**, which also drive an MK4 box and an MK6 box **simultaneously** (mixed
  mode), hardware-verified 2026-07-08. That is why the **"MK6" badges** on the generic
  chooser cards are now live, not greyed. What is left is bringing the MK6 telegram path to
  the **ESP32 and Android** radios (both MK4-only today). See
  [MIXED_MODE.md](MIXED_MODE.md) for the plain-language explainer and
  [`../linux-core/reference/mk6_protocol.md`](../linux-core/reference/mk6_protocol.md) for
  the protocol-level detail.

## Radio cores (more transports behind the same contract)

- **ESP32 core — a usable standalone appliance (third radio core).** A small, cheap, always-on
  standalone ESP32-S3 that runs the NimBLE `0xFFF0` advertiser + the same thin-transport
  WebSocket API, so neither a Pi nor a phone is needed. Same client, same contract. **It drives
  a real toy over WiFi with the unmodified client** — four hardware-proven control slices
  (clean-room C `MouldKingCrypt`, in-place NimBLE advertiser, 300 ms auto-neutral keepalive +
  STOP, the WiFi WS server mirroring `api.py`), **plus** WiFi provisioning (no creds baked in:
  a fallback `moldqueen-setup` AP + a branded bilingual setup page), **mDNS discovery** as
  `moldqueenesp.local`, and a **management page** at `moldqueenesp.local:8080` (status, restart,
  switch-to-setup, change-network) — all done and hardware-verified (`esp32-core/`; see
  [PROJECT.md](PROJECT.md) §6b). Pi mDNS (`moldqueenrasp.local` for linux-core) and the
  binary/release pipeline (a downloadable `.bin`, published per `esp-v*` tag) are shipped too.
  The ESP32 core is now **complete**; serving the client from the board's own flash was
  considered and **decided against** — it stays a pure radio core that a hosted client drives,
  and the page-load asset burst coexisting with BLE on the shared 2.4 GHz radio (plus the
  several-MB client vs limited flash) isn't worth the risk. See [PROJECT.md](PROJECT.md) §6b.

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
  **F-Droid MR !41291** is merged (app now available on F-Droid). A **Play-Store**
  listing remains the forward-looking item. See [ANDROID.md](ANDROID.md).
- **Finish the excavator channel map** — a couple of functions are still placeholders to
  sweep on hardware (see [PROJECT.md](PROJECT.md)).
- **Slot auto-detection** — today the connect wizard guides hub→slot buttoning manually.
