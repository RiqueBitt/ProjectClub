package com.projectclub.android.data.offline

import android.content.Context
import coil.disk.DiskCache

/**
 * Cache de imagens em disco (fotos de perfil, anexos, figurinhas) — UM só,
 * usado pelos dois ImageLoaders do app (o padrão e o que anima GIF).
 * Com teto de tamanho: o Coil apaga as mais antigas sozinho.
 */
object ImageCaches {
    const val MAX_BYTES = 40L * 1024 * 1024

    @Volatile private var disk: DiskCache? = null

    fun disk(context: Context): DiskCache = disk ?: synchronized(this) {
        disk ?: DiskCache.Builder()
            .directory(context.applicationContext.cacheDir.resolve("image_cache"))
            .maxSizeBytes(MAX_BYTES)
            .build()
            .also { disk = it }
    }
}
