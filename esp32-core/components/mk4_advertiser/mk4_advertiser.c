/* MK4 NimBLE advertiser — see mk4_advertiser.h for the SACRED in-place-update rule. */
#include "mk4_advertiser.h"
#include "mouldking_crypt.h"

#include <string.h>
#include "esp_log.h"
#include "nvs_flash.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "services/gap/ble_svc_gap.h"

static const char *TAG = "mk4_adv";

/* On-air advertising data: Flags AD + 0xFFF0 manufacturer AD + 24 crypted bytes
   = 31 bytes (the legacy limit). Mirrors linux-core/mk4web/telegram.py and the
   Android BleBroadcaster. */
#define AD_LEN 31
static uint8_t  s_ad[AD_LEN];
static volatile int s_started;          /* advertising actually running? */
static uint8_t  s_own_addr_type;

/* The single generic CONNECT telegram (raw): ad ae 18 80 80 80 f3 52. */
static const uint8_t CONNECT_RAW[] = { 0xad, 0xae, 0x18, 0x80, 0x80, 0x80, 0xf3, 0x52 };

static int gap_event(struct ble_gap_event *event, void *arg);

/* raw MK4 telegram -> the 31-byte AD payload (Flags + mfr header + crypted 24). */
static void build_ad(const uint8_t *raw, size_t L)
{
    s_ad[0] = 0x02; s_ad[1] = 0x01; s_ad[2] = 0x02;                     /* Flags AD (LE General Disc) */
    s_ad[3] = 0x1b; s_ad[4] = 0xff; s_ad[5] = 0xf0; s_ad[6] = 0xff;     /* mfr AD: len 27, type 0xFF, company 0xFFF0 (LE) */
    mk_crypt_encode(raw, L, &s_ad[7]);                                  /* 24 crypted bytes */
}

/* Push the current AD to the radio. When advertising is RUNNING this is an
   IN-PLACE update on the continuously-running advertiser (no stop/start). */
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

static void advertise(void)
{
    int rc = ble_gap_adv_set_data(s_ad, AD_LEN);
    if (rc != 0) { ESP_LOGE(TAG, "set_data(start) rc=%d", rc); return; }

    struct ble_gap_adv_params p;
    memset(&p, 0, sizeof p);
    p.conn_mode = BLE_GAP_CONN_MODE_UND;   /* connectable ADV_IND — matches the stock app */
    p.disc_mode = BLE_GAP_DISC_MODE_GEN;
    p.itvl_min = 160;                      /* 160 * 0.625ms = 100ms (~10/s), matches the other cores */
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
        /* We are a pure broadcaster — drop any stray GATT connection and keep advertising. */
        ESP_LOGW(TAG, "unexpected connect (status=%d); terminating to stay a broadcaster", event->connect.status);
        if (event->connect.status == 0) {
            ble_gap_terminate(event->connect.conn_handle, BLE_ERR_REM_USER_CONN_TERM);
        }
        return 0;
    case BLE_GAP_EVENT_DISCONNECT:
    case BLE_GAP_EVENT_ADV_COMPLETE:
        /* Only ever happens on an unexpected stop — re-advertise. NOT a data-change path. */
        s_started = 0;
        advertise();
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

static void on_reset(int reason)
{
    ESP_LOGE(TAG, "NimBLE reset; reason=%d", reason);
}

static void host_task(void *param)
{
    nimble_port_run();              /* returns only on nimble_port_stop */
    nimble_port_freertos_deinit();
}

void mk4_adv_init(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    build_ad(CONNECT_RAW, sizeof CONNECT_RAW);   /* a valid frame ready before sync */

    ret = nimble_port_init();
    if (ret != ESP_OK) { ESP_LOGE(TAG, "nimble_port_init failed: %d", ret); return; }

    ble_hs_cfg.sync_cb  = on_sync;
    ble_hs_cfg.reset_cb = on_reset;

    ble_svc_gap_init();
    ble_svc_gap_device_name_set("moldqueen-esp32");

    nimble_port_freertos_init(host_task);
}

void mk4_adv_connect(void)
{
    build_ad(CONNECT_RAW, sizeof CONNECT_RAW);
    ESP_LOGI(TAG, "telegram -> CONNECT");
    push_ad();
}

void mk4_adv_set_channels(const int8_t values[12])
{
    /* motion raw: 7d ae 18 <6 channel bytes> 82; 12 nibbles = 0x8 + value (-7..+7),
       index = slot*4 + channel, even index = high nibble. */
    uint8_t raw[10];
    raw[0] = 0x7d; raw[1] = 0xae; raw[2] = 0x18;
    for (int i = 0; i < 6; i++) {
        int hi = 0x8 + values[2 * i];
        int lo = 0x8 + values[2 * i + 1];
        if (hi < 0x1) hi = 0x1;
        if (hi > 0xF) hi = 0xF;
        if (lo < 0x1) lo = 0x1;
        if (lo > 0xF) lo = 0xF;
        raw[3 + i] = (uint8_t)((hi << 4) | lo);
    }
    raw[9] = 0x82;
    build_ad(raw, sizeof raw);
    push_ad();
}

void mk4_adv_drive(int slot, int channel, int value)
{
    int8_t v[12] = {0};
    int idx = slot * 4 + channel;
    if (idx >= 0 && idx < 12) v[idx] = (int8_t)value;
    ESP_LOGI(TAG, "telegram -> DRIVE slot%d ch%d = %+d (nibble idx %d)", slot, channel, value, idx);
    mk4_adv_set_channels(v);
}

void mk4_adv_neutral(void)
{
    int8_t v[12] = {0};
    ESP_LOGI(TAG, "telegram -> NEUTRAL (all stop)");
    mk4_adv_set_channels(v);
}

int mk4_adv_is_ready(void)
{
    return s_started ? 1 : 0;
}
