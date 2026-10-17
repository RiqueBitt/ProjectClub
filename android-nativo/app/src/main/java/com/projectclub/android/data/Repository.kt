package com.projectclub.android.data

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.projectclub.android.net.Api
import com.projectclub.android.net.ApiException
import com.projectclub.android.net.RefreshResult
import com.projectclub.android.net.isCancellation
import com.projectclub.android.net.isTransientServer
import com.projectclub.android.realtime.RtEvent
import com.projectclub.android.realtime.Realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import okio.source
import java.net.URLEncoder
import java.util.UUID

sealed interface SessionState {
    data object Loading : SessionState
    data class LoggedOut(val message: String? = null) : SessionState
    data object LoggedIn : SessionState
}

sealed interface LoginResult {
    data object Ok : LoginResult
    data object NeedsTwoFactor : LoginResult
    data class Error(val message: String) : LoginResult
}

/** Sala de conversa: um canal da comunidade ou uma conversa privada (DM/grupo). */
data class Room(val channelId: String? = null, val conversationId: String? = null) {
    val id: String get() = channelId ?: conversationId ?: ""
    val isDm: Boolean get() = conversationId != null
    fun query(): String = if (channelId != null) "channelId=$channelId" else "conversationId=$conversationId"
}

/** Arquivo escolhido pra anexar. */
data class PickedFile(val uri: Uri, val name: String, val mime: String, val size: Long)

/**
 * Estado central do app: sessão, comunidade, conversas, presença, avisos e
 * calls em andamento — tudo atualizado pelo tempo real.
 */
class Repository(private val context: Context, val api: Api, private val scope: CoroutineScope) {
    val realtime = Realtime(api, scope)

    private val _session = MutableStateFlow<SessionState>(SessionState.Loading)
    val session: StateFlow<SessionState> = _session

    private val _me = MutableStateFlow<User?>(null)
    val me: StateFlow<User?> = _me

    private val _community = MutableStateFlow<CommunityResponse?>(null)
    val community: StateFlow<CommunityResponse?> = _community

    private val _channelStates = MutableStateFlow<Map<String, ChannelState>>(emptyMap())
    val channelStates: StateFlow<Map<String, ChannelState>> = _channelStates

    private val _conversations = MutableStateFlow<List<Conversation>>(emptyList())
    val conversations: StateFlow<List<Conversation>> = _conversations

    private val _friends = MutableStateFlow<List<Friendship>>(emptyList())
    val friends: StateFlow<List<Friendship>> = _friends

    private val _presence = MutableStateFlow<Map<String, String>>(emptyMap())
    val presence: StateFlow<Map<String, String>> = _presence
    /** Quem está online só pelo celular (a bolinha vira um celular). */
    private val _mobileUsers = MutableStateFlow<Set<String>>(emptySet())
    val mobileUsers: StateFlow<Set<String>> = _mobileUsers

    private val _notices = MutableStateFlow<List<Notice>>(emptyList())
    val notices: StateFlow<List<Notice>> = _notices
    private val _unreadNotices = MutableStateFlow(0)
    val unreadNotices: StateFlow<Int> = _unreadNotices

    /** Quem está em cada canal de voz (channelId → participantes). */
    private val _voiceRosters = MutableStateFlow<Map<String, List<VoiceParticipant>>>(emptyMap())
    val voiceRosters: StateFlow<Map<String, List<VoiceParticipant>>> = _voiceRosters

    /** Sala aberta na tela agora (não notifica mensagens dela). */
    val openRoom = MutableStateFlow<String?>(null)

    /** Eventos que as telas usam (mensagens novas etc.) + avisos pra notificação. */
    /** A primeira carga depois do login terminou (antes disso as telas mostram esqueletos). */
    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded

    private val _alerts = MutableSharedFlow<Alert>(extraBufferCapacity = 64)
    val alerts: SharedFlow<Alert> = _alerts

    private val users = HashMap<String, User>()

    init {
        api.onSessionLost = {
            scope.launch { endLocalSession("Sua sessão terminou. Entre de novo.") }
        }
        api.onRefreshed = { auth -> auth.user?.let { u -> _me.value = u; remember(u) } }
        scope.launch { realtime.events.collect { handle(it) } }
        scope.launch {
            realtime.connected.collect { up -> if (up && _session.value == SessionState.LoggedIn) refreshLight() }
        }
    }

    /** Últimas mensagens de cada conversa/canal aberto: reabrir mostra na hora (sem carregamento). */
    val messageCache = java.util.concurrent.ConcurrentHashMap<String, List<Message>>()

    fun user(id: String?): User? = id?.let { synchronized(users) { users[it] } }

    private fun remember(u: User) = synchronized(users) {
        val old = users[u.id]
        users[u.id] = if (old == null) u else old.copy(
            displayName = u.displayName ?: old.displayName, username = u.username ?: old.username,
            avatarUrl = u.avatarUrl ?: old.avatarUrl, avatarDecoration = u.avatarDecoration ?: old.avatarDecoration,
            status = u.status ?: old.status, profileColor = u.profileColor ?: old.profileColor,
        )
    }

    // ---------------- sessão ----------------

    /** Abertura do app: renova a sessão com o cookie salvo (tenta de novo em erro de rede). */
    suspend fun restore() {
        if (api.cookies.find("refreshToken") == null && api.cookies.find("pcKeep") == null) {
            _session.value = SessionState.LoggedOut(); return
        }
        var attempt = 0
        while (true) {
            when (val r = api.refresh()) {
                is RefreshResult.Ok -> { r.auth.user?.let { _me.value = it; remember(it) }; startSession(); return }
                RefreshResult.Rejected -> { _session.value = SessionState.LoggedOut(); return }
                RefreshResult.Transient -> {
                    attempt++
                    delay(minOf(10_000L, attempt * 1500L))
                }
            }
        }
    }

    suspend fun login(identifier: String, password: String, twoFactorCode: String?): LoginResult = try {
        val body = buildJsonObject {
            put("emailOrUsername", identifier.trim())
            put("password", password)
            if (!twoFactorCode.isNullOrBlank()) {
                val clean = twoFactorCode.trim()
                if (clean.contains('-') || clean.length > 6) put("recoveryCode", clean) else put("twoFactorCode", clean)
            }
        }
        val res: AuthResponse = api.post("/api/auth/login", body)
        when {
            res.requiresTwoFactor -> LoginResult.NeedsTwoFactor
            res.accessToken.isNullOrBlank() -> LoginResult.Error("Resposta inesperada do servidor.")
            else -> {
                api.setSession(res.accessToken)
                res.user?.let { _me.value = it; remember(it) }
                startSession()
                LoginResult.Ok
            }
        }
    } catch (e: ApiException) {
        LoginResult.Error(e.message ?: "Não deu certo.")
    } catch (e: Exception) {
        LoginResult.Error("Sem conexão com o Project Club. Verifique sua internet.")
    }

    /**
     * Começa a sessão. O carregamento roda no escopo do PRÓPRIO app (não no
     * da tela que chamou): antes ele rodava no escopo da tela de login, que
     * sai da composição assim que entra — e o carregamento era cancelado no
     * meio (a aba Comunidade ficava vazia depois do login).
     */
    private fun startSession() {
        _session.value = SessionState.LoggedIn
        realtime.connect()
        scope.launch { loadAll() }
        _alerts.tryEmit(Alert.SessionStarted)
    }

    /** Roda antes de sair (ex.: parar as notificações push deste aparelho). */
    @Volatile var beforeLogout: (suspend () -> Unit)? = null

    suspend fun logout() {
        runCatching { beforeLogout?.invoke() }
        runCatching { api.postIgnore("/api/auth/logout") }
        endLocalSession(null)
    }

    private fun endLocalSession(message: String?) {
        messageCache.clear()
        _loaded.value = false
        realtime.disconnect()
        api.setSession(null)
        api.cookies.clear()
        _me.value = null
        _community.value = null
        _conversations.value = emptyList()
        _channelStates.value = emptyMap()
        _notices.value = emptyList()
        _voiceRosters.value = emptyMap()
        _session.value = SessionState.LoggedOut(message)
    }

    // ---------------- carregamento ----------------

    suspend fun loadAll() {
        try {
            val boot: Bootstrap = api.get("/api/bootstrap?only=community,conversations,friends,channelStates,usableEmojis,stickers,favoriteGifs")
            boot.data["community"]?.let { el -> runCatching { setCommunity(decodeCommunity(el)) }.onFailure { report("community", it) } }
            boot.data["conversations"]?.let { el -> runCatching { setConversations(AppJson.decodeFromJsonElement<ConversationsResponse>(el).conversations) }.onFailure { report("conversations", it) } }
            boot.data["friends"]?.let { el -> runCatching { setFriends(AppJson.decodeFromJsonElement<FriendsResponse>(el).friendships) }.onFailure { report("friends", it) } }
            boot.data["channelStates"]?.let { el -> runCatching { _channelStates.value = AppJson.decodeFromJsonElement<ChannelStatesResponse>(el).states }.onFailure { report("channelStates", it) } }
            boot.data["usableEmojis"]?.let { el -> runCatching { _emojis.value = AppJson.decodeFromJsonElement<EmojisResponse>(el).emojis } }
            boot.data["stickers"]?.let { el -> runCatching { _stickers.value = AppJson.decodeFromJsonElement<StickersResponse>(el).stickers } }
            boot.data["favoriteGifs"]?.let { el -> runCatching { _favoriteGifs.value = AppJson.decodeFromJsonElement<FavoriteGifsResponse>(el).gifs } }
            if (_community.value == null) runCatching { loadCommunity() }.onFailure { report("community-get", it) }
            if (boot.failed.containsKey("conversations")) runCatching { loadConversations() }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            report("bootstrap", e) // (report ignora cancelamento e 502/503/504)
            runCatching { loadCommunity() }.onFailure { report("community-get", it) }
            runCatching { loadConversations() }
        }
        runCatching { loadNotices() }
        _loaded.value = true
        // Servidor atualizando (deploy, ~1 min): tenta de novo sozinho, com
        // espera crescente, sem mensagem assustadora nem recarregar tudo em loop.
        if (_community.value == null) scheduleReload()
    }

    @Volatile private var reloadJob: kotlinx.coroutines.Job? = null

    private fun scheduleReload() {
        if (reloadJob?.isActive == true) return
        reloadJob = scope.launch {
            for (wait in longArrayOf(4_000, 8_000, 15_000, 30_000, 30_000, 60_000)) {
                delay(wait)
                if (_session.value != SessionState.LoggedIn || _community.value != null) return@launch
                val ok = runCatching { loadCommunity() }.onFailure { if (!it.isTransientServer()) report("community-retry", it) }.isSuccess
                if (ok) { runCatching { loadConversations() }; return@launch }
            }
        }
    }

    /** Erro ao carregar a comunidade (a tela mostra e deixa tentar de novo). */
    private val _communityError = MutableStateFlow<String?>(null)
    val communityError: StateFlow<String?> = _communityError

    private val _emojis = MutableStateFlow<List<CustomEmoji>>(emptyList())
    val emojis: StateFlow<List<CustomEmoji>> = _emojis
    private val _stickers = MutableStateFlow<List<ServerSticker>>(emptyList())
    val stickers: StateFlow<List<ServerSticker>> = _stickers
    private val _favoriteGifs = MutableStateFlow<List<FavoriteGif>>(emptyList())
    val favoriteGifs: StateFlow<List<FavoriteGif>> = _favoriteGifs

    suspend fun loadPickers() {
        runCatching { _emojis.value = api.get<EmojisResponse>("/api/users/me/usable-emojis").emojis }
        runCatching { _stickers.value = api.get<StickersResponse>("/api/community/stickers").stickers }
        runCatching { _favoriteGifs.value = api.get<FavoriteGifsResponse>("/api/users/me/favorite-gifs").gifs }
    }

    /**
     * Lê a comunidade item por item: um canal/membro com formato inesperado
     * não derruba a lista inteira (antes, um único campo diferente deixava a
     * aba Comunidade vazia para sempre).
     */
    private fun decodeCommunity(el: JsonElement): CommunityResponse {
        val o = el.jsonObject
        fun <T> items(arr: JsonElement?, what: String, decode: (JsonElement) -> T): List<T> =
            (arr as? JsonArray).orEmpty().mapNotNull { item -> runCatching { decode(item) }.onFailure { report("community.$what", it) }.getOrNull() }
        val channel = { e: JsonElement -> AppJson.decodeFromJsonElement<Channel>(e) }
        val categories = items(o["categories"], "category") { e ->
            val obj = e.jsonObject
            val base = AppJson.decodeFromJsonElement<Category>(JsonObject(obj - "channels"))
            base.copy(channels = items(obj["channels"], "channel", channel))
        }
        return CommunityResponse(
            community = o["community"]?.let { runCatching { AppJson.decodeFromJsonElement<CommunityInfo>(it) }.getOrNull() },
            categories = categories,
            channels = items(o["channels"], "channel", channel),
            members = items(o["members"], "member") { AppJson.decodeFromJsonElement<Member>(it) },
        )
    }

    private val reported = java.util.Collections.synchronizedSet(HashSet<String>())

    /** Manda o motivo exato de uma falha para o servidor (aparece nos logs da equipe). */
    fun report(where: String, e: Throwable) {
        // Cancelamento (tela fechou, escopo saiu da composição) não é erro.
        if (e.isCancellation()) return
        val msg = (e.message ?: e.javaClass.simpleName).take(400)
        _communityError.value = if (where.startsWith("community")) msg else _communityError.value
        // 502/503/504 = site sendo atualizado: a tela mostra o aviso calmo e o
        // app tenta de novo sozinho; não vai pros logs como erro.
        if (e.isTransientServer()) return
        if (!reported.add(where + msg.take(60))) return
        scope.launch {
            runCatching {
                api.postIgnore("/api/system/client-error", buildJsonObject {
                    put("where", "android-nativo:$where")
                    put("path", "/app")
                    put("message", msg)
                    put("stack", e.stackTraceToString().take(1500))
                    put("version", com.projectclub.android.BuildConfig.VERSION_NAME)
                })
            }
        }
    }

    /** Depois de reconectar: só o que pode ter mudado. */
    private suspend fun refreshLight() {
        // Voltou depois de uma queda/deploy e a comunidade nunca carregou: carrega agora.
        if (_community.value == null) runCatching { loadCommunity() }.onFailure { report("community-get", it) }
        runCatching { loadConversations() }
        runCatching { _channelStates.value = api.get<ChannelStatesResponse>("/api/community/channels/read-states").states }
    }

    suspend fun loadCommunity() {
        val el: JsonElement = api.get("/api/community")
        setCommunity(decodeCommunity(el))
        _communityError.value = null
    }
    suspend fun loadConversations() = setConversations(api.get<ConversationsResponse>("/api/conversations").conversations)
    suspend fun loadFriends() = setFriends(api.get<FriendsResponse>("/api/friends").friendships)
    suspend fun loadNotices() {
        val n: NoticesResponse = api.get("/api/notices")
        _notices.value = n.notices
        _unreadNotices.value = n.unread
    }

    /** Depois de editar o perfil: atualiza o "eu" na hora (sem esperar o socket). */
    fun updateMe(u: User) { remember(u); _me.value = u }

    /** Só pros testes de tela (capturas do visual): preenche o app com dados de exemplo. */
    @androidx.annotation.VisibleForTesting
    fun seedForScreenshots(
        me: User, community: CommunityResponse, conversations: List<Conversation>, friends: List<Friendship>,
        notices: List<Notice>, presence: Map<String, String>, rosters: Map<String, List<VoiceParticipant>> = emptyMap(),
        states: Map<String, ChannelState> = emptyMap(),
    ) {
        remember(me); _me.value = me
        setCommunity(community); setConversations(conversations); setFriends(friends)
        _notices.value = notices; _unreadNotices.value = notices.count { it.readAt == null }
        _presence.value = presence; _voiceRosters.value = rosters; _channelStates.value = states
        _session.value = SessionState.LoggedIn
        _loaded.value = true
    }

    private fun setCommunity(c: CommunityResponse) {
        c.members.forEach { remember(it.user) }
        _community.value = c
    }

    private fun setConversations(list: List<Conversation>) {
        list.forEach { conv -> conv.members.forEach(::remember) }
        _conversations.value = sortConversations(list)
    }

    private fun setFriends(list: List<Friendship>) {
        list.forEach { remember(it.user) }
        _friends.value = list
    }

    fun channel(id: String): Channel? {
        val c = _community.value ?: return null
        return (c.channels + c.categories.flatMap { it.channels }).firstOrNull { it.id == id }
    }

    fun conversation(id: String): Conversation? = _conversations.value.firstOrNull { it.id == id }

    fun conversationTitle(conv: Conversation): String {
        if (!conv.name.isNullOrBlank()) return conv.name
        val myId = _me.value?.id
        val others = conv.members.filter { it.id != myId }
        return others.joinToString(", ") { it.name }.ifBlank { "Conversa" }
    }

    fun isUnread(conv: Conversation): Boolean = ChatLogic.isConversationUnread(conv, _me.value?.id)
    fun isUnread(channelId: String): Boolean = ChatLogic.isChannelUnread(_channelStates.value[channelId])

    // ---------------- mensagens ----------------

    suspend fun messages(room: Room, before: Message? = null): List<Message> {
        val q = StringBuilder("/api/messages?").append(room.query())
        if (before != null) q.append("&before=").append(enc(before.createdAt)).append("&beforeId=").append(before.id)
        val list = api.get<MessagesResponse>(q.toString()).messages
        list.forEach { m -> m.author?.let(::remember) }
        return list
    }

    suspend fun send(room: Room, content: String, replyToId: String?, files: List<PickedFile>, nonce: String = UUID.randomUUID().toString()): Message {
        val mb = MultipartBody.Builder().setType(MultipartBody.FORM)
        if (room.channelId != null) mb.addFormDataPart("channelId", room.channelId) else mb.addFormDataPart("conversationId", room.conversationId!!)
        if (content.isNotBlank()) mb.addFormDataPart("content", content)
        replyToId?.let { mb.addFormDataPart("replyToId", it) }
        mb.addFormDataPart("nonce", nonce)
        if (files.isNotEmpty()) {
            mb.addFormDataPart("spoilerFlags", buildJsonArray { files.forEach { _ -> add(JsonPrimitive(false)) } }.toString())
            files.forEach { f -> mb.addFormDataPart("attachments", f.name, uriBody(f)) }
        }
        val text = api.postBody("/api/messages?${room.query()}", mb.build())
        return AppJson.decodeFromString(MessageResponse.serializer(), text).message
    }

    /** Figurinha: vai como mensagem própria (campo stickerUrl, igual ao site). */
    suspend fun sendSticker(room: Room, stickerUrl: String, nonce: String = UUID.randomUUID().toString()): Message {
        val mb = MultipartBody.Builder().setType(MultipartBody.FORM)
        if (room.channelId != null) mb.addFormDataPart("channelId", room.channelId) else mb.addFormDataPart("conversationId", room.conversationId!!)
        mb.addFormDataPart("stickerUrl", stickerUrl)
        mb.addFormDataPart("nonce", nonce)
        val text = api.postBody("/api/messages?${room.query()}", mb.build())
        return AppJson.decodeFromString(MessageResponse.serializer(), text).message
    }

    suspend fun edit(messageId: String, content: String): Message =
        api.patch<MessageResponse>("/api/messages/$messageId", buildJsonObject { put("content", content) }).message

    suspend fun deleteMessage(messageId: String) = api.delete("/api/messages/$messageId")

    suspend fun react(messageId: String, emoji: String): Message =
        api.post<MessageResponse>("/api/messages/$messageId/react", buildJsonObject { put("emoji", emoji) }).message

    suspend fun markRead(room: Room) {
        runCatching {
            if (room.channelId != null) api.postIgnore("/api/community/channels/${room.channelId}/read")
            else api.postIgnore("/api/conversations/${room.conversationId}/read")
        }
        val now = java.time.Instant.now().toString()
        if (room.channelId != null) {
            _channelStates.update { it + (room.channelId to (it[room.channelId] ?: ChannelState()).copy(myReadAt = now, unreadMentions = 0)) }
        } else {
            _conversations.update { list -> list.map { if (it.id == room.conversationId) it.copy(lastReadAt = now) else it } }
        }
    }

    /** Abre (ou cria) a conversa privada com alguém. */
    suspend fun openDm(userId: String): Conversation {
        val res: ConversationResponse = api.post("/api/conversations", buildJsonObject {
            put("userIds", buildJsonArray { add(JsonPrimitive(userId)) })
        })
        val conv = res.conversation
        conv.members.forEach(::remember)
        realtime.joinConversation(conv.id)
        _conversations.update { list -> if (list.any { it.id == conv.id }) list else sortConversations(list + conv) }
        return conv
    }

    suspend fun markNoticeRead(id: String) {
        runCatching { api.postIgnore("/api/notices/$id/read") }
        _notices.update { l -> l.map { if (it.id == id && it.readAt == null) it.copy(readAt = java.time.Instant.now().toString()) else it } }
        _unreadNotices.value = _notices.value.count { it.readAt == null }
    }

    suspend fun markAllNoticesRead() {
        runCatching { api.postIgnore("/api/notices/read-all") }
        val now = java.time.Instant.now().toString()
        _notices.update { l -> l.map { if (it.readAt == null) it.copy(readAt = now) else it } }
        _unreadNotices.value = 0
    }

    suspend fun registerPushToken(token: String) {
        runCatching { api.postIgnore("/api/push/register", buildJsonObject { put("token", token); put("platform", "android") }) }
    }

    suspend fun unregisterPushToken(token: String) {
        runCatching { api.postIgnore("/api/push/unregister", buildJsonObject { put("token", token) }) }
    }

    /**
     * Pede ao servidor as credenciais da call. O app só usa o servidor de
     * mídia PRÓPRIO ([clientReady] = projectclub); se ele não estiver
     * disponível, o servidor responde com a reserva da web (Jitsi).
     */
    suspend fun voiceJoin(channelName: String, clientReady: List<String> = listOf("projectclub")): VoiceJoinResponse =
        api.get("/api/voice/join?channelName=${enc(channelName)}&clientReady=${enc(clientReady.joinToString(","))}")

    // ---------------- tempo real ----------------

    private fun handle(e: RtEvent) {
        val d = e.data
        when (e.name) {
            "message:new" -> decode<Message>(d)?.let { onNewMessage(it) }
            "conversation:new" -> d?.jsonObject?.get("conversation")?.let { decode<Conversation>(it) }?.let { conv ->
                conv.members.forEach(::remember)
                realtime.joinConversation(conv.id)
                _conversations.update { list ->
                    val existing = list.firstOrNull { it.id == conv.id }
                    val merged = existing?.copy(name = conv.name, icon = conv.icon, members = conv.members, isGroup = conv.isGroup) ?: conv
                    sortConversations(list.filter { it.id != conv.id } + merged)
                }
            }
            "conversation:left" -> str(d, "conversationId")?.let { id -> _conversations.update { l -> l.filter { it.id != id } } }
            "presence:sync" -> {
                val arr = (d as? JsonArray) ?: d?.jsonObject?.get("list") as? JsonArray
                arr?.let { list ->
                    val objs = list.mapNotNull { it as? JsonObject }
                    _presence.value = objs.mapNotNull { o -> str(o, "userId")?.let { id -> id to (str(o, "status") ?: "ONLINE") } }.toMap()
                    _mobileUsers.value = objs.filter { o -> (o["mobile"] as? kotlinx.serialization.json.JsonPrimitive)?.content == "true" }
                        .mapNotNull { str(it, "userId") }.toSet()
                }
            }
            "presence:update" -> {
                val id = str(d, "userId") ?: return
                val status = str(d, "status") ?: "OFFLINE"
                _presence.update { if (status == "OFFLINE") it - id else it + (id to status) }
                val mobile = ((d as? JsonObject)?.get("mobile") as? kotlinx.serialization.json.JsonPrimitive)?.content == "true"
                _mobileUsers.update { if (mobile && status != "OFFLINE") it + id else it - id }
            }
            "presence:reset" -> { _presence.value = emptyMap(); _mobileUsers.value = emptySet() }
            "user:update" -> decode<User>(d)?.let { u ->
                remember(u)
                if (u.id == _me.value?.id) _me.value = _me.value?.copy(displayName = u.displayName, avatarUrl = u.avatarUrl, status = u.status)
            }
            "notice:new" -> decode<Notice>(d)?.let { n ->
                _notices.update { listOf(n) + it.filter { x -> x.id != n.id } }
                _unreadNotices.value = _unreadNotices.value + 1
                _alerts.tryEmit(Alert.NoticeArrived(n))
            }
            "mention:new" -> {
                val channelId = str(d, "channelId") ?: return
                _channelStates.update { it + (channelId to (it[channelId] ?: ChannelState()).let { s -> s.copy(unreadMentions = s.unreadMentions + 1, lastMessageAt = str(d, "createdAt") ?: s.lastMessageAt) }) }
                if (openRoom.value != channelId) {
                    _alerts.tryEmit(Alert.Mention(channelId, str(d, "channelName").orEmpty(), str(d, "authorName").orEmpty(), str(d, "preview").orEmpty()))
                }
            }
            "channel:ping" -> str(d, "channelId")?.let { id ->
                _channelStates.update { it + (id to (it[id] ?: ChannelState()).copy(lastMessageAt = str(d, "createdAt"))) }
            }
            "community:update", "channel:new", "channel:update", "channel:delete", "channel:reorder",
            "category:new", "category:update", "category:delete", "category:reorder", "overwrite:update",
            "member:roles-update" -> scope.launch { runCatching { loadCommunity() } }
            "voice:roster" -> {
                val o = d?.jsonObject ?: return
                val channelId = str(o, "channelId") ?: return
                val parts = o["participants"]?.let { decodeList<VoiceParticipant>(it) } ?: emptyList()
                _voiceRosters.update { if (parts.isEmpty()) it - channelId else it + (channelId to parts) }
            }
            "voice:rosters" -> {
                val o = d?.jsonObject ?: return
                _voiceRosters.value = o.mapNotNull { (channelId, v) ->
                    val parts = v.jsonObject["participants"]?.let { decodeList<VoiceParticipant>(it) } ?: emptyList()
                    if (parts.isEmpty()) null else channelId to parts
                }.toMap()
            }
            "dm-call:ringing" -> {
                val conversationId = str(d, "conversationId") ?: return
                _alerts.tryEmit(Alert.IncomingCall(conversationId, str(d, "channelId") ?: "dm:$conversationId", str(d, "fromUserId"), str(d, "callerName") ?: "Alguém"))
            }
            // Atendeu em OUTRO aparelho / ninguém atendeu em 60s: para de tocar aqui.
            "dm-call:ended", "dm-call:declined", "dm-call:answered", "dm-call:missed" -> str(d, "conversationId")?.let { _alerts.tryEmit(Alert.CallEnded(it)) }
            "account:banned", "account:suspended", "account:disabled", "account:deleted", "account:blocked" ->
                scope.launch { endLocalSession("Sua conta não pode entrar agora.") }
        }
    }

    private fun onNewMessage(m: Message) {
        m.author?.let(::remember)
        val myId = _me.value?.id
        if (m.conversationId != null) {
            val lm = LastMessage(m.id, m.content, m.authorId, m.createdAt, m.attachments.size, m.stickerUrl)
            val known = _conversations.value.any { it.id == m.conversationId }
            _conversations.update { list ->
                sortConversations(list.map { if (it.id == m.conversationId) it.copy(lastMessage = lm) else it })
            }
            if (!known) scope.launch { runCatching { loadConversations() } }
            if (m.authorId != myId && openRoom.value != m.conversationId) _alerts.tryEmit(Alert.DirectMessage(m))
        } else if (m.channelId != null) {
            _channelStates.update { it + (m.channelId to (it[m.channelId] ?: ChannelState()).copy(lastMessageAt = m.createdAt)) }
        }
    }

    private fun sortConversations(list: List<Conversation>) =
        list.sortedByDescending { it.lastMessage?.createdAt ?: "" }

    private inline fun <reified T> decode(el: JsonElement?): T? = try {
        el?.let { AppJson.decodeFromJsonElement<T>(it) }
    } catch (_: Exception) { null }

    private inline fun <reified T> decodeList(el: JsonElement): List<T> =
        el.jsonArray.mapNotNull { runCatching { AppJson.decodeFromJsonElement<T>(it) }.getOrNull() }

    private fun str(el: JsonElement?, key: String): String? =
        (el as? JsonObject)?.get(key)?.let { (it as? JsonPrimitive)?.contentOrNull }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun uriBody(f: PickedFile): RequestBody = object : RequestBody() {
        override fun contentType() = f.mime.toMediaTypeOrNull()
        override fun contentLength() = if (f.size > 0) f.size else -1
        override fun writeTo(sink: BufferedSink) {
            context.contentResolver.openInputStream(f.uri)?.use { sink.writeAll(it.source()) }
        }
    }

    /** Lê nome/tamanho/tipo de um arquivo escolhido no seletor. */
    suspend fun describe(uri: Uri): PickedFile = withContext(Dispatchers.IO) {
        var name = "arquivo"; var size = -1L
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getString(0)?.let { name = it }
                if (!c.isNull(1)) size = c.getLong(1)
            }
        }
        PickedFile(uri, name, context.contentResolver.getType(uri) ?: "application/octet-stream", size)
    }
}

/** Coisas que viram notificação ou aviso na tela. */
sealed interface Alert {
    data object SessionStarted : Alert
    data class DirectMessage(val message: Message) : Alert
    data class Mention(val channelId: String, val channelName: String, val authorName: String, val preview: String) : Alert
    data class NoticeArrived(val notice: Notice) : Alert
    data class IncomingCall(val conversationId: String, val channelName: String, val fromUserId: String?, val callerName: String) : Alert
    data class CallEnded(val conversationId: String) : Alert
}

/** Regras puras (testáveis sem Android). */
object ChatLogic {
    fun isConversationUnread(conv: Conversation, myId: String?): Boolean {
        val lm = conv.lastMessage ?: return false
        if (lm.authorId == myId) return false
        val read = conv.lastReadAt ?: return true
        return instant(lm.createdAt ?: return false) > instant(read)
    }

    fun isChannelUnread(s: ChannelState?): Boolean {
        val last = s?.lastMessageAt ?: return false
        val read = s.myReadAt ?: return true
        return instant(last) > instant(read)
    }

    private fun instant(s: String): Long = runCatching { java.time.Instant.parse(s).toEpochMilli() }.getOrDefault(0L)

    /** Junta mensagens novas na lista (sem repetir), em ordem do mais antigo pro mais novo. */
    fun merge(current: List<Message>, incoming: List<Message>): List<Message> {
        if (incoming.isEmpty()) return current
        val byId = LinkedHashMap<String, Message>()
        current.forEach { byId[it.id] = it }
        incoming.forEach { m ->
            // Troca a versão otimista (mesmo nonce) pela do servidor.
            if (m.nonce != null) byId.entries.removeIf { it.value.nonce == m.nonce && it.key != m.id }
            byId[m.id] = m
        }
        return byId.values.filter { !it.deleted }.sortedWith(compareBy({ instant(it.createdAt) }, { it.id }))
    }

    /** Reações agrupadas por emoji: (emoji, quantidade, eu reagi?). */
    fun groupReactions(reactions: List<Reaction>, myId: String?): List<Triple<String, Int, Boolean>> =
        reactions.groupBy { it.emoji }.map { (emoji, list) -> Triple(emoji, list.size, list.any { it.userId == myId }) }

    /** Agrupa mensagens seguidas do mesmo autor (até 5 min) — só a primeira mostra avatar/nome. */
    fun startsGroup(prev: Message?, m: Message): Boolean {
        if (prev == null || prev.authorId != m.authorId || m.replyTo != null) return true
        return instant(m.createdAt) - instant(prev.createdAt) > 5 * 60_000
    }
}
