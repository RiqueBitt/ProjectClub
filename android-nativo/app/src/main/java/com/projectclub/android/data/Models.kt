package com.projectclub.android.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/** JSON do servidor: ignora campos que o app ainda não usa. */
val AppJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
    explicitNulls = false
    coerceInputValues = true
    encodeDefaults = false
}

@Serializable
data class User(
    val id: String,
    val publicId: String? = null,
    val username: String? = null,
    val displayName: String? = null,
    val avatarUrl: String? = null,
    val avatarDecoration: String? = null,
    /** Efeito de perfil da Loja: JSON {id,url,d:{s,x,y,o,t},m:{...}}. */
    val profileEffect: String? = null,
    /** Fonte do nome comprada na Loja: JSON {id, family, url}. */
    val profileFont: String? = null,
    /** Estilo de perfil da Loja (win2000, anime, terror, bugado, nostalgia). */
    val profileStyle: String? = null,
    val bannerUrl: String? = null,
    val bio: String? = null,
    val pronouns: String? = null,
    val status: String? = null,
    val customStatus: String? = null,
    val customStatusEmoji: String? = null,
    val profileColor: String? = null,
    val profileNameColor: String? = null,
    val platformRole: String? = null,
    val accountLevel: Int? = null,
    val email: String? = null,
    val createdAt: String? = null,
    /** Status da conta (só vem no /auth/me, pra própria pessoa). */
    val isPlatformBanned: Boolean? = null,
    val platformBanReason: String? = null,
    val suspendedUntil: String? = null,
    val timeoutUntil: String? = null,
    val accountDisabledAt: String? = null,
) {
    val name: String get() = displayName?.takeIf { it.isNotBlank() } ?: username ?: "Usuário"
}

@Serializable
data class Channel(
    val id: String,
    val categoryId: String? = null,
    val name: String = "",
    val topic: String? = null,
    val type: String = "TEXT",
    val position: Int = 0,
    val isPrivate: Boolean = false,
    val iconEmoji: String? = null,
    val iconUrl: String? = null,
    val slowModeSeconds: Int? = null,
) {
    val isVoice: Boolean get() = type == "VOICE" || type == "STAGE"
    /** Canais que o app nativo abre como chat (o resto abre no site). */
    val isChat: Boolean get() = type == "TEXT" || type == "ANNOUNCEMENT"
}

@Serializable
data class Category(
    val id: String,
    val name: String = "",
    val position: Int = 0,
    val iconEmoji: String? = null,
    val iconUrl: String? = null,
    val channels: List<Channel> = emptyList(),
)

@Serializable
data class CommunityInfo(val name: String? = null, val iconUrl: String? = null, val bannerUrl: String? = null)

@Serializable
data class Member(val user: User, val roleIds: List<String> = emptyList())

@Serializable
data class CommunityResponse(
    val community: CommunityInfo? = null,
    val categories: List<Category> = emptyList(),
    val channels: List<Channel> = emptyList(),
    val members: List<Member> = emptyList(),
)

@Serializable
data class LastMessage(
    val id: String,
    val content: String? = null,
    val authorId: String? = null,
    val createdAt: String? = null,
    val attachmentCount: Int = 0,
    val stickerUrl: String? = null,
)

@Serializable
data class Conversation(
    val id: String,
    val isGroup: Boolean = false,
    val name: String? = null,
    val icon: String? = null,
    val members: List<User> = emptyList(),
    val lastMessage: LastMessage? = null,
    val lastReadAt: String? = null,
)

@Serializable
data class ConversationsResponse(val conversations: List<Conversation> = emptyList())

@Serializable
data class ConversationResponse(val conversation: Conversation)

@Serializable
data class Attachment(
    val id: String,
    val url: String,
    val filename: String? = null,
    val mimeType: String? = null,
    val size: Long? = null,
    val isSpoiler: Boolean = false,
) {
    val isImage: Boolean get() = mimeType?.startsWith("image/") == true
    val isVideo: Boolean get() = mimeType?.startsWith("video/") == true
}

@Serializable
data class Reaction(val id: String? = null, val emoji: String, val userId: String)

@Serializable
data class ReplyRef(val id: String, val content: String? = null, val author: User? = null)

@Serializable
data class Message(
    val id: String,
    val content: String? = null,
    val authorId: String? = null,
    val conversationId: String? = null,
    val channelId: String? = null,
    val replyToId: String? = null,
    val edited: Boolean = false,
    val deleted: Boolean = false,
    val pinned: Boolean = false,
    val createdAt: String = "",
    val updatedAt: String? = null,
    val author: User? = null,
    val attachments: List<Attachment> = emptyList(),
    val reactions: List<Reaction> = emptyList(),
    val replyTo: ReplyRef? = null,
    val stickerUrl: String? = null,
    val embed: String? = null,
    val nonce: String? = null,
    val contentFiltered: Boolean = false,
) {
    val roomId: String? get() = channelId ?: conversationId
}

@Serializable
data class MessagesResponse(val messages: List<Message> = emptyList())

@Serializable
data class MessageResponse(val message: Message)

@Serializable
data class ChannelState(
    val lastMessageAt: String? = null,
    val myReadAt: String? = null,
    val unreadMentions: Int = 0,
)

@Serializable
data class ChannelStatesResponse(val states: Map<String, ChannelState> = emptyMap())

@Serializable
data class Notice(
    val id: String,
    val kind: String? = null,
    val title: String? = null,
    val body: String? = null,
    val link: String? = null,
    val readAt: String? = null,
    val createdAt: String? = null,
)

@Serializable
data class NoticesResponse(val notices: List<Notice> = emptyList(), val unread: Int = 0)

@Serializable
data class Friendship(
    val id: String,
    val status: String,
    val isIncoming: Boolean = false,
    val user: User,
)

@Serializable
data class FriendsResponse(val friendships: List<Friendship> = emptyList())

@Serializable
data class AuthResponse(val user: User? = null, val accessToken: String? = null, val requiresTwoFactor: Boolean = false)

@Serializable
data class MeResponse(val user: User)

@Serializable
data class AgoraCreds(val token: String, val appId: String, val uid: String? = null)

@Serializable
data class JitsiCreds(val domain: String? = null, val room: String? = null)

@Serializable
data class VoiceJoinResponse(
    val provider: String,
    val channelName: String? = null,
    val agora: AgoraCreds? = null,
    val jitsi: JitsiCreds? = null,
    /** Servidor de mídia próprio: { url, token, room, identity, iceServers }. */
    val projectclub: kotlinx.serialization.json.JsonObject? = null,
    val token: String? = null,
    val appId: String? = null,
)

@Serializable
data class Bootstrap(
    val hashes: Map<String, String> = emptyMap(),
    val data: Map<String, JsonElement> = emptyMap(),
    val failed: Map<String, Int> = emptyMap(),
)

/** Participante de uma call (vem do socket: voice:roster / voice:joined). */
@Serializable
data class VoiceParticipant(
    val userId: String,
    val muted: Boolean = false,
    val deafened: Boolean = false,
    val video: Boolean = false,
    val screenSharing: Boolean = false,
    val role: String? = null,
)

/** Emoji personalizado da comunidade (usado no texto como :nome:). */
@Serializable
data class CustomEmoji(val id: String = "", val name: String = "", val url: String = "", val category: String? = null)

@Serializable
data class EmojisResponse(val emojis: List<CustomEmoji> = emptyList())

/** Figurinha da comunidade (vai como mensagem própria). */
@Serializable
data class ServerSticker(val id: String = "", val name: String = "", val url: String = "")

@Serializable
data class StickersResponse(val stickers: List<ServerSticker> = emptyList())

@Serializable
data class FavoriteGif(val id: String = "", val gifId: String = "", val url: String = "", val preview: String? = null)

@Serializable
data class FavoriteGifsResponse(val gifs: List<FavoriteGif> = emptyList())
