/* Provisioning SoftAP + branded, bilingual config + saved pages — see mk4_provision.h.
   Shared branding (icon, CSS, copy/lang JS, chunked sender) lives in the mk4_webui component
   so this AP page and the normal-op management page (mk4_mgmt) stay identical. */
#include "mk4_provision.h"
#include "mk4_wifi.h"
#include "mk4_webui.h"

#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include "esp_log.h"
#include "esp_http_server.h"
#include "esp_system.h"
#include "cJSON.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "mk4_prov";

#define AP_SSID "moldqueen-setup"
#define AP_PASS ""              /* open network — easiest to join for a brief setup moment */

/* The main config page. "__ICON__"/"__MAC__" are replaced at serve time (chunked, so the CSS
   '%' is never seen by printf). German strings use \u escapes; no external assets. */
static const char PAGE[] =
"<!doctype html><html lang=en><head><meta charset=utf-8>"
"<meta name=viewport content='width=device-width,initial-scale=1'>"
"<title>MoldQueen (ESP32)</title>"
"<link rel=icon type=image/png href='__ICON__'>"
"<style>" MK4_CSS_BASE MK4_CSS_FORM
"</style></head><body><div class=wrap>"
"<div class=top><img src='__ICON__' alt='MoldQueen'>"
"<span class=nm>MoldQueen (ESP32)</span>"
"<span class=lang><button type=button id=en>EN</button><span class=sep>|</span><button type=button id=de>DE</button></span></div>"
"<p class=eyebrow data-i18n=eyebrow>device setup</p>"
"<h2 data-i18n=h2>Connect to your WiFi</h2>"
"<p class=sub data-i18n=sub>Pick your network or type it, enter the password, and save.</p>"
"<form method=POST action=/save>"
"<label data-i18n=netsL>Networks</label>"
"<div class=nets id=nets><div class=empty data-i18n=scanning>scanning&hellip;</div></div>"
"<label data-i18n=ssidL>Network name (SSID)</label>"
"<input name=ssid id=ssid maxlength=32 required autocomplete=off>"
"<label data-i18n=passL>Password</label>"
"<input name=password id=password type=password maxlength=63>"
"<label class=showpw><input type=checkbox id=eye> <span data-i18n=showL>Show password</span></label>"
"<p class=hint data-i18n=passH>Type your WiFi password carefully. A wrong password keeps the device from joining and it returns to this setup page.</p>"
"<label data-i18n=portL>WebSocket port</label>"
"<input name=ws_port id=ws_port value=8765 inputmode=numeric maxlength=5>"
"<p class=hint data-i18n=portH>The port the client connects to after saving and restarting.</p>"
"<button type=submit class=go data-i18n=saveL>Save &amp; connect</button></form>"
"<div class=foot>"
"<div class=kv><span class=k data-i18n=linkL>App endpoint</span><b id=linkv>ws://moldqueenesp.local:8765</b>"
"<button type=button class=cp id=clink data-i18n=copy>Copy</button></div>"
"<div class=kv><span class=k data-i18n=macL>Device MAC</span><b id=mac>__MAC__</b>"
"<button type=button class=cp id=cmac data-i18n=copy>Copy</button></div>"
"<p data-i18n=hint>After saving it reboots, joins your network, and is reachable at the address above.</p>"
"<p class=hint><span data-i18n=mgmtH>Once on your network, manage it at</span> "
"<a href='http://moldqueenesp.local:8080' style='color:var(--accent);white-space:nowrap'>moldqueenesp.local:8080</a></p>"
"</div></div><script>"
"var T={en:{eyebrow:'device setup',h2:'Connect to your WiFi',sub:'Pick your network or type it, enter the password, and save.',"
"netsL:'Networks',none:'no networks found, type it below',ssidL:'Network name (SSID)',passL:'Password',showL:'Show password',"
"passH:'Type your WiFi password carefully. A wrong password keeps the device from joining and it returns to this setup page.',"
"portL:'WebSocket port',portH:'The port the client connects to after saving and restarting.',saveL:'Save & connect',"
"linkL:'App endpoint',macL:'Device MAC',mgmtH:'Once on your network, manage it at',copy:'Copy',copied:'Copied'},"
"de:{eyebrow:'Ger\\u00e4te-Setup',h2:'Mit deinem WLAN verbinden',sub:'W\\u00e4hle dein Netzwerk oder tippe es ein, gib das Passwort ein und speichere.',"
"netsL:'Netzwerke',none:'keine Netzwerke gefunden, unten eintragen',ssidL:'Netzwerkname (SSID)',passL:'Passwort',showL:'Passwort zeigen',"
"passH:'Gib dein WLAN-Passwort sorgf\\u00e4ltig ein. Ein falsches Passwort verhindert die Verbindung und das Ger\\u00e4t kehrt zu dieser Setup-Seite zur\\u00fcck.',"
"portL:'WebSocket-Port',portH:'Der Port, mit dem sich der Client nach dem Speichern und Neustart verbindet.',saveL:'Speichern & verbinden',"
"linkL:'App-Endpunkt',macL:'Ger\\u00e4te-MAC',mgmtH:'Im Netzwerk verwaltest du es unter',copy:'Kopieren',copied:'Kopiert'}};"
"var lang=(navigator.language||'en').slice(0,2)==='de'?'de':'en';"
MK4_LANG_JS
"function bars(r){var n=r>=-55?4:r>=-67?3:r>=-78?2:1,h='';for(var i=1;i<=4;i++)h+='<i class=\"bar'+(i<=n?' on':'')+'\"></i>';return h;}"
"fetch('/scan').then(function(r){return r.json();}).then(function(list){var box=document.getElementById('nets');"
"if(!list.length){box.innerHTML='<div class=empty>'+T[lang].none+'</div>';return;}box.innerHTML='';"
"list.forEach(function(o){var b=document.createElement('button');b.type='button';b.className='netrow';"
"b.innerHTML='<span class=nm></span><span class=sig>'+bars(o.rssi)+'</span>';"
"b.querySelector('.nm').textContent=o.ssid;b.onclick=function(){ssid.value=o.ssid;ssid.focus();};box.appendChild(b);});"
"}).catch(function(){document.getElementById('nets').innerHTML='<div class=empty>'+T[lang].none+'</div>';});"
"eye.onchange=function(){password.type=this.checked?'text':'password';};"
MK4_COPY_JS
"function url(){return 'ws://moldqueenesp.local:'+(ws_port.value||'8765');}"
"cmac.onclick=function(){cp(mac.textContent,this);};clink.onclick=function(){cp(url(),this);};"
"ws_port.oninput=function(){linkv.textContent=url();};"
"applyLang(lang);linkv.textContent=url();"
"</script></body></html>";

/* The branded "Saved" page (matches the config page). "__ICON__"/"__WSURL__"/"__MAC__"
   replaced at serve time, in that order. The chosen WS port flows in via __WSURL__. */
static const char SAVED[] =
"<!doctype html><html lang=en><head><meta charset=utf-8>"
"<meta name=viewport content='width=device-width,initial-scale=1'>"
"<title>MoldQueen (ESP32)</title>"
"<link rel=icon type=image/png href='__ICON__'>"
"<style>" MK4_CSS_BASE "</style></head><body><div class=wrap>"
"<div class=top><img src='__ICON__' alt='MoldQueen'>"
"<span class=nm>MoldQueen (ESP32)</span>"
"<span class=lang><button type=button id=en>EN</button><span class=sep>|</span><button type=button id=de>DE</button></span></div>"
"<p class=eyebrow data-i18n=eyebrow>saved</p>"
"<h2 data-i18n=h2>Saved</h2>"
"<p class=sub data-i18n=sub>The device is restarting and joining your network. Keep the details below handy; this setup network is closing.</p>"
"<div class=foot style='border-top:0;margin-top:6px'>"
"<div class=kv><span class=k data-i18n=linkL>App endpoint</span><b id=wsv>__WSURL__</b>"
"<button type=button class=cp id=clink data-i18n=copy>Copy</button></div>"
"<div class=kv><span class=k data-i18n=macL>Device MAC</span><b id=mac>__MAC__</b>"
"<button type=button class=cp id=cmac data-i18n=copy>Copy</button></div>"
"<p data-i18n=hint>If the name does not resolve on your network, use the MAC to find the device IP in your router.</p>"
"<p class=hint><span data-i18n=mgmtH>Once on your network, manage it at</span> "
"<a href='http://moldqueenesp.local:8080' style='color:var(--accent);white-space:nowrap'>moldqueenesp.local:8080</a></p>"
"</div></div><script>"
"var T={en:{eyebrow:'saved',h2:'Saved',sub:'The device is restarting and joining your network. Keep the details below handy; this setup network is closing.',"
"linkL:'App endpoint',macL:'Device MAC',mgmtH:'Once on your network, manage it at',copy:'Copy',copied:'Copied',hint:'If the name does not resolve on your network, use the MAC to find the device IP in your router.'},"
"de:{eyebrow:'gespeichert',h2:'Gespeichert',sub:'Das Ger\\u00e4t startet neu und verbindet sich mit deinem Netzwerk. Halte die Angaben unten bereit; dieses Setup-Netzwerk wird geschlossen.',"
"linkL:'App-Endpunkt',macL:'Ger\\u00e4te-MAC',mgmtH:'Im Netzwerk verwaltest du es unter',copy:'Kopieren',copied:'Kopiert',hint:'Falls der Name in deinem Netzwerk nicht aufl\\u00f6st, finde die Ger\\u00e4te-IP \\u00fcber die MAC im Router.'}};"
"var lang=(navigator.language||'en').slice(0,2)==='de'?'de':'en';"
MK4_LANG_JS
MK4_COPY_JS
"cmac.onclick=function(){cp(mac.textContent,this);};clink.onclick=function(){cp(wsv.textContent,this);};"
"applyLang(lang);"
"</script></body></html>";

static esp_err_t get_root(httpd_req_t *req)
{
    char mac[18] = "";
    mk4_wifi_mac_str(mac, sizeof mac);
    httpd_resp_set_type(req, "text/html");
    const char *toks[] = { "__ICON__", "__ICON__", "__MAC__" };   /* head favicon, logo, MAC */
    const char *vals[] = { MK4_ICON_DATA_URI, MK4_ICON_DATA_URI, mac };
    mk4_webui_send_chunked(req, PAGE, toks, vals, 3);
    return ESP_OK;
}

static esp_err_t get_scan(httpd_req_t *req)
{
    char ssids[12][33];
    int8_t rssi[12];
    int n = mk4_wifi_scan_get(ssids, rssi, 12);
    cJSON *arr = cJSON_CreateArray();
    for (int i = 0; i < n; i++) {
        cJSON *o = cJSON_CreateObject();
        cJSON_AddStringToObject(o, "ssid", ssids[i]);
        cJSON_AddNumberToObject(o, "rssi", rssi[i]);
        cJSON_AddItemToArray(arr, o);
    }
    char *json = cJSON_PrintUnformatted(arr);
    httpd_resp_set_type(req, "application/json");
    esp_err_t r = httpd_resp_send(req, json ? json : "[]", HTTPD_RESP_USE_STRLEN);
    cJSON_free(json);
    cJSON_Delete(arr);
    return r;
}

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

static bool form_field(const char *body, const char *key, char *out, size_t cap)
{
    char pat[40];
    snprintf(pat, sizeof pat, "%s=", key);
    const char *p = strstr(body, pat);
    while (p && p != body && p[-1] != '&') p = strstr(p + 1, pat);
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

    char ssid[33] = "", pass[65] = "", portstr[8] = "";
    form_field(buf, "ssid", ssid, sizeof ssid);
    form_field(buf, "password", pass, sizeof pass);
    form_field(buf, "ws_port", portstr, sizeof portstr);
    if (ssid[0] == 0) {
        httpd_resp_set_type(req, "text/html");
        httpd_resp_send(req, "<p>SSID required. <a href=/>back</a></p>", HTTPD_RESP_USE_STRLEN);
        return ESP_OK;
    }
    int port = atoi(portstr);
    if (port < 1 || port > 65535) port = 8765;

    mk4_wifi_creds_save(ssid, pass);
    mk4_wifi_ws_port_save((uint16_t)port);

    char mac[18] = "";
    mk4_wifi_mac_str(mac, sizeof mac);
    char wsurl[64];
    snprintf(wsurl, sizeof wsurl, "ws://moldqueenesp.local:%d", port);

    httpd_resp_set_type(req, "text/html");
    const char *toks[] = { "__ICON__", "__ICON__", "__WSURL__", "__MAC__" };   /* favicon, logo, url, MAC */
    const char *vals[] = { MK4_ICON_DATA_URI, MK4_ICON_DATA_URI, wsurl, mac };
    mk4_webui_send_chunked(req, SAVED, toks, vals, 4);

    ESP_LOGW(TAG, "creds + ws_port(%d) saved; rebooting into station mode", port);
    vTaskDelay(pdMS_TO_TICKS(2000));   /* let the Saved page reach the phone before we drop the AP */
    esp_restart();
    return ESP_OK;
}

void mk4_provision_run(void)
{
    mk4_wifi_scan_cache();                 /* scan visible networks (STA) before the AP comes up */
    mk4_wifi_start_ap(AP_SSID, AP_PASS);

    httpd_handle_t srv = NULL;
    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.server_port = 80;
    if (httpd_start(&srv, &cfg) == ESP_OK) {
        httpd_uri_t root = { .uri = "/",     .method = HTTP_GET,  .handler = get_root };
        httpd_uri_t scan = { .uri = "/scan", .method = HTTP_GET,  .handler = get_scan };
        httpd_uri_t save = { .uri = "/save", .method = HTTP_POST, .handler = post_save };
        httpd_register_uri_handler(srv, &root);
        httpd_register_uri_handler(srv, &scan);
        httpd_register_uri_handler(srv, &save);
        ESP_LOGI(TAG, "PROVISIONING: join WiFi '%s' (open), then open http://192.168.4.1/", AP_SSID);
    } else {
        ESP_LOGE(TAG, "config httpd failed to start");
    }

    while (1) vTaskDelay(pdMS_TO_TICKS(1000));   /* idle; reboot happens on save */
}
