# WORKBOARD

Single living backlog for moldqueen, so cross-session items don't get lost. Move items
between sections as work **starts** (→ IN-PROGRESS), **stalls/blocks** (→ STALE), or
**completes** (→ FINISHED). Keep it concise — deep detail lives in
[`dev-docs/PROJECT.md`](dev-docs/PROJECT.md) and [`dev-docs/HANDOVER.md`](dev-docs/HANDOVER.md).

## FUTURE / CARRY-FORWARD (planned, not started)

- **Build/version info in About** — one source of version/build (e.g. a `version.json` or
  an injected build string) that the *whole* client reads, surfaced in an About tab.
  Client-wide and not hardcoded per file.
- **Per-layout allowed-orientations property** — each layout declares which orientations it
  permits (e.g. `orientations: ["landscape"]` vs `["portrait","landscape"]`) and the host
  reads it, instead of hardcoding. The startpage-portrait change (see FINISHED) is the
  **first step** toward this, not the full system.
- **Bump GitHub Actions versions (clear the Node-20 deprecation)** — low-priority maintenance.
  CI + release pin actions (`actions/checkout@v4`, `actions/setup-java@v4`,
  `android-actions/setup-android@v3`, `gradle/actions/setup-gradle@v4`,
  `actions/upload-artifact@v4`) that internally use Node 20, which GitHub is deprecating for
  Node 24. **Not urgent** — GitHub currently forces them onto Node 24 and they work; bump to
  newer action majors when convenient. GitHub Actions only, not F-Droid.
- **Reproducible builds for F-Droid (consideration — likely not retrofittable)** — v0.1.x was
  submitted with *"No, I don't want this"*, so F-Droid signs with **F-Droid's** key. Reproducible
  builds would let F-Droid ship **our** signature (users could switch channels without reinstall;
  independent source-to-binary verification). Would need
  `dependenciesInfo { includeInApk = false; includeInBundle = false }` in `build.gradle` plus a
  matching signing setup. ⚠️ **One-way door** — the F-Droid inclusion template warns this can't be
  enabled later once published with F-Droid's key. **Deliberate deferral**; revisit only when
  re-evaluating at a major version.
- **ESP32 WiFi / standalone roadmap (cluster).** ✅ **Done — WiFi provisioning + the NVS
  credential store** (built; see esp32-core under IN-PROGRESS): on boot, try the NVS creds
  (30 s); on empty/timeout, fall back to a SoftAP (`moldqueen-setup`, open) + a plain config
  page at 192.168.4.1; save creds to NVS → reboot → connect. The firmware is now **distributable**
  (no creds in git or the binary). A **physical re-provision trigger** (double-reset / BOOT-hold)
  was evaluated and **DROPPED as unreliable on this board** — GPIO0 is the boot strap (BOOT-hold →
  ROM download mode), and the EN-pin reset clears RTC memory (so neither an RTC nor an NVS-flag
  double-reset detected the EN double-tap cleanly). Re-provisioning moves to the management page
  (Group B). **Remaining:**
  - ✅ **Group-A — provisioning/config-page polish — DONE** (hardware-verified): a **branded,
    bilingual (EN/DE)** config page (inlined MoldQueen icon rendering **offline**, "MoldQueen
    (ESP32)" title), a **scrollable scanned-network list with signal strength**, a
    **show-password** toggle + careful-password hint, a **configurable WS port** (with helper
    text; it flows through to the shown endpoint — tested at **9000**), **copy MAC / copy
    endpoint**, a matching **branded Saved page**, and **mDNS** discovery (`moldqueenesp.local`,
    renamed from `moldqueondevice`; proven end-to-end — the client drives via the name). All
    assets inlined/self-contained (offline AP); no creds in git or the binary.
  - ✅ **Group-B — web management page — DONE** (hardware + host-verified): a branded, bilingual
    status/management page at **`http://moldqueenesp.local:8080`** (normal op) — cards for live
    status (IP/MAC/SSID/signal/uptime/firmware/endpoint, with copy buttons for endpoint / mgmt-URL
    / IP / MAC), **restart**, **switch-to-setup** (a **software force-AP** via an NVS flag — the
    reliable replacement for the dropped hardware double-reset, re-provision on demand), and
    **change-network** directly (save new creds → reboot to the new network, non-bricking AP
    fallback). Responsive layout, status/signal color-coding, favicon, support links; the
    **`:8080` link** is on the Group A setup pages. No-auth LAN-trust (like the WS API). Shared
    branding factored into `mk4_webui`.
  - **Pi mDNS (`moldqueenrasp.local`) + the binary/release pipeline** — give the linux-core the
    sibling `.local` name, and a build/flash distribution path for the ESP32 firmware.
  - **Operational AP mode** (distinct from provisioning's temporary config AP) — the ESP32 as
    its *own* WiFi network you connect to and drive over, for true standalone with no home
    network.
  - **Serve the client from ESP32 flash** — **gated on the client-size problem**: the full
    client (dashboard HTML/JS/CSS + images/GIFs/icons) may be several MB. Either (a)
    aggressively size-limit the full client's assets, or (b) build a separate **"light client"**
    (stripped dashboard, smaller assets) for embedded serving — full client from Pi/dev, lean
    client from ESP32 flash. ⚠️ **Concern:** the browser page-load **asset burst** coexisting
    with BLE on the shared 2.4 GHz radio is the heaviest moment + most likely to stutter —
    measure if/when built. Needs a flash filesystem (SPIFFS/LittleFS) partition + the
    `__WS_PORT__` / `__INIT_JSON__` injection the Pi/Android hosts do.

## RECURRING (every release)

- **After each release** (a new `v*` tag) — update the **README** + **website (`docs/`)**
  Download/Install sections + the version badge to the new version, and verify the
  release-download links resolve to the latest release. (Mirrored in `CLAUDE.md`.)

## IN-PROGRESS

- **esp32-core (ESP32-S3 radio core) — in progress.** In [`esp32-core/`](esp32-core/): the
  clean-room **C MouldKingCrypt port** (byte-exact, 9/9 on-device), the **NimBLE 0xFFF0
  advertiser** with in-place adv-data updates (`ble_gap_adv_set_data`, no stop/start runaway —
  legacy advertising on purpose, since extended `EBUSY`s while active), the **safety layer**
  (per-channel **300 ms** auto-neutral keepalive + **STOP** = kill+reconnect-at-neutral), and the
  **WiFi WebSocket server** (`esp_http_server` WS on :8765, WiFi station) mirroring the `api.py`
  thin-transport contract (`setup`/`set`/`stop`/`state`/`info` + pushes; `radio_backend`=
  `esp32-nimble`). **Hardware-confirmed on the N16R8:** the *unmodified* single-source client
  drives a real toy **over WiFi** (drive + STOP + auto-neutral over the live path, no WiFi/BLE
  coexistence stutter). **WiFi provisioning** is built too — NVS creds + auto-fallback SoftAP
  (`moldqueen-setup`) + a **branded, bilingual config page** at `192.168.4.1` (inlined icon,
  EN/DE, scanned-network list with signal strength, show-password, configurable WS port, copy
  MAC/endpoint, a matching Saved page) and **mDNS discovery** (`moldqueenesp.local`); the
  firmware is now **distributable** (no creds in git or the binary). A physical re-provision
  trigger (double-reset / BOOT-hold) was evaluated and **dropped as unreliable** (GPIO0 is the
  boot strap; the EN reset clears RTC) — replaced by the management page's software force-AP.
  **Groups A + B are DONE + hardware-verified** — discovery (mDNS `moldqueenesp.local`) + the
  branded bilingual config/Saved pages, and the **management page** at `moldqueenesp.local:8080`
  (status, restart, **software switch-to-setup** = reliable re-provision, change-network), with
  the `:8080` link on the setup pages. **Next:** **Pi mDNS (`moldqueenrasp.local`) + the binary
  pipeline**, and serving the client from flash (see the FUTURE cluster). Toolchain: ESP-IDF v5.5.4.
- **F-Droid submission** — MR [!41291](https://gitlab.com/fdroid/fdroiddata/-/merge_requests/41291)
  open at `fdroid/fdroiddata` (*New app: MoldQueen*), v0.1.2 / commit `fad0c20`. Addressing
  maintainer (linsui) review: HTML description, full commit hash, `output` line removed.
  Awaiting review/merge.

## STALE (deferred / blocked)

- **Slot auto-detection** — unsolved (which hub sits on which slot). See PROJECT.md §8.
- **Box-identity UX** — unsolved (telling hubs apart for the user). See PROJECT.md §8.
- **Console/AI client of the WS API** — TODO, not started. See PROJECT.md §8.

## FINISHED (recent, for context)

- **v0.1.0 — first signed release** — the release pipeline is live: deterministic versioning
  (0.1.0 / 10000), package rename to `io.github.jrichter24.moldqueen`, FOSS-only deps, CI test
  gate (Python/Android/JS), release signingConfig, and a gated `v*`-tag release workflow that
  signs + publishes the APK. `moldqueen-v0.1.0.apk` is attached to the GitHub Release. *(F-Droid
  recipe + Play AAB/closed-testing remain — external.)*
- **Startpage portrait support** — the chooser works in portrait + landscape; individual
  layouts stay landscape-locked (the Android host sets activity orientation per page).
- **Even menu button widths** — Coffee / Sponsor / Website now match the standard menu items.
- **android targetSdk/compileSdk 35** — toolchain bump (AGP 8.7.3 / Gradle 8.9 / Kotlin
  1.9.24) + edge-to-edge & predictive-back handling. Hardware-tested on the S25.
- **Client support batch** — auto-assign stepper, Release toast, Support menu group
  (Ko-fi + Sponsors), website link, startpage support row.
