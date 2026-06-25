/*
 * Byte-exact self-test for the esp32-core MouldKingCrypt C port.
 *
 * Shared by the host build (test/host_test.c) and the on-device app (main/main.c)
 * so there is ONE source of vectors. Pure portable C: prints "[PASS]/[FAIL] name"
 * lines + a TOTAL via printf. Vectors are the repo's shared crypt vectors from
 * linux-core/reference/mouldking_crypt.py and android-core's MouldKingCryptTest.
 */
#ifndef MK_CRYPT_SELFTEST_H
#define MK_CRYPT_SELFTEST_H

#ifdef __cplusplus
extern "C" {
#endif

/* Runs every vector; returns the number of FAILED checks (0 == all byte-exact). */
int mk_crypt_selftest(void);

#ifdef __cplusplus
}
#endif

#endif /* MK_CRYPT_SELFTEST_H */
