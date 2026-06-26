# Provisioning SoftAP + the 192.168.4.1 config page.
idf_component_register(
    SRCS "mk4_provision.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_http_server mk4_wifi
)
