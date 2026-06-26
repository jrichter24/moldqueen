/*
 * MK4 NimBLE advertiser + the safety layer (auto-neutral keepalive + STOP).
 *
 * Broadcasts crypted MK4 telegrams as company-0xFFF0 legacy manufacturer-specific
 * advertising data, matching the on-air shape the Pi (linux-core) and Android cores
 * produce, fed by the proven mouldking_crypt. Dumb transport: it resolves nothing.
 *
 * SACRED RULE: normal payload changes (drive / per-channel auto-neutral / release)
 * update the advertising data IN PLACE on the continuously-running advertiser
 * (ble_gap_adv_set_data — no active/EBUSY gate; the extended API would EBUSY while
 * active and force a stop/start, so we use LEGACY advertising). The advertiser is
 * NEVER stopped/started per payload change.
 *
 * SAFETY (mirrors linux-core api.py + android-core ApiCore, CHANNEL_TIMEOUT 300ms):
 *  - Auto-neutral keepalive: each non-neutral channel is held alive ONLY by active
 *    refresh (mk4_adv_set ~10/s). A channel not refreshed within 300ms auto-neutrals
 *    on its own (the source-of-drive dead-man's-switch — covers client/input death,
 *    stalled loop, dropped link). This is an affirmative motion-keepalive, NOT a blind
 *    heartbeat. Auto-neutral applies in place (still the SACRED rule).
 *  - STOP = kill + reconnect-at-neutral: tears the advertiser DOWN and re-establishes
 *    it holding all-neutral. This is the ONE place a stop/start is correct — a
 *    deliberate teardown, distinct from per-change churn.
 */
#ifndef MK4_ADVERTISER_H
#define MK4_ADVERTISER_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Per-channel auto-neutral timeout (ms) — matches api.py MK4_CHANNEL_TIMEOUT=0.3s. */
#define MK4_CHANNEL_TIMEOUT_MS 300

/* Init NVS + NimBLE, start the legacy connectable 0xFFF0 advertiser (initial telegram
   = CONNECT), and start the auto-neutral keepalive. Call once from app_main. */
void mk4_adv_init(void);

/* Broadcast the CONNECT telegram (in place if already advertising). */
void mk4_adv_connect(void);

/* Drive one channel (slot 0..2, channel 0..3) to `value` (-7..+7) AND refresh its
   dead-man timer. The caller (the source of drive) must keep calling this ~10/s for a
   held channel; stop calling it and the channel auto-neutrals within 300ms. In-place. */
void mk4_adv_set(int slot, int channel, int value);

/* Release ALL channels to neutral immediately (in place). A normal stop-driving; for
   the hard safety teardown use mk4_adv_stop(). */
void mk4_adv_neutral(void);

/* STOP — kill the advertiser and reconnect holding all-neutral (the deliberate-teardown
   exception to the SACRED rule). Driving works again immediately afterwards. */
void mk4_adv_stop(void);

/* 1 once advertising has actually started (the host has synced), else 0. */
int mk4_adv_is_ready(void);

/* Consistent snapshot for the WS `state` push: the 12 channel values (-7..+7), the motion
   telegram raw hex ("7dae18..82"), and the on-air AD hex ("1f 02 01 .." space-separated).
   Mirrors api.py state_json's slots/raw/ad. */
void mk4_adv_snapshot(int8_t ch_out[12], char *raw_hex, size_t raw_cap, char *ad_hex, size_t ad_cap);

#ifdef __cplusplus
}
#endif

#endif /* MK4_ADVERTISER_H */
