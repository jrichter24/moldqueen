# The NimBLE 0xFFF0 MK4 advertiser + safety layer (auto-neutral keepalive + STOP).
# Depends on the proven crypt, the BLE stack, and esp_timer (dead-man timestamps).
idf_component_register(
    SRCS "mk4_advertiser.c"
    INCLUDE_DIRS "include"
    REQUIRES mouldking_crypt bt nvs_flash esp_timer
)
