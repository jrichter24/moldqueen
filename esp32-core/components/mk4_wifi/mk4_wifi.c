/* WiFi station — see mk4_wifi.h. Standard esp_wifi STA bring-up. */
#include "mk4_wifi.h"

#include <string.h>
#include <stdio.h>
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"

static const char *TAG = "mk4_wifi";

#define GOT_IP_BIT BIT0
#define FAIL_BIT   BIT1
#define MAX_RETRY  10

static EventGroupHandle_t s_eg;
static char s_ip[16];
static int  s_retries;

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_retries < MAX_RETRY) {
            s_retries++;
            ESP_LOGW(TAG, "disconnected — retry %d/%d", s_retries, MAX_RETRY);
            esp_wifi_connect();
        } else {
            xEventGroupSetBits(s_eg, FAIL_BIT);
        }
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *e = (ip_event_got_ip_t *)data;
        snprintf(s_ip, sizeof s_ip, IPSTR, IP2STR(&e->ip_info.ip));
        s_retries = 0;
        xEventGroupSetBits(s_eg, GOT_IP_BIT);
    }
}

void mk4_wifi_connect(const char *ssid, const char *pass, char *ip_out, size_t ip_cap)
{
    s_eg = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_instance_t h1, h2;
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, NULL, &h1));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL, &h2));

    wifi_config_t wc;
    memset(&wc, 0, sizeof wc);
    strncpy((char *)wc.sta.ssid, ssid, sizeof wc.sta.ssid - 1);
    strncpy((char *)wc.sta.password, pass, sizeof wc.sta.password - 1);
    /* Accept whatever the AP offers (WPA2/WPA3/open) — minimal threshold. */
    wc.sta.threshold.authmode = WIFI_AUTH_OPEN;

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "connecting to SSID '%s' ...", ssid);
    EventBits_t bits = xEventGroupWaitBits(s_eg, GOT_IP_BIT | FAIL_BIT, pdFALSE, pdFALSE, pdMS_TO_TICKS(30000));
    if (bits & GOT_IP_BIT) {
        ESP_LOGI(TAG, "WiFi connected — IP = %s", s_ip);
        strncpy(ip_out, s_ip, ip_cap - 1);
        ip_out[ip_cap - 1] = '\0';
    } else {
        ESP_LOGE(TAG, "WiFi connect FAILED (ssid '%s') — check wifi_secrets.h", ssid);
        if (ip_cap) ip_out[0] = '\0';
    }
}
