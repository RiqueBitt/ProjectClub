package com.projectclub.android

import com.projectclub.android.net.CookieCodec
import okhttp3.Cookie
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CookieCodecTest {
    private val future = System.currentTimeMillis() + 90L * 24 * 3600 * 1000

    @Test fun roundTripKeepsLoginCookies() {
        val c = Cookie.Builder().name("refreshToken").value("abc").domain("projectclub.shardweb.app")
            .path("/api/auth").expiresAt(future).secure().httpOnly().build()
        val back = CookieCodec.decodeAll(CookieCodec.encodeAll(listOf(c)))
        assertEquals(1, back.size)
        val b = back[0]
        assertEquals("refreshToken", b.name); assertEquals("abc", b.value)
        assertEquals("/api/auth", b.path); assertEquals(c.expiresAt, b.expiresAt)
        assertTrue(b.secure); assertTrue(b.httpOnly)
        assertEquals(CookieCodec.key(c), CookieCodec.key(b))
    }

    @Test fun sessionCookiesAreNotPersisted() {
        val s = Cookie.Builder().name("tmp").value("1").domain("projectclub.shardweb.app").build()
        assertTrue(CookieCodec.decodeAll(CookieCodec.encodeAll(listOf(s))).isEmpty())
    }

    @Test fun garbageIsIgnored() {
        assertTrue(CookieCodec.decodeAll(null).isEmpty())
        assertTrue(CookieCodec.decodeAll("not json").isEmpty())
    }
}
