/*
 * MouldKing BLE telegram codec (manufacturer-specific, company 0xFFF0) — C port.
 *
 * DERIVATIVE WORK — clean-room C reimplementation of the algorithm described in
 * linux-core/reference/mouldking_crypt.py, which is itself a port of the
 * `MouldKingCrypt` cipher from J0EK3R/mkconnect-python
 * (https://github.com/J0EK3R/mkconnect-python), Copyright (c) 2024 J0EK3R, used
 * under the MIT License (see the repo-root THIRD-PARTY-NOTICES.md).
 *
 * The TECHNIQUE/algorithm was studied; this CODE was written fresh in C — NOT
 * copied from the MK+tech app — the same clean-room discipline as the existing
 * Python and Kotlin ports, and verified byte-exact against the repo's shared
 * crypt vectors. Pure, platform-independent C99: NO BLE / no ESP-IDF here.
 *
 *   mk_crypt_encode(raw, L) -> 24-byte on-air manufacturer data
 *   mk_crypt_decode(...)    -> raw payload (the exact inverse)
 */
#ifndef MOULDKING_CRYPT_H
#define MOULDKING_CRYPT_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* On-air manufacturer data is always padded to this many bytes. */
#define MK_CRYPT_ONAIR_LEN   24
/* Largest raw payload the fixed working buffer supports. */
#define MK_CRYPT_MAX_PAYLOAD 32

/*
 * Encode a raw command payload (`raw`, `L` bytes) into the 24-byte on-air
 * manufacturer data. `out` must have room for MK_CRYPT_ONAIR_LEN bytes.
 * `L` must be in 1..MK_CRYPT_MAX_PAYLOAD.
 */
void mk_crypt_encode(const uint8_t *raw, size_t L, uint8_t out[MK_CRYPT_ONAIR_LEN]);

/*
 * Decode on-air data (`crypted`, `n` bytes) back to the raw payload — the exact
 * inverse of mk_crypt_encode. Writes the payload into `raw_out` (caller provides
 * >= MK_CRYPT_MAX_PAYLOAD bytes) and its length into *L_out. When `verify` != 0
 * and `crc_ok` != NULL, *crc_ok is set to 1/0 from the embedded CRC-16 check.
 * Returns 0 on success, -1 if the payload length could not be detected.
 */
int mk_crypt_decode(const uint8_t *crypted, size_t n,
                    uint8_t *raw_out, size_t *L_out,
                    int verify, int *crc_ok);

#ifdef __cplusplus
}
#endif

#endif /* MOULDKING_CRYPT_H */
