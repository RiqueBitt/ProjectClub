package com.projectclub.android.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class TicketMessage(
    val id: String = "",
    val ticketId: String? = null,
    val authorId: String? = null,
    val author: User? = null,
    val content: String = "",
    val createdAt: String? = null,
)

@Serializable
data class TicketCount(val messages: Int = 0)

/** Chamado de suporte. status: OPEN | CLOSED. */
@Serializable
data class Ticket(
    val id: String = "",
    val authorId: String? = null,
    val author: User? = null,
    val subject: String = "",
    val status: String = "OPEN",
    val claimedById: String? = null,
    val claimedBy: User? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val closedAt: String? = null,
    /** Na lista vem só a última mensagem; no detalhe vem a conversa inteira (mais antiga primeiro). */
    val messages: List<TicketMessage> = emptyList(),
    @SerialName("_count") val count: TicketCount? = null,
) {
    val isOpen: Boolean get() = status == "OPEN"
}

@Serializable
data class TicketsResponse(val tickets: List<Ticket> = emptyList())

@Serializable
data class TicketResponse(val ticket: Ticket? = null)

@Serializable
data class TicketMessageResponse(val message: TicketMessage? = null)
