package io.github.jrichter24.moldqueen

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import io.github.jrichter24.moldqueen.service.Mk4Service

/**
 * Layer 3 host + native app tuning. Starts the local service and shows the bundled
 * client in a full-immersive, landscape-locked WebView (no action bar, no system bars).
 * Off-site links (anything not http(s)://localhost) open in the system browser; localhost
 * navigation stays in-app. None of this touches the shared client — it's all native.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var service: Mk4Service
    private lateinit var web: WebView

    // Predictive-back-correct (targetSdk 35 default-on): while the WebView has history, consume
    // Back to walk it; when it can't go back the callback disables itself and the system finishes
    // the activity (clean exit, predictive close animation). Replaces the deprecated
    // onBackPressed() override, which the ahead-of-time back model can bypass.
    private val backCallback = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            if (::web.isInitialized && web.canGoBack()) web.goBack()
        }
    }

    private val permLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { /* radio picks up the grant on the next connect; client unaware */ }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)   // edge-to-edge
        // Chooser loads first, so default to user orientation; onPageStarted refines per page
        // (chooser = portrait+landscape, layouts = landscape-locked).
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_USER

        service = Mk4Service(this)
        service.start()

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            // The client's off-site links use target="_blank" -> they arrive via
            // onCreateWindow, not shouldOverrideUrlLoading. Support both paths.
            settings.setSupportMultipleWindows(true)
            settings.javaScriptCanOpenWindowsAutomatically = true
            webViewClient = object : WebViewClient() {
                // Same-window navigation: keep localhost in-app; off-site -> system browser.
                override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                    val uri = req.url
                    return if (isLocal(uri)) false else { openExternally(uri); true }
                }
                // Keep the Back callback's enabled state in sync with the WebView history.
                override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                    backCallback.isEnabled = view.canGoBack()
                }
                // Per-page orientation: the chooser (root) allows portrait+landscape; layouts lock landscape.
                override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                    applyOrientation(url)
                }
            }
            webChromeClient = object : WebChromeClient() {
                // target="_blank" / window.open: capture the target URL via a throwaway
                // WebView and route it to the system browser (never opens in-app).
                override fun onCreateWindow(
                    view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message,
                ): Boolean {
                    val temp = WebView(view.context)
                    temp.webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(v: WebView, req: WebResourceRequest): Boolean {
                            openExternally(req.url)
                            temp.destroy()
                            return true
                        }
                    }
                    (resultMsg.obj as WebView.WebViewTransport).webView = temp
                    resultMsg.sendToTarget()
                    return true
                }
            }
        }
        setContentView(web)
        // Edge-to-edge is enforced on targetSdk 35; pad the control surface into the safe area
        // so it never sits under the status/nav bars or the display cutout. In immersive the
        // bars are hidden (their insets collapse to 0) so the page stays full-bleed; the cutout
        // inset still keeps the joysticks clear of the notch when present.
        ViewCompat.setOnApplyWindowInsetsListener(web) { v, insets ->
            val safe = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            v.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            insets
        }
        enterImmersive()

        onBackPressedDispatcher.addCallback(this, backCallback)

        permLauncher.launch(arrayOf(
            android.Manifest.permission.BLUETOOTH_ADVERTISE,
            android.Manifest.permission.BLUETOOTH_CONNECT,
        ))

        web.loadUrl("http://localhost:${Mk4Service.HTTP_PORT}/")
    }

    /**
     * Per-page orientation: the startpage/chooser (root path "/") allows portrait + landscape;
     * every individual layout (/excavator, /raw, /generic_*, …) stays landscape-locked. This is
     * the first step toward a per-layout allowed-orientations property (see WORKBOARD.md).
     */
    private fun applyOrientation(url: String?) {
        val path = url?.let { Uri.parse(it).path }
        val isChooser = path.isNullOrEmpty() || path == "/"
        requestedOrientation = if (isChooser)
            ActivityInfo.SCREEN_ORIENTATION_USER          // startpage: follow the device (portrait + landscape)
        else
            ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE     // layouts: landscape-locked
    }

    /** True only for the locally-served client (http/https on loopback). */
    private fun isLocal(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase()
        val host = uri.host?.lowercase()
        return (scheme == "http" || scheme == "https") && (host == "localhost" || host == "127.0.0.1")
    }

    private fun openExternally(uri: Uri) {
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    private fun enterImmersive() {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersive()   // immersive sticky: re-hide after transient reveal
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::web.isInitialized) web.destroy()
        if (::service.isInitialized) service.stop()
    }
}
