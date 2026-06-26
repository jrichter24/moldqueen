# The NimBLE 0xFFF0 MK4 advertiser: builds + crypts + broadcasts telegrams, with
# in-place advertising-data updates. Depends on the proven crypt + the BLE stack.
idf_component_register(
    SRCS "mk4_advertiser.c"
    INCLUDE_DIRS "include"
    REQUIRES mouldking_crypt bt nvs_flash
)
