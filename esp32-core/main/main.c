/*
 * esp32-core WiFi WS-server build: the single-source client drives the ESP32 over WiFi.
 *
 *   WiFi STATION (join home WiFi, print LAN IP)
 *     -> NimBLE 0xFFF0 advertiser + safety layer (the radio, dumb transport)
 *     -> WebSocket server on :8765 mirroring the api.py contract
 *
 * The client is served ELSEWHERE (Pi / client/serve.py); point its WS endpoint at
 * ws://<this-ip>:8765. The ESP32 does NOT serve the client (deferred per WORKBOARD).
 * Only ONE 0xFFF0 transmitter at a time (Pi broadcaster off; the ESP32 is the TX).
 */
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "nvs_flash.h"

#include "wifi_secrets.h"     /* GITIGNORED: WIFI_SSID / WIFI_PASS */
#include "mk4_wifi.h"
#include "mk4_advertiser.h"
#include "mk4_ws_server.h"

static const char *TAG = "mk4_main";

#define WS_PORT 8765

void app_main(void)
{
    ESP_LOGI(TAG, "== esp32-core: WiFi station + NimBLE advertiser + WS server (api.py contract) ==");

    esp_err_t r = nvs_flash_init();
    if (r == ESP_ERR_NVS_NO_FREE_PAGES || r == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        r = nvs_flash_init();
    }
    ESP_ERROR_CHECK(r);

    /* 1) Join WiFi, get the LAN IP. */
    char ip[16];
    mk4_wifi_connect(WIFI_SSID, WIFI_PASS, ip, sizeof ip);
    if (ip[0] == '\0') {
        ESP_LOGE(TAG, "no IP — fix wifi_secrets.h and reflash. Halting.");
        while (1) vTaskDelay(pdMS_TO_TICKS(10000));
    }

    /* 2) Bring up the BLE radio (advertiser + 300 ms auto-neutral keepalive + STOP). */
    mk4_adv_init();

    /* 3) Start the WS server. */
    mk4_ws_start(WS_PORT);

    ESP_LOGI(TAG, "========================================================");
    ESP_LOGI(TAG, " READY. Point the client's WS endpoint at:");
    ESP_LOGI(TAG, "     ws://%s:%d", ip, WS_PORT);
    ESP_LOGI(TAG, " (client served elsewhere, e.g. the Pi / client/serve.py)");
    ESP_LOGI(TAG, "========================================================");

    while (1) vTaskDelay(pdMS_TO_TICKS(10000));
}
