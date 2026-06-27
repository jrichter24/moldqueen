/* WiFi station + SoftAP + NVS creds/port + network scan — see mk4_wifi.h. */
#include "mk4_wifi.h"

#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_mac.h"
#include "esp_log.h"
#include "nvs.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"

static const char *TAG = "mk4_wifi";

#define NVS_NS    "wifi"
#define SCAN_MAX  12

#define GOT_IP_BIT BIT0
#define FAIL_BIT   BIT1

static EventGroupHandle_t s_eg;
static char s_ip[16];
static char s_ssid[33];          /* the connected SSID (shown on the management page) */
static int  s_retries;
static int  s_max_retries;
static volatile bool s_giving_up;
static volatile bool s_no_autoconnect;   /* in scan/AP mode the STA must not auto-connect */
static bool s_stack_inited;

static char   s_scan_ssids[SCAN_MAX][33];
static int8_t s_scan_rssi[SCAN_MAX];
static int    s_scan_count;

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        if (!s_no_autoconnect) esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_giving_up || s_no_autoconnect) return;
        if (s_retries < s_max_retries) { s_retries++; esp_wifi_connect(); }
        else xEventGroupSetBits(s_eg, FAIL_BIT);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *e = (ip_event_got_ip_t *)data;
        snprintf(s_ip, sizeof s_ip, IPSTR, IP2STR(&e->ip_info.ip));
        s_retries = 0;
        xEventGroupSetBits(s_eg, GOT_IP_BIT);
    }
}

/* One-time WiFi stack bring-up (idempotent). */
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

uint16_t mk4_wifi_ws_port_load(void)
{
    nvs_handle_t h;
    uint16_t p = 8765;
    if (nvs_open(NVS_NS, NVS_READONLY, &h) == ESP_OK) {
        nvs_get_u16(h, "ws_port", &p);
        nvs_close(h);
    }
    return p ? p : 8765;
}

void mk4_wifi_ws_port_save(uint16_t port)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READWRITE, &h) == ESP_OK) {
        nvs_set_u16(h, "ws_port", port);
        nvs_commit(h);
        nvs_close(h);
        ESP_LOGI(TAG, "ws_port saved to NVS (%u)", port);
    }
}

void mk4_wifi_mac_str(char *out, size_t cap)
{
    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);   /* from eFuse — no WiFi init needed */
    snprintf(out, cap, "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

void mk4_wifi_ip_str(char *out, size_t cap)
{
    if (cap) { strncpy(out, s_ip, cap - 1); out[cap - 1] = 0; }
}

void mk4_wifi_current_ssid(char *out, size_t cap)
{
    if (cap) { strncpy(out, s_ssid, cap - 1); out[cap - 1] = 0; }
}

int mk4_wifi_sta_rssi(void)
{
    wifi_ap_record_t ap;
    return (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) ? ap.rssi : 0;
}

/* Software force-AP flag (NVS) — the reliable replacement for the dropped hardware re-provision
   trigger. The management page sets it; the boot logic takes (reads + clears) it. One-shot. */
void mk4_wifi_force_ap_set(void)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READWRITE, &h) == ESP_OK) {
        nvs_set_u8(h, "force_ap", 1);
        nvs_commit(h);
        nvs_close(h);
        ESP_LOGW(TAG, "force-AP flag set — next boot goes to provisioning");
    }
}

bool mk4_wifi_force_ap_take(void)
{
    nvs_handle_t h;
    uint8_t v = 0;
    if (nvs_open(NVS_NS, NVS_READWRITE, &h) == ESP_OK) {
        if (nvs_get_u8(h, "force_ap", &v) == ESP_OK && v) {
            nvs_erase_key(h, "force_ap");   /* one-shot: clear so a later power-cycle is normal */
            nvs_commit(h);
        }
        nvs_close(h);
    }
    return v != 0;
}

bool mk4_wifi_connect_sta(const char *ssid, const char *pass, char *ip_out, size_t ip_cap, int timeout_ms)
{
    stack_init();
    s_retries = 0;
    s_giving_up = false;
    s_no_autoconnect = false;     /* this path WANTS the STA to connect */
    s_max_retries = 100;
    xEventGroupClearBits(s_eg, GOT_IP_BIT | FAIL_BIT);

    wifi_config_t wc;
    memset(&wc, 0, sizeof wc);
    strncpy((char *)wc.sta.ssid, ssid, sizeof wc.sta.ssid - 1);
    strncpy((char *)wc.sta.password, pass ? pass : "", sizeof wc.sta.password - 1);
    wc.sta.threshold.authmode = WIFI_AUTH_OPEN;
    strncpy(s_ssid, ssid, sizeof s_ssid - 1);
    s_ssid[sizeof s_ssid - 1] = 0;

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
    s_giving_up = true;
    ESP_LOGW(TAG, "STA connect failed/timeout for '%s'", ssid);
    esp_wifi_stop();
    if (ip_out && ip_cap) ip_out[0] = 0;
    return false;
}

/* Pull the just-finished scan's results into the cache (dedup, hidden skipped, strongest-first). */
static void scan_collect(void)
{
    s_scan_count = 0;
    uint16_t n = 0;
    esp_wifi_scan_get_ap_num(&n);
    if (n == 0) return;
    wifi_ap_record_t *recs = calloc(n, sizeof(wifi_ap_record_t));
    if (!recs) return;
    esp_wifi_scan_get_ap_records(&n, recs);
    for (int i = 0; i < n; i++) {
        const char *s = (const char *)recs[i].ssid;
        if (s[0] == 0) continue;          /* hidden */
        int8_t rssi = recs[i].rssi;
        int found = -1;
        for (int j = 0; j < s_scan_count; j++)
            if (strcmp(s_scan_ssids[j], s) == 0) { found = j; break; }
        if (found >= 0) {
            if (rssi > s_scan_rssi[found]) s_scan_rssi[found] = rssi;   /* keep strongest */
            continue;
        }
        if (s_scan_count >= SCAN_MAX) continue;
        strncpy(s_scan_ssids[s_scan_count], s, 32);
        s_scan_ssids[s_scan_count][32] = 0;
        s_scan_rssi[s_scan_count] = rssi;
        s_scan_count++;
    }
    /* strongest-first (insertion sort; N <= SCAN_MAX) */
    for (int a = 1; a < s_scan_count; a++) {
        char tmps[33]; strcpy(tmps, s_scan_ssids[a]);
        int8_t tmpr = s_scan_rssi[a];
        int b = a - 1;
        while (b >= 0 && s_scan_rssi[b] < tmpr) {
            strcpy(s_scan_ssids[b + 1], s_scan_ssids[b]);
            s_scan_rssi[b + 1] = s_scan_rssi[b];
            b--;
        }
        strcpy(s_scan_ssids[b + 1], tmps);
        s_scan_rssi[b + 1] = tmpr;
    }
    free(recs);
}

void mk4_wifi_scan_cache(void)
{
    stack_init();
    s_scan_count = 0;
    s_no_autoconnect = true;       /* scan only — do not auto-connect the STA */
    s_giving_up = true;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_start());

    wifi_scan_config_t sc = { 0 };   /* active scan, all channels */
    if (esp_wifi_scan_start(&sc, true) == ESP_OK) scan_collect();   /* blocking */
    else ESP_LOGW(TAG, "scan failed");
    ESP_LOGI(TAG, "scan: %d network(s) cached", s_scan_count);
    esp_wifi_stop();   /* start_ap brings up the AP next */
}

void mk4_wifi_scan_live(void)
{
    s_scan_count = 0;
    wifi_scan_config_t sc = { 0 };   /* scan while CONNECTED — do not change mode or stop WiFi */
    if (esp_wifi_scan_start(&sc, true) == ESP_OK) scan_collect();
    else ESP_LOGW(TAG, "live scan failed");
    ESP_LOGI(TAG, "live scan: %d network(s) cached", s_scan_count);
}

int mk4_wifi_scan_get(char ssids[][33], int8_t *rssi, int max)
{
    int n = s_scan_count < max ? s_scan_count : max;
    for (int i = 0; i < n; i++) {
        strncpy(ssids[i], s_scan_ssids[i], 32);
        ssids[i][32] = 0;
        if (rssi) rssi[i] = s_scan_rssi[i];
    }
    return n;
}

void mk4_wifi_start_ap(const char *ap_ssid, const char *ap_pass)
{
    stack_init();
    s_giving_up = true;
    s_no_autoconnect = true;
    esp_wifi_stop();

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
