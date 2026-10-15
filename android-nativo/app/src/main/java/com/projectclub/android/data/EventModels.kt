package com.projectclub.android.data

import kotlinx.serialization.Serializable

/** Evento da comunidade (GET /api/events). status: UPCOMING | ACTIVE | ENDED. */
@Serializable
data class CommunityEvent(
    val id: String = "",
    val title: String = "",
    val description: String? = null,
    val bannerUrl: String? = null,
    val iconUrl: String? = null,
    val startsAt: String? = null,
    val endsAt: String? = null,
    val status: String = "UPCOMING",
    val createdById: String? = null,
    val createdBy: User? = null,
    val createdAt: String? = null,
    val rsvp: EventRsvpSummary? = null,
)

@Serializable
data class EventRsvpCounts(
    val GOING: Int = 0,
    val MAYBE: Int = 0,
    val NO: Int = 0,
) {
    fun of(key: String): Int = when (key) { "GOING" -> GOING; "MAYBE" -> MAYBE; "NO" -> NO; else -> 0 }
}

/** Resumo de "Eu vou / Talvez / Não vou" (alguns rostos de quem vai + a minha resposta). */
@Serializable
data class EventRsvpSummary(
    val counts: EventRsvpCounts = EventRsvpCounts(),
    val going: List<User> = emptyList(),
    val maybe: List<User> = emptyList(),
    val mine: String? = null,
)

@Serializable
data class CommunityEventsResponse(val events: List<CommunityEvent> = emptyList())

/** POST /api/events/:id/rsvp → { rsvp, mine }. */
@Serializable
data class EventRsvpResponse(val rsvp: EventRsvpSummary? = null, val mine: String? = null)
