/* Provisioning SoftAP + config page — see mk4_provision.h. */
#include "mk4_provision.h"
#include "mk4_wifi.h"

#include <string.h>
#include <stdio.h>
#include "esp_log.h"
#include "esp_http_server.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "mk4_prov";

#define AP_SSID "moldqueen-setup"
#define AP_PASS ""              /* open network — easiest to join for a brief setup moment */

/* Tiny self-contained setup page (inline HTML/CSS, no external assets). */
static const char PAGE[] =
"<!doctype html><html><head><meta charset=utf-8>"
"<meta name=viewport content=\"width=device-width,initial-scale=1\">"
"<title>moldqueen setup</title><style>"
"body{font-family:system-ui,-apple-system,sans-serif;max-width:420px;margin:32px auto;padding:0 16px;color:#111}"
"h2{margin:0 0 4px}label{display:block;margin:14px 0 4px;font-weight:600}"
"input{width:100%;padding:10px;box-sizing:border-box;border:1px solid #bbb;border-radius:6px;font-size:16px}"
"button{margin-top:18px;padding:11px 18px;border:0;border-radius:6px;background:#0a7a5a;color:#fff;font-size:16px}"
"p.note{color:#666;margin-top:24px;font-size:14px}</style></head>"
"<body><h2>moldqueen WiFi setup</h2>"
"<p>Enter your WiFi so the board can join it and the app can reach it.</p>"
"<form method=POST action=/save>"
"<label>Network name (SSID)</label><input name=ssid maxlength=32 required autofocus>"
"<label>Password</label><input name=password type=password maxlength=63>"
"<button type=submit>Save &amp; connect</button></form>"
"<p class=note>The board reboots and joins your network. If it cannot, this setup network "
"reappears so you can try again.</p></body></html>";

static esp_err_t get_root(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, PAGE, HTTPD_RESP_USE_STRLEN);
}

/* URL-decode a form value in place (%XX + '+'). */
static void url_decode(char *s)
{
    char *o = s;
    for (char *p = s; *p; p++) {
        if (*p == '+') {
            *o++ = ' ';
        } else if (*p == '%' && p[1] && p[2]) {
            char hi = p[1], lo = p[2];
            int H = (hi <= '9') ? hi - '0' : (hi | 0x20) - 'a' + 10;
            int L = (lo <= '9') ? lo - '0' : (lo | 0x20) - 'a' + 10;
            *o++ = (char)((H << 4) | L);
            p += 2;
        } else {
            *o++ = *p;
        }
    }
    *o = 0;
}

/* Extract one x-www-form-urlencoded field (`key=value`, &-separated) into `out`. */
static bool form_field(const char *body, const char *key, char *out, size_t cap)
{
    char pat[40];
    snprintf(pat, sizeof pat, "%s=", key);
    const char *p = strstr(body, pat);
    while (p && p != body && p[-1] != '&') p = strstr(p + 1, pat);  /* must be a field start */
    if (!p) return false;
    p += strlen(pat);
    const char *end = strchr(p, '&');
    if (!end) end = p + strlen(p);
    size_t n = (size_t)(end - p);
    if (n >= cap) n = cap - 1;
    memcpy(out, p, n);
    out[n] = 0;
    url_decode(out);
    return true;
}

static esp_err_t post_save(httpd_req_t *req)
{
    char buf[256];
    int len = req->content_len < (int)sizeof buf - 1 ? req->content_len : (int)sizeof buf - 1;
    int r = httpd_req_recv(req, buf, len);
    if (r <= 0) return ESP_FAIL;
    buf[r] = 0;

    char ssid[33] = "", pass[65] = "";
    form_field(buf, "ssid", ssid, sizeof ssid);
    form_field(buf, "password", pass, sizeof pass);
    if (ssid[0] == 0) {
        httpd_resp_set_type(req, "text/html");
        httpd_resp_send(req, "<p>SSID required. <a href=/>back</a></p>", HTTPD_RESP_USE_STRLEN);
        return ESP_OK;
    }

    mk4_wifi_creds_save(ssid, pass);

    char msg[400];
    snprintf(msg, sizeof msg,
             "<!doctype html><meta charset=utf-8><body style=\"font-family:sans-serif;max-width:420px;margin:32px auto\">"
             "<h2>Saved</h2><p>The board will reboot and join <b>%s</b>. Watch its serial for the IP, "
             "then point the app there. If it cannot join, the setup network reappears.</p></body>", ssid);
    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req, msg, HTTPD_RESP_USE_STRLEN);

    ESP_LOGW(TAG, "creds saved; rebooting into station mode");
    vTaskDelay(pdMS_TO_TICKS(1500));
    esp_restart();
    return ESP_OK;
}

void mk4_provision_run(void)
{
    mk4_wifi_start_ap(AP_SSID, AP_PASS);

    httpd_handle_t srv = NULL;
    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.server_port = 80;
    if (httpd_start(&srv, &cfg) == ESP_OK) {
        httpd_uri_t root = { .uri = "/",     .method = HTTP_GET,  .handler = get_root };
        httpd_uri_t save = { .uri = "/save", .method = HTTP_POST, .handler = post_save };
        httpd_register_uri_handler(srv, &root);
        httpd_register_uri_handler(srv, &save);
        ESP_LOGI(TAG, "PROVISIONING: join WiFi '%s' (open), then open http://192.168.4.1/", AP_SSID);
    } else {
        ESP_LOGE(TAG, "config httpd failed to start");
    }

    while (1) vTaskDelay(pdMS_TO_TICKS(1000));   /* idle; reboot happens on save */
}
