/*
 * WiFi station + SoftAP + NVS credential store + WS-port + a network-scan cache.
 *
 * Creds + the WS port live ONLY in NVS (flash) — never compiled in, never in git. On boot
 * the app tries the stored creds (station); on no-creds / connect-timeout it falls back to
 * a SoftAP + config page (see mk4_provision). NVS-stored config is what makes the firmware
 * distributable: anyone flashes the same binary and enters their own WiFi.
 */
#ifndef MK4_WIFI_H
#define MK4_WIFI_H

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Load WiFi creds from NVS. Returns true iff a non-empty SSID is stored. */
bool mk4_wifi_creds_load(char *ssid, size_t ssid_cap, char *pass, size_t pass_cap);

/* Save WiFi creds to NVS (flash) — survives reboot, never touches git or the binary. */
void mk4_wifi_creds_save(const char *ssid, const char *pass);

/* Wipe stored creds (forces provisioning on next boot). */
void mk4_wifi_creds_clear(void);

/* WS server port, persisted in NVS (default 8765 if unset). */
uint16_t mk4_wifi_ws_port_load(void);
void mk4_wifi_ws_port_save(uint16_t port);

/* Software force-AP flag (NVS): set => the next boot enters provisioning; take = read+clear
   (one-shot). The reliable replacement for the dropped hardware re-provision trigger. */
void mk4_wifi_force_ap_set(void);
bool mk4_wifi_force_ap_take(void);

/* The station MAC as "AA:BB:CC:DD:EE:FF" — the address the router shows. */
void mk4_wifi_mac_str(char *out, size_t cap);

/* Live status for the management page: current dotted-quad IP, connected SSID, STA RSSI (dBm). */
void mk4_wifi_ip_str(char *out, size_t cap);
void mk4_wifi_current_ssid(char *out, size_t cap);
int  mk4_wifi_sta_rssi(void);

/* Connect in station mode with `timeout_ms`. Returns true on got-IP (copies the dotted-quad
   into ip_out, caller provides >= 16 bytes); false on timeout/failure (then call
   mk4_wifi_start_ap to fall back — the STA is stopped cleanly first). */
bool mk4_wifi_connect_sta(const char *ssid, const char *pass, char *ip_out, size_t ip_cap, int timeout_ms);

/* Scan visible networks (briefly, in STA mode) and cache their SSIDs. Call BEFORE
   mk4_wifi_start_ap (scanning needs STA; the AP comes up afterwards). */
void mk4_wifi_scan_cache(void);

/* Scan while CONNECTED as STA (normal op) — does not stop WiFi; the connection survives.
   Caches the same way as mk4_wifi_scan_cache (read back with mk4_wifi_scan_get). */
void mk4_wifi_scan_live(void);

/* Copy up to `max` cached networks (deduped, hidden skipped, strongest-first) into
   ssids[][33] and rssi[] (dBm); returns the count. rssi may be NULL. */
int mk4_wifi_scan_get(char ssids[][33], int8_t *rssi, int max);

/* Start a SoftAP (gateway 192.168.4.1). `ap_pass` < 8 chars => an OPEN network. */
void mk4_wifi_start_ap(const char *ap_ssid, const char *ap_pass);

#ifdef __cplusplus
}
#endif

#endif /* MK4_WIFI_H */
