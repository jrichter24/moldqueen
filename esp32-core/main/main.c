/*
 * esp32-core advertiser test harness — proves the NimBLE 0xFFF0 advertiser, built
 * on the proven crypt, with IN-PLACE adv-data updates, can connect + drive a hub.
 *
 * Sequence: broadcast CONNECT (so the hub pairs), then loop a motion pattern on
 * slot0/ch0 (the transmit-confirmed bucket) — every telegram change is an in-place
 * update on the continuously-running advertiser (the advertiser never stops).
 *
 * NOT the WS server yet (later slice). Auto-neutral keepalive / STOP also later.
 */
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "mk4_advertiser.h"

static const char *TAG = "mk4_harness";

void app_main(void)
{
    ESP_LOGI(TAG, "== esp32-core NimBLE 0xFFF0 MK4 advertiser harness ==");
    ESP_LOGI(TAG, "ONLY ONE 0xFFF0 transmitter at a time: make sure the Pi + phone are NOT broadcasting.");

    mk4_adv_init();

    /* wait for the host to sync + advertising to start */
    for (int i = 0; i < 50 && !mk4_adv_is_ready(); i++) {
        vTaskDelay(pdMS_TO_TICKS(100));
    }
    ESP_LOGI(TAG, "advertiser ready = %d", mk4_adv_is_ready());

    /* Phase 1 — CONNECT: broadcast the connect telegram so the hub pairs. */
    ESP_LOGI(TAG, ">>> CONNECT for 12s — power the hub, button it to slot 0, watch the LED go to connected/fast-flash");
    mk4_adv_connect();
    for (int s = 12; s > 0; s--) {
        ESP_LOGI(TAG, "    ...CONNECT broadcasting (%ds left)", s);
        vTaskDelay(pdMS_TO_TICKS(1000));
    }

    /* Phase 2 — a FINITE demo: one gentle tap each way, then HOLD neutral. We do NOT
       loop the drive: the forward/back taps aren't perfectly symmetrical, so repeating
       would drift the shovel into its mechanical end-stop. One pair proves the in-place
       drive; then we rest at neutral — the advertiser keeps broadcasting the neutral
       telegram, so the hub stays connected but motionless. */
    const int DRIVE_MS = 400;    /* brief tap so the motor moves only a little */

    ESP_LOGI(TAG, ">>> DEMO: DRIVE slot0 ch0 = +7 (%dms tap) — small move forward", DRIVE_MS);
    mk4_adv_drive(0, 0, +7);
    vTaskDelay(pdMS_TO_TICKS(DRIVE_MS));
    mk4_adv_neutral();
    vTaskDelay(pdMS_TO_TICKS(1500));

    ESP_LOGI(TAG, ">>> DEMO: DRIVE slot0 ch0 = -7 (%dms tap) — small move back", DRIVE_MS);
    mk4_adv_drive(0, 0, -7);
    vTaskDelay(pdMS_TO_TICKS(DRIVE_MS));
    mk4_adv_neutral();

    ESP_LOGI(TAG, ">>> DEMO complete — HOLDING NEUTRAL (advertiser stays up, hub connected, no motion)");
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(5000));   /* idle; the advertiser keeps broadcasting the neutral telegram */
    }
}
