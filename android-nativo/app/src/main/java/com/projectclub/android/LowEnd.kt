package com.projectclub.android

import android.app.ActivityManager
import android.content.Context

/**
 * Celular "fraco" (pouca memória, ex.: 1–2 GB de RAM): o app economiza —
 * cache de imagens menor e menos animação. Calculado uma vez só.
 */
object LowEnd {
    @Volatile private var cached: Boolean? = null

    fun isLowEnd(context: Context): Boolean = cached ?: run {
        val am = context.applicationContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        val info = ActivityManager.MemoryInfo().also { runCatching { am?.getMemoryInfo(it) } }
        // isLowRamDevice: o próprio Android marca aparelhos de pouca RAM.
        // memoryClass <= 128 MB por app e menos de ~2,5 GB no total pegam os de 1–2 GB.
        val low = am == null || am.isLowRamDevice || am.memoryClass <= 128 ||
            (info.totalMem in 1..2_600_000_000L)
        cached = low
        low
    }
}
