package com.projectclub.android.ui.economy

import com.projectclub.android.ui.common.PcArt
import com.projectclub.android.ui.common.ArtIcon
import android.widget.Toast
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Leaderboard
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.LocalMall
import androidx.compose.material.icons.outlined.MonetizationOn
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.EcoDailyResult
import com.projectclub.android.data.EcoHistory
import com.projectclub.android.data.EcoMission
import com.projectclub.android.data.EcoMissionClaim
import com.projectclub.android.data.EcoMissionList
import com.projectclub.android.data.EcoWallet
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.Bone
import com.projectclub.android.ui.common.Chip
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.IconTile
import com.projectclub.android.ui.common.PcCard
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.common.formatTime
import com.projectclub.android.ui.common.rememberShimmer
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.store.BalancePill
import com.projectclub.android.ui.store.CoinColor
import com.projectclub.android.ui.store.CurrencyAmount
import com.projectclub.android.ui.store.GemColor
import com.projectclub.android.ui.store.fmtNum
import com.projectclub.android.ui.store.rememberAnimatedImageLoader
import com.projectclub.android.ui.store.untilText
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/** Economia: saldo, baú diário, missões e extrato. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun EconomyScreen(repo: Repository, nav: AppNav) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var wallet by remember { mutableStateOf<EcoWallet?>(null) }
    var chests by remember { mutableStateOf<List<com.projectclub.android.data.EcoChest>>(emptyList()) }
    var missions by remember { mutableStateOf<EcoMissionList?>(null) }
    var history by remember { mutableStateOf<EcoHistory?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var claiming by remember { mutableStateOf(false) }
    var lastChest by remember { mutableStateOf<EcoDailyResult?>(null) }
    var claimingMission by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableStateOf(0L) }
    var season by remember { mutableStateOf<com.projectclub.android.data.SeasonInfo?>(null) }
    var seasonBusy by remember { mutableStateOf<String?>(null) }
    val me by repo.me.collectAsState()

    suspend fun load() {
        try {
            coroutineScope {
                val w = async { repo.api.get<EcoWallet>("/api/economy") }
                val m = async { runCatching { repo.api.get<EcoMissionList>("/api/missions") }.getOrNull() }
                val h = async { runCatching { repo.api.get<EcoHistory>("/api/economy/history?limit=30") }.getOrNull() }
                val s = async { runCatching { repo.api.get<com.projectclub.android.data.SeasonInfo>("/api/missions/season") }.getOrNull() }
                val ch = async { runCatching { repo.api.get<com.projectclub.android.data.EcoChestList>("/api/economy/chests") }.getOrNull() }
                wallet = w.await(); missions = m.await() ?: missions; history = h.await() ?: history; season = s.await() ?: season
                ch.await()?.let { list -> chests = list.chests.filter { it.imageClosed != null } }
            }
            error = null
        } catch (e: Exception) { if (wallet == null) error = e.message ?: "Não deu pra abrir a Economia." }
    }
    LaunchedEffect(Unit) { load() }
    // Atualiza a contagem do próximo baú.
    LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(30_000); tick = System.currentTimeMillis() } }

    fun toast(t: String) = Toast.makeText(ctx, t, Toast.LENGTH_SHORT).show()

    fun claimDaily() = scope.launch {
        claiming = true
        try {
            val r = repo.api.post<EcoDailyResult>("/api/economy/daily")
            lastChest = r
            toast(buildString {
                append("+${fmtNum(r.coins)} moedas")
                if (r.megaAwarded) append(" e +${fmtNum(r.megaGems)} gemas (baú mega!)")
            })
            load()
        } catch (e: Exception) { toast(e.message ?: "Não deu pra abrir o baú.") }
        claiming = false
    }

    fun claimMission(m: EcoMission) = scope.launch {
        claimingMission = m.id
        try {
            val r = repo.api.post<EcoMissionClaim>("/api/missions/${m.id}/claim")
            val rw = r.reward
            toast(listOfNotNull(
                rw?.coins?.takeIf { it > 0 }?.let { "+${fmtNum(it)} moedas" },
                rw?.gems?.takeIf { it > 0 }?.let { "+${fmtNum(it)} gemas" },
                rw?.xp?.takeIf { it > 0 }?.let { "+${fmtNum(it)} XP" },
            ).joinToString(" · ").ifBlank { "Recompensa resgatada!" } + if (r.levelUp?.levelUp == true) " · Subiu para o nível ${r.levelUp.newLevel}!" else "")
            load()
        } catch (e: Exception) { toast(e.message ?: "Não deu pra resgatar.") }
        claimingMission = null
    }

    var styleBusy by remember { mutableStateOf<String?>(null) }
    fun setStyle(style: String) = scope.launch {
        styleBusy = style
        try {
            repo.api.put<kotlinx.serialization.json.JsonElement>("/api/economy/card-style", kotlinx.serialization.json.buildJsonObject { put("style", kotlinx.serialization.json.JsonPrimitive(style)) })
            wallet = wallet?.copy(cardStyle = style)
            toast("Estilo do cartão atualizado.")
        } catch (e: Exception) { toast(e.message ?: "Não foi possível trocar o estilo.") }
        styleBusy = null
    }

    fun claimSeason(level: Int, track: String) = scope.launch {
        seasonBusy = "$level:$track"
        try {
            val r = repo.api.post<kotlinx.serialization.json.JsonObject>("/api/missions/season/claim", kotlinx.serialization.json.buildJsonObject {
                put("level", kotlinx.serialization.json.JsonPrimitive(level)); put("track", kotlinx.serialization.json.JsonPrimitive(track))
            })
            val rw = r["reward"] as? kotlinx.serialization.json.JsonObject
            val c = (rw?.get("coins") as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull() ?: 0
            val g = (rw?.get("gems") as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull() ?: 0
            toast(listOfNotNull(c.takeIf { it > 0 }?.let { "+${fmtNum(it)} moedas" }, g.takeIf { it > 0 }?.let { "+${fmtNum(it)} gemas" }).joinToString(" · ").ifBlank { "Resgatado!" })
            load()
        } catch (e: Exception) { toast(e.message ?: "Não deu pra resgatar.") }
        seasonBusy = null
    }

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar("Economia", PcArt.Coin, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } })
        val w = wallet
        when {
            w == null && error != null -> EmptyState(Icons.Outlined.CloudOff, "Economia indisponível", error ?: "", Modifier.padding(top = 40.dp)) {
                GhostButton("Tentar de novo", { scope.launch { error = null; load() } })
            }
            w == null -> EcoSkeleton()
            else -> PullToRefreshBox(refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    item(key = "wallet") { FlipWalletCard(w, me) }
                    // Igual ao site: atalho pro ranking e o estilo do cartão logo embaixo dele.
                    item(key = "card-style") { CardStylePicker(w, styleBusy) { setStyle(it) } }
                    item(key = "daily") {
                        val wait = untilText(w.nextDailyAt, maxOf(tick, System.currentTimeMillis()))
                        DailyCard(w, wait, claiming, lastChest, chests.firstOrNull()) { claimDaily() }
                    }
                    if (chests.isNotEmpty()) item(key = "chests") { ChestGallery(chests) }
                    item(key = "links") {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            PcCard(Modifier.weight(1f), onClick = { nav.store() }, padding = PaddingValues(12.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    IconTile(Icons.Outlined.LocalMall, PC.Store); Spacer(Modifier.width(10.dp))
                                    Text("Loja", style = MaterialTheme.typography.titleSmall, color = PC.Header)
                                }
                            }
                            PcCard(Modifier.weight(1f), onClick = { nav.progress("ranks") }, padding = PaddingValues(12.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    IconTile(PcArt.Ranks, PC.Brand); Spacer(Modifier.width(10.dp))
                                    Text("Ver ranking", style = MaterialTheme.typography.titleSmall, color = PC.Header)
                                }
                            }
                        }
                    }
                    season?.let { s ->
                        item(key = "season") { SeasonCard(s, seasonBusy) { lv, track -> claimSeason(lv, track) } }
                    }
                    // Missões (nov/2026): moraram aqui; agora são uma aba do Progresso.
                    item(key = "mt") {
                        PcCard(padding = PaddingValues(14.dp), onClick = { nav.progress("missoes") }) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.TaskAlt, null, tint = PC.Pink, modifier = Modifier.size(22.dp))
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text("Missões", color = PC.Header, style = MaterialTheme.typography.titleSmall)
                                    Text("Agora ficam no Progresso", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                                }
                                Text("Ver ›", color = PC.Brand, style = MaterialTheme.typography.labelLarge)
                            }
                        }
                    }
                    item(key = "ht") { Section(Icons.AutoMirrored.Outlined.ReceiptLong, "Extrato", PC.Yellow) }
                    val tx = history?.transactions.orEmpty()
                    if (tx.isEmpty()) item { Text("Nenhuma movimentação ainda.", color = PC.Muted, modifier = Modifier.padding(8.dp)) }
                    else item(key = "hist") {
                        PcCard(padding = PaddingValues(vertical = 4.dp, horizontal = 14.dp)) {
                            tx.forEachIndexed { i, t ->
                                Row(Modifier.fillMaxWidth().padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(t.label.ifBlank { t.kind }, color = PC.Header, style = MaterialTheme.typography.bodyMedium)
                                        Text(formatTime(t.createdAt), color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                                    }
                                    Column(horizontalAlignment = Alignment.End) {
                                        if (t.coins != 0) Delta(t.coins, CoinColor, "moedas")
                                        if (t.gems != 0) Delta(t.gems, GemColor, "gemas")
                                        if (t.xp != 0) Delta(t.xp, PC.Brand, "XP")
                                    }
                                }
                                if (i < tx.lastIndex) Box(Modifier.fillMaxWidth().height(1.dp).background(PC.Line))
                            }
                        }
                    }
                    item { Spacer(Modifier.navigationBarsPadding().height(8.dp)) }
                }
            }
        }
    }
}

@Composable
private fun WalletCard(w: EcoWallet) {
    val shape = RoundedCornerShape(24.dp)
    Column(
        Modifier.fillMaxWidth().clip(shape).background(Brush.linearGradient(listOf(Color(0xFF2A1F05), Color(0xFF5A3F0B), Color(0xFFB7851E))))
            .border(1.dp, Color(0x33F0B232), shape).padding(20.dp),
    ) {
        Text("Seu saldo", color = Color(0xCCFFFFFF))
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { BalancePill(false, w.coins); BalancePill(true, w.gems) }
        Spacer(Modifier.height(12.dp))
        Text("Nível ${w.accountLevel} · ${fmtNum(w.accountXp)} XP", color = Color.White, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun DailyCard(w: EcoWallet, wait: String?, claiming: Boolean, last: EcoDailyResult?, sample: com.projectclub.android.data.EcoChest?, onClaim: () -> Unit) {
    val loader = rememberAnimatedImageLoader()
    PcCard(padding = PaddingValues(16.dp), border = if (wait == null) PC.Yellow.copy(alpha = 0.5f) else PC.Line) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // o baú (igual ao site): o que abriu hoje, ou um dos baús possíveis fechado
            val img = if (wait != null) last?.chestImageOpened ?: last?.chestImageClosed ?: sample?.imageOpened ?: sample?.imageClosed
                else last?.chestImageClosed ?: sample?.imageClosed
            Box(Modifier.size(64.dp).clip(RoundedCornerShape(16.dp)).background(PC.Surface2), contentAlignment = Alignment.Center) {
                if (img != null) AsyncImage(Config.media(img), null, imageLoader = loader, contentScale = ContentScale.Fit, modifier = Modifier.size(56.dp))
                else ArtIcon(PcArt.Gift, PC.Yellow, Modifier.size(32.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text("Baú diário", style = MaterialTheme.typography.titleMedium, color = PC.Header)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.LocalFireDepartment, null, tint = Color(0xFFFF7A45), modifier = Modifier.size(16.dp))
                    Text(" Sequência ${w.dailyStreak}/${w.streakRequired} para o baú mega", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                }
                Spacer(Modifier.height(8.dp))
                StreakNodes(w.dailyStreak, w.streakRequired)
            }
        }
        Spacer(Modifier.height(12.dp))
        if (wait == null) PillButton("Resgatar baú diário", onClaim, Modifier.fillMaxWidth(), busy = claiming, color = Color(0xFFB7851E))
        else Text("Já resgatado hoje · volta em $wait", color = PC.Muted, modifier = Modifier.align(Alignment.CenterHorizontally))
    }
}

/** Uma missão (usada na aba Missões do Progresso). */
@Composable
internal fun MissionCard(m: EcoMission, busy: Boolean, onClaim: () -> Unit) {
    val ready = m.completed && !m.claimed
    PcCard(padding = PaddingValues(14.dp), border = if (ready) PC.Green.copy(alpha = 0.5f) else PC.Line) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(m.title, color = PC.Header, style = MaterialTheme.typography.titleSmall)
                m.description?.takeIf { it.isNotBlank() }?.let { Text(it, color = PC.Muted, style = MaterialTheme.typography.bodySmall) }
            }
            if (m.claimed) Icon(Icons.Outlined.CheckCircle, "Resgatada", tint = PC.Green)
        }
        Spacer(Modifier.height(10.dp))
        val frac = (m.progress.toFloat() / m.target.coerceAtLeast(1)).coerceIn(0f, 1f)
        LinearProgressIndicator(progress = { frac }, Modifier.fillMaxWidth().height(6.dp).clip(CircleShape), color = if (m.completed) PC.Green else PC.Brand, trackColor = PC.Surface3)
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${fmtNum(minOf(m.progress, m.target))}/${fmtNum(m.target)}${m.unit?.let { " $it" } ?: ""}", color = PC.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
            if (m.rewardCoins > 0) CurrencyAmount(false, m.rewardCoins, Modifier.padding(start = 8.dp), iconSize = 14.dp)
            if (m.rewardGems > 0) CurrencyAmount(true, m.rewardGems, Modifier.padding(start = 8.dp), iconSize = 14.dp)
            if (m.rewardXp > 0) Text("  +${fmtNum(m.rewardXp)} XP", color = PC.Brand, style = MaterialTheme.typography.labelMedium)
        }
        if (ready) {
            Spacer(Modifier.height(10.dp))
            PillButton("Resgatar", onClaim, Modifier.fillMaxWidth(), busy = busy, color = PC.Green)
        } else if (m.claimed) Chip("Resgatada", PC.Green, Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun Delta(v: Int, color: Color, unit: String) {
    Text((if (v > 0) "+" else "") + fmtNum(v) + " " + unit, color = if (v > 0) color else PC.Red, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
}

@Composable
private fun Section(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, color: Color) {
    Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = color, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.titleLarge, color = PC.Header)
    }
}

@Composable
private fun EcoSkeleton() {
    val b = rememberShimmer()
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Bone(b, Modifier.fillMaxWidth().height(140.dp), RoundedCornerShape(24.dp))
        Bone(b, Modifier.fillMaxWidth().height(150.dp), RoundedCornerShape(20.dp))
        repeat(4) { Bone(b, Modifier.fillMaxWidth().height(96.dp), RoundedCornerShape(20.dp)) }
    }
}


/** Temporada do mês: nível, barra de pontos e os prêmios (grátis + apoio) em fila. */
@Composable
private fun SeasonCard(s: com.projectclub.android.data.SeasonInfo, busy: String?, onClaim: (Int, String) -> Unit) {
    PcCard(padding = PaddingValues(14.dp)) {
        Text(s.name, style = MaterialTheme.typography.titleMedium, color = PC.Header)
        Spacer(Modifier.height(4.dp))
        val inLevel = if (s.level >= s.maxLevel) s.levelPoints else s.points % s.levelPoints
        Text("Nível ${s.level}/${s.maxLevel} · ${fmtNum(s.points)} pontos" + if (s.level < s.maxLevel) " · faltam ${s.levelPoints - inLevel}" else "", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(8.dp))
        Box(Modifier.fillMaxWidth().height(8.dp).clip(CircleShape).background(PC.Surface3)) {
            Box(Modifier.fillMaxWidth(inLevel / s.levelPoints.toFloat()).height(8.dp).clip(CircleShape).background(PC.Brand))
        }
        Spacer(Modifier.height(12.dp))
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            s.tiers.forEach { t ->
                Column(Modifier.width(96.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.size(28.dp).clip(CircleShape).background(if (t.unlocked) PC.Brand else PC.Surface3), contentAlignment = Alignment.Center) {
                        Text("${t.level}", color = if (t.unlocked) PC.OnBrand else PC.Muted, style = MaterialTheme.typography.labelMedium)
                    }
                    listOf("free" to t.free, "plus" to t.plus).forEach { (track, r) ->
                        val claimed = if (track == "free") t.claimedFree else t.claimedPlus
                        val locked = !t.unlocked || (track == "plus" && !s.isSupporter)
                        val bg = if (track == "plus") PC.Yellow.copy(alpha = 0.10f) else PC.Surface2
                        Column(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(bg)
                                .clickable(enabled = !locked && !claimed && busy == null) { onClaim(t.level, track) }.padding(8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            if (r.coins > 0) com.projectclub.android.ui.store.CurrencyAmount(false, r.coins, iconSize = 15.dp, color = PC.Text)
                            if (r.gems > 0) com.projectclub.android.ui.store.CurrencyAmount(true, r.gems, iconSize = 15.dp, color = PC.Purple)
                            Text(
                                when { claimed -> "✓ Resgatado"; busy == "${t.level}:$track" -> "…"; locked -> if (track == "plus" && t.unlocked) "Assinante" else "Nível ${t.level}"; else -> "Resgatar" },
                                color = when { claimed -> PC.Green; locked -> PC.Faint; else -> PC.Brand },
                                style = MaterialTheme.typography.labelSmall,
                            )
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        Text("Missão diária = 10 pontos, semanal = 40. Faixa de cima é grátis; a de baixo é de Assinante.", color = PC.Faint, style = MaterialTheme.typography.bodySmall)
    }
}


/* ---------- igual ao site: estilo do cartão e a sequência do baú ---------- */

private val CARD_STYLES = listOf(
    Triple("DEFAULT", "Clássico", null),
    Triple("GOLD", "Dourado", "Assinante"),
    Triple("RAINBOW", "Arco-íris", "Super Assinante"),
)

@Composable
private fun CardStylePicker(w: EcoWallet, busy: String?, onPick: (String) -> Unit) {
    val current = w.cardStyle ?: "DEFAULT"
    Column {
        Text("Estilo do cartão", color = PC.Muted, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(start = 4.dp, bottom = 6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CARD_STYLES.forEach { (id, label, need) ->
                val unlocked = id in w.cardStyles || id == "DEFAULT"
                val on = id == current
                val swatch = when (id) {
                    "GOLD" -> Brush.linearGradient(listOf(Color(0xFF1D1B16), Color(0xFF050504)))
                    "RAINBOW" -> Brush.sweepGradient(listOf(Color(0xFFFF5D7A), Color(0xFFFFB65C), Color(0xFF5CF7A6), Color(0xFF5CC8FF), Color(0xFF9A7BFF), Color(0xFFFF5D7A)))
                    else -> Brush.linearGradient(listOf(Color(0xFF2552CC), Color(0xFF091654)))
                }
                Column(
                    Modifier.weight(1f).clip(RoundedCornerShape(14.dp))
                        .background(if (on) PC.Surface3 else PC.Surface)
                        .border(1.5.dp, if (on) PC.Brand else PC.Line, RoundedCornerShape(14.dp))
                        .clickable(enabled = unlocked && !on && busy == null) { onPick(id) }
                        .padding(8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        Modifier.fillMaxWidth().aspectRatio(1.586f).clip(RoundedCornerShape(6.dp)).background(swatch)
                            .border(1.dp, if (id == "GOLD") Color(0x80E8C468) else Color(0x33FFFFFF), RoundedCornerShape(6.dp)),
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(label, color = if (unlocked) PC.Header else PC.Faint, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, maxLines = 1)
                    Text(
                        when { busy == id -> "Salvando…"; on -> "Em uso"; unlocked -> "Usar"; else -> need ?: "" },
                        color = when { on -> PC.Green; unlocked -> PC.Brand; else -> PC.Faint },
                        style = MaterialTheme.typography.labelSmall, maxLines = 1,
                    )
                }
            }
        }
    }
}

/** Bolinhas da sequência (igual ao site): dias feitos acesos, o último é o baú mega. */
@Composable
private fun StreakNodes(streak: Int, goal: Int) {
    val n = goal.coerceIn(1, 14)
    val done = streak.coerceIn(0, n)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        for (i in 1..n) {
            val lit = i <= done
            val mega = i == n
            Box(
                Modifier.size(if (mega) 26.dp else 20.dp).clip(CircleShape)
                    .background(if (lit) PC.Yellow else PC.Surface3)
                    .border(1.5.dp, if (lit) Color(0xFFFFE08A) else PC.Line, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                if (mega) ArtIcon(PcArt.Gift, if (lit) Color(0xFF3A2A00) else PC.Muted, Modifier.size(14.dp))
                else Text("$i", color = if (lit) Color(0xFF3A2A00) else PC.Faint, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
            }
            if (i < n) Box(Modifier.weight(1f).height(3.dp).background(if (i < done) PC.Yellow else PC.Surface3))
        }
    }
}


/** "Baús possíveis" (igual ao site): cada resgate abre um destes. */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun ChestGallery(chests: List<com.projectclub.android.data.EcoChest>) {
    val loader = rememberAnimatedImageLoader()
    PcCard(padding = PaddingValues(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Baús possíveis", style = MaterialTheme.typography.titleSmall, color = PC.Header)
            Spacer(Modifier.width(6.dp))
            Text("${chests.size}", color = PC.Faint, style = MaterialTheme.typography.labelMedium)
        }
        Text("Cada resgate abre um destes, com moedas.", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(10.dp))
        androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            chests.forEach { c ->
                Column(
                    Modifier.width(84.dp).clip(RoundedCornerShape(14.dp)).background(PC.Surface2).padding(8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    AsyncImage(Config.media(c.imageClosed), c.name, imageLoader = loader, contentScale = ContentScale.Fit, modifier = Modifier.size(60.dp))
                    Spacer(Modifier.height(4.dp))
                    Text(c.name, color = PC.Text, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                }
            }
        }
    }
}
