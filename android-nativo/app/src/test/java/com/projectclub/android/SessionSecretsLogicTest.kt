package com.projectclub.android

import com.projectclub.android.data.AesGcmSealer
import com.projectclub.android.data.SealedValue
import com.projectclub.android.data.Sealer
import com.projectclub.android.net.CookieCodec
import okhttp3.Cookie
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** Proteção da sessão guardada no aparelho (data/SessionSecrets.kt), sem precisar de celular. */
class SessionSecretsLogicTest {
    private fun newKey(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private val key = newKey()
    private val sealer = AesGcmSealer { key }

    /** O "disco" do teste. */
    private class Disk(var value: String? = null) {
        var writes = 0
        fun sealed(sealer: Sealer) = SealedValue({ value }, { v -> value = v; writes++ }, sealer)
    }

    private val cookiesJson: String by lazy {
        val c = Cookie.Builder().name("refreshToken").value("segredo-do-login").domain("projectclub.shardweb.app")
            .path("/api/auth").expiresAt(System.currentTimeMillis() + 90L * 24 * 3600 * 1000).secure().httpOnly().build()
        CookieCodec.encodeAll(listOf(c))
    }

    @Test fun sealedTextHidesTheContentAndOpensBack() {
        val sealed = sealer.seal(cookiesJson)!!
        assertTrue(AesGcmSealer.isSealed(sealed))
        assertFalse(sealed.contains("segredo-do-login"))
        assertFalse(sealed.contains("refreshToken"))
        assertEquals(cookiesJson, sealer.open(sealed))
    }

    @Test fun sameTextNeverSealsTheSameWayTwice() {
        assertNotEquals(sealer.seal("abc"), sealer.seal("abc"))
    }

    @Test fun tamperedOrForeignTextDoesNotOpen() {
        val sealed = sealer.seal(cookiesJson)!!
        val flipped = sealed.dropLast(3) + (if (sealed.endsWith("AAA")) "BBB" else "AAA")
        assertNull(sealer.open(flipped))
        assertNull("chave de outro aparelho", AesGcmSealer { newKey() }.open(sealed))
        assertNull(sealer.open(AesGcmSealer.PREFIX + "isto não é base64!"))
        assertNull(sealer.open(AesGcmSealer.PREFIX))
        assertNull("texto sem proteção não é aberto como protegido", sealer.open(cookiesJson))
    }

    @Test fun oldUnprotectedLoginIsKeptAndProtectedOnFirstRead() {
        val disk = Disk(cookiesJson) // o que a versão antiga do app deixou gravado
        val stored = disk.sealed(sealer)
        assertEquals("ninguém é deslogado na atualização", cookiesJson, stored.read())
        assertTrue("já regravou protegido", AesGcmSealer.isSealed(disk.value!!))
        assertFalse(disk.value!!.contains("segredo-do-login"))
        assertEquals(cookiesJson, stored.read())
        assertEquals("a segunda leitura não regrava", 1, disk.writes)
        assertEquals(1, CookieCodec.decodeAll(stored.read()).size)
    }

    @Test fun writesAreProtectedAndNullErases() {
        val disk = Disk()
        val stored = disk.sealed(sealer)
        assertNull(stored.read())
        stored.write(cookiesJson)
        assertTrue(AesGcmSealer.isSealed(disk.value!!))
        assertEquals(cookiesJson, stored.read())
        stored.write(null)
        assertNull(disk.value)
        assertNull(stored.read())
    }

    @Test fun brokenKeystoreFallsBackToTheOldFormatInsteadOfLoggingOut() {
        val broken = object : Sealer {
            override fun seal(plain: String): String? = null
            override fun open(sealed: String): String? = null
        }
        val disk = Disk()
        val stored = disk.sealed(broken)
        stored.write(cookiesJson)
        assertEquals("gravou como as versões antigas gravavam", cookiesJson, disk.value)
        assertEquals(cookiesJson, stored.read())
    }

    @Test fun unreadableProtectedTextReadsAsEmptyAndIsLeftAlone() {
        val sealedElsewhere = AesGcmSealer { newKey() }.seal(cookiesJson)!!
        val disk = Disk(sealedElsewhere)
        val stored = disk.sealed(sealer)
        assertNull(stored.read())
        assertEquals("não apaga nem regrava o que não conseguiu abrir", sealedElsewhere, disk.value)
        assertEquals(0, disk.writes)
    }

    @Test fun passingKeystoreFailureGetsASecondTry() {
        var calls = 0
        val flaky = object : Sealer {
            override fun seal(plain: String): String? = sealer.seal(plain)
            override fun open(sealed: String): String? = if (calls++ == 0) null else sealer.open(sealed)
        }
        val disk = Disk(sealer.seal(cookiesJson))
        assertEquals(cookiesJson, disk.sealed(flaky).read())
        assertEquals(2, calls)
    }
}
