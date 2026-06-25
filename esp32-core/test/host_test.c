/*
 * Host build of the MouldKingCrypt byte-exact self-test — pure C, NO ESP-IDF,
 * NO board. This is the preferred (fast, CI-able) verification; build it with
 * any host C compiler via test/run_host_test.sh. Exit code 0 = all vectors
 * byte-exact, non-zero = a mismatch.
 */
#include "mk_crypt_selftest.h"
#include <stdio.h>

int main(void)
{
    printf("== esp32-core MouldKingCrypt host self-test ==\n");
    int failed = mk_crypt_selftest();
    if (failed == 0)
        printf("RESULT: ALL VECTORS BYTE-EXACT vs the Python/Kotlin reference (PASS)\n");
    else
        printf("RESULT: %d check(s) FAILED\n", failed);
    return failed ? 1 : 0;
}
