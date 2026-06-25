#!/usr/bin/env sh
# Host build + run of the MouldKingCrypt byte-exact self-test (pure C, no ESP-IDF,
# no board). Run from the esp32-core/ directory. CI-able once a host C compiler
# (gcc/clang/cc) is on PATH.
set -e

CC="${CC:-}"
if [ -z "$CC" ]; then
    for c in cc gcc clang; do
        if command -v "$c" >/dev/null 2>&1; then CC="$c"; break; fi
    done
fi
if [ -z "$CC" ]; then
    echo "No host C compiler (cc/gcc/clang) on PATH — skipping the host test."
    echo "Use the on-device test instead: idf.py -p <PORT> flash monitor"
    exit 0
fi

echo "Using compiler: $CC"
"$CC" -std=c99 -Wall -Wextra -O2 \
    -I components/mouldking_crypt/include -I test \
    test/host_test.c test/mk_crypt_selftest.c components/mouldking_crypt/mouldking_crypt.c \
    -o build_host_test

./build_host_test
