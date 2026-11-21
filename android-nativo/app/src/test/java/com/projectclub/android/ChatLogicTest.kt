package com.projectclub.android

import com.projectclub.android.data.ChannelState
import com.projectclub.android.data.ChatLogic
import com.projectclub.android.data.Conversation
import com.projectclub.android.data.LastMessage
import com.projectclub.android.data.Message
import com.projectclub.android.data.Reaction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatLogicTest {
    private fun msg(id: String, at: String, author: String = "a", nonce: String? = null, deleted: Boolean = false) =
        Message(id = id, createdAt = at, authorId = author, nonce = nonce, deleted = deleted)

    @Test fun mergeOrdersAndDedupes() {
        val cur = listOf(msg("2", "2026-01-01T10:02:00Z"), msg("1", "2026-01-01T10:01:00Z"))
        val out = ChatLogic.merge(cur, listOf(msg("3", "2026-01-01T10:03:00Z"), msg("2", "2026-01-01T10:02:00Z")))
        assertEquals(listOf("1", "2", "3"), out.map { it.id })
    }

    @Test fun mergeReplacesOptimisticByNonce() {
        val local = msg("local-x", "2026-01-01T10:05:00Z", nonce = "x")
        val out = ChatLogic.merge(listOf(local), listOf(msg("srv", "2026-01-01T10:05:01Z", nonce = "x")))
        assertEquals(listOf("srv"), out.map { it.id })
    }

    @Test fun mergeDropsDeleted() {
        val out = ChatLogic.merge(listOf(msg("1", "2026-01-01T10:00:00Z")), listOf(msg("1", "2026-01-01T10:00:00Z", deleted = true)))
        assertTrue(out.isEmpty())
    }

    @Test fun conversationUnread() {
        val lm = LastMessage(id = "m", authorId = "other", createdAt = "2026-01-01T10:00:00Z")
        assertTrue(ChatLogic.isConversationUnread(Conversation(id = "c", lastMessage = lm), "me"))
        assertFalse(ChatLogic.isConversationUnread(Conversation(id = "c", lastMessage = lm, lastReadAt = "2026-01-01T10:00:01Z"), "me"))
        assertFalse(ChatLogic.isConversationUnread(Conversation(id = "c", lastMessage = lm.copy(authorId = "me")), "me"))
    }

    @Test fun channelUnread() {
        assertFalse(ChatLogic.isChannelUnread(null))
        assertTrue(ChatLogic.isChannelUnread(ChannelState(lastMessageAt = "2026-01-02T00:00:00Z", myReadAt = "2026-01-01T00:00:00Z")))
        assertFalse(ChatLogic.isChannelUnread(ChannelState(lastMessageAt = "2026-01-01T00:00:00Z", myReadAt = "2026-01-02T00:00:00Z")))
    }

    @Test fun reactionsGrouped() {
        val g = ChatLogic.groupReactions(listOf(Reaction(emoji = "👍", userId = "me"), Reaction(emoji = "👍", userId = "b"), Reaction(emoji = "😂", userId = "b")), "me")
        assertEquals(Triple("👍", 2, true), g[0])
        assertEquals(Triple("😂", 1, false), g[1])
    }

    @Test fun grouping() {
        val a = msg("1", "2026-01-01T10:00:00Z")
        assertFalse(ChatLogic.startsGroup(a, msg("2", "2026-01-01T10:04:00Z")))
        assertTrue(ChatLogic.startsGroup(a, msg("2", "2026-01-01T10:06:00Z")))
        assertTrue(ChatLogic.startsGroup(a, msg("2", "2026-01-01T10:01:00Z", author = "b")))
        assertTrue(ChatLogic.startsGroup(null, a))
    }
}
