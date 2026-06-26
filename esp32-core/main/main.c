/*
 * esp32-core: WiFi-provisioning build — the firmware is distributable (no creds baked in).
 *
 * Boot flow:
 *   NVS has creds and station connects within 30 s  -> NORMAL OPERATION
 *   else (no creds / connect failed)                -> PROVISIONING (fallback SoftAP)
 *
 * There is NO physical re-provision trigger. A double-reset / BOOT-hold override was
 * evaluated and DROPPED as unreliable on this board (GPIO0 is the boot strap, so BOOT-hold
 * enters ROM download mode; and the EN-pin reset power-gates the chip — clearing RTC memory,
 * and even an NVS-flag double-reset did not detect the EN double-tap cleanly). Re-provisioning
 * (changing WiFi) will move to the planned HTTP management page. For now the board re-enters
 * provisioning AUTOMATICALLY when the saved network is unreachable (empty NVS or a 30 s
 * connect timeout); to force it, erase NVS (reflash).
 *
 * PROVISIONING: SoftAP "moldqueen-setup" + a tiny config page at http://192.168.4.1/.
 * NORMAL OPERATION (proven): the NimBLE advertiser + safety layer + the WS server on :8765;
 * the client (pointed at the printed IP) drives the toy over WiFi.
 * Creds live ONLY in NVS (flash) — never compiled in, never in git.
 */
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "nvs_flash.h"

#include "mk4_wifi.h"
#include "mk4_provision.h"
#include "mk4_advertiser.h"
#include "mk4_ws_server.h"

static const char *TAG = "mk4_main";

#define WS_PORT        8765
#define STA_TIMEOUT_MS 30000

void app_main(void)
{
    ESP_LOGI(TAG, "== esp32-core: provisioning + WiFi station + advertiser + WS server ==");

    esp_err_t r = nvs_flash_init();
    if (r == ESP_ERR_NVS_NO_FREE_PAGES || r == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        r = nvs_flash_init();
    }
    ESP_ERROR_CHECK(r);

    char ssid[33], pass[65], ip[16];
    bool have = mk4_wifi_creds_load(ssid, sizeof ssid, pass, sizeof pass);
    bool connected = false;

    if (have) {
        ESP_LOGI(TAG, "NVS has creds for '%s' -> trying station for %d s", ssid, STA_TIMEOUT_MS / 1000);
        connected = mk4_wifi_connect_sta(ssid, pass, ip, sizeof ip, STA_TIMEOUT_MS);
        if (!connected) ESP_LOGW(TAG, "could not join '%s' -> falling back to provisioning", ssid);
    } else {
        ESP_LOGW(TAG, "no WiFi creds in NVS -> provisioning");
    }

    if (!connected) {
        ESP_LOGW(TAG, "== PROVISIONING: join 'moldqueen-setup', open http://192.168.4.1/ ==");
        mk4_provision_run();    /* does not return — reboots into station mode on save */
        return;
    }

    /* NORMAL OPERATION (unchanged + proven). */
    mk4_adv_init();
    mk4_ws_start(WS_PORT);
    ESP_LOGI(TAG, "========================================================");
    ESP_LOGI(TAG, " READY. Point the client's WS endpoint at:");
    ESP_LOGI(TAG, "     ws://%s:%d", ip, WS_PORT);
    ESP_LOGI(TAG, "========================================================");

    while (1) vTaskDelay(pdMS_TO_TICKS(10000));
}
