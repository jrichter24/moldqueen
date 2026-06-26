/* WiFi WebSocket server mirroring api.py — see mk4_ws_server.h. */
#include "mk4_ws_server.h"
#include "mk4_advertiser.h"

#include <string.h>
#include <stdlib.h>
#include "esp_log.h"
#include "esp_http_server.h"
#include "cJSON.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "mk4_ws";

/* Lifecycle (owned here, like api.py's App.lifecycle). */
static const char *IDLE = "IDLE", *CONNECTING = "CONNECTING", *READY = "READY";
static const char *s_lifecycle = "IDLE";
static httpd_handle_t s_server;
static uint16_t s_port;

#define MAX_FDS 8

/* ---- server -> client JSON (field names/shapes match api.py) ----------------- */

static char *lifecycle_json(void)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "type", "lifecycle");
    cJSON_AddStringToObject(o, "state", s_lifecycle);
    char *s = cJSON_PrintUnformatted(o);
    cJSON_Delete(o);
    return s;   /* caller frees */
}

static char *state_json(void)
{
    int8_t ch[12];
    char raw[40], ad[160];
    mk4_adv_snapshot(ch, raw, sizeof raw, ad, sizeof ad);

    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "type", "state");
    cJSON *slots = cJSON_AddArrayToObject(o, "slots");
    for (int s = 0; s < 3; s++) {
        cJSON *row = cJSON_CreateArray();
        for (int c = 0; c < 4; c++) cJSON_AddItemToArray(row, cJSON_CreateNumber(ch[s * 4 + c]));
        cJSON_AddItemToArray(slots, row);
    }
    cJSON_AddStringToObject(o, "raw", raw);
    cJSON_AddStringToObject(o, "ad", ad);
    char *str = cJSON_PrintUnformatted(o);
    cJSON_Delete(o);
    return str;
}

static char *info_json(void)
{
    /* info_level "light": app/version/lifecycle/info_level + radio/ports (NO host identity).
       radio_backend is display-only; the shapes/tiers match api.py. */
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "type", "info");
    cJSON_AddStringToObject(o, "app", "moldqueen");
    cJSON_AddStringToObject(o, "version", "esp32-core");
    cJSON_AddStringToObject(o, "lifecycle", s_lifecycle);
    cJSON_AddStringToObject(o, "info_level", "light");
    cJSON_AddStringToObject(o, "radio_backend", "esp32-nimble");
    cJSON_AddBoolToObject(o, "dry_run", 0);
    cJSON_AddStringToObject(o, "hci", "nimble");
    cJSON_AddNumberToObject(o, "ws_port", s_port);
    cJSON_AddNumberToObject(o, "http_port", 0);
    cJSON_AddBoolToObject(o, "serve_client", 0);   /* the ESP32 does NOT serve the client */
    char *s = cJSON_PrintUnformatted(o);
    cJSON_Delete(o);
    return s;
}

/* ---- transport ---------------------------------------------------------------- */

static void send_text(int fd, const char *text)
{
    httpd_ws_frame_t f = { 0 };
    f.type = HTTPD_WS_TYPE_TEXT;
    f.payload = (uint8_t *)text;
    f.len = strlen(text);
    httpd_ws_send_frame_async(s_server, fd, &f);
}

/* List the current WebSocket client fds into `out` (cap MAX_FDS); returns the count. */
static size_t ws_client_fds(int out[MAX_FDS])
{
    size_t n = MAX_FDS;
    int fds[MAX_FDS];
    size_t k = 0;
    if (httpd_get_client_list(s_server, &n, fds) != ESP_OK) return 0;
    for (size_t i = 0; i < n && k < MAX_FDS; i++) {
        if (httpd_ws_get_fd_info(s_server, fds[i]) == HTTPD_WS_CLIENT_WEBSOCKET) out[k++] = fds[i];
    }
    return k;
}

static void ws_broadcast(const char *text)
{
    int fds[MAX_FDS];
    size_t n = ws_client_fds(fds);
    for (size_t i = 0; i < n; i++) send_text(fds[i], text);
}

/* ---- message dispatch (mirrors api.py handler choreography) -------------------- */

static void dispatch(int fd, const char *json)
{
    cJSON *m = cJSON_Parse(json);
    if (!m) return;
    const cJSON *cmd = cJSON_GetObjectItem(m, "cmd");
    if (cJSON_IsString(cmd)) {
        if (!strcmp(cmd->valuestring, "setup")) {
            const cJSON *a = cJSON_GetObjectItem(m, "action");
            if (cJSON_IsString(a)) {
                int ok = 1;
                if (!strcmp(a->valuestring, "connect"))      { s_lifecycle = CONNECTING; mk4_adv_connect(); }
                else if (!strcmp(a->valuestring, "ready"))   { s_lifecycle = READY;      mk4_adv_neutral(); }
                else if (!strcmp(a->valuestring, "reset"))   { s_lifecycle = IDLE;       mk4_adv_connect(); }
                else ok = 0;
                if (ok) {
                    ESP_LOGI(TAG, "setup -> %s", s_lifecycle);
                    char *lj = lifecycle_json(); ws_broadcast(lj); free(lj);
                    /* the state push (if anything changed) is handled by the poller */
                }
            }
        } else if (!strcmp(cmd->valuestring, "set")) {     /* the ONLY motion primitive */
            if (s_lifecycle == READY) {
                const cJSON *sl = cJSON_GetObjectItem(m, "slot");
                const cJSON *ch = cJSON_GetObjectItem(m, "channel");
                const cJSON *vv = cJSON_GetObjectItem(m, "value");
                if (cJSON_IsNumber(sl) && cJSON_IsNumber(ch) && cJSON_IsNumber(vv)) {
                    mk4_adv_set(sl->valueint, ch->valueint, vv->valueint);  /* refreshes the keepalive */
                }
            }
        } else if (!strcmp(cmd->valuestring, "stop")) {
            mk4_adv_stop();                                /* kill + reconnect at neutral */
        } else if (!strcmp(cmd->valuestring, "state")) {
            char *lj = lifecycle_json(); send_text(fd, lj); free(lj);
            char *sj = state_json();     send_text(fd, sj); free(sj);
        } else if (!strcmp(cmd->valuestring, "info")) {
            char *ij = info_json(); send_text(fd, ij); free(ij);
        }
    }
    cJSON_Delete(m);
}

static esp_err_t ws_handler(httpd_req_t *req)
{
    if (req->method == HTTP_GET) {
        ESP_LOGI(TAG, "WS client connected (fd=%d)", httpd_req_to_sockfd(req));
        return ESP_OK;   /* handshake; the poller sends the initial lifecycle+state */
    }
    httpd_ws_frame_t f = { 0 };
    f.type = HTTPD_WS_TYPE_TEXT;
    esp_err_t r = httpd_ws_recv_frame(req, &f, 0);   /* probe the length */
    if (r != ESP_OK) return r;
    if (f.len == 0 || f.len > 1024) return ESP_OK;
    uint8_t *buf = calloc(1, f.len + 1);
    if (!buf) return ESP_ERR_NO_MEM;
    f.payload = buf;
    r = httpd_ws_recv_frame(req, &f, f.len);
    if (r == ESP_OK) dispatch(httpd_req_to_sockfd(req), (char *)buf);
    free(buf);
    return ESP_OK;
}

/* The single state broadcaster + new-client/disconnect detector (mirrors api.py's
   on-connect initial send, per-set state push, and on-disconnect safety). */
static void poller_task(void *arg)
{
    int known[MAX_FDS]; size_t known_n = 0;
    char last_state[200] = "";
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(50));
        if (!s_server) continue;

        int cur[MAX_FDS];
        size_t cur_n = ws_client_fds(cur);

        /* new fds -> send the initial lifecycle + state (api.py on-connect) */
        for (size_t i = 0; i < cur_n; i++) {
            int isknown = 0;
            for (size_t k = 0; k < known_n; k++) if (known[k] == cur[i]) isknown = 1;
            if (!isknown) {
                char *lj = lifecycle_json(); send_text(cur[i], lj); free(lj);
                char *sj = state_json();     send_text(cur[i], sj); free(sj);
            }
        }
        int had = (known_n > 0);
        memcpy(known, cur, cur_n * sizeof(int));
        known_n = cur_n;
        if (had && known_n == 0) {     /* last client gone -> STOP (safety; keepalive already covers it) */
            ESP_LOGW(TAG, "all WS clients gone -> STOP (safety)");
            s_lifecycle = IDLE;
            mk4_adv_stop();
        }

        /* broadcast state when it changes (covers set / stop / auto-neutral) */
        char *sj = state_json();
        if (cur_n > 0 && strcmp(sj, last_state) != 0) {
            ws_broadcast(sj);
            strncpy(last_state, sj, sizeof last_state - 1);
            last_state[sizeof last_state - 1] = '\0';
        }
        free(sj);
    }
}

void mk4_ws_start(uint16_t port)
{
    s_port = port;
    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.server_port = port;
    cfg.max_open_sockets = MAX_FDS - 1;   /* httpd needs one spare for the control socket */
    cfg.lru_purge_enable = true;
    if (httpd_start(&s_server, &cfg) != ESP_OK) {
        ESP_LOGE(TAG, "httpd_start failed on port %d", port);
        return;
    }
    httpd_uri_t ws = { .uri = "/", .method = HTTP_GET, .handler = ws_handler, .is_websocket = true };
    httpd_register_uri_handler(s_server, &ws);
    xTaskCreate(poller_task, "mk4_ws_poll", 4096, NULL, 5, NULL);
    ESP_LOGI(TAG, "WebSocket API on ws://<ip>:%d/ (mirrors api.py; radio_backend=esp32-nimble)", port);
}
