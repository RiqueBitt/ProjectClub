package com.projectclub.android.data.offline

import com.projectclub.android.data.ChannelState
import com.projectclub.android.data.CommunityResponse
import com.projectclub.android.data.Conversation
import com.projectclub.android.data.Friendship
import com.projectclub.android.data.Notice
import com.projectclub.android.data.User
import kotlinx.serialization.Serializable

/**
 * O que o app mostra ao abrir sem internet: você, a comunidade (canais e
 * membros), as conversas, amigos e avisos, e os nomes/fotos de quem apareceu
 * nas conversas. Gravado no disco a cada mudança (com uma pequena espera).
 */
@Serializable
data class OfflineSnapshot(
    val me: User? = null,
    val community: CommunityResponse? = null,
    val conversations: List<Conversation> = emptyList(),
    val friends: List<Friendship> = emptyList(),
    val channelStates: Map<String, ChannelState> = emptyMap(),
    val notices: List<Notice> = emptyList(),
    val unreadNotices: Int = 0,
    val users: List<User> = emptyList(),
    val savedAt: Long = 0,
)
