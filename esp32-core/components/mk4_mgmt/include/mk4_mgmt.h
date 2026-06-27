/*
 * Device management/status page over HTTP on port 8080 during NORMAL operation (device on the
 * user's LAN). Reachable at http://moldqueenesp.local:8080 — same device/hostname as the WS
 * server (8765), different port; distinct from the AP-mode provisioning page (192.168.4.1).
 *
 * Shows live status (IP/MAC/SSID/signal/uptime/firmware/WS endpoint) and offers restart,
 * switch-to-setup (software force-AP — the reliable replacement for the dropped hardware
 * trigger), and change-network (scan + new creds + reconnect). UNAUTHENTICATED + LAN-only by
 * design, consistent with the unauthenticated WS API; destructive actions confirm in the UI.
 */
#ifndef MK4_MGMT_H
#define MK4_MGMT_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Start the management HTTP server on port 8080. `ws_port` is the WS server's port (shown +
   used to build the displayed ws://moldqueenesp.local:<port> endpoint). Call in normal op. */
void mk4_mgmt_start(uint16_t ws_port);

#ifdef __cplusplus
}
#endif

#endif /* MK4_MGMT_H */
