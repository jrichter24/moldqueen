# The WiFi WebSocket server (esp_http_server WS) mirroring the api.py contract.
idf_component_register(
    SRCS "mk4_ws_server.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_http_server json mk4_advertiser
)
