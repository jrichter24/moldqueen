/*
 * MouldKing BLE telegram codec — C port (see mouldking_crypt.h for the full
 * DERIVATIVE-WORK / J0EK3R MIT attribution and the clean-room note).
 *
 * Frame layout inside the working buffer `t` (payload length L; tlen = L + 25):
 *   t[15..17]      = header 0x71 0x0F 0x55              (bit-reversed in step 5)
 *   t[18..22]      = reversed preamble C5 C4 C3 C2 C1   (bit-reversed in step 5)
 *   t[23..23+L-1]  = raw payload                        (NOT bit-reversed)
 *   t[23+L..+1]    = CRC-16 (little-endian)
 * Ciphers: LFSR(seed 63) over t[18:], then LFSR(seed 37) over all of t.
 * On-air = t[15 : 15+L+10], right-padded to 24 with filler byte[i] = i + 1.
 */
#include "mouldking_crypt.h"

static const uint8_t MK_PREAMBLE[5] = { 0xC1, 0xC2, 0xC3, 0xC4, 0xC5 };

static uint8_t revert_bits_byte(uint8_t v)
{
    uint8_t r = 0;
    for (int i = 0; i < 8; i++)
        if (v & (uint8_t)(1u << i))
            r |= (uint8_t)(1u << (7 - i));
    return r;
}

static uint16_t revert_bits_int(uint16_t v)
{
    uint16_t r = 0;
    for (int i = 0; i < 16; i++)
        if (v & (uint16_t)(1u << i))
            r |= (uint16_t)(1u << (15 - i));
    return r;
}

/* 7-stage LFSR seed expansion: m[0]=1, m[i]=(seed >> (6-i)) & 1 for i=1..6. */
static void make_magic(int seed, int m[7])
{
    m[0] = 1;
    for (int i = 1; i < 7; i++)
        m[i] = (seed >> (6 - i)) & 1;
}

/* Advance the LFSR one step and return the new s[0] (the keystream bit). */
static int shift_magic(int s[7])
{
    int r1 = s[3] ^ s[6];
    s[3] = s[2]; s[2] = s[1]; s[1] = s[0]; s[0] = s[6];
    s[6] = s[5]; s[5] = s[4]; s[4] = r1;
    return s[0];
}

/* XOR stream cipher over buf[from..n), LSB-first; the keystream is
   data-independent, so the transform is self-inverse. Mutates buf + magic. */
static void crypt_slice(uint8_t *buf, size_t from, size_t n, int magic[7])
{
    for (size_t k = from; k < n; k++) {
        uint8_t cur = buf[k];
        int res = 0;
        for (int bit = 0; bit < 8; bit++)
            res += (((cur >> bit) & 1) ^ shift_magic(magic)) << bit;
        buf[k] = (uint8_t)(res & 0xFF);
    }
}

/* CRC-16/CCITT (poly 0x1021, init 0xFFFF): fed the reversed preamble then the
   bit-reversed payload; final value bit-reversed (16) then XOR 0xFFFF. The
   uint16_t shift truncates to 16 bits, matching the Python/Kotlin masking. */
static uint16_t mk_crc(const uint8_t *payload, size_t L)
{
    uint16_t result = 0xFFFF;
    for (int i = 0; i < 5; i++) {
        result ^= (uint16_t)((uint16_t)MK_PREAMBLE[5 - 1 - i] << 8);
        for (int j = 0; j < 8; j++) {
            uint16_t cur = result & 0x8000;
            result = (uint16_t)(result << 1);
            if (cur) result ^= 0x1021;
        }
    }
    for (size_t k = 0; k < L; k++) {
        result = (uint16_t)(((uint16_t)revert_bits_byte(payload[k]) << 8) ^ result);
        for (int j = 0; j < 8; j++) {
            uint16_t cur = result & 0x8000;
            result = (uint16_t)(result << 1);
            if (cur) result ^= 0x1021;
        }
    }
    return (uint16_t)(revert_bits_int(result) ^ 0xFFFF);
}

void mk_crypt_encode(const uint8_t *raw, size_t L, uint8_t out[MK_CRYPT_ONAIR_LEN])
{
    uint8_t t[MK_CRYPT_MAX_PAYLOAD + 25];
    size_t tlen = L + 25;

    for (size_t i = 0; i < tlen; i++) t[i] = 0;
    t[15] = 0x71; t[16] = 0x0F; t[17] = 0x55;
    for (int i = 0; i < 5; i++) t[18 + i] = MK_PREAMBLE[5 - 1 - i];  /* reversed preamble */
    for (size_t i = 0; i < L; i++) t[23 + i] = raw[i];              /* raw payload */
    for (int i = 15; i < 23; i++) t[i] = revert_bits_byte(t[i]);    /* bit-reverse header+preamble */

    uint16_t crc = mk_crc(raw, L);
    t[23 + L] = (uint8_t)(crc & 0xFF);
    t[24 + L] = (uint8_t)((crc >> 8) & 0xFF);

    int magic1[7], magic2[7];
    make_magic(63, magic1); crypt_slice(t, 18, tlen, magic1);       /* pass 1 over t[18:] */
    make_magic(37, magic2); crypt_slice(t, 0,  tlen, magic2);       /* pass 2 over all of t */

    size_t keep = L + 10;
    for (size_t i = 0; i < keep; i++) out[i] = t[15 + i];
    for (size_t i = keep; i < MK_CRYPT_ONAIR_LEN; i++) out[i] = (uint8_t)(i + 1); /* filler */
}

int mk_crypt_decode(const uint8_t *crypted, size_t n,
                    uint8_t *raw_out, size_t *L_out,
                    int verify, int *crc_ok)
{
    uint8_t b[MK_CRYPT_ONAIR_LEN];
    if (n > MK_CRYPT_ONAIR_LEN) n = MK_CRYPT_ONAIR_LEN;
    for (size_t i = 0; i < n; i++) b[i] = crypted[i];

    /* strip the trailing filler run (byte[i] == (i+1) & 0xFF) to find the length */
    size_t keep = n;
    long i = (long)n - 1;
    while (i >= 0 && b[i] == (uint8_t)((i + 1) & 0xFF)) { keep = (size_t)i; i--; }
    if (keep < 11) return -1;                       /* L = keep - 10 must be > 0 */
    size_t L = keep - 10;
    if (L > MK_CRYPT_MAX_PAYLOAD) return -1;

    uint8_t t[MK_CRYPT_MAX_PAYLOAD + 25];
    size_t tlen = L + 25;
    for (size_t k = 0; k < tlen; k++) t[k] = 0;
    for (size_t j = 0; j < keep; j++) t[15 + j] = b[j];

    int magic2[7], magic1[7];
    make_magic(37, magic2); crypt_slice(t, 0,  tlen, magic2);       /* invert pass 2 (whole) */
    make_magic(63, magic1); crypt_slice(t, 18, tlen, magic1);       /* invert pass 1 (t[18:]) */

    for (size_t k = 0; k < L; k++) raw_out[k] = t[23 + k];
    *L_out = L;

    if (verify && crc_ok) {
        uint16_t crc = mk_crc(raw_out, L);
        *crc_ok = (t[23 + L] == (uint8_t)(crc & 0xFF) &&
                   t[24 + L] == (uint8_t)((crc >> 8) & 0xFF)) ? 1 : 0;
    }
    return 0;
}
