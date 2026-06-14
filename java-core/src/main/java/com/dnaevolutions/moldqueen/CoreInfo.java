package com.dnaevolutions.moldqueen;

/**
 * Placeholder entry point that proves the java-core toolchain builds and tests.
 *
 * <p>Real responsibilities land here later: building BLE-advertising telegrams
 * (encoding/crypto, channel-&gt;speed mapping over -7..+7, the rolling counter)
 * and orchestrating multiple hubs (device 0 / device 1).
 *
 * <p>This module is HARDWARE-INDEPENDENT: pure bytes + logic, no BLE, nothing
 * Pi-only. It emits payload bytes; a bt-core radio worker broadcasts them.
 */
public final class CoreInfo {

    private CoreInfo() {
    }

    /** Stable module identifier, used by the trivial bring-up test. */
    public static String name() {
        return "moldqueen-java-core";
    }
}
