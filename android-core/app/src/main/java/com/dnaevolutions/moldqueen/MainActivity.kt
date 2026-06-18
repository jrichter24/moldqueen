package com.dnaevolutions.moldqueen

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

/**
 * Minimal radio proof: Connect / Drive / Stop, each pushing one MK4 telegram to
 * the BLE advertiser. Goal of this session = move ONE motor.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var broadcaster: BleBroadcaster
    private lateinit var status: TextView

    private val requiredPerms = arrayOf(
        Manifest.permission.BLUETOOTH_ADVERTISE,
        Manifest.permission.BLUETOOTH_CONNECT,
    )

    private val permLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        val granted = result.values.all { it }
        status.text = if (granted) "Permissions granted — ready to Connect"
        else "Bluetooth permissions DENIED — grant them in Settings"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        status = findViewById(R.id.status)
        broadcaster = BleBroadcaster(this)
        broadcaster.onStatus = { msg -> runOnUiThread { status.text = msg } }

        findViewById<Button>(R.id.btnConnect).setOnClickListener {
            if (ensurePerms()) broadcaster.setPayload(Mk4Telegrams.connect(), "CONNECT")
        }
        findViewById<Button>(R.id.btnDrive).setOnClickListener {
            if (ensurePerms()) broadcaster.setPayload(Mk4Telegrams.drive(0, 0, 5), "DRIVE s0 c0 +5")
        }
        findViewById<Button>(R.id.btnStop).setOnClickListener {
            if (ensurePerms()) broadcaster.setPayload(Mk4Telegrams.stop(), "STOP (neutral)")
        }

        if (!hasPerms()) permLauncher.launch(requiredPerms)
    }

    private fun hasPerms(): Boolean = requiredPerms.all {
        ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
    }

    private fun ensurePerms(): Boolean {
        if (hasPerms()) return true
        permLauncher.launch(requiredPerms)
        return false
    }

    override fun onDestroy() {
        super.onDestroy()
        broadcaster.stop()
    }
}
