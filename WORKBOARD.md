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

## RECURRING (every release)

- **After each release** (a new `v*` tag) — update the **README** + **website (`docs/`)**
  Download/Install sections + the version badge to the new version, and verify the
  release-download links resolve to the latest release. (Mirrored in `CLAUDE.md`.)

## IN-PROGRESS

- _(none)_

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
