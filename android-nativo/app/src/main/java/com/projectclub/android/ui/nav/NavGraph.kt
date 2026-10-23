package com.projectclub.android.ui.nav

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.core.tween
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.projectclub.android.Config
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Room
import com.projectclub.android.ui.announcements.AnnouncementsScreen
import com.projectclub.android.ui.clubs.ClubScreen
import com.projectclub.android.ui.clubs.ClubsScreen
import com.projectclub.android.ui.economy.EconomyScreen
import com.projectclub.android.ui.events.EventScreen
import com.projectclub.android.ui.events.EventsScreen
import com.projectclub.android.ui.forum.ForumCommunityScreen
import com.projectclub.android.ui.forum.ForumScreen
import com.projectclub.android.ui.forum.NewPostScreen
import com.projectclub.android.ui.forum.PostScreen
import com.projectclub.android.ui.gallery.GalleryScreen
import com.projectclub.android.ui.profile.EditProfileScreen
import com.projectclub.android.ui.profile.ProfileScreen
import com.projectclub.android.ui.progress.ProgressScreen
import com.projectclub.android.ui.store.StoreScreen
import com.projectclub.android.ui.tickets.TicketScreen
import com.projectclub.android.ui.tickets.TicketsScreen
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** Liga a interface [AppNav] ao NavController (rotas das telas nativas). */
class AppNavigator(
    private val context: Context,
    private val nav: NavHostController,
    private val repo: Repository,
    private val scope: CoroutineScope,
    private val onJoinVoice: (String, String) -> Unit,
    private val onHome: (tab: Int) -> Unit,
    private val onMiniProfile: (String) -> Unit = {},
) : AppNav {
    private fun go(route: String) = nav.navigate(route) { launchSingleTop = true }
    private fun enc(s: String) = Uri.encode(s)

    override fun back() { if (!nav.popBackStack()) onHome(0) }
    override fun room(room: Room) = go(if (room.isDm) "chat/dm/${room.conversationId}" else "chat/channel/${room.channelId}")
    override fun dmWith(userId: String) {
        scope.launch {
            try { room(Room(conversationId = repo.openDm(userId).id)) }
            catch (e: Exception) { Toast.makeText(context, e.message ?: "Não deu pra abrir a conversa.", Toast.LENGTH_SHORT).show() }
        }
    }
    override fun joinVoice(channelName: String, title: String) = onJoinVoice(channelName, title)
    override fun profile(userId: String) = onMiniProfile(userId)
    override fun fullProfile(userId: String) = go("profile/${enc(userId)}")
    override fun editProfile() = go("profile-edit")
    override fun store(tab: String?) = go("store?tab=${enc(tab ?: "")}")
    override fun economy() = go("economy")
    override fun progress(tab: String?) = go("progress?tab=${enc(tab ?: "")}")
    override fun forum() = go("forum")
    override fun forumCommunity(slug: String) = go("forum/c/${enc(slug)}")
    override fun post(postId: String) = go("post/${enc(postId)}")
    override fun newPost(communitySlug: String?) = go("post-new?slug=${enc(communitySlug ?: "")}")
    override fun events() = go("events")
    override fun event(eventId: String) = go("event/${enc(eventId)}")
    override fun announcements() = go("announcements")
    override fun inbox(tab: Int) = go("inbox?tab=$tab")
    override fun clubs() = go("clubs")
    override fun club(clubId: String) = go("club/${enc(clubId)}")
    override fun tickets() = go("tickets")
    override fun ticket(ticketId: String) = go("ticket/${enc(ticketId)}")
    override fun gallery() = go("gallery")
    override fun settings() = go("settings")
    override fun activity() = go("activity")
    override fun search() = go("search")
    override fun games(userId: String) = go("games/$userId")
    override fun trades() = go("trades")

    // ---- links bonitos (/canal/<nome>, /dm/<@>, /perfil/<@>, /evento/<nome>, /forum/<nome>) ----
    // O ref pode ser o nome do link OU o id antigo. Primeiro procura no que
    // já está carregado; senão pergunta ao servidor (mesma regra de acesso
    // dos ids); sem resposta, tenta o próprio ref como id (comportamento antigo).
    private val uuidRe = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

    private fun resolveThen(path: String, ref: String, open: (String) -> Unit) {
        if (uuidRe.matches(ref)) { open(ref); return }
        scope.launch { open(repo.resolveLink(path)?.id ?: ref) }
    }

    private fun openChannelId(id: String) {
        // Canal de voz (ex.: aviso "Evento começou! Entrar na call"): entra na call.
        val ch = repo.channel(id)
        if (ch?.isVoice == true) onJoinVoice(id, ch.name) else room(Room(channelId = id))
    }

    private fun openChannelRef(ref: String) {
        val local = repo.channelByRef(ref)
        if (local != null) { openChannelId(local.id); return }
        resolveThen("/canal/" + enc(ref), ref) { openChannelId(it) }
    }

    private fun openConversationRef(ref: String) {
        val local = repo.conversationByRef(ref)
        if (local != null) { room(Room(conversationId = local.id)); return }
        scope.launch {
            val link = repo.resolveLink("/dm/" + enc(ref))
            val convId = link?.id
            val otherId = link?.userId
            if (convId != null) room(Room(conversationId = convId))
            else if (otherId != null) dmWith(otherId) // ainda não tinham conversa: abre uma DM nova
            else room(Room(conversationId = ref))
        }
    }

    private fun openUserRef(ref: String, then: (String) -> Unit) {
        val local = repo.memberByRef(ref)
        if (local != null) { then(local.id); return }
        resolveThen("/perfil/" + enc(ref), ref, then)
    }

    override fun link(pathOrUrl: String) {
        val raw = pathOrUrl.trim()
        if (raw.isEmpty()) return
        val base = Uri.parse(Config.baseUrl)
        val uri = Uri.parse(if (raw.startsWith("/")) Config.baseUrl + raw else raw)
        if (uri.scheme?.startsWith("http") == true && !uri.host.equals(base.host, ignoreCase = true)) { external(raw); return }
        val seg = uri.pathSegments.orEmpty()
        val tab = uri.getQueryParameter("tab")
        when (seg.firstOrNull()) {
            null, "inicio" -> onHome(0)
            "canal", "channels" -> seg.getOrNull(1)?.let { openChannelRef(it) } ?: onHome(1)
            "dm", "conversations" -> seg.getOrNull(1)?.let { openConversationRef(it) } ?: onHome(2)
            "dms", "amigos" -> onHome(2)
            "notifications" -> onHome(3)
            "loja" -> if (tab == "trocas") trades() else store(tab)
            "economia", "missoes" -> economy()
            "progresso" -> progress(tab)
            "rank" -> progress("ranks")
            "conquistas" -> progress("conquistas")
            "forum", "posts" -> seg.getOrNull(1)?.let { ref -> resolveThen("/forum/" + enc(ref), ref) { post(it) } } ?: forum()
            "comunidades" -> seg.getOrNull(1)?.let(::forumCommunity) ?: forum()
            "comunidade" -> when (seg.getOrNull(1)) { "galeria" -> gallery(); else -> events() }
            "evento", "eventos" -> seg.getOrNull(1)?.let { ref -> resolveThen("/evento/" + enc(ref), ref) { event(it) } } ?: events()
            "anuncios" -> announcements()
            "inbox", "caixa-de-entrada" -> inbox(if (tab == "favoritos") 1 else 0)
            "clans" -> clubs()
            "tickets" -> tickets()
            "atividade" -> activity()
            "search" -> search()
            "jogos" -> if (seg.getOrNull(1) == "biblioteca") {
                val ref = seg.getOrNull(2)
                if (ref == null) games("me") else openUserRef(ref) { games(it) }
            } else external(uri.toString())
            "profile" -> repo.me.value?.id?.let(::fullProfile) ?: onHome(4)
            "perfil", "u" -> seg.getOrNull(1)?.let { ref -> openUserRef(ref) { fullProfile(it) } }
            else -> external(uri.toString())
        }
    }

    override fun external(url: String) {
        val full = if (url.startsWith("/")) Config.baseUrl + url else url
        val colors = CustomTabColorSchemeParams.Builder().setToolbarColor(0xFF000000.toInt()).build()
        try {
            CustomTabsIntent.Builder().setDefaultColorSchemeParams(colors).setShowTitle(true).build()
                .launchUrl(context, Uri.parse(full))
        } catch (_: Exception) {
            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(full)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }
}

private const val ANIM = 260

/** Rotas das telas nativas (o resto — home, chat, voz — fica no MainActivity). */
fun NavGraphBuilder.featureScreens(repo: Repository, nav: AppNav) {
    fun NavGraphBuilder.screen(route: String, args: List<String> = emptyList(), content: @androidx.compose.runtime.Composable (android.os.Bundle?) -> Unit) =
        composable(
            route,
            arguments = args.map { a -> navArgument(a) { type = NavType.StringType; nullable = true; defaultValue = null } },
            enterTransition = { slideInHorizontally(tween(ANIM)) { it / 6 } + fadeIn(tween(ANIM)) },
            exitTransition = { fadeOut(tween(ANIM / 2)) },
            popEnterTransition = { fadeIn(tween(ANIM)) },
            popExitTransition = { slideOutHorizontally(tween(ANIM)) { it / 6 } + fadeOut(tween(ANIM)) },
        ) { e -> content(e.arguments) }

    screen("profile/{id}", listOf("id")) { ProfileScreen(repo, nav, it?.getString("id").orEmpty()) }
    screen("profile-edit") { EditProfileScreen(repo, nav) }
    screen("store?tab={tab}", listOf("tab")) { StoreScreen(repo, nav, it?.getString("tab")?.ifBlank { null }) }
    screen("economy") { EconomyScreen(repo, nav) }
    screen("progress?tab={tab}", listOf("tab")) { ProgressScreen(repo, nav, it?.getString("tab")?.ifBlank { null }) }
    screen("forum") { ForumScreen(repo, nav) }
    screen("forum/c/{slug}", listOf("slug")) { ForumCommunityScreen(repo, nav, it?.getString("slug").orEmpty()) }
    screen("post/{id}", listOf("id")) { PostScreen(repo, nav, it?.getString("id").orEmpty()) }
    screen("post-new?slug={slug}", listOf("slug")) { NewPostScreen(repo, nav, it?.getString("slug")?.ifBlank { null }) }
    screen("events") { EventsScreen(repo, nav) }
    screen("event/{id}", listOf("id")) { EventScreen(repo, nav, it?.getString("id").orEmpty()) }
    screen("announcements") { AnnouncementsScreen(repo, nav) }
    screen("inbox?tab={tab}", listOf("tab")) { com.projectclub.android.ui.inbox.InboxScreen(repo, nav, it?.getString("tab")?.toIntOrNull() ?: 0) }
    screen("clubs") { ClubsScreen(repo, nav) }
    screen("club/{id}", listOf("id")) { ClubScreen(repo, nav, it?.getString("id").orEmpty()) }
    screen("tickets") { TicketsScreen(repo, nav) }
    screen("ticket/{id}", listOf("id")) { TicketScreen(repo, nav, it?.getString("id").orEmpty()) }
    screen("gallery") { GalleryScreen(repo, nav) }
    screen("settings") { com.projectclub.android.ui.settings.SettingsScreen(repo, nav) }
    screen("activity") { com.projectclub.android.ui.activity.ActivityScreen(repo, nav) }
    screen("search") { com.projectclub.android.ui.activity.SearchScreen(repo, nav) }
    screen("trades") { com.projectclub.android.ui.store.TradesScreen(repo, nav) }
    screen("games/{id}", listOf("id")) { com.projectclub.android.ui.activity.GamesScreen(repo, nav, it?.getString("id").orEmpty()) }
}
