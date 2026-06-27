# Provisioning SoftAP + the branded 192.168.4.1 config page (scan list, WS-port, MAC).
idf_component_register(
    SRCS "mk4_provision.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_http_server mk4_wifi mk4_webui json
)
