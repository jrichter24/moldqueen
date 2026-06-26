/*
 * WiFi WebSocket server mirroring linux-core/mk4web/api.py's thin-transport contract, so
 * the single-source client drives the ESP32 over WiFi with ZERO ESP32-specific changes.
 *
 * Client -> server:  {"cmd":"setup","action":"connect"|"ready"|"reset"}
 *                    {"cmd":"set","slot":0-2,"channel":0-3,"value":-7..7}   (READY only)
 *                    {"cmd":"stop"} / {"cmd":"state"} / {"cmd":"info"}
 * Server -> client:  {"type":"lifecycle","state":...}
 *                    {"type":"state","slots":[[..]x3],"raw":hex,"ad":hex}
 *                    {"type":"info",...}  (info_level "light"; radio_backend "esp32-nimble")
 *
 * Thin transport: it owns the lifecycle + forwards raw `set` to the advertiser; the client
 * owns all function->channel resolution. `set` feeds the advertiser's 300 ms auto-neutral
 * keepalive (so client/WiFi death -> the toy coasts to neutral), `stop` fires the STOP
 * teardown. The ESP32 does NOT serve the client (served elsewhere, endpoint -> this IP).
 */
#ifndef MK4_WS_SERVER_H
#define MK4_WS_SERVER_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Start the WebSocket server on `port` (8765 to match the other cores). */
void mk4_ws_start(uint16_t port);

#ifdef __cplusplus
}
#endif

#endif /* MK4_WS_SERVER_H */
