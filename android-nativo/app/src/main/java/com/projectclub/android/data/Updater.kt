package com.projectclub.android.data

import com.projectclub.android.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

@Serializable
data class AppRelease(val versionCode: Int = 0, val versionName: String = "", val url: String = "")

/**
 * Confere se saiu versão nova do app (arquivo publicado junto com o APK na
 * release "android-nativo" do GitHub). Cliente HTTP separado: o login do
 * Project Club nunca vai pra outro site.
 */
object Updater {
    private const val INFO_URL = "https://github.com/RiqueBitt/ProjectClub/releases/download/android-nativo/android-nativo.json"
    private val http = OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build()

    private val _available = MutableStateFlow<AppRelease?>(null)
    val available: StateFlow<AppRelease?> = _available

    suspend fun check() = withContext(Dispatchers.IO) {
        runCatching {
            http.newCall(Request.Builder().url(INFO_URL).header("Cache-Control", "no-cache").build()).execute().use { r ->
                if (!r.isSuccessful) return@use
                val info = AppJson.decodeFromString<AppRelease>(r.body?.string().orEmpty())
                if (info.versionCode > BuildConfig.VERSION_CODE && info.url.startsWith("https://")) _available.value = info
            }
        }
    }

    fun dismiss() { _available.value = null }
}
