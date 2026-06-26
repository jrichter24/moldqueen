# The ESP-IDF app: provisioning + WiFi station + NimBLE advertiser + WS server.
idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
    REQUIRES mk4_advertiser mk4_wifi mk4_ws_server mk4_provision nvs_flash
)
