/* WiFi station + SoftAP + NVS creds + BOOT button — see mk4_wifi.h. */
#include "mk4_wifi.h"

#include <string.h>
#include <stdio.h>
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_log.h"
#include "nvs.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"

static const char *TAG = "mk4_wifi";

#define NVS_NS    "wifi"

#define GOT_IP_BIT BIT0
#define FAIL_BIT   BIT1

static EventGroupHandle_t s_eg;
static char s_ip[16];
static int  s_retries;
static int  s_max_retries;
static volatile bool s_giving_up;
static bool s_stack_inited;

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_giving_up) return;
        if (s_retries < s_max_retries) { s_retries++; esp_wifi_connect(); }
        else xEventGroupSetBits(s_eg, FAIL_BIT);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *e = (ip_event_got_ip_t *)data;
        snprintf(s_ip, sizeof s_ip, IPSTR, IP2STR(&e->ip_info.ip));
        s_retries = 0;
        xEventGroupSetBits(s_eg, GOT_IP_BIT);
    }
}

/* One-time WiFi stack bring-up (netif + event loop + esp_wifi_init + handlers + both
   default netifs so STA->AP fallback within one boot is clean). Idempotent. */
static void stack_init(void)
{
    if (s_stack_inited) return;
    s_eg = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    esp_netif_create_default_wifi_ap();
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL, NULL));
    s_stack_inited = true;
}

bool mk4_wifi_creds_load(char *ssid, size_t ssid_cap, char *pass, size_t pass_cap)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READONLY, &h) != ESP_OK) return false;
    size_t sl = ssid_cap, pl = pass_cap;
    if (ssid_cap) ssid[0] = 0;
    if (pass_cap) pass[0] = 0;
    esp_err_t e1 = nvs_get_str(h, "ssid", ssid, &sl);
    esp_err_t e2 = nvs_get_str(h, "pass", pass, &pl);
    nvs_close(h);
    return (e1 == ESP_OK && e2 == ESP_OK && ssid[0] != 0);
}

void mk4_wifi_creds_save(const char *ssid, const char *pass)
{
    nvs_handle_t h;
    ESP_ERROR_CHECK(nvs_open(NVS_NS, NVS_READWRITE, &h));
    ESP_ERROR_CHECK(nvs_set_str(h, "ssid", ssid));
    ESP_ERROR_CHECK(nvs_set_str(h, "pass", pass ? pass : ""));
    ESP_ERROR_CHECK(nvs_commit(h));
    nvs_close(h);
    ESP_LOGI(TAG, "creds saved to NVS (ssid='%s')", ssid);
}

void mk4_wifi_creds_clear(void)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READWRITE, &h) == ESP_OK) {
        nvs_erase_all(h);
        nvs_commit(h);
        nvs_close(h);
        ESP_LOGW(TAG, "NVS creds cleared");
    }
}

bool mk4_wifi_connect_sta(const char *ssid, const char *pass, char *ip_out, size_t ip_cap, int timeout_ms)
{
    stack_init();
    s_retries = 0;
    s_giving_up = false;
    s_max_retries = 100;     /* retry within the timeout window; the wait below bounds total time */
    xEventGroupClearBits(s_eg, GOT_IP_BIT | FAIL_BIT);

    wifi_config_t wc;
    memset(&wc, 0, sizeof wc);
    strncpy((char *)wc.sta.ssid, ssid, sizeof wc.sta.ssid - 1);
    strncpy((char *)wc.sta.password, pass ? pass : "", sizeof wc.sta.password - 1);
    wc.sta.threshold.authmode = WIFI_AUTH_OPEN;   /* accept whatever the AP offers */

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "STA connecting to '%s' (timeout %d ms) ...", ssid, timeout_ms);
    EventBits_t bits = xEventGroupWaitBits(s_eg, GOT_IP_BIT | FAIL_BIT, pdFALSE, pdFALSE, pdMS_TO_TICKS(timeout_ms));
    if (bits & GOT_IP_BIT) {
        ESP_LOGI(TAG, "STA connected — IP = %s", s_ip);
        if (ip_out && ip_cap) { strncpy(ip_out, s_ip, ip_cap - 1); ip_out[ip_cap - 1] = 0; }
        return true;
    }
    /* timeout or exhausted retries -> give up cleanly so the AP can start fresh */
    s_giving_up = true;
    ESP_LOGW(TAG, "STA connect failed/timeout for '%s'", ssid);
    esp_wifi_stop();
    if (ip_out && ip_cap) ip_out[0] = 0;
    return false;
}

void mk4_wifi_start_ap(const char *ap_ssid, const char *ap_pass)
{
    stack_init();
    s_giving_up = true;        /* stop any STA retry from interfering */
    esp_wifi_stop();           /* in case a STA attempt was running */

    wifi_config_t wc;
    memset(&wc, 0, sizeof wc);
    strncpy((char *)wc.ap.ssid, ap_ssid, sizeof wc.ap.ssid - 1);
    wc.ap.ssid_len = strlen(ap_ssid);
    wc.ap.channel = 1;
    wc.ap.max_connection = 4;
    if (ap_pass && strlen(ap_pass) >= 8) {
        strncpy((char *)wc.ap.password, ap_pass, sizeof wc.ap.password - 1);
        wc.ap.authmode = WIFI_AUTH_WPA2_PSK;
    } else {
        wc.ap.authmode = WIFI_AUTH_OPEN;
    }

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_LOGI(TAG, "SoftAP '%s' up (%s) — config page at http://192.168.4.1/",
             ap_ssid, wc.ap.authmode == WIFI_AUTH_OPEN ? "open" : "wpa2");
}
