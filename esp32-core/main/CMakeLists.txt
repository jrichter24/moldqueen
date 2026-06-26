# The ESP-IDF app: WiFi station + NimBLE advertiser + WS server.
idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
    REQUIRES mk4_advertiser mk4_wifi mk4_ws_server nvs_flash
)
