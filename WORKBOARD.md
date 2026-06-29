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
- **ESP32 WiFi / standalone roadmap (cluster) — remaining future items.** Provisioning,
  Group A (discovery + setup page), Group B (the management page), Pi mDNS, and the
  **binary/release pipeline** are all **DONE** (moved to FINISHED below). Still future:
  - **Serve the client from ESP32 flash** — **the next ESP32 task** (after the shipped release
    pipeline). **Gated on the client-size
    problem**: the full client (dashboard HTML/JS/CSS + images/GIFs/icons) may be several MB.
    Either (a) aggressively size-limit the full client's assets, or (b) build a separate
    **"light client"** (stripped dashboard, smaller assets) for embedded serving — full client
    from Pi/dev, lean client from ESP32 flash. ⚠️ **Concern:** the browser page-load **asset
    burst** coexisting with BLE on the shared 2.4 GHz radio is the heaviest moment + most likely
    to stutter — measure if/when built. Needs a flash filesystem (SPIFFS/LittleFS) partition +
    the `__WS_PORT__` / `__INIT_JSON__` injection the Pi/Android hosts do.
  - **Operational AP mode** (distinct from provisioning's temporary config AP) — the ESP32 as
    its *own* WiFi network you connect to and drive over, for true standalone with no home
    network.

## RECURRING (every release)

- **After each release** (a new `v*` tag) — update the **README** + **website (`docs/`)**
  Download/Install sections + the version badge to the new version, and verify the
  release-download links resolve to the latest release. (Mirrored in `CLAUDE.md`.)

## IN-PROGRESS

- **esp32-core (ESP32-S3 radio core) — finishing.** The core is a usable standalone appliance
  (control slices + provisioning + Group A + Group B all DONE + hardware-verified; see FINISHED
  below). **Pi mDNS (`moldqueenrasp.local` for linux-core) is DONE**, and the
  **binary/release pipeline is DONE** (`esp-v0.1.0` published — see FINISHED). The
  remaining work is the **next ESP32 task: serve-client-from-flash** (see the FUTURE cluster).
  Toolchain: ESP-IDF v5.5.4.
- **F-Droid submission** — MR [!41291](https://gitlab.com/fdroid/fdroiddata/-/merge_requests/41291)
  open at `fdroid/fdroiddata` (*New app: MoldQueen*), v0.1.2 / commit `fad0c20`. Addressing
  maintainer (linsui) review: HTML description, full commit hash, `output` line removed.
  Awaiting review/merge.

## STALE (deferred / blocked)

- **Slot auto-detection** — unsolved (which hub sits on which slot). See PROJECT.md §8.
- **Box-identity UX** — unsolved (telling hubs apart for the user). See PROJECT.md §8.
- **Console/AI client of the WS API** — TODO, not started. See PROJECT.md §8.

## FINISHED (recent, for context)

- **ESP32 binary/release pipeline — SHIPPED** (`.github/workflows/esp32-release.yml`, on main).
  Triggers on **`esp-v*`** tags; builds in `espressif/idf:v5.5.4` and merges
  bootloader + partition-table + app into **one flashable `.bin`** (flash the whole image at
  offset `0x0`). **Version comes from the tag** (`esp-v0.1.0` → `0.1.0` via `MK_PROJECT_VER`,
  parity-checked); the **prerelease flag keys off the stripped version** — a dry-run
  `esp-v0.1.0-rc1` caught + fixed a prerelease bug before the real cut. First real release:
  **`esp-v0.1.0`**, a FULL release, asset **`moldqueen-esp32-esp-v0.1.0.bin`** (~1.14 MB),
  flash command in the release body
  (`esptool.py --chip esp32s3 write_flash 0x0 moldqueen-esp32-<tag>.bin`). Releases:
  <https://github.com/jrichter24/moldqueen/releases/tag/esp-v0.1.0>. (Next ESP32 task:
  serve-client-from-flash.)
- **Pi mDNS discovery — `moldqueenrasp.local`** (linux-core, hardware-verified on the LAN). The
  Pi core is now reachable by a stable name (`ws://moldqueenrasp.local:8765`), mirroring the
  ESP32's `moldqueenesp.local`. Mechanism: an **additive avahi address-record alias**
  (`avahi-publish -a moldqueenrasp.local <ip>`, from `avahi-utils`) via a shipped
  **`scripts/mdns.sh`** wired into **`scripts/start.sh`** (background, cleaned up on exit) + an
  optional **`scripts/moldqueen-mdns.service`** template for always-on. **No system-hostname
  rename** (the Pi's own `<hostname>.local` and the IP still resolve); **graceful** (no-ops if
  `avahi-utils` absent — core still works by IP; `MK4_NO_MDNS=1` to skip, `MK4_MDNS_NAME` to
  rename). Documented in QUICKSTART + README. `avahi-daemon` ships with Raspberry Pi OS;
  `avahi-utils` is the one apt dep.
- **esp32-core — a usable standalone appliance** (hardware-verified on the N16R8). The four
  control slices — clean-room **C MouldKingCrypt** (byte-exact, 9/9 on-device), the **NimBLE
  0xFFF0 advertiser** (in-place `ble_gap_adv_set_data`, legacy on purpose since extended
  `EBUSY`s while active), the **300 ms auto-neutral keepalive + STOP**, and the **WiFi WS
  server** (`:8765`) mirroring `api.py`'s thin-transport contract (`radio_backend`=
  `esp32-nimble`) — the *unmodified* client drives a real toy over WiFi, no coexistence stutter.
  **Plus:** **WiFi provisioning** (NVS creds, **no creds baked in**; boot = force-AP flag / no
  creds / 30 s timeout → fallback open SoftAP `moldqueen-setup` at `192.168.4.1`; firmware
  distributable). **Group A** — a **branded bilingual (EN/DE)** setup page (inlined icon offline,
  scanned-network list with signal strength, show-password, configurable WS port tested at 9000,
  copy MAC/endpoint, a matching Saved page) + **mDNS** discovery `moldqueenesp.local` (renamed
  from `moldqueondevice`; proven end-to-end). **Group B** — a **management page** at
  `moldqueenesp.local:8080` (status, restart, **software switch-to-setup** via a one-shot NVS
  force-AP flag, change-network with non-bricking AP fallback), with the `:8080` link on the
  setup pages; no-auth LAN-trust like the WS API. A **hardware** re-provision trigger
  (double-reset / BOOT-hold) was evaluated and **dropped as unreliable** (GPIO0 is the boot
  strap; the EN reset clears RTC) — replaced by the software switch-to-setup. Shared branding
  factored into `mk4_webui`; seven components total. (Pi mDNS + the release pipeline shipped after
  this — see above; next is serve-client-from-flash.)
- **Client WS-endpoint field fix** — `client/web/clientconfig.js`: the endpoint field no longer
  clears/overwrites itself while you're typing in it.
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
