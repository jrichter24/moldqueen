package io.github.jrichter24.moldqueen

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertisingSet
import android.bluetooth.le.AdvertisingSetCallback
import android.bluetooth.le.AdvertisingSetParameters
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Minimal advertiser seam (so RadioController is unit-testable without the Android radio). */
interface BleSink {
    fun setPayload(bytes: ByteArray, label: String)
    fun stop()
    fun hardStop(connect: ByteArray, neutral: ByteArray)   // STOP: kill the radio + reconnect at neutral
}

/**
 * Broadcasts MK4 telegrams as BLE manufacturer-specific advertising data under
 * company id 0xFFF0. No GATT — control is pure broadcast advertising.
 *
 * On-air layout must match the stock MK+tech app / Pi broadcaster, whose advertising
 * data is:  02 01 02  (Flags AD)  +  1b ff f0 ff <24 crypted bytes>  (manufacturer AD)
 * = 3 + 28 = 31 bytes, exactly the legacy limit. The hub needs that leading Flags
 * structure; Android only emits a Flags AD when the advertisement is CONNECTABLE, so
 * we advertise legacy + connectable (name + TX-power suppressed to stay within 31 bytes).
 *
 * IMPORTANT — keep the hub connected: we use the **AdvertisingSet** API so a NORMAL payload
 * change (drive / per-channel / release-to-neutral) is applied IN PLACE with
 * `AdvertisingSet.setAdvertisingData()` on the CONTINUOUSLY-RUNNING advertiser — NO stop/start,
 * so there is NO transmission gap. The radio re-emits the frame ~10/s (interval 100ms) without
 * interruption, so the hub never times out to slow-flash. The ONLY teardown is [hardStop]
 * (cmd:stop): stop the set, then reconnect into a clean neutral. (The legacy startAdvertising +
 * stop/start-per-change approach starved the hub during driving — that was the regression.)
 */
class BleBroadcaster(context: Context) : BleSink {

    companion object {
        private const val TAG = "Mk4Ble"
        const val COMPANY_ID = 0xFFF0
        private const val INTERVAL = 160                 // 0.625ms units; 160 = 100ms (~10/s), matches LOW_LATENCY
        private const val SETTLE_MS = 120L               // gap after a STOP teardown before re-starting (start/stop are async)
    }

    private val adapter: BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    private val advertiser: BluetoothLeAdvertiser?
        get() = adapter?.bluetoothLeAdvertiser

    // All advertiser control (and callbacks) is funnelled onto this ONE thread, so `set`/`starting`
    // are touched single-threaded.
    private val exec = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "mk4-ble").apply { isDaemon = true } }
    @Volatile private var desired: ByteArray? = null     // latest payload wanted (null = OFF)
    @Volatile private var desiredLabel = ""
    private var set: AdvertisingSet? = null              // the running advertising set (in-place updatable)
    private var starting = false                         // startAdvertisingSet issued, awaiting the started callback

    /** UI status sink. */
    var onStatus: ((String) -> Unit)? = null

    private val setCallback = object : AdvertisingSetCallback() {
        override fun onAdvertisingSetStarted(s: AdvertisingSet?, txPower: Int, status: Int) {
            exec.execute {
                starting = false
                if (status == ADVERTISE_SUCCESS && s != null) { set = s; Log.i(TAG, "advertising set started"); apply() }
                else { set = null; Log.e(TAG, "advertising set start failed: status=$status"); onStatus?.invoke("Advertise FAILED: status $status") }
            }
        }
        override fun onAdvertisingSetStopped(s: AdvertisingSet?) { exec.execute { set = null } }
        override fun onAdvertisingDataSet(s: AdvertisingSet?, status: Int) {
            if (status != ADVERTISE_SUCCESS) Log.w(TAG, "setAdvertisingData status=$status")
        }
    }

    fun isReady(): Boolean = adapter?.isEnabled == true && advertiser != null

    /** NORMAL update: set the payload; applied IN PLACE on the running set (no stop/start, no gap). */
    override fun setPayload(bytes: ByteArray, label: String) {
        desired = bytes; desiredLabel = label
        exec.execute { apply() }
    }

    /** Tear the advertiser DOWN (radio OFF). */
    override fun stop() {
        desired = null
        exec.execute { apply() }
        onStatus?.invoke("Radio stopped")
    }

    /** STOP only: KILL the advertiser, then RECONNECT into a clean neutral — re-send the connect
     *  telegram (fresh start), then swap to the all-neutral motion frame IN PLACE. The repeated
     *  state ends up neutral, so no stale non-zero frame can survive. */
    override fun hardStop(connect: ByteArray, neutral: ByteArray) {
        exec.execute {
            desired = null; apply()                                       // KILL (stop the set)
            exec.schedule({ desired = connect; desiredLabel = "CONNECT"; apply() }, SETTLE_MS, TimeUnit.MILLISECONDS)
            exec.schedule({ desired = neutral; desiredLabel = "STOP-NEUTRAL"; apply() }, SETTLE_MS * 3, TimeUnit.MILLISECONDS)
        }
    }

    /** Drive the radio toward `desired`. Runs ONLY on `exec`. A running set is updated IN PLACE
     *  (no gap); starting/stopping the set is the only stop/start, and only happens for the first
     *  start or a [hardStop]/[stop] teardown. */
    @SuppressLint("MissingPermission")
    private fun apply() {
        val adv = advertiser
        if (adapter?.isEnabled != true || adv == null) { onStatus?.invoke("Bluetooth is OFF — enable it and retry"); return }
        val want = desired
        if (want == null) {                                  // want OFF
            if (set != null || starting) { runCatching { adv.stopAdvertisingSet(setCallback) }; set = null; starting = false }
            return
        }
        val s = set
        if (s != null) {                                     // RUNNING -> in-place data swap (continuous, no gap)
            runCatching { s.setAdvertisingData(dataFor(want)) }
                .onFailure { Log.w(TAG, "setAdvertisingData failed (${it.javaClass.simpleName}: ${it.message})") }
            onStatus?.invoke("$desiredLabel — on-air %dB @0x%04X (~10/s)".format(want.size, COMPANY_ID))
            return
        }
        if (!starting) {                                     // not running -> start the set ONCE
            try {
                adv.startAdvertisingSet(paramsFor(), dataFor(want), null, null, null, setCallback)
                starting = true
            } catch (e: Exception) {
                starting = false
                Log.w(TAG, "startAdvertisingSet failed (${e.javaClass.simpleName}: ${e.message})")
                onStatus?.invoke("Radio unavailable: ${e.message}")
            }
        }
        // else: a start is in flight — onAdvertisingSetStarted applies the latest `desired`.
    }

    private fun paramsFor() = AdvertisingSetParameters.Builder()
        .setLegacyMode(true)                 // legacy 31-byte advertising (what the hub parses)
        .setConnectable(true)                // -> ADV_IND, Android prepends the Flags AD the hub needs
        .setScannable(true)                  // legacy connectable == scannable (ADV_IND)
        .setInterval(INTERVAL)               // ~100ms (10/s), continuous — holds the hub connected
        .setTxPowerLevel(AdvertisingSetParameters.TX_POWER_HIGH)
        .build()

    private fun dataFor(bytes: ByteArray) = AdvertiseData.Builder()
        .setIncludeDeviceName(false)
        .setIncludeTxPowerLevel(false)
        .addManufacturerData(COMPANY_ID, bytes)
        .build()
}
