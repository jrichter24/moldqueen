/*
 * WiFi station: join a home WiFi (creds passed in — kept out of git via a gitignored
 * wifi_secrets.h), get a DHCP IP, print it. The simple stepping stone; NVS-stored creds +
 * fallback-AP provisioning are the WORKBOARD future.
 */
#ifndef MK4_WIFI_H
#define MK4_WIFI_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Connect in station mode (blocks until got-IP or a ~30 s timeout). On success copies the
   dotted-quad IP into ip_out (caller provides >= 16 bytes) and logs it; on failure sets
   ip_out[0] = '\0'. */
void mk4_wifi_connect(const char *ssid, const char *pass, char *ip_out, size_t ip_cap);

#ifdef __cplusplus
}
#endif

#endif /* MK4_WIFI_H */
