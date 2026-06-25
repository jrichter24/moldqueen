/* See mk_crypt_selftest.h. Pure portable C — no ESP-IDF, no board required. */
#include "mk_crypt_selftest.h"
#include "mouldking_crypt.h"
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <stddef.h>

/* The repo's shared crypt vectors (raw command hex -> 24-byte on-air hex).
   Identical to linux-core/reference/mouldking_crypt.py + MouldKingCryptTest.kt. */
static const struct {
    const char *name;
    const char *raw_hex;
    const char *air_hex;
} VEC[] = {
    { "connect",  "6d7ba78080808092",     "6db643cf7e8f471188665938d17aaa26495e131415161718" },
    { "all-stop", "617ba78080808080809e", "6db643cf7e8f471184665938d17aaa34674a55bf15161718" },
    { "ch0+0.45", "617ba7b980808080809e", "6db643cf7e8f471184665901d17aaa34674a262815161718" },
};
#define VEC_COUNT (sizeof(VEC) / sizeof(VEC[0]))

static int hex_nibble(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

/* Parse a hex string into bytes; returns the byte count. */
static size_t hex2bytes(const char *hex, uint8_t *out, size_t out_cap)
{
    size_t n = 0;
    while (hex[0] && hex[1] && n < out_cap) {
        int hi = hex_nibble(hex[0]), lo = hex_nibble(hex[1]);
        if (hi < 0 || lo < 0) break;
        out[n++] = (uint8_t)((hi << 4) | lo);
        hex += 2;
    }
    return n;
}

static int g_pass, g_fail;

static void check(const char *name, int ok)
{
    if (ok) g_pass++; else g_fail++;
    printf("  [%s] %s\n", ok ? "PASS" : "FAIL", name);
}

int mk_crypt_selftest(void)
{
    g_pass = g_fail = 0;
    char label[96];

    for (size_t v = 0; v < VEC_COUNT; v++) {
        uint8_t raw[MK_CRYPT_MAX_PAYLOAD];
        uint8_t air[MK_CRYPT_ONAIR_LEN];
        size_t L   = hex2bytes(VEC[v].raw_hex, raw, sizeof raw);
        size_t alen = hex2bytes(VEC[v].air_hex, air, sizeof air);

        /* 1) encode(raw) == known on-air bytes (the core byte-exact check) */
        uint8_t got[MK_CRYPT_ONAIR_LEN];
        mk_crypt_encode(raw, L, got);
        snprintf(label, sizeof label, "encode(%s) == on-air", VEC[v].name);
        check(label, alen == MK_CRYPT_ONAIR_LEN && memcmp(got, air, MK_CRYPT_ONAIR_LEN) == 0);

        /* 2) decode(encode(raw)) == raw  (round-trip) */
        uint8_t back[MK_CRYPT_MAX_PAYLOAD];
        size_t bl = 0; int crc_ok = 0;
        int rc = mk_crypt_decode(got, MK_CRYPT_ONAIR_LEN, back, &bl, 1, &crc_ok);
        snprintf(label, sizeof label, "round-trip %s", VEC[v].name);
        check(label, rc == 0 && bl == L && memcmp(back, raw, L) == 0);

        /* 3) decode(known on-air) == raw, CRC verified */
        uint8_t dr[MK_CRYPT_MAX_PAYLOAD];
        size_t dl = 0; int dcrc = 0;
        int rc2 = mk_crypt_decode(air, MK_CRYPT_ONAIR_LEN, dr, &dl, 1, &dcrc);
        snprintf(label, sizeof label, "decode(on-air %s) == raw (crc ok)", VEC[v].name);
        check(label, rc2 == 0 && dl == L && memcmp(dr, raw, L) == 0 && dcrc == 1);
    }

    printf("TOTAL: %d passed, %d failed\n", g_pass, g_fail);
    return g_fail;
}
