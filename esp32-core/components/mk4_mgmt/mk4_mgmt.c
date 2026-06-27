/* Device management/status page on port 8080 (normal op) — see mk4_mgmt.h.
   Reuses the shared MoldQueen branding (mk4_webui) so it matches the provisioning pages. */
#include "mk4_mgmt.h"
#include "mk4_wifi.h"
#include "mk4_webui.h"

#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include "esp_log.h"
#include "esp_http_server.h"
#include "esp_system.h"
#include "esp_app_desc.h"
#include "esp_timer.h"
#include "cJSON.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "mk4_mgmt";

static uint16_t s_ws_port = 8765;

/* The branded management page, organized into cards. "__ICON__" is replaced at serve time;
   everything else is filled live by JS from /api/info + /api/scan. German strings use \u
   escapes; all assets inlined (consistent with the AP pages even though the LAN has internet).

   Status/signal colors are scoped ".kv b.cX" — (0,2,1) — so they beat MK4_CSS_BASE's
   ".kv b{color:var(--ink)}" (0,1,1); a bare ".cX" (0,1,0) would lose and render white. */
static const char MGMT_PAGE[] =
"<!doctype html><html lang=en><head><meta charset=utf-8>"
"<meta name=viewport content='width=device-width,initial-scale=1'>"
"<title>MoldQueen (ESP32)</title>"
"<link rel=icon type=image/png href='__ICON__'>"
"<style>" MK4_CSS_BASE MK4_CSS_FORM
"@media(min-width:640px){.wrap{max-width:680px;padding:32px 26px 54px}}"
".card{margin-top:14px;padding:2px 14px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}"
".card h3{font-size:.7rem;text-transform:uppercase;letter-spacing:.18em;color:var(--muted);font-weight:700;margin:13px 0 6px}"
".kv b.cgreen{color:#5fd38d}.kv b.camber{color:#ffc14d}.kv b.cred{color:#ff7a5a}"
".epkv{margin:10px 0}.epkv .k{display:block;font-size:.83rem;color:var(--muted)}"
".eprow{display:flex;align-items:flex-start;gap:8px;margin-top:4px}"
".eprow b{flex:1;color:var(--ink);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all}"
".eprow .cp{margin-left:0}"
".act{display:block;width:100%;margin-top:10px;padding:12px;border-radius:9px;border:1px solid var(--line);"
"background:var(--surface);color:var(--ink);font:inherit;font-weight:700;font-size:15px;cursor:pointer}"
".act:hover{border-color:var(--accent)}"
".act.warn{color:#ffb4a2;border-color:rgba(255,120,90,.35)}.act.warn:hover{border-color:#ff7a5a}"
".note{margin-top:14px;padding:11px 13px;border-radius:9px;background:var(--surface);border:1px solid var(--line);"
"color:var(--ink);font-size:.86rem;display:none}.note.on{display:block}"
".links{margin:10px 0 2px 0;display:flex;flex-wrap:wrap;align-items:center;gap:5px 16px}"
".links .lbl{font-size:.7rem;text-transform:uppercase;letter-spacing:.18em;color:var(--muted);font-weight:700}"
".links a{color:var(--accent);text-decoration:none;font-size:.86rem;font-weight:600}.links a:hover{text-decoration:underline}"
"</style></head><body><div class=wrap>"
"<div class=top><img src='__ICON__' alt='MoldQueen'>"
"<span class=nm>MoldQueen (ESP32)</span>"
"<span class=lang><button type=button id=en>EN</button><span class=sep>|</span><button type=button id=de>DE</button></span></div>"
"<p class=eyebrow data-i18n=eyebrow>management</p>"
"<div class=links><span class=lbl data-i18n=supportH>Support</span>"
"<a href='https://jrichter24.github.io/moldqueen/' target=_blank rel=noopener>Website</a>"
"<a href='https://github.com/jrichter24/moldqueen' target=_blank rel=noopener>GitHub</a>"
"<a href='https://github.com/sponsors/jrichter24' target=_blank rel=noopener>Sponsors</a>"
"<a href='https://ko-fi.com/A437HBY' target=_blank rel=noopener>Ko-fi</a></div>"
"<div class=card><h3 data-i18n=statusCard>Status</h3>"
"<div class=kv><span class=k data-i18n=kStatus>Status</span><b id=vStatus class=cgreen>&hellip;</b></div>"
"<div class=kv><span class=k data-i18n=kIp>IP address</span><b id=vIp>&hellip;</b></div>"
"<div class=kv><span class=k data-i18n=kSsid>Network</span><b id=vSsid>&hellip;</b></div>"
"<div class=kv><span class=k data-i18n=kSig>Signal</span><b id=vSig>&hellip;</b></div>"
"<div class=kv><span class=k data-i18n=kUp>Uptime</span><b id=vUp>&hellip;</b></div>"
"</div>"
"<div class=card><h3 data-i18n=deviceCard>Device</h3>"
"<div class=kv><span class=k data-i18n=kFw>Firmware</span><b id=vFw>&hellip;</b></div>"
"<div class=kv><span class=k data-i18n=kPort>WS port</span><b id=vPort>&hellip;</b></div>"
"<div class=epkv><span class=k data-i18n=kEp>App endpoint</span>"
"<div class=eprow><b id=vEp>&hellip;</b><button type=button class=cp id=cEp data-i18n=copy>Copy</button></div></div>"
"<div class=epkv><span class=k data-i18n=kMgmt>Management page</span>"
"<div class=eprow><b id=vMgmt>http://moldqueenesp.local:8080</b><button type=button class=cp id=cMgmt data-i18n=copy>Copy</button></div></div>"
"<div class=kv><span class=k data-i18n=kIpc>IP address</span><b id=vIp2>&hellip;</b>"
"<button type=button class=cp id=cIp data-i18n=copy>Copy</button></div>"
"<div class=kv><span class=k data-i18n=kMac>Device MAC</span><b id=vMac>&hellip;</b>"
"<button type=button class=cp id=cMac data-i18n=copy>Copy</button></div>"
"</div>"
"<div class=card><h3 data-i18n=netH>Change network</h3>"
"<p class=sub data-i18n=netSub>Scan, pick a network, enter the password, and apply. The device reconnects on the new network and this page drops.</p>"
"<button type=button class=act id=scanBtn data-i18n=scanB>Scan for networks</button>"
"<div class=nets id=nets><div class=empty data-i18n=tapScan>Tap scan to list nearby networks.</div></div>"
"<label data-i18n=ssidL>Network name (SSID)</label>"
"<input id=ssid maxlength=32 autocomplete=off>"
"<label data-i18n=passL>Password</label>"
"<input id=password type=password maxlength=63>"
"<label class=showpw><input type=checkbox id=eye> <span data-i18n=showL>Show password</span></label>"
"<label data-i18n=portL>WebSocket port</label>"
"<input id=ws_port inputmode=numeric maxlength=5>"
"<button type=button class=go id=applyBtn data-i18n=applyB>Apply &amp; reconnect</button></div>"
"<div class=card><h3 data-i18n=maintCard>Maintenance</h3>"
"<button type=button class='act warn' id=setupBtn data-i18n=setupB>Switch to setup mode</button>"
"<button type=button class=act id=restartBtn data-i18n=restartB>Restart device</button></div>"
"<div class=note id=note></div>"
"</div><script>"
"var T={en:{eyebrow:'management',statusCard:'Status',deviceCard:'Device',maintCard:'Maintenance',supportH:'Support',"
"kStatus:'Status',kIp:'IP address',kIpc:'IP address',kSsid:'Network',kSig:'Signal',kUp:'Uptime',kFw:'Firmware',kPort:'WS port',"
"kEp:'App endpoint',kMgmt:'Management page',kMac:'Device MAC',"
"connected:'connected',reconnecting:'reconnecting\\u2026',sigExc:'excellent',sigGood:'good',sigFair:'fair',sigWeak:'weak',"
"netH:'Change network',netSub:'Scan, pick a network, enter the password, and apply. The device reconnects on the new network and this page drops.',"
"scanB:'Scan for networks',scanning:'scanning\\u2026',none:'no networks found',tapScan:'Tap scan to list nearby networks.',"
"ssidL:'Network name (SSID)',passL:'Password',showL:'Show password',portL:'WebSocket port',applyB:'Apply & reconnect',"
"setupB:'Switch to setup mode',restartB:'Restart device',copy:'Copy',copied:'Copied',"
"confApply:'Apply the new network and reconnect? This page will disconnect.',"
"confSetup:'Switch to setup mode? The device leaves your network and opens the moldqueen-setup WiFi for re-provisioning.',"
"confRestart:'Restart the device now?',"
"noteApply:'Reconnecting on the new network. Find the device at moldqueenesp.local (or its new IP).',"
"noteSetup:'Switching to setup mode. Join the moldqueen-setup WiFi and open http://192.168.4.1/.',"
"noteRestart:'Restarting. This page reconnects in a few seconds.'},"
"de:{eyebrow:'Verwaltung',statusCard:'Status',deviceCard:'Ger\\u00e4t',maintCard:'Wartung',supportH:'Unterst\\u00fctzen',"
"kStatus:'Status',kIp:'IP-Adresse',kIpc:'IP-Adresse',kSsid:'Netzwerk',kSig:'Signal',kUp:'Laufzeit',kFw:'Firmware',kPort:'WS-Port',"
"kEp:'App-Endpunkt',kMgmt:'Verwaltungsseite',kMac:'Ger\\u00e4te-MAC',"
"connected:'verbunden',reconnecting:'verbinde neu\\u2026',sigExc:'ausgezeichnet',sigGood:'gut',sigFair:'ok',sigWeak:'schwach',"
"netH:'Netzwerk wechseln',netSub:'Suche, w\\u00e4hle ein Netzwerk, gib das Passwort ein und \\u00fcbernimm. Das Ger\\u00e4t verbindet sich neu und diese Seite trennt.',"
"scanB:'Nach Netzwerken suchen',scanning:'suche\\u2026',none:'keine Netzwerke gefunden',tapScan:'Tippe auf Suchen, um Netzwerke zu listen.',"
"ssidL:'Netzwerkname (SSID)',passL:'Passwort',showL:'Passwort zeigen',portL:'WebSocket-Port',applyB:'\\u00dcbernehmen & neu verbinden',"
"setupB:'In den Setup-Modus wechseln',restartB:'Ger\\u00e4t neu starten',copy:'Kopieren',copied:'Kopiert',"
"confApply:'Neues Netzwerk \\u00fcbernehmen und neu verbinden? Diese Seite wird getrennt.',"
"confSetup:'In den Setup-Modus wechseln? Das Ger\\u00e4t verl\\u00e4sst dein Netzwerk und \\u00f6ffnet das WLAN moldqueen-setup zur Neukonfiguration.',"
"confRestart:'Ger\\u00e4t jetzt neu starten?',"
"noteApply:'Neu verbinden im neuen Netzwerk. Finde das Ger\\u00e4t unter moldqueenesp.local (oder der neuen IP).',"
"noteSetup:'Wechsel in den Setup-Modus. Verbinde dich mit dem WLAN moldqueen-setup und \\u00f6ffne http://192.168.4.1/.',"
"noteRestart:'Neustart. Diese Seite verbindet sich in wenigen Sekunden neu.'}};"
"var lang=(navigator.language||'en').slice(0,2)==='de'?'de':'en';"
MK4_LANG_JS
"function bars(r){var n=r>=-55?4:r>=-67?3:r>=-78?2:1,h='';for(var i=1;i<=4;i++)h+='<i class=\"bar'+(i<=n?' on':'')+'\"></i>';return h;}"
"function fmtUp(s){var d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return (d?d+'d ':'')+(h||d?h+'h ':'')+m+'m';}"
"function sigWord(r){return r>=-55?T[lang].sigExc:r>=-67?T[lang].sigGood:r>=-78?T[lang].sigFair:T[lang].sigWeak;}"
"function sigCls(r){return r>=-60?'cgreen':r>=-75?'camber':'cred';}"
"function loadInfo(){fetch('/api/info').then(function(r){return r.json();}).then(function(d){"
"vStatus.textContent=T[lang].connected;vStatus.className='cgreen';"
"vIp.textContent=d.ip||'-';vIp2.textContent=d.ip||'-';vMac.textContent=d.mac||'-';vSsid.textContent=d.ssid||'-';"
"vSig.textContent=d.rssi?d.rssi+' dBm \\u00b7 '+sigWord(d.rssi):'-';vSig.className=d.rssi?sigCls(d.rssi):'';"
"vUp.textContent=fmtUp(d.uptime||0);vFw.textContent=(d.fw||'-')+(d.fwdate?' ('+d.fwdate+')':'');"
"vPort.textContent=d.ws_port;vEp.textContent=d.ws_url;if(!ws_port.value&&d.ws_port)ws_port.value=d.ws_port;"
"}).catch(function(){vStatus.textContent=T[lang].reconnecting;vStatus.className='camber';});}"
"loadInfo();setInterval(loadInfo,5000);"
MK4_COPY_JS
"cEp.onclick=function(){cp(vEp.textContent,this);};cMgmt.onclick=function(){cp(vMgmt.textContent,this);};"
"cIp.onclick=function(){cp(vIp2.textContent,this);};cMac.onclick=function(){cp(vMac.textContent,this);};"
"eye.onchange=function(){password.type=this.checked?'text':'password';};"
"scanBtn.onclick=function(){var box=document.getElementById('nets');box.innerHTML='<div class=empty>'+T[lang].scanning+'</div>';"
"fetch('/api/scan').then(function(r){return r.json();}).then(function(list){"
"if(!list.length){box.innerHTML='<div class=empty>'+T[lang].none+'</div>';return;}box.innerHTML='';"
"list.forEach(function(o){var b=document.createElement('button');b.type='button';b.className='netrow';"
"b.innerHTML='<span class=nm></span><span class=sig>'+bars(o.rssi)+'</span>';"
"b.querySelector('.nm').textContent=o.ssid;b.onclick=function(){ssid.value=o.ssid;ssid.focus();};box.appendChild(b);});"
"}).catch(function(){box.innerHTML='<div class=empty>'+T[lang].none+'</div>';});};"
"function note(m){var n=document.getElementById('note');n.textContent=m;n.className='note on';}"
"applyBtn.onclick=function(){if(!ssid.value){ssid.focus();return;}if(!confirm(T[lang].confApply))return;note(T[lang].noteApply);"
"fetch('/api/network',{method:'POST',headers:{'Content-Type':'application/json'},"
"body:JSON.stringify({ssid:ssid.value,password:password.value,ws_port:parseInt(ws_port.value||'8765',10)})}).catch(function(){});};"
"setupBtn.onclick=function(){if(!confirm(T[lang].confSetup))return;note(T[lang].noteSetup);fetch('/api/setup',{method:'POST'}).catch(function(){});};"
"restartBtn.onclick=function(){if(!confirm(T[lang].confRestart))return;note(T[lang].noteRestart);fetch('/api/restart',{method:'POST'}).catch(function(){});};"
"en.addEventListener('click',loadInfo);de.addEventListener('click',loadInfo);"
"applyLang(lang);"
"</script></body></html>";

static esp_err_t mgmt_root(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html");
    const char *toks[] = { "__ICON__", "__ICON__" };   /* head favicon, then header logo */
    const char *vals[] = { MK4_ICON_DATA_URI, MK4_ICON_DATA_URI };
    mk4_webui_send_chunked(req, MGMT_PAGE, toks, vals, 2);
    return ESP_OK;
}

static esp_err_t api_info(httpd_req_t *req)
{
    char mac[18] = "", ip[16] = "", ssid[33] = "";
    mk4_wifi_mac_str(mac, sizeof mac);
    mk4_wifi_ip_str(ip, sizeof ip);
    mk4_wifi_current_ssid(ssid, sizeof ssid);
    const esp_app_desc_t *d = esp_app_get_description();
    char wsurl[64];
    snprintf(wsurl, sizeof wsurl, "ws://moldqueenesp.local:%u", s_ws_port);

    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "status", "connected");
    cJSON_AddStringToObject(o, "ip", ip);
    cJSON_AddStringToObject(o, "mac", mac);
    cJSON_AddStringToObject(o, "ssid", ssid);
    cJSON_AddNumberToObject(o, "rssi", mk4_wifi_sta_rssi());
    cJSON_AddNumberToObject(o, "uptime", (double)(esp_timer_get_time() / 1000000));
    cJSON_AddStringToObject(o, "fw", d ? d->version : "?");
    cJSON_AddStringToObject(o, "fwdate", d ? d->date : "");
    cJSON_AddNumberToObject(o, "ws_port", s_ws_port);
    cJSON_AddStringToObject(o, "ws_url", wsurl);

    char *json = cJSON_PrintUnformatted(o);
    httpd_resp_set_type(req, "application/json");
    esp_err_t r = httpd_resp_send(req, json ? json : "{}", HTTPD_RESP_USE_STRLEN);
    cJSON_free(json);
    cJSON_Delete(o);
    return r;
}

static esp_err_t api_scan(httpd_req_t *req)
{
    mk4_wifi_scan_live();                 /* scans while connected — the connection survives */
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

static esp_err_t api_restart(httpd_req_t *req)
{
    httpd_resp_sendstr(req, "ok");
    ESP_LOGW(TAG, "restart requested via management page");
    vTaskDelay(pdMS_TO_TICKS(700));
    esp_restart();
    return ESP_OK;
}

static esp_err_t api_setup(httpd_req_t *req)
{
    mk4_wifi_force_ap_set();              /* one-shot: next boot enters provisioning AP */
    httpd_resp_sendstr(req, "ok");
    ESP_LOGW(TAG, "switch-to-setup requested -> reboot into provisioning AP");
    vTaskDelay(pdMS_TO_TICKS(700));
    esp_restart();
    return ESP_OK;
}

static esp_err_t api_network(httpd_req_t *req)
{
    char buf[256];
    int len = req->content_len < (int)sizeof buf - 1 ? req->content_len : (int)sizeof buf - 1;
    int r = httpd_req_recv(req, buf, len);
    if (r <= 0) return ESP_FAIL;
    buf[r] = 0;

    cJSON *j = cJSON_Parse(buf);
    if (!j) { httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "bad json"); return ESP_OK; }
    cJSON *js = cJSON_GetObjectItem(j, "ssid");
    cJSON *jp = cJSON_GetObjectItem(j, "password");
    cJSON *jport = cJSON_GetObjectItem(j, "ws_port");
    const char *ssid = cJSON_IsString(js) ? js->valuestring : "";
    const char *pass = cJSON_IsString(jp) ? jp->valuestring : "";
    int port = cJSON_IsNumber(jport) ? jport->valueint : s_ws_port;
    if (port < 1 || port > 65535) port = s_ws_port;
    if (!ssid[0]) { cJSON_Delete(j); httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "ssid required"); return ESP_OK; }

    mk4_wifi_creds_save(ssid, pass);          /* NVS only — never git/binary */
    mk4_wifi_ws_port_save((uint16_t)port);
    cJSON_Delete(j);

    httpd_resp_sendstr(req, "ok");
    /* Reboot to apply: the proven boot logic tries the new creds (30 s) and falls back to the
       provisioning AP if they are wrong — so a bad password can never brick the device. */
    ESP_LOGW(TAG, "change-network -> reboot to join the new network");
    vTaskDelay(pdMS_TO_TICKS(800));
    esp_restart();
    return ESP_OK;
}

void mk4_mgmt_start(uint16_t ws_port)
{
    s_ws_port = ws_port;

    httpd_handle_t srv = NULL;
    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.server_port = 8080;
    cfg.ctrl_port = 32769;            /* MUST differ from the WS server's httpd ctrl_port (32768) */
    cfg.stack_size = 6144;            /* room for the blocking scan + cJSON */
    cfg.max_uri_handlers = 8;
    cfg.lru_purge_enable = true;
    if (httpd_start(&srv, &cfg) != ESP_OK) {
        ESP_LOGE(TAG, "management httpd failed to start on :8080");
        return;
    }
    httpd_uri_t u_root    = { .uri = "/",            .method = HTTP_GET,  .handler = mgmt_root };
    httpd_uri_t u_info    = { .uri = "/api/info",    .method = HTTP_GET,  .handler = api_info };
    httpd_uri_t u_scan    = { .uri = "/api/scan",    .method = HTTP_GET,  .handler = api_scan };
    httpd_uri_t u_restart = { .uri = "/api/restart", .method = HTTP_POST, .handler = api_restart };
    httpd_uri_t u_setup   = { .uri = "/api/setup",   .method = HTTP_POST, .handler = api_setup };
    httpd_uri_t u_network = { .uri = "/api/network", .method = HTTP_POST, .handler = api_network };
    httpd_register_uri_handler(srv, &u_root);
    httpd_register_uri_handler(srv, &u_info);
    httpd_register_uri_handler(srv, &u_scan);
    httpd_register_uri_handler(srv, &u_restart);
    httpd_register_uri_handler(srv, &u_setup);
    httpd_register_uri_handler(srv, &u_network);
    ESP_LOGI(TAG, "management page at http://moldqueenesp.local:8080/  (WS port %u)", ws_port);
}
