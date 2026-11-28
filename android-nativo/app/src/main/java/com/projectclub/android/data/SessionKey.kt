package com.projectclub.android.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * A chave que protege a sessão (ver SessionSecrets.kt). Ela é criada dentro do
 * cofre do Android na primeira vez e nunca sai de lá: o app só pede pro cofre
 * criptografar e abrir. Sem exigir digital nem senha, porque as notificações
 * em segundo plano também precisam da sessão.
 */
object SessionKey {
    private const val STORE = "AndroidKeyStore"
    private const val ALIAS = "pc_session_v1"

    @Synchronized
    fun get(): SecretKey {
        val store = KeyStore.getInstance(STORE).apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, STORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    /** O protetor usado pelo app inteiro. */
    val sealer: Sealer = AesGcmSealer { get() }
}
