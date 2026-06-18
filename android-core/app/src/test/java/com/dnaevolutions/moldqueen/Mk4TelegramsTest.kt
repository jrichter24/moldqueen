package com.dnaevolutions.moldqueen

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * MK4 12-channel nibble protocol (docs/PROJECT.md §3) — the format the app
 * actually broadcasts. Connect: ad ae 18 80 80 80 f3 52. Motion: 7d ae 18
 * <6 channel bytes> 82, where the 6 bytes hold 12 nibbles (3 slots x 4 ch),
 * global nibble index = slot*4 + channel, even index = high nibble, odd = low,
 * byte offset = 3 + index/2, nibble value = 0x8 + value (value -7..+7).
 */
class Mk4TelegramsTest {

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it.toInt() and 0xFF) }

    @Test fun connect_raw_is_the_mk4_connect_frame() =
        assertEquals("adae18808080f352", Mk4Telegrams.CONNECT_RAW)

    @Test fun motion_all_neutral_is_all_0x88() =
        assertEquals("7dae18" + "888888888888" + "82", Mk4Telegrams.motionRawHex(IntArray(12)))

    // slot0 ch0 = +5 -> global index 0 (even) -> high nibble of byte[3]; 0x8+5 = 0xD -> 0xD8
    @Test fun drive_slot0_ch0_plus5_sets_high_nibble() =
        assertEquals("7dae18" + "d8" + "8888888888" + "82", Mk4Telegrams.motionRawHexSingle(0, 0, 5))

    // slot0 ch1 = +3 -> global index 1 (odd) -> low nibble of byte[3]; 0x8+3 = 0xB -> 0x8B
    @Test fun drive_slot0_ch1_plus3_sets_low_nibble() =
        assertEquals("7dae18" + "8b" + "8888888888" + "82", Mk4Telegrams.motionRawHexSingle(0, 1, 3))

    // slot1 ch0 = +5 -> global index 4 (even) -> high nibble of byte[5]
    @Test fun drive_slot1_ch0_plus5_offsets_to_byte5() =
        assertEquals("7dae18" + "8888" + "d8" + "888888" + "82", Mk4Telegrams.motionRawHexSingle(1, 0, 5))

    // negative direction: slot0 ch0 = -7 -> 0x8-7 = 0x1 -> 0x18
    @Test fun drive_slot0_ch0_minus7_sets_low_value_nibble() =
        assertEquals("7dae18" + "18" + "8888888888" + "82", Mk4Telegrams.motionRawHexSingle(0, 0, -7))

    @Test fun connect_encodes_to_24_byte_onair() =
        assertEquals(24, Mk4Telegrams.connect().size)

    @Test fun drive_encodes_to_24_bytes_and_roundtrips_through_codec() {
        val air = Mk4Telegrams.drive(0, 0, 5)
        assertEquals(24, air.size)
        assertEquals("7dae18d8888888888882", MouldKingCrypt.decode(air))
    }

    @Test fun stop_roundtrips_through_codec() =
        assertEquals("7dae18" + "888888888888" + "82", MouldKingCrypt.decode(Mk4Telegrams.stop()))

    // Byte-exact vs the WORKING Pi broadcaster on-air payloads (bt-core/mk4web/telegram.py).
    // Confirms the 24-byte manufacturer data is identical to the proven system.
    @Test fun connect_onair_matches_pi_broadcaster() =
        assertEquals("6db643cf7e8f471148b3e638d17ad9e67017131415161718", Mk4Telegrams.connect().toHex())

    @Test fun drive_s0c0_plus5_onair_matches_pi_broadcaster() =
        assertEquals("6db643cf7e8f471198b3e660d972a23c6f563e6c15161718", Mk4Telegrams.drive(0, 0, 5).toHex())
}
