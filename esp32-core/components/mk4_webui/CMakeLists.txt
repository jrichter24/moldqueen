idf_component_register(
    SRCS "webui.c" "icon_data.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_http_server
)
