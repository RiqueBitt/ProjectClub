package com.projectclub.android.data

import okio.ByteString.Companion.decodeBase64
import okio.ByteString.Companion.toByteString
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Proteção do que mantém a pessoa logada (cookies de login da conta ativa e das
 * contas guardadas). Antes ficava como texto puro no armazenamento privado do
 * app; agora é gravado criptografado com uma chave que mora no cofre do Android
 * (Keystore) e não sai do aparelho — quem copiar os arquivos do app (backup,
 * aparelho com root, outro celular) não consegue usar a sessão.
 *
 * A lógica fica separada do Android pra ter teste sem celular
 * (SessionSecretsLogicTest); a chave de verdade está em SessionKey.kt.
 */
interface Sealer {
    /** Texto pronto pra gravar; null se não deu pra criptografar agora. */
    fun seal(plain: String): String?

    /** Texto original; null se não é um texto protegido ou se não deu pra abrir. */
    fun open(sealed: String): String?
}

/** AES-256-GCM: além de esconder, percebe se o texto gravado foi mexido. */
class AesGcmSealer(private val key: () -> SecretKey) : Sealer {
    override fun seal(plain: String): String? = try {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key()) // o próprio cofre sorteia o IV, um por gravação
        val body = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        // Base64 do okio (o java.util.Base64 só existe a partir do Android 8).
        PREFIX + (cipher.iv + body).toByteString().base64()
    } catch (_: Exception) {
        null
    }

    override fun open(sealed: String): String? {
        if (!isSealed(sealed)) return null
        return try {
            val raw = sealed.substring(PREFIX.length).decodeBase64()?.toByteArray() ?: return null
            if (raw.size <= IV_SIZE) return null
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, raw, 0, IV_SIZE))
            String(cipher.doFinal(raw, IV_SIZE, raw.size - IV_SIZE), Charsets.UTF_8)
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        /** Marca do texto protegido. O que as versões antigas gravavam é JSON e nunca começa assim. */
        const val PREFIX = "pc1:"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_SIZE = 12
        private const val TAG_BITS = 128

        fun isSealed(value: String) = value.startsWith(PREFIX)
    }
}

/**
 * Um texto guardado no aparelho, sempre protegido.
 * [load] e [save] dizem onde ele mora (SharedPreferences no app; um mapa nos testes).
 */
class SealedValue(
    private val load: () -> String?,
    private val save: (String?) -> Unit,
    private val sealer: Sealer,
) {
    /**
     * Lê o texto. O que uma versão antiga do app gravou sem proteção é lido
     * normalmente e já regravado protegido: ninguém é deslogado na atualização.
     */
    fun read(): String? {
        val stored = load() ?: return null
        if (!AesGcmSealer.isSealed(stored)) {
            write(stored)
            return stored
        }
        // O cofre do Android às vezes falha de passagem: tenta mais uma vez antes de desistir.
        return sealer.open(stored) ?: sealer.open(stored)
    }

    /**
     * Grava protegido. Se o cofre do aparelho não funcionar agora, grava como as
     * versões antigas gravavam: perder a proteção é melhor do que deslogar a pessoa.
     */
    fun write(value: String?) {
        save(if (value == null) null else sealer.seal(value) ?: value)
    }
}
