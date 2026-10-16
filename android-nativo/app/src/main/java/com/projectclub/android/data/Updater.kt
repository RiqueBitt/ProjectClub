package com.projectclub.android.data

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.projectclub.android.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

@Serializable
data class AppRelease(
    val versionCode: Int = 0,
    val versionName: String = "",
    val url: String = "",
    val sha256: String? = null,
    val size: Long? = null,
)

/** Estado da atualização (pro aviso da tela Início). */
sealed interface UpdateState {
    data object None : UpdateState
    data class Downloading(val release: AppRelease, val percent: Int?) : UpdateState
    /** Baixada. [needsPermission] = falta liberar "instalar apps desconhecidos" pro Project Club. */
    data class Ready(val release: AppRelease, val needsPermission: Boolean) : UpdateState
    data class Installing(val release: AppRelease) : UpdateState
    data class Failed(val release: AppRelease, val message: String) : UpdateState
}

/**
 * Atualização automática do app, sem navegador e sem abrir .apk na mão:
 *  1. Confere a versão publicada (android-nativo.json na release do GitHub).
 *  2. Baixa o .apk novo sozinho, em segundo plano, dentro do app (confere o SHA-256).
 *  3. Instala pelo PackageInstaller do próprio Android:
 *     - Android 12+: atualização silenciosa (USER_ACTION_NOT_REQUIRED) quando
 *       você sai do app (nunca no meio de uma chamada). Na próxima vez que abrir,
 *       já está na versão nova.
 *     - Android 8–11: o sistema mostra só o "Atualizar?" dele, dentro do app.
 *  Na primeira vez o Android pede pra liberar "instalar apps desconhecidos" pro
 *  Project Club — proteção do sistema, não dá pra pular (depois nunca mais).
 *  Cliente HTTP separado: o login do Project Club nunca vai pra outro site.
 */
object Updater {
    private const val INFO_URL = "https://github.com/RiqueBitt/ProjectClub/releases/download/android-nativo/android-nativo.json"
    private const val ACTION_RESULT = "com.projectclub.android.UPDATE_RESULT"
    private val http = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
    private val lock = Mutex()

    private lateinit var app: Context
    private val _state = MutableStateFlow<UpdateState>(UpdateState.None)
    val state: StateFlow<UpdateState> = _state
    private var lastCheck = 0L
    private val _dismissed = MutableStateFlow(false)
    /** "Agora não" no aviso (só esconde o aviso; a instalação ao sair continua). */
    val dismissed: StateFlow<Boolean> = _dismissed

    fun init(context: Context) { app = context.applicationContext }

    private fun dir() = File(app.cacheDir, "updates").apply { mkdirs() }
    private fun apkFile(r: AppRelease) = File(dir(), "ProjectClub-${r.versionCode}.apk")

    fun canInstall(): Boolean = Build.VERSION.SDK_INT < 26 || app.packageManager.canRequestPackageInstalls()

    /** Confere e já baixa. [force] ignora o intervalo mínimo (botão "procurar"). */
    suspend fun check(force: Boolean = false) = withContext(Dispatchers.IO) {
        if (!force && System.currentTimeMillis() - lastCheck < 30 * 60_000L) return@withContext
        lock.withLock {
            lastCheck = System.currentTimeMillis()
            // Limpa .apk de versões velhas (já instaladas).
            dir().listFiles()?.forEach { f ->
                val code = f.name.removePrefix("ProjectClub-").removeSuffix(".apk").removeSuffix(".part").toIntOrNull()
                if (code == null || code <= BuildConfig.VERSION_CODE) f.delete()
            }
            val info = runCatching {
                http.newCall(Request.Builder().url(INFO_URL).header("Cache-Control", "no-cache").build()).execute().use { r ->
                    if (!r.isSuccessful) null else AppJson.decodeFromString<AppRelease>(r.body?.string().orEmpty())
                }
            }.getOrNull() ?: return@withLock
            if (info.versionCode <= BuildConfig.VERSION_CODE || !info.url.startsWith("https://")) { _state.value = UpdateState.None; return@withLock }
            val cur = _state.value
            if (cur is UpdateState.Installing) return@withLock
            if (cur is UpdateState.Ready && cur.release.versionCode >= info.versionCode) { _state.value = cur.copy(needsPermission = !canInstall()); return@withLock }
            download(info)
        }
    }

    private fun download(r: AppRelease) {
        val out = apkFile(r)
        if (out.exists() && verify(out, r)) { ready(r); return }
        val part = File(out.path + ".part")
        _state.value = UpdateState.Downloading(r, null)
        try {
            http.newCall(Request.Builder().url(r.url).build()).execute().use { resp ->
                if (!resp.isSuccessful) error("HTTP ${resp.code}")
                val body = resp.body ?: error("resposta vazia")
                val total = body.contentLength().takeIf { it > 0 } ?: r.size ?: -1L
                var got = 0L; var lastPct = -1
                body.byteStream().use { input ->
                    part.outputStream().use { o ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf); if (n < 0) break
                            o.write(buf, 0, n); got += n
                            val pct = if (total > 0) (got * 100 / total).toInt().coerceIn(0, 100) else null
                            if (pct != lastPct) { lastPct = pct ?: -1; _state.value = UpdateState.Downloading(r, pct) }
                        }
                    }
                }
            }
            if (!verify(part, r)) { part.delete(); error("arquivo baixado não confere") }
            part.renameTo(out)
            ready(r)
        } catch (e: Exception) {
            // Falha de rede/arquivo ainda sendo publicado: em silêncio, tenta
            // de novo na próxima vez que abrir o app (daqui a 30 min no mínimo).
            part.delete()
            _state.value = UpdateState.None
        }
    }

    private fun verify(f: File, r: AppRelease): Boolean {
        if (f.length() == 0L) return false
        val want = r.sha256?.lowercase()?.takeIf { it.length == 64 } ?: return true
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { i -> val b = ByteArray(64 * 1024); while (true) { val n = i.read(b); if (n < 0) break; md.update(b, 0, n) } }
        return md.digest().joinToString("") { "%02x".format(it) } == want
    }

    private fun ready(r: AppRelease) { _state.value = UpdateState.Ready(r, needsPermission = !canInstall()) }

    /** Dá pra instalar sozinho, sem nenhuma pergunta (Android 12+ com permissão liberada)? */
    fun canInstallSilently() = Build.VERSION.SDK_INT >= 31 && canInstall()

    /**
     * Instala o .apk baixado. [userAsked] = a pessoa tocou em "Instalar agora"
     * (aí pode abrir a confirmação do sistema; em segundo plano não abre nada).
     */
    fun install(userAsked: Boolean) {
        val st = _state.value as? UpdateState.Ready ?: return
        val r = st.release
        if (!canInstall()) {
            _state.value = st.copy(needsPermission = true)
            if (userAsked) openPermissionSettings()
            return
        }
        val file = apkFile(r)
        if (!file.exists()) { _state.value = UpdateState.None; lastCheck = 0; return }
        _state.value = UpdateState.Installing(r)
        try {
            val pi = app.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(app.packageName)
                setSize(file.length())
                if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
            val id = pi.createSession(params)
            pi.openSession(id).use { s ->
                s.openWrite("base.apk", 0, file.length()).use { o -> file.inputStream().use { it.copyTo(o) }; s.fsync(o) }
                val intent = Intent(app, UpdateResultReceiver::class.java).setAction(ACTION_RESULT).putExtra("userAsked", userAsked)
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                s.commit(PendingIntent.getBroadcast(app, id, intent, flags).intentSender)
            }
        } catch (e: Exception) {
            _state.value = UpdateState.Failed(r, e.message ?: "falha ao instalar")
        }
    }

    fun openPermissionSettings() {
        if (Build.VERSION.SDK_INT < 26) return
        runCatching {
            app.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${app.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    /** Voltou das configurações: talvez já tenha liberado. */
    fun refreshPermission() {
        val st = _state.value
        if (st is UpdateState.Ready) _state.value = st.copy(needsPermission = !canInstall())
    }

    fun retry() { lastCheck = 0 }

    fun dismiss() { _dismissed.value = true }

    internal fun onResult(intent: Intent) {
        val st = _state.value
        val r = (st as? UpdateState.Installing)?.release ?: (st as? UpdateState.Ready)?.release ?: return
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // O sistema quer confirmação. Só abre se a pessoa pediu; senão
                // fica "pronta" e o aviso da tela Início mostra "Instalar agora".
                val confirm: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
                if (intent.getBooleanExtra("userAsked", false) && confirm != null) {
                    runCatching { app.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                }
                _state.value = UpdateState.Ready(r, needsPermission = false)
            }
            PackageInstaller.STATUS_SUCCESS -> _state.value = UpdateState.None
            PackageInstaller.STATUS_FAILURE_ABORTED -> _state.value = UpdateState.Ready(r, needsPermission = !canInstall())
            else -> {
                val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "o Android recusou a instalação"
                // Arquivo ruim/conflito: apaga pra baixar de novo na próxima.
                apkFile(r).delete()
                _state.value = UpdateState.Failed(r, msg)
            }
        }
    }
}

class UpdateResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Updater.init(context)
        Updater.onResult(intent)
    }
}
