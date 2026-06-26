/*
 * Provisioning mode: bring up a SoftAP ("moldqueen-setup") + a tiny self-contained config
 * page at http://192.168.4.1/. The user joins the AP, enters their WiFi, and the board
 * saves it to NVS and reboots into station mode. No captive portal (browse to the IP), no
 * external assets (this is NOT the moldqueen client — just a dedicated setup form). The
 * advertiser/driving does not run in this mode; it is config-only.
 */
#ifndef MK4_PROVISION_H
#define MK4_PROVISION_H

#ifdef __cplusplus
extern "C" {
#endif

/* Start the SoftAP + config page and idle (reboots into station mode when creds are
   saved). Does not return. */
void mk4_provision_run(void);

#ifdef __cplusplus
}
#endif

#endif /* MK4_PROVISION_H */
