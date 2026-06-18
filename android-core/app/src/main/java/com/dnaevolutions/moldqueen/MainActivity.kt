package com.dnaevolutions.moldqueen

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.dnaevolutions.moldqueen.service.Mk4Service

/**
 * Layer 2 host: starts the local WS API service (ws://localhost:8765) and drives it
 * through the SAME ApiCore the WebView will use — so Connect → Ready → Drive → Stop
 * exercises the full stack (UI → ApiCore → RadioController → BleBroadcaster → hub),
 * re-proving the radio behind the mirror. The WebView client arrives in layer 3.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var service: Mk4Service
    private lateinit var status: TextView

    private val requiredPerms = arrayOf(
        Manifest.permission.BLUETOOTH_ADVERTISE,
        Manifest.permission.BLUETOOTH_CONNECT,
    )

    private val permLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        status.text = if (result.values.all { it }) "Ready — WS on ws://localhost:8765"
        else "Bluetooth permissions DENIED — radio disabled (WS still up)"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        status = findViewById(R.id.status)

        service = Mk4Service(this)
        service.start()
        status.text = "WS API on ws://localhost:8765 — Connect → Ready → Drive"

        findViewById<Button>(R.id.btnConnect).setOnClickListener {
            if (ensurePerms()) submit("""{"cmd":"setup","action":"connect"}""", "CONNECT (hub should fast-flash)")
        }
        findViewById<Button>(R.id.btnReady).setOnClickListener {
            submit("""{"cmd":"setup","action":"ready"}""", "READY")
        }
        findViewById<Button>(R.id.btnDrive).setOnClickListener {
            submit("""{"cmd":"set","slot":0,"channel":0,"value":5}""", "DRIVE slot0 ch0 +5")
        }
        findViewById<Button>(R.id.btnStop).setOnClickListener {
            submit("""{"cmd":"stop"}""", "STOP (neutral)")
        }

        if (!hasPerms()) permLauncher.launch(requiredPerms)
    }

    private fun submit(cmd: String, label: String) {
        service.submit(cmd)
        status.text = label
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
        service.stop()
    }
}
