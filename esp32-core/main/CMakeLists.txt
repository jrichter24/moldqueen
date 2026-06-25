# The ESP-IDF app component. It runs the shared crypt self-test (kept in
# ../test so the host build can reuse the exact same source + vectors).
idf_component_register(
    SRCS "main.c" "${CMAKE_CURRENT_LIST_DIR}/../test/mk_crypt_selftest.c"
    INCLUDE_DIRS "${CMAKE_CURRENT_LIST_DIR}/../test"
    REQUIRES mouldking_crypt
)
