/* MK4 NimBLE advertiser + safety layer — see mk4_advertiser.h. */
#include "mk4_advertiser.h"
#include "mouldking_crypt.h"

#include <string.h>
#include <stdio.h>
#include "esp_log.h"
#include "esp_timer.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "services/gap/ble_svc_gap.h"

static const char *TAG = "mk4_adv";

/* On-air advertising data: Flags AD + 0xFFF0 manufacturer AD + 24 crypted bytes = 31
   bytes (the legacy limit). Mirrors linux-core telegram.py and the Android BleBroadcaster. */
#define AD_LEN 31
static uint8_t  s_ad[AD_LEN];
static volatile int s_started;          /* advertising actually running? */
static uint8_t  s_own_addr_type;

/* Per-channel motion state + dead-man timers (the safety layer). */
static int8_t   s_channels[12];         /* -7..+7, 0 = neutral */
static int64_t  s_refresh_us[12];       /* last refresh time per channel (esp_timer us) */
static SemaphoreHandle_t s_lock;        /* guards s_channels / s_refresh_us / the adv push */

/* The single generic CONNECT telegram (raw): ad ae 18 80 80 80 f3 52. */
static const uint8_t CONNECT_RAW[] = { 0xad, 0xae, 0x18, 0x80, 0x80, 0x80, 0xf3, 0x52 };

static int gap_event(struct ble_gap_event *event, void *arg);

/* raw MK4 telegram -> the 31-byte AD payload (Flags + mfr header + crypted 24). */
static void build_ad(const uint8_t *raw, size_t L)
{
    s_ad[0] = 0x02; s_ad[1] = 0x01; s_ad[2] = 0x02;                     /* Flags AD */
    s_ad[3] = 0x1b; s_ad[4] = 0xff; s_ad[5] = 0xf0; s_ad[6] = 0xff;     /* mfr AD: len 27, type 0xFF, company 0xFFF0 (LE) */
    mk_crypt_encode(raw, L, &s_ad[7]);                                  /* 24 crypted bytes */
}

/* Push the current AD to the radio. When advertising is RUNNING this is an IN-PLACE
   update on the continuously-running advertiser (no stop/start) — the SACRED path. */
static void push_ad(void)
{
    if (!s_started) {
        return;     /* not advertising yet; advertise() will use s_ad on sync */
    }
    int rc = ble_gap_adv_set_data(s_ad, AD_LEN);   /* HCI LE Set Advertising Data — in place */
    if (rc != 0) {
        ESP_LOGE(TAG, "ble_gap_adv_set_data rc=%d", rc);
    }
}

/* Build the 10-byte motion raw telegram from channel values:
   7d ae 18 <6 channel bytes> 82; nibble = 0x8 + value, even index = high nibble. */
static void motion_from_channels(const int8_t ch[12], uint8_t raw[10])
{
    raw[0] = 0x7d; raw[1] = 0xae; raw[2] = 0x18;
    for (int i = 0; i < 6; i++) {
        int hi = 0x8 + ch[2 * i];
        int lo = 0x8 + ch[2 * i + 1];
        if (hi < 0x1) hi = 0x1;
        if (hi > 0xF) hi = 0xF;
        if (lo < 0x1) lo = 0x1;
        if (lo > 0xF) lo = 0xF;
        raw[3 + i] = (uint8_t)((hi << 4) | lo);
    }
    raw[9] = 0x82;
}

/* Rebuild the motion telegram from s_channels and push it in place. Call with s_lock held. */
static void rebuild_motion_locked(void)
{
    uint8_t raw[10];
    motion_from_channels(s_channels, raw);
    build_ad(raw, sizeof raw);
    push_ad();
}

static void advertise(void)
{
    int rc = ble_gap_adv_set_data(s_ad, AD_LEN);
    if (rc != 0) { ESP_LOGE(TAG, "set_data(start) rc=%d", rc); return; }

    struct ble_gap_adv_params p;
    memset(&p, 0, sizeof p);
    p.conn_mode = BLE_GAP_CONN_MODE_UND;   /* connectable ADV_IND — matches the stock app */
    p.disc_mode = BLE_GAP_DISC_MODE_GEN;
    p.itvl_min = 160;                      /* 160 * 0.625ms = 100ms (~10/s) */
    p.itvl_max = 160;

    rc = ble_gap_adv_start(s_own_addr_type, NULL, BLE_HS_FOREVER, &p, gap_event, NULL);
    if (rc == 0) {
        s_started = 1;
        ESP_LOGI(TAG, "advertising started: legacy connectable, company 0xFFF0, 31B AD, 100ms");
    } else {
        ESP_LOGE(TAG, "ble_gap_adv_start rc=%d", rc);
    }
}

static int gap_event(struct ble_gap_event *event, void *arg)
{
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        ESP_LOGW(TAG, "unexpected connect (status=%d); terminating to stay a broadcaster", event->connect.status);
        if (event->connect.status == 0) {
            ble_gap_terminate(event->connect.conn_handle, BLE_ERR_REM_USER_CONN_TERM);
        }
        return 0;
    case BLE_GAP_EVENT_DISCONNECT:
    case BLE_GAP_EVENT_ADV_COMPLETE:
        s_started = 0;
        advertise();        /* only on an unexpected stop — NOT a data-change path */
        return 0;
    default:
        return 0;
    }
}

static void on_sync(void)
{
    int rc = ble_hs_util_ensure_addr(0);
    if (rc != 0) ESP_LOGW(TAG, "ensure_addr rc=%d", rc);
    rc = ble_hs_id_infer_auto(0, &s_own_addr_type);
    if (rc != 0) { ESP_LOGE(TAG, "infer_auto rc=%d", rc); return; }
    ESP_LOGI(TAG, "NimBLE host synced — starting the 0xFFF0 advertiser");
    advertise();
}

static void on_reset(int reason) { ESP_LOGE(TAG, "NimBLE reset; reason=%d", reason); }

static void host_task(void *param)
{
    nimble_port_run();
    nimble_port_freertos_deinit();
}

/* Affirmative per-channel dead-man's-switch: neutralize any non-neutral channel not
   refreshed within MK4_CHANNEL_TIMEOUT_MS. Mirrors api.py reap_stale / ApiCore.reapStale. */
static void keepalive_task(void *param)
{
    const int64_t timeout_us = (int64_t)MK4_CHANNEL_TIMEOUT_MS * 1000;
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(50));
        xSemaphoreTake(s_lock, portMAX_DELAY);
        int64_t now = esp_timer_get_time();
        int changed = 0;
        for (int i = 0; i < 12; i++) {
            if (s_channels[i] != 0 && (now - s_refresh_us[i]) > timeout_us) {
                s_channels[i] = 0;
                changed = 1;
            }
        }
        if (changed) {
            ESP_LOGW(TAG, "channel(s) not refreshed > %dms -> NEUTRAL (dead-man's-switch)", MK4_CHANNEL_TIMEOUT_MS);
            rebuild_motion_locked();    /* in place — the SACRED rule still holds */
        }
        xSemaphoreGive(s_lock);
    }
}

void mk4_adv_init(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    s_lock = xSemaphoreCreateMutex();
    for (int i = 0; i < 12; i++) { s_channels[i] = 0; s_refresh_us[i] = 0; }

    build_ad(CONNECT_RAW, sizeof CONNECT_RAW);   /* a valid frame ready before sync */

    ret = nimble_port_init();
    if (ret != ESP_OK) { ESP_LOGE(TAG, "nimble_port_init failed: %d", ret); return; }

    ble_hs_cfg.sync_cb  = on_sync;
    ble_hs_cfg.reset_cb = on_reset;
    ble_svc_gap_init();
    ble_svc_gap_device_name_set("moldqueen-esp32");

    nimble_port_freertos_init(host_task);
    xTaskCreate(keepalive_task, "mk4_keepalive", 3072, NULL, 5, NULL);
}

void mk4_adv_connect(void)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    build_ad(CONNECT_RAW, sizeof CONNECT_RAW);
    ESP_LOGI(TAG, "telegram -> CONNECT");
    push_ad();
    xSemaphoreGive(s_lock);
}

void mk4_adv_set(int slot, int channel, int value)
{
    int idx = slot * 4 + channel;
    if (idx < 0 || idx >= 12) return;
    if (value < -7) value = -7;
    if (value > 7) value = 7;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_channels[idx] = (int8_t)value;
    s_refresh_us[idx] = esp_timer_get_time();   /* affirmative refresh — resets the dead-man timer */
    rebuild_motion_locked();
    xSemaphoreGive(s_lock);
}

void mk4_adv_neutral(void)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    for (int i = 0; i < 12; i++) s_channels[i] = 0;
    ESP_LOGI(TAG, "telegram -> NEUTRAL (all channels released)");
    rebuild_motion_locked();
    xSemaphoreGive(s_lock);
}

void mk4_adv_stop(void)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    ESP_LOGW(TAG, "STOP: tearing the advertiser DOWN + reconnecting at NEUTRAL");
    for (int i = 0; i < 12; i++) { s_channels[i] = 0; s_refresh_us[i] = 0; }

    /* kill+reconnect (mirrors linux-core _kill_reconnect): adv OFF -> CONNECT -> adv ON
       -> in-place neutral motion. This is the ONE deliberate stop/start (NOT per-change). */
    ble_gap_adv_stop();
    s_started = 0;
    vTaskDelay(pdMS_TO_TICKS(120));               /* settle so the hub registers the teardown */
    build_ad(CONNECT_RAW, sizeof CONNECT_RAW);
    advertise();                                  /* adv ON, broadcasting CONNECT */
    rebuild_motion_locked();                      /* in-place swap to the all-neutral motion frame */
    ESP_LOGW(TAG, "STOP: radio torn down + reconnected at NEUTRAL");
    xSemaphoreGive(s_lock);
}

int mk4_adv_is_ready(void)
{
    return s_started ? 1 : 0;
}

void mk4_adv_snapshot(int8_t ch_out[12], char *raw_hex, size_t raw_cap, char *ad_hex, size_t ad_cap)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    for (int i = 0; i < 12; i++) ch_out[i] = s_channels[i];

    uint8_t raw[10];
    motion_from_channels(s_channels, raw);

    /* raw hex, no spaces (e.g. "7dae18888888888882") */
    int p = 0;
    for (int i = 0; i < 10 && p + 2 < (int)raw_cap; i++)
        p += snprintf(raw_hex + p, raw_cap - p, "%02x", raw[i]);

    /* ad hex: leading length 1f + the 31 AD bytes, space-separated (matches the Pi's ad_hex) */
    uint8_t ad[31];
    ad[0] = 0x02; ad[1] = 0x01; ad[2] = 0x02;
    ad[3] = 0x1b; ad[4] = 0xff; ad[5] = 0xf0; ad[6] = 0xff;
    mk_crypt_encode(raw, 10, &ad[7]);
    p = 0;
    p += snprintf(ad_hex + p, ad_cap - p, "1f");
    for (int i = 0; i < 31 && p < (int)ad_cap; i++)
        p += snprintf(ad_hex + p, ad_cap - p, " %02x", ad[i]);

    xSemaphoreGive(s_lock);
}
