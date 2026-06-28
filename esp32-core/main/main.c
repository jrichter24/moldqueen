/*
 * esp32-core: WiFi-provisioning build — the firmware is distributable (no creds baked in).
 *
 * Boot flow:
 *   NVS has creds and station connects within 30 s  -> NORMAL OPERATION
 *   else (no creds / connect failed)                -> PROVISIONING (fallback SoftAP)
 *
 * Discovery: in normal operation the device advertises mDNS as moldqueenesp.local and a
 * _ws._tcp service on the (NVS-configured) WS port, so the client can use
 * ws://moldqueenesp.local:<port> instead of an IP. The MAC is shown on the config page as
 * a fallback for networks where .local doesn't resolve.
 *
 * No physical re-provision trigger (a double-reset / BOOT-hold override was evaluated and
 * dropped — see the provisioning slice). Re-provisioning is handled by the management page on
 * :8080 (software "switch to setup", which sets the one-shot NVS force-AP flag the boot logic
 * checks above); the board also re-enters provisioning automatically when the saved network is
 * unreachable.
 *
 * NORMAL OPERATION (proven): the NimBLE advertiser + safety layer + the WS server on the
 * configured port. Creds + the WS port live ONLY in NVS (flash) — never in source or binary.
 */
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "mdns.h"

#include "mk4_wifi.h"
#include "mk4_provision.h"
#include "mk4_advertiser.h"
#include "mk4_ws_server.h"
#include "mk4_mgmt.h"

static const char *TAG = "mk4_main";

#define MDNS_HOSTNAME  "moldqueenesp"
#define STA_TIMEOUT_MS 30000

static void start_mdns(uint16_t ws_port)
{
    esp_err_t e = mdns_init();
    if (e != ESP_OK) { ESP_LOGW(TAG, "mdns_init failed: %d (discovery by IP only)", e); return; }
    mdns_hostname_set(MDNS_HOSTNAME);
    mdns_instance_name_set("MoldQueen ESP32");
    mdns_service_add("MoldQueen control", "_ws", "_tcp", ws_port, NULL, 0);
    ESP_LOGI(TAG, "mDNS up: %s.local  (_ws._tcp:%u)", MDNS_HOSTNAME, ws_port);
}

void app_main(void)
{
    ESP_LOGI(TAG, "== esp32-core: provisioning + WiFi station + advertiser + WS server ==");

    esp_err_t r = nvs_flash_init();
    if (r == ESP_ERR_NVS_NO_FREE_PAGES || r == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        r = nvs_flash_init();
    }
    ESP_ERROR_CHECK(r);

    uint16_t ws_port = mk4_wifi_ws_port_load();   /* NVS, default 8765 */

    /* Software force-AP (the management page's "switch to setup") — one-shot: skip the station
       attempt and go straight to provisioning. The reliable replacement for the dropped
       hardware re-provision trigger. */
    bool force_ap = mk4_wifi_force_ap_take();
    if (force_ap) ESP_LOGW(TAG, "force-AP flag set -> provisioning (re-provision on demand)");

    char ssid[33], pass[65], ip[16];
    bool have = !force_ap && mk4_wifi_creds_load(ssid, sizeof ssid, pass, sizeof pass);
    bool connected = false;

    if (have) {
        ESP_LOGI(TAG, "NVS has creds for '%s' -> trying station for %d s", ssid, STA_TIMEOUT_MS / 1000);
        connected = mk4_wifi_connect_sta(ssid, pass, ip, sizeof ip, STA_TIMEOUT_MS);
        if (!connected) ESP_LOGW(TAG, "could not join '%s' -> falling back to provisioning", ssid);
    } else if (!force_ap) {
        ESP_LOGW(TAG, "no WiFi creds in NVS -> provisioning");
    }

    if (!connected) {
        ESP_LOGW(TAG, "== PROVISIONING: join 'moldqueen-setup', open http://192.168.4.1/ ==");
        mk4_provision_run();    /* does not return — reboots into station mode on save */
        return;
    }

    /* NORMAL OPERATION (the proven drive path is unchanged; the management page is an
       additional HTTP surface on :8080, not a change to driving). */
    mk4_adv_init();
    mk4_ws_start(ws_port);
    start_mdns(ws_port);
    mk4_mgmt_start(ws_port);
    ESP_LOGI(TAG, "========================================================");
    ESP_LOGI(TAG, " READY. Point the client's WS endpoint at either:");
    ESP_LOGI(TAG, "     ws://%s.local:%u", MDNS_HOSTNAME, ws_port);
    ESP_LOGI(TAG, "     ws://%s:%u", ip, ws_port);
    ESP_LOGI(TAG, " Manage the device at http://%s.local:8080/", MDNS_HOSTNAME);
    ESP_LOGI(TAG, "========================================================");

    while (1) vTaskDelay(pdMS_TO_TICKS(10000));
}
