package com.projectclub.android.net

import android.content.Context
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import org.json.JSONArray
import org.json.JSONObject

/**
 * Cookies do login (refreshToken e pcKeep, caminho /api/auth) guardados no
 * aparelho. Diferente do WebView, grava no disco NA HORA (commit síncrono)
 * a cada cookie novo: a sessão é renovada (o cookie troca) a cada abertura,
 * e perder o cookie novo era o que mandava pra tela de login.
 */
class PersistentCookieJar(context: Context) : CookieJar {
    private val prefs = context.getSharedPreferences("pc_cookies", Context.MODE_PRIVATE)
    private val cookies = LinkedHashMap<String, Cookie>()

    init {
        CookieCodec.decodeAll(prefs.getString(KEY, null)).forEach { cookies[CookieCodec.key(it)] = it }
    }

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (cookies.isEmpty()) return
        val now = System.currentTimeMillis()
        for (c in cookies) {
            val k = CookieCodec.key(c)
            if (c.expiresAt <= now) this.cookies.remove(k) else this.cookies[k] = c
        }
        persist()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        val expired = cookies.filterValues { it.expiresAt <= now }.keys
        if (expired.isNotEmpty()) { expired.forEach { cookies.remove(it) }; persist() }
        return cookies.values.filter { it.matches(url) }
    }

    @Synchronized
    fun find(name: String): Cookie? = cookies.values.firstOrNull { it.name == name && it.expiresAt > System.currentTimeMillis() }

    @Synchronized
    fun clear() {
        cookies.clear()
        prefs.edit().remove(KEY).commit()
    }

    private fun persist() {
        prefs.edit().putString(KEY, CookieCodec.encodeAll(cookies.values)).commit()
    }

    private companion object {
        const val KEY = "all"
    }
}

/** (De)serialização dos cookies — separado pra ter teste sem Android. */
object CookieCodec {
    fun key(c: Cookie) = "${c.name}|${c.domain}|${c.path}"

    fun encodeAll(list: Collection<Cookie>): String {
        val arr = JSONArray()
        for (c in list) {
            if (!c.persistent) continue // cookie de sessão não vai pro disco
            arr.put(JSONObject().apply {
                put("n", c.name); put("v", c.value); put("e", c.expiresAt)
                put("d", c.domain); put("p", c.path); put("s", c.secure)
                put("h", c.httpOnly); put("o", c.hostOnly)
            })
        }
        return arr.toString()
    }

    fun decodeAll(raw: String?): List<Cookie> {
        if (raw.isNullOrBlank()) return emptyList()
        val out = ArrayList<Cookie>()
        try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val b = Cookie.Builder().name(o.getString("n")).value(o.getString("v"))
                    .expiresAt(o.getLong("e")).path(o.getString("p"))
                if (o.optBoolean("o")) b.hostOnlyDomain(o.getString("d")) else b.domain(o.getString("d"))
                if (o.optBoolean("s")) b.secure()
                if (o.optBoolean("h")) b.httpOnly()
                out += b.build()
            }
        } catch (_: Exception) {
            // arquivo corrompido: começa vazio (vai pedir login)
        }
        return out
    }
}
