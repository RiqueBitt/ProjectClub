package com.projectclub.android.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

/** Uma conta guardada no aparelho pra trocar rápido (nome e foto pra lista). */
@Serializable
data class SavedAccount(
    val id: String,
    val displayName: String? = null,
    val username: String? = null,
    val avatarUrl: String? = null,
    /** Cookies de login (JSON do CookieCodec). Null = conta ativa agora. */
    val cookies: String? = null,
    val savedAt: Long = 0,
) {
    fun asUser() = User(id = id, displayName = displayName, username = username, avatarUrl = avatarUrl)
}

/**
 * Contas guardadas no aparelho (só no armazenamento privado do app, igual aos
 * cookies da conta ativa, e criptografadas do mesmo jeito: ver SessionSecrets.kt).
 * No máximo 5, igual ao site.
 */
class AccountVault(context: Context, sealer: Sealer = SessionKey.sealer) {
    private val prefs = context.applicationContext.getSharedPreferences("pc_accounts", Context.MODE_PRIVATE)
    private val stored = SealedValue(
        load = { prefs.getString(KEY, null) },
        save = { value -> prefs.edit().apply { if (value == null) remove(KEY) else putString(KEY, value) }.commit() },
        sealer = sealer,
    )
    private val ser = ListSerializer(SavedAccount.serializer())
    private val _list = MutableStateFlow(load())
    val list: StateFlow<List<SavedAccount>> = _list

    private fun load(): List<SavedAccount> =
        runCatching { AppJson.decodeFromString(ser, stored.read() ?: "[]") }.getOrDefault(emptyList())

    @Synchronized
    private fun write(l: List<SavedAccount>) {
        _list.value = l
        stored.write(AppJson.encodeToString(ser, l))
    }

    @Synchronized
    fun save(me: User, cookies: String) {
        val acc = SavedAccount(me.id, me.displayName, me.username, me.avatarUrl, cookies, System.currentTimeMillis())
        write((listOf(acc) + _list.value.filter { it.id != me.id }).take(MAX))
    }

    fun cookiesOf(id: String): String? = _list.value.firstOrNull { it.id == id }?.cookies

    /** Entrou nela: a foto antiga não serve mais (o servidor já girou o cookie). */
    @Synchronized
    fun forgetCookies(id: String) = write(_list.value.map { if (it.id == id) it.copy(cookies = null) else it }.filter { it.cookies != null || it.id == id })

    @Synchronized
    fun remove(id: String) = write(_list.value.filter { it.id != id })

    private companion object {
        const val KEY = "list"
        const val MAX = 5
    }
}
