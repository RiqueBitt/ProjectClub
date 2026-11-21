package com.projectclub.android.net

import android.content.Context
import com.projectclub.android.Config
import com.projectclub.android.data.AppJson
import com.projectclub.android.data.AuthResponse
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Erro de uma resposta do servidor ({ error: "..." }). */
class ApiException(val status: Int, message: String, val json: JsonObject? = null) : IOException(message) {
    /** 401/403 vindo do NOSSO servidor (JSON) = sessão inválida de verdade. */
    val isAuthRejection: Boolean get() = (status == 401 || status == 403) && json != null
    val code: String? get() = json?.get("code")?.let { runCatching { it.jsonPrimitive.content }.getOrNull() }
}

/**
 * Cancelamento normal de corrotina (a tela saiu, o escopo acabou...) — não é
 * erro e nunca deve ir pros logs. Olha também as causas: às vezes o
 * cancelamento chega embrulhado (ex.: "The coroutine scope left the
 * composition" dentro de outra exceção) ou vira o IOException "Canceled" do
 * OkHttp quando a chamada é cancelada no meio.
 */
fun Throwable.isCancellation(): Boolean = generateSequence(this) { it.cause }.take(8).any {
    it is CancellationException || (it is IOException && it !is ApiException && it.message == "Canceled")
}

/**
 * Falha passageira do servidor: 502/503/504 (deploy do site, ~1 min).
 * Tenta de novo com espera; não é erro pra relatar nem pra assustar ninguém.
 */
fun Throwable.isTransientServer(): Boolean = this is ApiException && status in Api.TRANSIENT_CODES

sealed interface RefreshResult {
    data class Ok(val auth: AuthResponse) : RefreshResult
    /** O servidor recusou (sessão acabou de verdade). */
    data object Rejected : RefreshResult
    /** Rede/servidor fora/deploy: tenta de novo depois, sem deslogar. */
    data object Transient : RefreshResult
}

/**
 * Cliente HTTP do Project Club.
 * - Access token (15 min) só em memória, mandado como Bearer.
 * - Cookies de login persistentes (PersistentCookieJar).
 * - 401 numa rota comum → renova a sessão UMA vez (renovações são em fila:
 *   duas renovações com o mesmo cookie seriam tratadas como roubo).
 */
class Api(context: Context) {
    val cookies = PersistentCookieJar(context.applicationContext)

    @Volatile var accessToken: String? = null
        private set

    /** Chamado quando a sessão acaba de verdade (precisa logar de novo). */
    @Volatile var onSessionLost: (() -> Unit)? = null
    /** Chamado a cada renovação com sucesso (usuário atualizado). */
    @Volatile var onRefreshed: ((AuthResponse) -> Unit)? = null

    private val refreshLock = Any()

    val http: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookies)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(180, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val req = chain.request()
            val b = req.newBuilder().header("User-Agent", Config.userAgent)
            val token = accessToken
            if (token != null && req.header("Authorization") == null && !req.url.encodedPath.startsWith("/api/auth/refresh")) {
                b.header("Authorization", "Bearer $token")
            }
            chain.proceed(b.build())
        }
        .authenticator { _, response ->
            val req = response.request
            if (req.url.encodedPath.startsWith("/api/auth/")) return@authenticator null
            if (req.header(RETRY_HEADER) != null) return@authenticator null
            val used = req.header("Authorization")?.removePrefix("Bearer ")
            val fresh = refreshAfterFailure(used) ?: return@authenticator null
            req.newBuilder().header("Authorization", "Bearer $fresh").header(RETRY_HEADER, "1").build()
        }
        .build()

    fun setSession(token: String?) { accessToken = token }

    fun url(path: String): String = if (path.startsWith("http")) path else Config.baseUrl + path

    /** Renova depois de um 401: se outra requisição já renovou, só reaproveita. */
    private fun refreshAfterFailure(usedToken: String?): String? = synchronized(refreshLock) {
        val current = accessToken
        if (current != null && current != usedToken) return current
        when (val r = refreshLocked()) {
            is RefreshResult.Ok -> r.auth.accessToken
            else -> null
        }
    }

    /** Renovação explícita (abertura do app, reconexão do tempo real). */
    fun refreshBlocking(): RefreshResult = synchronized(refreshLock) { refreshLocked() }

    suspend fun refresh(): RefreshResult = withContext(Dispatchers.IO) { refreshBlocking() }

    private fun refreshLocked(): RefreshResult {
        val req = Request.Builder().url(url("/api/auth/refresh")).post(EMPTY_JSON).build()
        return try {
            http.newCall(req).execute().use { r ->
                val text = r.body?.string().orEmpty()
                val json = runCatching { AppJson.parseToJsonElement(text).jsonObject }.getOrNull()
                when {
                    r.isSuccessful -> {
                        val auth = AppJson.decodeFromString(AuthResponse.serializer(), text)
                        if (auth.accessToken.isNullOrBlank()) RefreshResult.Transient
                        else {
                            accessToken = auth.accessToken
                            onRefreshed?.invoke(auth)
                            RefreshResult.Ok(auth)
                        }
                    }
                    (r.code == 401 || r.code == 403) && json != null -> {
                        accessToken = null
                        onSessionLost?.invoke()
                        RefreshResult.Rejected
                    }
                    else -> RefreshResult.Transient
                }
            }
        } catch (_: IOException) {
            RefreshResult.Transient
        }
    }

    /**
     * Executa e devolve o corpo. Lança ApiException fora de 2xx.
     * GET com 502/503/504 (deploy do site) tenta de novo sozinho, com espera
     * crescente (e respeitando o Retry-After) — só GET, que pode repetir sem
     * efeito colateral.
     */
    suspend fun call(req: Request): String = withContext(Dispatchers.IO) { execute(req) }

    private suspend fun execute(req: Request): String {
        var attempt = 0
        while (true) {
            var wait = 0L
            http.newCall(req).execute().use { r ->
                val text = r.body?.string().orEmpty()
                if (r.isSuccessful) return text
                val retry = req.method == "GET" && r.code in TRANSIENT_CODES && attempt < GET_RETRIES
                if (!retry) throw errorOf(r.code, text)
                val hinted = r.header("Retry-After")?.trim()?.toLongOrNull()?.times(1000)
                wait = (hinted ?: (1500L shl attempt)).coerceIn(500L, 8_000L)
            }
            attempt++
            delay(wait)
        }
    }

    suspend inline fun <reified T> get(path: String): T =
        AppJson.decodeFromString(call(Request.Builder().url(url(path)).get().build()))

    suspend inline fun <reified T> post(path: String, body: JsonElement? = null): T =
        AppJson.decodeFromString(call(Request.Builder().url(url(path)).post(jsonBody(body)).build()))

    suspend inline fun <reified T> patch(path: String, body: JsonElement? = null): T =
        AppJson.decodeFromString(call(Request.Builder().url(url(path)).patch(jsonBody(body)).build()))

    suspend inline fun <reified T> put(path: String, body: JsonElement? = null): T =
        AppJson.decodeFromString(call(Request.Builder().url(url(path)).put(jsonBody(body)).build()))

    suspend fun postIgnore(path: String, body: JsonElement? = null) {
        call(Request.Builder().url(url(path)).post(jsonBody(body)).build())
    }

    suspend fun delete(path: String, body: JsonElement? = null) {
        call(Request.Builder().url(url(path)).delete(jsonBody(body)).build())
    }

    suspend fun postBody(path: String, body: RequestBody): String =
        call(Request.Builder().url(url(path)).post(body).build())

    fun jsonBody(body: JsonElement?): RequestBody =
        (body?.toString() ?: "{}").toRequestBody(JSON_TYPE)

    companion object {
        const val RETRY_HEADER = "X-PC-Retry"
        /** Respostas de "servidor reiniciando/atualizando" (proxy na frente do site). */
        val TRANSIENT_CODES = setOf(502, 503, 504)
        private const val GET_RETRIES = 2
        val JSON_TYPE = "application/json; charset=utf-8".toMediaType()
        private val EMPTY_JSON = "{}".toRequestBody(JSON_TYPE)

        fun errorOf(code: Int, text: String): ApiException {
            val json = runCatching { AppJson.parseToJsonElement(text).jsonObject }.getOrNull()
            val msg = json?.get("error")?.let { runCatching { it.jsonPrimitive.content }.getOrNull() }
                ?: when (code) {
                    429 -> "Muitas tentativas. Espere um pouco."
                    502, 503, 504 -> "O Project Club está sendo atualizado. Tente de novo em instantes."
                    in 500..599 -> "O servidor não respondeu agora. Tente de novo."
                    else -> "Não deu certo (erro $code)."
                }
            return ApiException(code, msg, json)
        }
    }
}
