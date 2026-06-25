# The MouldKingCrypt cipher as a standalone, dependency-free ESP-IDF component.
# Pure portable C — also compiled as-is by the host test (test/run_host_test.sh).
idf_component_register(
    SRCS "mouldking_crypt.c"
    INCLUDE_DIRS "include"
)
