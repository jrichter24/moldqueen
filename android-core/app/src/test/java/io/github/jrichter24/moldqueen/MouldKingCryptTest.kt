package io.github.jrichter24.moldqueen

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Byte-exact validation of the Kotlin MouldKingCrypt port against the repo's own
 * self-test vectors in linux-core/reference/mouldking_crypt.py.
 *
 * These vectors use the MK6-era raw framing (0x6d/0x61 first byte). The crypt
 * (encode/decode) is identical for MK4 — this test validates the CODEC only.
 * The frames the app actually broadcasts are MK4 nibble (see Mk4TelegramsTest).
 */
class MouldKingCryptTest {

    private val CONNECT_RAW = "6d7ba78080808092"
    private val CONNECT_AIR = "6db643cf7e8f471188665938d17aaa26495e131415161718"
    private val STOP_RAW = "617ba78080808080809e"
    private val STOP_AIR = "6db643cf7e8f471184665938d17aaa34674a55bf15161718"
    private val CH0_RAW = "617ba7b980808080809e"
    private val CH0_AIR = "6db643cf7e8f471184665901d17aaa34674a262815161718"

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it.toInt() and 0xFF) }
    private fun hex(s: String): ByteArray =
        ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

    // Self-test 1 & 2 — encode(raw) == known on-air bytes
    @Test fun encode_connect_matches_known_onair() =
        assertEquals(CONNECT_AIR, MouldKingCrypt.encode(CONNECT_RAW).toHex())

    @Test fun encode_stop_matches_known_onair() =
        assertEquals(STOP_AIR, MouldKingCrypt.encode(STOP_RAW).toHex())

    @Test fun encode_ch0_matches_known_onair() =
        assertEquals(CH0_AIR, MouldKingCrypt.encode(CH0_RAW).toHex())

    // Self-test 3 — decode(encode(x)) == x (round-trip)
    @Test fun roundtrip_connect() =
        assertEquals(CONNECT_RAW, MouldKingCrypt.decode(MouldKingCrypt.encode(CONNECT_RAW)))

    @Test fun roundtrip_stop() =
        assertEquals(STOP_RAW, MouldKingCrypt.decode(MouldKingCrypt.encode(STOP_RAW)))

    @Test fun roundtrip_ch0() =
        assertEquals(CH0_RAW, MouldKingCrypt.decode(MouldKingCrypt.encode(CH0_RAW)))

    // Self-test 4 — decode(captured on-air bytes) == raw
    @Test fun decode_captured_connect_air() =
        assertEquals(CONNECT_RAW, MouldKingCrypt.decode(hex(CONNECT_AIR)))

    @Test fun decode_captured_stop_air() =
        assertEquals(STOP_RAW, MouldKingCrypt.decode(hex(STOP_AIR)))

    @Test fun decode_captured_ch0_air() =
        assertEquals(CH0_RAW, MouldKingCrypt.decode(hex(CH0_AIR)))
}
