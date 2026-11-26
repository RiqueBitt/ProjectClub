package com.projectclub.android.gamehub

import com.projectclub.android.data.ModdableGame
import java.text.NumberFormat
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * Regras puras do Game Hub (sem Android), testadas em GameHubLogicTest:
 * preços, horários, contagens, casar os apps instalados com a lista de jogos
 * que aceitam mods, nomes de arquivo e o corte do replay de 30 s.
 */
object HubLogic {
    private val BR = Locale("pt", "BR")

    /** "R$ 74,97", "US$ 12,49", "Grátis" (0). */
    fun money(value: Double?, currency: String): String {
        if (value == null) return ""
        if (value <= 0.0) return "Grátis"
        val nf = NumberFormat.getNumberInstance(BR).apply { minimumFractionDigits = 2; maximumFractionDigits = 2 }
        val sym = when (currency.uppercase()) { "BRL" -> "R$"; "USD" -> "US$"; "EUR" -> "€"; else -> currency.uppercase() }
        return "$sym ${nf.format(value)}"
    }

    /** "98,7 mil", "1,2 mi", "350". */
    fun count(n: Long): String {
        val nf = NumberFormat.getNumberInstance(BR).apply { maximumFractionDigits = 1 }
        return when {
            n >= 1_000_000 -> "${nf.format(n / 1_000_000.0)} mi"
            n >= 1_000 -> "${nf.format(n / 1_000.0)} mil"
            else -> n.toString()
        }
    }

    /** "2,4 MB", "830 KB". */
    fun size(bytes: Long): String {
        val nf = NumberFormat.getNumberInstance(BR).apply { maximumFractionDigits = 1 }
        return when {
            bytes >= 1L shl 30 -> "${nf.format(bytes / (1L shl 30).toDouble())} GB"
            bytes >= 1L shl 20 -> "${nf.format(bytes / (1L shl 20).toDouble())} MB"
            bytes >= 1024 -> "${bytes / 1024} KB"
            else -> "$bytes B"
        }
    }

    /** Tempo de jogo: "42 min", "3,5 h", "120 h". */
    fun hours(seconds: Long): String = when {
        seconds < 60 -> "menos de 1 min"
        seconds < 3600 -> "${seconds / 60} min"
        else -> {
            val h = seconds / 3600.0
            if (h < 10) String.format(BR, "%.1f h", h) else "${h.toLong()} h"
        }
    }

    fun instant(iso: String?): Instant? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }

    private val HOUR = DateTimeFormatter.ofPattern("HH:mm", BR)
    private val DAY = DateTimeFormatter.ofPattern("EEE, d MMM", BR)
    private val SHORT_DAY = DateTimeFormatter.ofPattern("d MMM", BR)

    /** Quando a partida começa: "Agora", "Hoje às 21:00", "Amanhã às 20:30", "sáb., 30 nov. às 19:00". */
    fun whenLabel(startsAt: String?, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val t = instant(startsAt) ?: return "Agora"
        if (!t.isAfter(now.plusSeconds(60))) return "Agora"
        val z = t.atZone(zone)
        val today = now.atZone(zone).toLocalDate()
        val day = when (z.toLocalDate()) {
            today -> "Hoje"
            today.plusDays(1) -> "Amanhã"
            else -> DAY.format(z)
        }
        return "$day às ${HOUR.format(z)}"
    }

    /** Fim de uma promoção: "acaba hoje", "acaba amanhã", "acaba em 3 dias", "até 30 nov.". */
    fun untilLabel(endsAt: String?, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val t = instant(endsAt) ?: return ""
        if (!t.isAfter(now)) return "acabou"
        val days = ChronoUnit.DAYS.between(now.atZone(zone).toLocalDate(), t.atZone(zone).toLocalDate())
        return when {
            days <= 0L -> "acaba hoje"
            days == 1L -> "acaba amanhã"
            days < 7L -> "acaba em $days dias"
            else -> "até ${SHORT_DAY.format(t.atZone(zone))}"
        }
    }

    /** Começo de um grátis que vem aí: "a partir de 3 dez.". */
    fun fromLabel(startsAt: String?, zone: ZoneId = ZoneId.systemDefault()): String =
        instant(startsAt)?.let { "a partir de ${SHORT_DAY.format(it.atZone(zone))}" } ?: ""

    /** "agora", "há 5 min", "há 3 h", "há 2 dias", "há 4 sem.". */
    fun ago(iso: String?, now: Instant = Instant.now()): String {
        val t = instant(iso) ?: return ""
        val s = Duration.between(t, now).seconds.coerceAtLeast(0)
        return when {
            s < 60 -> "agora"
            s < 3600 -> "há ${s / 60} min"
            s < 86_400 -> "há ${s / 3600} h"
            s < 7 * 86_400 -> "há ${s / 86_400} ${if (s / 86_400 == 1L) "dia" else "dias"}"
            else -> "há ${s / (7 * 86_400)} sem."
        }
    }

    fun steamCover(appId: Long?): String? = appId?.takeIf { it > 0 }?.let { "https://cdn.cloudflare.steamstatic.com/steam/apps/$it/header.jpg" }

    // ---------- Jogos instalados ----------

    /** O que o app vê de cada aplicativo instalado. */
    data class InstalledApp(val packageName: String, val label: String, val isGame: Boolean)

    /** Jogo achado no celular; [mod] = null quando não conhecemos um jeito de pôr mods. */
    data class DetectedGame(val app: InstalledApp, val mod: ModdableGame?, val loaderInstalled: Boolean = false) {
        val moddable: Boolean get() = mod != null
    }

    private fun supportRank(s: String?): Int = when (s) { "install" -> 0; "loader" -> 1; "ingame" -> 2; else -> 3 }

    /**
     * Casa os apps instalados com a lista do servidor. Volta primeiro os que
     * aceitam mods (os que o Project Club instala sozinho na frente), depois
     * os outros jogos em ordem alfabética. Apps que não são jogo só entram se
     * estiverem na lista (ex.: o launcher do Minecraft Java).
     */
    fun matchInstalled(apps: List<InstalledApp>, curated: List<ModdableGame>, ownPackage: String = ""): List<DetectedGame> {
        val byPkg = apps.filter { it.packageName != ownPackage }.associateBy { it.packageName }
        val used = HashSet<String>()
        val found = ArrayList<DetectedGame>()
        for (g in curated) {
            val app = g.packages.firstNotNullOfOrNull { byPkg[it] } ?: continue
            if (!used.add(app.packageName)) continue
            found += DetectedGame(app, g, loaderInstalled = g.loaderPackages.any { it in byPkg })
        }
        // O próprio carregador (ex.: Geode) não aparece como jogo separado.
        val loaders = curated.flatMap { it.loaderPackages }.toSet()
        val others = byPkg.values
            .filter { it.isGame && it.packageName !in used && it.packageName !in loaders }
            .sortedBy { it.label.lowercase(BR) }
            .map { DetectedGame(it, null) }
        return found.sortedWith(compareBy({ supportRank(it.mod?.support) }, { (it.mod?.name ?: it.app.label).lowercase(BR) })) + others
    }

    // ---------- Addons do Bedrock ----------

    private val BEDROCK_EXT = listOf(".mcpack", ".mcaddon", ".mcworld", ".mctemplate")

    fun isBedrockFile(name: String?): Boolean = name?.lowercase(Locale.ROOT)?.let { n -> BEDROCK_EXT.any { n.endsWith(it) } } == true

    /** Nome seguro pra salvar no cache (sem barras nem caracteres estranhos), mantendo a extensão. */
    fun safeFileName(raw: String?, fallback: String = "addon.mcpack"): String {
        val base = raw.orEmpty().substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("[^A-Za-z0-9._ ()\\-]"), "_").trim().trimStart('.')
        return base.take(120).ifBlank { fallback }
    }

    // ---------- Clipes ----------

    private val CLIP_STAMP = DateTimeFormatter.ofPattern("yyyy-MM-dd HH-mm-ss", Locale.ROOT)

    /** "Clipe 2026-11-26 21-03-05.mp4". */
    fun clipFileName(at: Instant, zone: ZoneId = ZoneId.systemDefault()): String = "Clipe ${CLIP_STAMP.format(at.atZone(zone))}.mp4"

    /** "0:07", "1:32", "12:05". */
    fun duration(ms: Long): String {
        val s = (ms / 1000).coerceAtLeast(0)
        return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
    }

    /**
     * Replay: de onde começar pra ficar com no máximo [windowUs] de vídeo
     * terminando no último quadro. Sempre num quadro-chave (senão o vídeo
     * abre cinza). [times] em ordem; [keys] diz quais são quadros-chave.
     * Sem quadro-chave dentro da janela, usa o último antes dela.
     */
    fun replayStart(times: LongArray, keys: BooleanArray, windowUs: Long): Int {
        if (times.isEmpty()) return -1
        val from = times.last() - windowUs
        var best = -1
        for (i in times.indices) {
            if (!keys[i]) continue
            if (times[i] >= from) return i
            best = i
        }
        return best
    }
}
