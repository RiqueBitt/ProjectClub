package com.projectclub.android

import com.projectclub.android.data.Message
import com.projectclub.android.data.User
import com.projectclub.android.data.offline.OfflineCache
import com.projectclub.android.data.offline.OfflineLogic
import com.projectclub.android.data.offline.PendingMessage
import com.projectclub.android.data.offline.PendingQueue
import com.projectclub.android.net.ApiException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

/** Modo offline: cache em disco com teto, fila de envio e regras de reenvio (JVM puro). */
class OfflineLogicTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun pending(nonce: String, at: String, room: String = "c1", content: String = "oi") =
        PendingMessage(nonce = nonce, conversationId = room, content = content, createdAt = at)

    // ---------- cache ----------

    @Test fun cachePutGetRemove() {
        val c = OfflineCache(tmp.newFolder("c"))
        assertNull(c.get("a"))
        c.put("a", "{\"x\":1}")
        assertEquals("{\"x\":1}", c.get("a"))
        c.put("a", "2")
        assertEquals("2", c.get("a"))
        c.remove("a")
        assertNull(c.get("a"))
    }

    @Test fun cacheKeysWithSymbolsDoNotCollide() {
        val c = OfflineCache(tmp.newFolder("c"))
        c.put("room:a/b", "1")
        c.put("room:a_b", "2")
        assertEquals("1", c.get("room:a/b"))
        assertEquals("2", c.get("room:a_b"))
    }

    @Test fun cacheEvictsLeastRecentlyUsedOverCap() {
        var clock = 1_000_000L
        val c = OfflineCache(tmp.newFolder("c"), maxBytes = 250, now = { clock })
        val big = "x".repeat(100)
        c.put("a", big); clock += 10_000
        c.put("b", big); clock += 10_000
        assertEquals(big, c.get("a")) // "a" usado agora: "b" vira o mais antigo
        clock += 10_000
        c.put("c", big) // 300 bytes > 250: sai o menos usado ("b")
        assertTrue(c.contains("a"))
        assertFalse(c.contains("b"))
        assertTrue(c.contains("c"))
        assertTrue(c.sizeBytes() <= 250)
    }

    @Test fun cacheNeverEvictsWhatWasJustWritten() {
        val c = OfflineCache(tmp.newFolder("c"), maxBytes = 10)
        c.put("grande", "y".repeat(50))
        assertTrue(c.contains("grande"))
    }

    @Test fun cacheClear() {
        val c = OfflineCache(tmp.newFolder("c"))
        c.put("a", "1"); c.put("b", "2")
        c.clear()
        assertNull(c.get("a")); assertNull(c.get("b"))
        assertEquals(0L, c.sizeBytes())
    }

    // ---------- fila ----------

    @Test fun queueKeepsOrderAndSurvivesRestart() {
        val f = File(tmp.root, "q.json")
        val q = PendingQueue(f)
        q.add(pending("n2", "2026-01-01T10:00:02Z"))
        q.add(pending("n1", "2026-01-01T10:00:01Z"))
        q.add(pending("n3", "2026-01-01T10:00:03Z", room = "c2"))
        assertEquals(listOf("n1", "n2", "n3"), q.ordered().map { it.nonce })
        assertEquals(listOf("n2", "n1"), q.forRoom("c1").map { it.nonce })

        val reopened = PendingQueue(f) // app fechou e abriu de novo
        assertEquals(listOf("n1", "n2", "n3"), reopened.ordered().map { it.nonce })
    }

    @Test fun queueSameNonceIsNotDuplicated() {
        val q = PendingQueue(null)
        q.add(pending("n1", "2026-01-01T10:00:01Z", content = "a"))
        q.add(pending("n1", "2026-01-01T10:00:01Z", content = "a"))
        assertEquals(1, q.items.value.size)
    }

    @Test fun queueRemoveMarkFailedAndClear() {
        val f = File(tmp.root, "q.json")
        val q = PendingQueue(f)
        q.add(pending("n1", "2026-01-01T10:00:01Z"))
        q.add(pending("n2", "2026-01-01T10:00:02Z"))
        q.markFailed("n1", "sem rede")
        assertEquals(1, q.items.value.first { it.nonce == "n1" }.attempts)
        assertEquals("sem rede", q.items.value.first { it.nonce == "n1" }.lastError)
        q.remove("n1")
        assertEquals(listOf("n2"), q.items.value.map { it.nonce })
        q.clear()
        assertTrue(q.items.value.isEmpty())
        assertFalse(f.exists())
        assertTrue(PendingQueue(f).items.value.isEmpty())
    }

    @Test fun queueIsBounded() {
        val q = PendingQueue(null)
        repeat(PendingQueue.MAX_ITEMS + 5) { i -> q.add(pending("n$i", "2026-01-01T10:00:00Z")) }
        assertEquals(PendingQueue.MAX_ITEMS, q.items.value.size)
    }

    @Test fun queueIgnoresCorruptFile() {
        val f = File(tmp.root, "q.json").apply { writeText("{quebrado") }
        assertTrue(PendingQueue(f).items.value.isEmpty())
    }

    // ---------- regras ----------

    @Test fun retryableErrors() {
        assertTrue(OfflineLogic.isRetryable(IOException("Unable to resolve host")))
        assertTrue(OfflineLogic.isRetryable(java.net.SocketTimeoutException()))
        assertTrue(OfflineLogic.isRetryable(ApiException(503, "atualizando")))
        assertTrue(OfflineLogic.isRetryable(ApiException(429, "calma")))
        assertTrue(OfflineLogic.isRetryable(ApiException(401, "sessão")))
        assertFalse(OfflineLogic.isRetryable(ApiException(403, "sem permissão")))
        assertFalse(OfflineLogic.isRetryable(ApiException(400, "inválida")))
        assertFalse(OfflineLogic.isRetryable(ApiException(404, "sala apagada")))
        assertFalse(OfflineLogic.isRetryable(IllegalStateException("json")))
    }

    @Test fun backoffGrowsAndCaps() {
        assertEquals(5_000L, OfflineLogic.backoffMs(0))
        assertEquals(10_000L, OfflineLogic.backoffMs(1))
        assertEquals(60_000L, OfflineLogic.backoffMs(10))
    }

    @Test fun pendingBecomesLocalMessageWithSameNonce() {
        val me = User(id = "me", username = "eu")
        val m = OfflineLogic.toMessage(pending("abc12345", "2026-01-01T10:00:00Z", content = "olá"), me)
        assertEquals("local-abc12345", m.id)
        assertEquals("abc12345", m.nonce)
        assertEquals("olá", m.content)
        assertEquals("me", m.authorId)
        assertEquals("c1", m.conversationId)
    }

    @Test fun recentRoomsMoveToFrontAndDropOldest() {
        val (a, dropA) = OfflineLogic.touchRecent(listOf("r1", "r2", "r3"), "r2", max = 3)
        assertEquals(listOf("r2", "r1", "r3"), a)
        assertTrue(dropA.isEmpty())
        val (b, dropB) = OfflineLogic.touchRecent(listOf("r1", "r2", "r3"), "r4", max = 3)
        assertEquals(listOf("r4", "r1", "r2"), b)
        assertEquals(listOf("r3"), dropB)
    }

    @Test fun diskKeepsLast100ConfirmedOnly() {
        val msgs = (1..130).map { Message(id = "m$it", createdAt = "2026-01-01T10:00:00Z") } +
            Message(id = "local-x", nonce = "x", createdAt = "2026-01-01T10:00:00Z")
        val disk = OfflineLogic.forDisk(msgs)
        assertEquals(OfflineLogic.MESSAGES_PER_ROOM, disk.size)
        assertEquals("m31", disk.first().id)
        assertEquals("m130", disk.last().id)
    }
}
