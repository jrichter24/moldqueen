# Device management/status page (HTTP :8080) for normal operation.
idf_component_register(
    SRCS "mk4_mgmt.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_http_server mk4_wifi mk4_webui json esp_app_format esp_timer
)
