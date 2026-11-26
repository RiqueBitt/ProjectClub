package com.projectclub.android.gamehub

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Log
import androidx.core.content.FileProvider
import androidx.core.graphics.drawable.toBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Jogos instalados no celular (só os que aparecem na tela inicial: o
 * manifesto pede a visibilidade pelo filtro MAIN/LAUNCHER, sem
 * QUERY_ALL_PACKAGES) e abrir um jogo.
 */
object InstalledGames {
    @Suppress("DEPRECATION")
    fun scan(ctx: Context): List<HubLogic.InstalledApp> {
        val pm = ctx.packageManager
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val list = runCatching {
            if (Build.VERSION.SDK_INT >= 33) pm.queryIntentActivities(launcher, PackageManager.ResolveInfoFlags.of(0))
            else pm.queryIntentActivities(launcher, 0)
        }.getOrElse { emptyList() }
        return list.mapNotNull { ri ->
            val ai = ri.activityInfo?.applicationInfo ?: return@mapNotNull null
            val isGame = ai.category == ApplicationInfo.CATEGORY_GAME ||
                (ai.flags and ApplicationInfo.FLAG_IS_GAME) != 0
            HubLogic.InstalledApp(ai.packageName, runCatching { ai.loadLabel(pm).toString() }.getOrDefault(ai.packageName), isGame)
        }.distinctBy { it.packageName }
    }

    fun icon(ctx: Context, pkg: String, sizePx: Int): Bitmap? =
        runCatching { ctx.packageManager.getApplicationIcon(pkg).toBitmap(sizePx, sizePx) }.getOrNull()

    fun isInstalled(ctx: Context, pkg: String): Boolean =
        ctx.packageManager.getLaunchIntentForPackage(pkg) != null

    /** Abre o jogo; false = não está instalado (ou não abre). */
    fun launch(ctx: Context, pkg: String): Boolean {
        val i = ctx.packageManager.getLaunchIntentForPackage(pkg) ?: return false
        return runCatching { ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true }.getOrDefault(false)
    }

    /** Página do app na loja (Play Store; sem ela, o site). */
    fun openStore(ctx: Context, pkg: String) {
        val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { ctx.startActivity(market) } catch (_: ActivityNotFoundException) {
            runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }
}

/**
 * Addons do Minecraft Bedrock: baixa do CDN da CurseForge pro cache do app e
 * entrega o arquivo ao Minecraft (que importa sozinho .mcpack, .mcaddon,
 * .mcworld e .mctemplate). Também copia um arquivo escolhido no celular.
 */
object BedrockInstaller {
    const val MINECRAFT = "com.mojang.minecraftpe"
    private const val MAX_BYTES = 600L * 1024 * 1024
    private val http by lazy {
        OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).followRedirects(true).build()
    }

    private fun dir(ctx: Context) = File(ctx.cacheDir, "addons").apply { mkdirs() }

    /** Baixa [url] como [fileName]; [progress] recebe 0..1 (ou -1 sem tamanho conhecido). */
    suspend fun download(ctx: Context, url: String, fileName: String, progress: (Float) -> Unit): File = withContext(Dispatchers.IO) {
        val host = Uri.parse(url).host.orEmpty()
        if (!url.startsWith("https://") || !(host.endsWith("forgecdn.net") || host.endsWith("curseforge.com"))) throw IOException("Link de download inválido.")
        cleanOld(ctx)
        val out = File(dir(ctx), HubLogic.safeFileName(fileName))
        val tmp = File(out.path + ".part")
        val req = Request.Builder().url(url).header("User-Agent", "ProjectClub-Android").build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw IOException("O download falhou (erro ${res.code}).")
            val body = res.body ?: throw IOException("O download veio vazio.")
            val total = body.contentLength()
            if (total > MAX_BYTES) throw IOException("Arquivo grande demais (${HubLogic.size(total)}).")
            var read = 0L
            body.byteStream().use { input ->
                tmp.outputStream().use { os ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        read += n
                        if (read > MAX_BYTES) throw IOException("Arquivo grande demais.")
                        os.write(buf, 0, n)
                        progress(if (total > 0) read.toFloat() / total else -1f)
                    }
                }
            }
        }
        if (out.exists()) out.delete()
        if (!tmp.renameTo(out)) throw IOException("Não deu pra salvar o arquivo.")
        out
    }

    /** Copia um arquivo escolhido (seletor do Android) pro cache, mantendo o nome. */
    suspend fun importLocal(ctx: Context, uri: Uri): File = withContext(Dispatchers.IO) {
        val name = ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
        if (!HubLogic.isBedrockFile(name)) throw IOException("Escolha um arquivo .mcpack, .mcaddon, .mcworld ou .mctemplate.")
        cleanOld(ctx)
        val out = File(dir(ctx), HubLogic.safeFileName(name))
        var copied = 0L
        (ctx.contentResolver.openInputStream(uri) ?: throw IOException("Não deu pra abrir o arquivo.")).use { input ->
            out.outputStream().use { os ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    copied += n
                    if (copied > MAX_BYTES) { out.delete(); throw IOException("Arquivo grande demais.") }
                    os.write(buf, 0, n)
                }
            }
        }
        out
    }

    /**
     * Entrega o arquivo ao Minecraft. Tenta direto no app do jogo (com alguns
     * tipos que ele aceita); se não der, abre o "Abrir com" do Android.
     * Volta false se nenhum app abriu.
     */
    fun openInMinecraft(ctx: Context, file: File): Boolean {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.updates", file)
        val types = listOf("application/octet-stream", "application/zip", "*/*")
        for (type in types) {
            val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).setPackage(MINECRAFT)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            try { ctx.startActivity(i); return true } catch (_: ActivityNotFoundException) { } catch (e: SecurityException) { Log.w("PCGameHub", "Minecraft recusou", e) }
        }
        val any = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/octet-stream")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return runCatching {
            ctx.startActivity(Intent.createChooser(any, "Abrir com").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true
        }.getOrDefault(false)
    }

    /** Apaga downloads com mais de 1 dia (o Minecraft já copiou pra dentro dele). */
    private fun cleanOld(ctx: Context) {
        val limit = System.currentTimeMillis() - 24 * 3600_000L
        dir(ctx).listFiles()?.forEach { if (it.lastModified() < limit) it.delete() }
    }
}
