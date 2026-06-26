/*
 * WiFi station + SoftAP + NVS credential store, for the provisioning flow.
 *
 * Creds live ONLY in NVS (flash) — never compiled in, never in git. On boot the app
 * tries the stored creds (station); on no-creds / connect-timeout it falls back
 * to a SoftAP + config page (see mk4_provision). NVS-stored creds is what makes the
 * firmware distributable: anyone flashes the same binary and enters their own WiFi.
 */
#ifndef MK4_WIFI_H
#define MK4_WIFI_H

#include <stddef.h>
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

/* Connect in station mode with `timeout_ms`. Returns true on got-IP (copies the dotted-quad
   into ip_out, caller provides >= 16 bytes); false on timeout/failure (then call
   mk4_wifi_start_ap to fall back — the STA is stopped cleanly first). */
bool mk4_wifi_connect_sta(const char *ssid, const char *pass, char *ip_out, size_t ip_cap, int timeout_ms);

/* Start a SoftAP (gateway 192.168.4.1). `ap_pass` < 8 chars => an OPEN network. */
void mk4_wifi_start_ap(const char *ap_ssid, const char *ap_pass);

#ifdef __cplusplus
}
#endif

#endif /* MK4_WIFI_H */
