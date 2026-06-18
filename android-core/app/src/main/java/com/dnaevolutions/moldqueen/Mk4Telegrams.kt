package com.dnaevolutions.moldqueen

/**
 * Builds MK4 12-channel nibble telegrams (docs/PROJECT.md §3) and crypts them
 * to 24-byte on-air manufacturer data via [MouldKingCrypt].
 *
 * Connect (raw): ad ae 18 80 80 80 f3 52  — single generic frame.
 * Motion (raw):  7d ae 18 <6 channel bytes> 82
 *   The 6 channel bytes hold 12 nibbles = 3 slots x 4 channels.
 *   global nibble index = slot * 4 + channel  (0..11)
 *   byte offset in the 6-byte block = index / 2; even index = high nibble, odd = low.
 *   nibble value = 0x8 + value, value in -7..+7 (0 = neutral/stop).
 * ONE telegram drives all hubs at once; a hub obeys whichever 4-nibble slot block
 * it is on (selected by its physical button).
 */
object Mk4Telegrams {

    const val CONNECT_RAW = "adae18808080f352"
    private const val MOTION_HEADER = "7dae18"
    private const val MOTION_TRAILER = "82"

    const val N_CHANNELS = 12
    const val NEUTRAL = 0x8                 // neutral nibble
    private const val NEUTRAL_NIBBLE = 0x8
    // Full on-air advertising-data prefix the Pi/stock app use: Flags AD (02 01 02) +
    // manufacturer AD header (len 1b, type ff, company f0 ff = 0xFFF0). The 24 crypted
    // bytes follow. Mirrors bt-core/mk4web/telegram.py _AD_PREFIX.
    private const val AD_PREFIX_HEX = "1f0201021bfff0ff"

    /** value (-7..+7) -> nibble (0x1..0xF); 0 -> 0x8 neutral. Clamps out-of-range. */
    fun valueToNibble(value: Int): Int = NEUTRAL + value.coerceIn(-7, 7)

    /** nibble (0x1..0xF) -> signed value (-7..+7). */
    fun nibbleToValue(nibble: Int): Int = nibble - NEUTRAL

    /** (slot 0-2, channel 0-3) -> global channel index 0-11. */
    fun channelIndex(slot: Int, channel: Int): Int = slot * 4 + channel

    /** 12 nibbles (0x0..0xF) -> motion telegram raw hex (mirrors telegram.motion_raw). */
    fun motionRawHexNibbles(nibbles: IntArray): String {
        require(nibbles.size == N_CHANNELS) { "expected 12 nibbles (was ${nibbles.size})" }
        val sb = StringBuilder(MOTION_HEADER)
        for (i in 0 until 6) sb.append("%02x".format(((nibbles[2 * i] and 0xF) shl 4) or (nibbles[2 * i + 1] and 0xF)))
        sb.append(MOTION_TRAILER)
        return sb.toString()
    }

    /** raw telegram hex -> on-air AD bytes (prefix + crypted 24), mirrors telegram.ad_bytes. */
    fun adBytes(rawHex: String): ByteArray {
        val prefix = ByteArray(AD_PREFIX_HEX.length / 2) {
            AD_PREFIX_HEX.substring(it * 2, it * 2 + 2).toInt(16).toByte()
        }
        return prefix + MouldKingCrypt.encode(rawHex)
    }

    /** Space-separated hex of [adBytes] (mirrors telegram.ad_hex) for the RAW console. */
    fun adHex(rawHex: String): String =
        adBytes(rawHex).joinToString(" ") { "%02x".format(it.toInt() and 0xFF) }

    fun connect(): ByteArray = MouldKingCrypt.encode(CONNECT_RAW)

    fun stop(): ByteArray = MouldKingCrypt.encode(motionRawHex(IntArray(12)))

    /** Crypted on-air frame moving a single (slot, channel) to [value], rest neutral. */
    fun drive(slot: Int, channel: Int, value: Int): ByteArray =
        MouldKingCrypt.encode(motionRawHexSingle(slot, channel, value))

    /** Raw motion hex with one channel set; all others neutral. */
    fun motionRawHexSingle(slot: Int, channel: Int, value: Int): String {
        require(slot in 0..2) { "slot must be 0..2 (was $slot)" }
        require(channel in 0..3) { "channel must be 0..3 (was $channel)" }
        val values = IntArray(12)
        values[slot * 4 + channel] = value
        return motionRawHex(values)
    }

    /** Raw motion hex from 12 channel values (index = slot*4 + channel), each -7..+7. */
    fun motionRawHex(values: IntArray): String {
        require(values.size == 12) { "expected 12 channel values (was ${values.size})" }
        val bytes = IntArray(6)
        for (index in 0 until 12) {
            val v = values[index]
            require(v in -7..7) { "channel $index value out of range -7..7 (was $v)" }
            val nibble = NEUTRAL_NIBBLE + v
            val byteIdx = index / 2
            bytes[byteIdx] = bytes[byteIdx] or if (index % 2 == 0) nibble shl 4 else nibble
        }
        val sb = StringBuilder(MOTION_HEADER)
        for (b in bytes) sb.append("%02x".format(b))
        sb.append(MOTION_TRAILER)
        return sb.toString()
    }
}
