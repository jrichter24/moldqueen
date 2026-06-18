package com.dnaevolutions.moldqueen.service

import android.content.Context
import com.dnaevolutions.moldqueen.core.MapStore
import java.io.File

/**
 * Per-layout default channel map storage, mirroring the Pi's config/channel_map.<id>.json:
 * a promoted override in app files dir wins; otherwise the bundled asset is the default.
 * Writes are UTF-8 (so CJK labels persist — the cp1252 trap the Pi only hits on Windows).
 */
class AssetMapStore(context: Context) : MapStore {

    private val appCtx = context.applicationContext

    override fun loadDefault(layoutId: String): String? {
        val override = File(appCtx.filesDir, "channel_map.$layoutId.json")
        if (override.exists()) runCatching { return override.readText() }
        return runCatching {
            appCtx.assets.open("channel_map.$layoutId.json").bufferedReader().use { it.readText() }
        }.getOrNull()
    }

    override fun saveDefault(layoutId: String, jsonText: String) {
        File(appCtx.filesDir, "channel_map.$layoutId.json").writeText(jsonText)
    }
}
