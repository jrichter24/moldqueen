package com.dnaevolutions.moldqueen

import android.Manifest
import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.dnaevolutions.moldqueen.service.Mk4Service

/**
 * Layer 3: the app IS the web client. Starts the local service (HTTP client server +
 * WS API + radio) and points a WebView at http://localhost:8080/ — the SAME chooser →
 * excavator/raw the Pi serves, byte-identical (single-sourced from bt-core at build time).
 * The page connects to ws://localhost:8765 and drives the phone's radio. The client has
 * NO Android knowledge: endpoint, permissions, BT lifecycle and serving are all native.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var service: Mk4Service
    private lateinit var web: WebView

    // BLE runtime permissions for the radio. The client never sees these — once granted
    // the WS-driven radio just works; if denied, the UI still loads (radio disabled).
    private val permLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { /* no client involvement; radio picks up the grant on the next connect */ }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        service = Mk4Service(this)
        service.start()

        web = WebView(this).apply {
            settings.javaScriptEnabled = true          // the client is a JS app
            settings.domStorageEnabled = true          // localStorage: endpoint + settings + language
            settings.mediaPlaybackRequiresUserGesture = false
            webViewClient = WebViewClient()            // keep navigation in-app (chooser ↔ layouts)
            webChromeClient = WebChromeClient()        // console, fullscreen, etc.
        }
        setContentView(web)

        permLauncher.launch(arrayOf(
            Manifest.permission.BLUETOOTH_ADVERTISE,
            Manifest.permission.BLUETOOTH_CONNECT,
        ))

        web.loadUrl("http://localhost:${Mk4Service.HTTP_PORT}/")
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::web.isInitialized) web.destroy()
        if (::service.isInitialized) service.stop()
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
