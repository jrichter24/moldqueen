/*
 * esp32-core SAFETY-LAYER test harness — proves, on a TRACK box (a track just spins, no
 * end-stop, so sustained driving is safe to test):
 *
 *   TEST 1 — AUTO-NEUTRAL KEEPALIVE: drive a track WITH refresh (~10/s, simulating a live
 *     client), then STOP refreshing (simulated input death). The channel must auto-neutral
 *     within ~300ms ON ITS OWN — the track stops without any explicit stop command. This
 *     is the central safety proof.
 *   TEST 2 — STOP = kill + reconnect-at-neutral: drive the track, fire STOP; the track must
 *     halt (advertiser torn down + reconnected at neutral), and driving must work again
 *     immediately after.
 *
 * The advertiser keeps running throughout; payload changes are in-place (SACRED rule).
 * STOP is the ONE deliberate teardown.
 */
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "mk4_advertiser.h"

static const char *TAG = "mk4_safety";

/* The track channel to drive. slot 0 is the hub's power-up default. If this isn't a track
   on your box, tell me which (slot, channel) spins a track and I'll retarget + reflash. */
#define TRACK_SLOT 0
#define TRACK_CH   0
#define DRIVE_VAL  7

/* Drive (slot, ch) to `value`, RE-AFFIRMING every 100ms (~10/s) for `ms` — this is the
   "live source of drive". Stop calling it and the channel auto-neutrals within 300ms. */
static void drive_with_refresh_ms(int slot, int ch, int value, int ms)
{
    int64_t end = esp_timer_get_time() + (int64_t)ms * 1000;
    while (esp_timer_get_time() < end) {
        mk4_adv_set(slot, ch, value);
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

void app_main(void)
{
    ESP_LOGI(TAG, "== esp32-core SAFETY layer (auto-neutral keepalive + STOP) test ==");
    ESP_LOGI(TAG, "ONLY ONE 0xFFF0 transmitter: make sure the Pi + phone are NOT broadcasting.");

    mk4_adv_init();
    for (int i = 0; i < 50 && !mk4_adv_is_ready(); i++) vTaskDelay(pdMS_TO_TICKS(100));
    ESP_LOGI(TAG, "advertiser ready = %d; keepalive timeout = %dms", mk4_adv_is_ready(), MK4_CHANNEL_TIMEOUT_MS);

    /* Connect phase. */
    ESP_LOGI(TAG, ">>> CONNECT 8s — power the track box, button to slot 0, watch the LED connect");
    mk4_adv_connect();
    vTaskDelay(pdMS_TO_TICKS(8000));

    /* ===== TEST 1 — AUTO-NEUTRAL KEEPALIVE ===== */
    ESP_LOGI(TAG, "=== TEST 1: AUTO-NEUTRAL KEEPALIVE ===");
    ESP_LOGI(TAG, ">>> Driving track slot%d/ch%d = +%d WITH refresh (~10/s) for 3s — the track should SPIN",
             TRACK_SLOT, TRACK_CH, DRIVE_VAL);
    drive_with_refresh_ms(TRACK_SLOT, TRACK_CH, DRIVE_VAL, 3000);
    ESP_LOGW(TAG, ">>> NOW CUTTING THE REFRESH (simulated input death) — the track must AUTO-NEUTRAL");
    ESP_LOGW(TAG, "    within %dms ON ITS OWN, with NO stop command. Watch it coast to a stop.", MK4_CHANNEL_TIMEOUT_MS);
    vTaskDelay(pdMS_TO_TICKS(2500));    /* no set() calls — the keepalive neutralizes the channel */
    ESP_LOGI(TAG, "TEST 1 done — the track should have stopped on its own ~%dms after the refresh ceased",
             MK4_CHANNEL_TIMEOUT_MS);

    vTaskDelay(pdMS_TO_TICKS(2000));

    /* ===== TEST 2 — STOP = kill + reconnect-at-neutral ===== */
    ESP_LOGI(TAG, "=== TEST 2: STOP = kill + reconnect-at-neutral ===");
    ESP_LOGI(TAG, ">>> Driving track WITH refresh for 2s — the track should SPIN");
    drive_with_refresh_ms(TRACK_SLOT, TRACK_CH, DRIVE_VAL, 2000);
    ESP_LOGW(TAG, ">>> Firing STOP — the track must HALT immediately (advertiser torn down + reconnected at neutral)");
    mk4_adv_stop();
    vTaskDelay(pdMS_TO_TICKS(2500));
    ESP_LOGI(TAG, ">>> Driving AGAIN after STOP for 2s — the track should SPIN again (drive works post-STOP)");
    drive_with_refresh_ms(TRACK_SLOT, TRACK_CH, DRIVE_VAL, 2000);
    ESP_LOGW(TAG, ">>> Cutting refresh again -> auto-neutral; settling to rest");
    vTaskDelay(pdMS_TO_TICKS(2000));

    ESP_LOGI(TAG, "=== TESTS COMPLETE — holding neutral (advertiser up, motionless) ===");
    mk4_adv_neutral();
    while (1) vTaskDelay(pdMS_TO_TICKS(5000));
}
