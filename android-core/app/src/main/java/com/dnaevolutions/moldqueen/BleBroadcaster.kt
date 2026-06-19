package com.dnaevolutions.moldqueen

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.SystemClock
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
        // After ANY stopAdvertising, wait this long before the next startAdvertising. stop/start
        // are async; starting too soon races -> ADVERTISE_FAILED_ALREADY_STARTED -> the new frame
        // is dropped and the OLD one keeps repeating. A settle makes every change reliably apply.
        private const val SETTLE_MS = 110L
    }

    private val adapter: BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    private val advertiser: BluetoothLeAdvertiser?
        get() = adapter?.bluetoothLeAdvertiser

    @Volatile private var advertising = false

    // Serialize all advertiser control on ONE thread; `desired` is the latest wanted payload
    // (null = OFF). `reconcile()` drives the radio toward `desired`, never starting within
    // SETTLE_MS of a stop (avoids the ALREADY_STARTED race that drops frames).
    private val exec = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "mk4-ble").apply { isDaemon = true } }
    @Volatile private var desired: ByteArray? = null
    @Volatile private var desiredLabel = ""
    private var started = false          // exec-thread only: startAdvertising issued, not yet stopped
    private var cooldownUntil = 0L       // exec-thread only: don't start before this (post-stop settle)

    /** UI status sink. */
    var onStatus: ((String) -> Unit)? = null

    private val callback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            advertising = true
            Log.i(TAG, "advertising started")
        }

        override fun onStartFailure(errorCode: Int) {
            advertising = false
            if (errorCode == ADVERTISE_FAILED_ALREADY_STARTED) {   // our state desynced -> recover
                exec.execute { started = false; cooldownUntil = SystemClock.elapsedRealtime() + SETTLE_MS; reconcile() }
            }
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

    /** Set the broadcast payload (the radio reconciles to it on its own thread). */
    override fun setPayload(bytes: ByteArray, label: String) {
        desired = bytes; desiredLabel = label
        exec.execute { reconcile() }
    }

    /** Tear the advertiser DOWN (radio OFF). */
    override fun stop() {
        desired = null
        exec.execute { reconcile() }
        onStatus?.invoke("Radio stopped")
    }

    /** STOP: KILL the advertiser, then reconnect into a CLEAN neutral — re-send the connect
     *  telegram, then hold the all-neutral motion frame. The repeated state ends up neutral, so
     *  no stale non-zero frame can survive. Sequenced (with settles) on the radio thread so each
     *  start is clean (from a stopped state). */
    override fun hardStop(connect: ByteArray, neutral: ByteArray) {
        exec.execute {
            desired = null; reconcile()                                   // kill (advertiser off)
            exec.schedule({ desired = connect; desiredLabel = "CONNECT"; reconcile() }, SETTLE_MS, TimeUnit.MILLISECONDS)
            exec.schedule({ desired = neutral; desiredLabel = "STOP-NEUTRAL"; reconcile() }, SETTLE_MS * 4, TimeUnit.MILLISECONDS)
        }
    }

    /** Drive the radio toward `desired`. Runs ONLY on `exec` (single-threaded). Legacy advertising
     *  can't update data in place, so a change = stop + (settle) + start; a start never happens
     *  within SETTLE_MS of a stop. */
    @SuppressLint("MissingPermission")
    private fun reconcile() {
        val adv = advertiser
        if (adapter?.isEnabled != true || adv == null) {
            onStatus?.invoke("Bluetooth is OFF — enable it and retry"); return
        }
        val want = desired
        val nowMs = SystemClock.elapsedRealtime()
        if (want == null) {                                  // want OFF
            if (started) { runCatching { adv.stopAdvertising(callback) }; started = false; advertising = false; cooldownUntil = nowMs + SETTLE_MS }
            return
        }
        if (started) {                                       // replacing -> stop, then restart after the settle
            runCatching { adv.stopAdvertising(callback) }; started = false; advertising = false; cooldownUntil = nowMs + SETTLE_MS
            exec.schedule({ reconcile() }, SETTLE_MS, TimeUnit.MILLISECONDS); return
        }
        if (nowMs < cooldownUntil) {                         // still settling from a stop -> try again after
            exec.schedule({ reconcile() }, cooldownUntil - nowMs, TimeUnit.MILLISECONDS); return
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
            .addManufacturerData(COMPANY_ID, want)
            .build()
        // Swallow radio errors (e.g. SecurityException without BLUETOOTH_ADVERTISE) — a radio
        // failure must NEVER break the WS exchange; the client stays unaware.
        try {
            adv.startAdvertising(settings, data, callback)
            started = true
            onStatus?.invoke("$desiredLabel — on-air %dB @0x%04X (~10/s)".format(want.size, COMPANY_ID))
        } catch (e: Exception) {
            started = false; advertising = false
            Log.w(TAG, "advertise call failed (${e.javaClass.simpleName}: ${e.message})")
            onStatus?.invoke("Radio unavailable: ${e.message}")
        }
    }
}
