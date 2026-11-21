package com.projectclub.android.data.offline

import java.io.File

/**
 * Cache em disco do modo offline: um arquivo de texto (JSON) por chave, com
 * teto de tamanho. Passou do teto, apaga os arquivos usados há mais tempo
 * (LRU pela data de modificação — ler uma chave "toca" o arquivo).
 *
 * Java puro (sem Android): testável no JVM (OfflineLogicTest).
 */
class OfflineCache(
    private val dir: File,
    private val maxBytes: Long = DEFAULT_MAX_BYTES,
    private val now: () -> Long = System::currentTimeMillis,
) {
    @Synchronized
    fun put(key: String, text: String) {
        runCatching {
            if (!dir.exists()) dir.mkdirs()
            val target = fileFor(key)
            // Escreve num temporário e renomeia: o app fechado no meio não deixa JSON pela metade.
            val tmp = File(dir, target.name + ".tmp")
            tmp.writeText(text, Charsets.UTF_8)
            if (!tmp.renameTo(target)) {
                target.delete()
                if (!tmp.renameTo(target)) { tmp.delete(); return }
            }
            target.setLastModified(now())
            trim(protect = target)
        }
    }

    @Synchronized
    fun get(key: String): String? {
        val f = fileFor(key)
        if (!f.isFile) return null
        return runCatching { f.readText(Charsets.UTF_8) }.getOrNull()?.also { f.setLastModified(now()) }
    }

    @Synchronized
    fun remove(key: String) { fileFor(key).delete() }

    @Synchronized
    fun contains(key: String): Boolean = fileFor(key).isFile

    /** Apaga tudo (sair da conta: nada do usuário anterior fica no aparelho). */
    @Synchronized
    fun clear() { dir.listFiles()?.forEach { it.delete() } }

    @Synchronized
    fun sizeBytes(): Long = files().sumOf { it.length() }

    private fun files(): List<File> = dir.listFiles()?.filter { it.isFile && it.name.endsWith(EXT) }.orEmpty()

    /** Apaga os mais antigos até caber no teto (nunca o que acabou de ser gravado). */
    private fun trim(protect: File?) {
        val all = files()
        var total = all.sumOf { it.length() }
        if (total <= maxBytes) return
        for (f in all.sortedBy { it.lastModified() }) {
            if (total <= maxBytes) break
            if (f == protect) continue
            val len = f.length()
            if (f.delete()) total -= len
        }
    }

    internal fun fileFor(key: String): File = File(dir, safeName(key) + EXT)

    companion object {
        /** JSON das conversas/perfil/feed (as imagens têm o próprio cache do Coil). */
        const val DEFAULT_MAX_BYTES = 10L * 1024 * 1024
        private const val EXT = ".json"

        /** Nome de arquivo seguro e sem colisão para qualquer chave. */
        fun safeName(key: String): String {
            val clean = key.replace(Regex("[^A-Za-z0-9_-]"), "_").take(60)
            return clean + "-" + Integer.toHexString(key.hashCode())
        }
    }
}
