/*
 * MK4 NimBLE advertiser — broadcasts crypted MK4 telegrams as company-0xFFF0
 * legacy manufacturer-specific advertising data, exactly matching the on-air
 * shape the Pi (linux-core) and Android cores produce.
 *
 * THE SACRED RULE: telegram changes update the advertising data IN PLACE on the
 * continuously-running advertiser (NimBLE `ble_gap_adv_set_data`, which issues HCI
 * "LE Set Advertising Data" with no active/EBUSY gate) — the advertiser is NEVER
 * stopped/started per change. This is the NimBLE twin of Android's
 * AdvertisingSet.setAdvertisingData(); it avoids the frame-drop runaway. (Extended
 * advertising's ble_gap_ext_adv_set_data returns EBUSY while active and would force a
 * stop/start — so this core uses LEGACY advertising on purpose.)
 *
 * Dumb transport: it takes (slot, channel, value) / connect, builds the 12-nibble
 * telegram, crypts it (the proven mouldking_crypt), wraps it as 0xFFF0 manufacturer
 * data, and broadcasts. It resolves no functions and owns no map.
 */
#ifndef MK4_ADVERTISER_H
#define MK4_ADVERTISER_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Init NVS + NimBLE and start the legacy connectable 0xFFF0 advertiser. The
   initial telegram is CONNECT, so a valid frame goes on-air the instant the host
   syncs. Call once from app_main. */
void mk4_adv_init(void);

/* Broadcast the CONNECT telegram (in place if already advertising). */
void mk4_adv_connect(void);

/* Broadcast a motion telegram with one (slot 0..2, channel 0..3) driven to
   `value` (-7..+7), all others neutral; updated in place. */
void mk4_adv_drive(int slot, int channel, int value);

/* Broadcast a full 12-channel motion telegram (index = slot*4 + channel, each
   value -7..+7, 0 = neutral); updated in place. */
void mk4_adv_set_channels(const int8_t values[12]);

/* Broadcast the all-neutral (stop) motion telegram; updated in place. */
void mk4_adv_neutral(void);

/* 1 once advertising has actually started (the host has synced), else 0. */
int mk4_adv_is_ready(void);

#ifdef __cplusplus
}
#endif

#endif /* MK4_ADVERTISER_H */
