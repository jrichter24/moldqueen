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

    private const val NEUTRAL_NIBBLE = 0x8

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
