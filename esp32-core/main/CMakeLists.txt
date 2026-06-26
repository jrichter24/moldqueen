# The ESP-IDF app: the NimBLE advertiser test harness.
idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
    REQUIRES mk4_advertiser
)
