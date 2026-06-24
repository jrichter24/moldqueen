package io.github.jrichter24.moldqueen

/**
 * MouldKing BLE telegram codec (company 0xFFF0).
 *
 * Clean-room Kotlin reimplementation of the algorithm described in
 * linux-core/reference/mouldking_crypt.py (itself a derivative of
 * J0EK3R/mkconnect-python's MouldKingCrypt, MIT). Pure software, no BLE here.
 *
 * encode(rawHex) -> 24-byte on-air manufacturer data
 * decode(crypted) -> raw command hex (exact inverse)
 *
 * Frame layout inside the working buffer `t` (payload length L):
 *   t[15..17]     = header 0x71 0x0F 0x55              (bit-reversed in step 4)
 *   t[18..22]     = reversed preamble C5 C4 C3 C2 C1   (bit-reversed in step 4)
 *   t[23..23+L-1] = raw payload                        (NOT bit-reversed)
 *   t[23+L..+1]   = CRC-16 (little-endian)
 * Ciphers: LFSR(63) over t[18:], then LFSR(37) over all of t.
 * On-air = t[15 : 15+L+10], right-padded to 24 with filler byte[i] = i + 1.
 */
object MouldKingCrypt {

    private val PREAMBLE = intArrayOf(0xC1, 0xC2, 0xC3, 0xC4, 0xC5)

    /** Result of the CRC check on the most recent decode(), or null if not verified. */
    var lastCrcOk: Boolean? = null
        private set

    fun encode(rawHex: String): ByteArray {
        val raw = hexToInts(rawHex)
        val L = raw.size
        val t = IntArray(5 + L + 20)              // length L + 25
        t[15] = 0x71; t[16] = 0x0F; t[17] = 0x55
        for (i in 0 until 5) t[18 + i] = PREAMBLE[5 - i - 1]   // reversed preamble
        for (i in 0 until L) t[23 + i] = raw[i]               // raw payload
        for (i in 15 until 23) t[i] = revertBitsByte(t[i])    // bit-reverse header+preamble
        val crc = crc(PREAMBLE, raw)
        t[23 + L] = crc and 0xFF
        t[24 + L] = (crc ushr 8) and 0xFF
        cryptSlice(t, 18, makeMagic(63))          // LFSR pass 1 (seed 63) over t[18:]
        cryptSlice(t, 0, makeMagic(37))           // LFSR pass 2 (seed 37) over all of t
        val out = IntArray(24)
        val keep = 5 + L + 5                       // = L + 10 meaningful bytes
        for (i in 0 until keep) out[i] = t[15 + i]
        for (i in keep until 24) out[i] = i + 1   // filler
        return ByteArray(24) { out[it].toByte() }
    }

    fun decode(crypted: ByteArray, verify: Boolean = true): String {
        val b = IntArray(crypted.size) { crypted[it].toInt() and 0xFF }
        val n = b.size
        // detect meaningful length by stripping the trailing filler (byte[i] == i+1)
        var keep = n
        var i = n - 1
        while (i >= 0 && b[i] == ((i + 1) and 0xFF)) {
            keep = i
            i--
        }
        val L = keep - 10
        require(L > 0) { "could not detect payload length (filler run too long?)" }
        val t = IntArray(L + 25)
        for (j in 0 until keep) t[15 + j] = b[j]  // 15 + keep == L + 25
        cryptSlice(t, 0, makeMagic(37))           // invert LFSR pass 2 (whole)
        cryptSlice(t, 18, makeMagic(63))          // invert LFSR pass 1 (t[18:])
        val raw = IntArray(L) { t[23 + it] }
        lastCrcOk = if (verify) {
            val crc = crc(PREAMBLE, raw)
            t[23 + L] == (crc and 0xFF) && t[24 + L] == ((crc ushr 8) and 0xFF)
        } else null
        return raw.joinToString("") { "%02x".format(it) }
    }

    // ── primitives ──────────────────────────────────────────────────

    private fun revertBitsByte(v: Int): Int {
        var r = 0
        for (i in 0 until 8) if ((1 shl i) and v != 0) r = r or (1 shl (7 - i))
        return r
    }

    private fun revertBitsInt(v: Int): Int {
        var r = 0
        for (i in 0 until 16) if ((1 shl i) and v != 0) r = r or (1 shl (15 - i))
        return r and 0xFFFF
    }

    private fun makeMagic(seed: Int): IntArray {
        val m = IntArray(7)
        m[0] = 1
        for (i in 1 until 7) m[i] = (seed ushr (6 - i)) and 1
        return m
    }

    private fun shiftMagic(s: IntArray): Int {
        val r1 = s[3] xor s[6]
        s[3] = s[2]; s[2] = s[1]; s[1] = s[0]; s[0] = s[6]
        s[6] = s[5]; s[5] = s[4]; s[4] = r1
        return s[0]
    }

    /**
     * XOR stream cipher over t[from until t.size], LSB-first; the keystream is
     * data-independent so the operation is self-inverse. Mutates `t` in place.
     */
    private fun cryptSlice(t: IntArray, from: Int, magic: IntArray) {
        for (k in from until t.size) {
            val cur = t[k]
            var res = 0
            for (bit in 0 until 8) {
                res += (((cur ushr bit) and 1) xor shiftMagic(magic)) shl bit
            }
            t[k] = res and 0xFF
        }
    }

    /**
     * CRC-16/CCITT (poly 0x1021, init 0xFFFF), fed reversed-preamble then
     * bit-reversed payload; final value bit-reversed (16) then XOR 0xFFFF.
     */
    private fun crc(preamble: IntArray, payload: IntArray): Int {
        var result = 0xFFFF
        for (i in preamble.indices) {
            result = (result xor (preamble[preamble.size - 1 - i] shl 8)) and 0xFFFF
            repeat(8) {
                val cur = result and 0x8000
                result = (result shl 1) and 0xFFFF
                if (cur != 0) result = result xor 0x1021
            }
        }
        for (b in payload) {
            result = ((revertBitsByte(b) shl 8) xor result) and 0xFFFF
            repeat(8) {
                val cur = result and 0x8000
                result = (result shl 1) and 0xFFFF
                if (cur != 0) result = result xor 0x1021
            }
        }
        return revertBitsInt(result) xor 0xFFFF
    }

    private fun hexToInts(s: String): IntArray =
        IntArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16) }
}
