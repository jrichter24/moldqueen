package com.dnaevolutions.moldqueen

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.util.Log

/** Minimal advertiser seam (so RadioController is unit-testable without the Android radio). */
interface BleSink {
    fun setPayload(bytes: ByteArray, label: String)
    fun stop()
}

/**
 * Broadcasts MK4 telegrams as BLE manufacturer-specific advertising data under
 * company id 0xFFF0. No GATT — control is pure broadcast advertising.
 *
 * On-air layout must match the stock MK+tech app / Pi broadcaster, whose advertising
 * data is:  02 01 02  (Flags AD)  +  1b ff f0 ff <24 crypted bytes>  (manufacturer AD)
 * = 3 + 28 = 31 bytes, exactly the legacy limit. The hub needs that leading Flags
 * structure; Android only emits a Flags AD when the advertisement is CONNECTABLE, so
 * we advertise connectable (with name + TX-power suppressed to stay within 31 bytes).
 *
 * Repetition comes from the radio itself: ADVERTISE_MODE_LOW_LATENCY re-emits the
 * advert roughly every 100 ms (~10/sec), so a single startAdvertising() keeps the
 * connect/motion frame on-air continuously until the payload changes.
 */
class BleBroadcaster(context: Context) : BleSink {

    companion object {
        private const val TAG = "Mk4Ble"
        const val COMPANY_ID = 0xFFF0
    }

    private val adapter: BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    private val advertiser: BluetoothLeAdvertiser?
        get() = adapter?.bluetoothLeAdvertiser

    @Volatile private var advertising = false

    /** UI status sink. */
    var onStatus: ((String) -> Unit)? = null

    private val callback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            advertising = true
            Log.i(TAG, "advertising started")
        }

        override fun onStartFailure(errorCode: Int) {
            advertising = false
            val msg = when (errorCode) {
                ADVERTISE_FAILED_DATA_TOO_LARGE -> "DATA_TOO_LARGE (needs extended advertising)"
                ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "TOO_MANY_ADVERTISERS"
                ADVERTISE_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"
                ADVERTISE_FAILED_INTERNAL_ERROR -> "INTERNAL_ERROR"
                ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "FEATURE_UNSUPPORTED"
                else -> "error $errorCode"
            }
            Log.e(TAG, "advertise failed: $msg")
            onStatus?.invoke("Advertise FAILED: $msg")
        }
    }

    fun isReady(): Boolean = adapter?.isEnabled == true && advertiser != null

    /** Replace the broadcast payload; restarts advertising so the new frame goes out.
     *  MUST be called only on a CHANGE (RadioController dedups) — calling it at the keepalive
     *  rate churns the async start/stop and drops frames (incl. the release neutral). */
    @SuppressLint("MissingPermission")
    override fun setPayload(bytes: ByteArray, label: String) {
        val adv = advertiser
        if (adapter?.isEnabled != true || adv == null) {
            onStatus?.invoke("Bluetooth is OFF — enable it and retry")
            return
        }
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)   // forces Android to prepend the Flags AD the hub expects
            .setTimeout(0)
            .build()
        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addManufacturerData(COMPANY_ID, bytes)
            .build()
        // Swallow radio errors (e.g. SecurityException when BLUETOOTH_ADVERTISE isn't
        // granted yet) — like the Pi's IPCClient swallows OSError. A radio failure must
        // NEVER break the WS exchange/contract; the client stays unaware.
        try {
            if (advertising) {
                adv.stopAdvertising(callback)
                advertising = false
            }
            adv.startAdvertising(settings, data, callback)
            onStatus?.invoke("$label — on-air %dB @0x%04X (~10/s)".format(bytes.size, COMPANY_ID))
        } catch (e: Exception) {
            advertising = false
            Log.w(TAG, "advertise call failed (${e.javaClass.simpleName}: ${e.message})")
            onStatus?.invoke("Radio unavailable: ${e.message}")
        }
    }

    @SuppressLint("MissingPermission")
    override fun stop() {
        try {
            if (advertising) {
                advertiser?.stopAdvertising(callback)
                advertising = false
            }
        } catch (e: Exception) {
            advertising = false
            Log.w(TAG, "stopAdvertising failed (${e.javaClass.simpleName}: ${e.message})")
        }
        onStatus?.invoke("Radio stopped")
    }
}
