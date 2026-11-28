package com.projectclub.android.gamehub.clips

import android.app.RecoverableSecurityException
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentSender
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.media.ThumbnailUtils
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import android.util.Size
import androidx.core.content.FileProvider
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.io.File

/** Clipe salvo neste celular. */
data class LocalClip(val uri: Uri, val name: String, val durationMs: Long, val size: Long, val dateMs: Long, val file: File? = null)

/**
 * Onde os clipes do celular ficam: na Galeria, em Filmes/Project Club Clipes
 * (Android 10+), ou na pasta do app nos mais antigos. Nada vai pro servidor —
 * pra mostrar no clube, a pessoa manda pro YouTube e cola o link.
 */
object ClipStore {
    const val FOLDER = "Project Club Clipes"
    private val RELATIVE = "${Environment.DIRECTORY_MOVIES}/$FOLDER/"

    /** Muda quando um clipe é salvo ou apagado (a tela recarrega a lista). */
    private val _version = MutableStateFlow(0)
    val version: StateFlow<Int> = _version
    fun changed() { _version.value = _version.value + 1 }

    private fun legacyDir(ctx: Context) = File(ctx.getExternalFilesDir(Environment.DIRECTORY_MOVIES), FOLDER).apply { mkdirs() }

    /** Arquivo novo pra gravar; [commit] publica, [abort] apaga. */
    class Target internal constructor(
        val uri: Uri,
        val name: String,
        val pfd: ParcelFileDescriptor?,
        val file: File?,
    ) {
        fun commit(ctx: Context) {
            runCatching { pfd?.close() }
            if (Build.VERSION.SDK_INT >= 29 && file == null) {
                val v = ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }
                runCatching { ctx.contentResolver.update(uri, v, null, null) }
            }
            ClipStore.changed()
        }

        fun abort(ctx: Context) {
            runCatching { pfd?.close() }
            if (file != null) file.delete() else runCatching { ctx.contentResolver.delete(uri, null, null) }
        }
    }

    fun create(ctx: Context, name: String): Target {
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, name)
                put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                put(MediaStore.Video.Media.RELATIVE_PATH, RELATIVE)
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
            val uri = ctx.contentResolver.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values)
                ?: error("Não deu pra criar o arquivo do clipe.")
            val pfd = ctx.contentResolver.openFileDescriptor(uri, "rw")
                ?: run { ctx.contentResolver.delete(uri, null, null); error("Não deu pra abrir o arquivo do clipe.") }
            return Target(uri, name, pfd, null)
        }
        val f = File(legacyDir(ctx), name)
        return Target(Uri.fromFile(f), name, null, f)
    }

    fun list(ctx: Context): List<LocalClip> {
        if (Build.VERSION.SDK_INT >= 29) {
            val out = ArrayList<LocalClip>()
            val cols = arrayOf(
                MediaStore.Video.Media._ID, MediaStore.Video.Media.DISPLAY_NAME, MediaStore.Video.Media.DURATION,
                MediaStore.Video.Media.SIZE, MediaStore.Video.Media.DATE_ADDED,
            )
            val base = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            runCatching {
                ctx.contentResolver.query(
                    base, cols, "${MediaStore.Video.Media.RELATIVE_PATH} LIKE ? AND ${MediaStore.Video.Media.IS_PENDING} = 0",
                    arrayOf("$RELATIVE%"), "${MediaStore.Video.Media.DATE_ADDED} DESC",
                )?.use { c ->
                    while (c.moveToNext()) {
                        val uri = ContentUris.withAppendedId(base, c.getLong(0))
                        var dur = c.getLong(2)
                        if (dur <= 0) dur = durationOf(ctx, uri)
                        out += LocalClip(uri, c.getString(1) ?: "Clipe", dur, c.getLong(3), c.getLong(4) * 1000)
                    }
                }
            }
            return out
        }
        return legacyDir(ctx).listFiles { f -> f.isFile && f.name.endsWith(".mp4") && f.length() > 0 }.orEmpty()
            .sortedByDescending { it.lastModified() }
            .map { f -> LocalClip(Uri.fromFile(f), f.name, durationOf(ctx, Uri.fromFile(f)), f.length(), f.lastModified(), f) }
    }

    private fun durationOf(ctx: Context, uri: Uri): Long = runCatching {
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(ctx, uri)
            r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
        } finally { runCatching { r.release() } }
    }.getOrDefault(0L)

    @Suppress("DEPRECATION")
    fun thumbnail(ctx: Context, clip: LocalClip): Bitmap? = runCatching {
        if (Build.VERSION.SDK_INT >= 29 && clip.file == null) ctx.contentResolver.loadThumbnail(clip.uri, Size(480, 270), null)
        else clip.file?.let { ThumbnailUtils.createVideoThumbnail(it.path, MediaStore.Video.Thumbnails.MINI_KIND) }
    }.getOrNull()

    /** Endereço pra outros apps (compartilhar): content:// sempre. */
    fun shareUri(ctx: Context, clip: LocalClip): Uri =
        clip.file?.let { FileProvider.getUriForFile(ctx, "${ctx.packageName}.updates", it) } ?: clip.uri

    fun shareIntent(ctx: Context, clip: LocalClip): Intent {
        val send = Intent(Intent.ACTION_SEND).setType("video/mp4")
            .putExtra(Intent.EXTRA_STREAM, shareUri(ctx, clip))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return Intent.createChooser(send, "Compartilhar clipe")
    }

    /**
     * Apaga. Volta null se apagou; um IntentSender quando o Android pede
     * confirmação (clipe gravado antes de reinstalar o app).
     */
    fun delete(ctx: Context, clip: LocalClip): IntentSender? {
        if (clip.file != null) { clip.file.delete(); changed(); return null }
        return try {
            ctx.contentResolver.delete(clip.uri, null, null)
            changed()
            null
        } catch (e: SecurityException) {
            when {
                Build.VERSION.SDK_INT >= 30 -> MediaStore.createDeleteRequest(ctx.contentResolver, listOf(clip.uri)).intentSender
                Build.VERSION.SDK_INT >= 29 && e is RecoverableSecurityException -> e.userAction.actionIntent.intentSender
                else -> throw e
            }
        }
    }
}
