package com.projectclub.android.voice

import android.content.Context
import android.content.SharedPreferences

/**
 * Preferências de voz guardadas no aparelho (o que vale na hora da chamada):
 * volume geral de saída, volume de cada pessoa e o processamento do microfone.
 * As mesmas chaves também vão pra conta (/api/users/me/settings), mas o que a
 * chamada lê é daqui — funciona até sem internet e muda na hora.
 */
class VoicePrefs(context: Context) {
    private val sp: SharedPreferences = context.applicationContext.getSharedPreferences("voice_prefs", Context.MODE_PRIVATE)
    private val listeners = mutableListOf<() -> Unit>()

    var noiseSuppression: Boolean
        get() = sp.getBoolean("noiseSuppression", true)
        set(v) { sp.edit().putBoolean("noiseSuppression", v).apply(); changed() }
    var echoCancellation: Boolean
        get() = sp.getBoolean("echoCancellation", true)
        set(v) { sp.edit().putBoolean("echoCancellation", v).apply(); changed() }
    var automaticGain: Boolean
        get() = sp.getBoolean("automaticGain", true)
        set(v) { sp.edit().putBoolean("automaticGain", v).apply(); changed() }

    /** Volume geral de quem você ouve, 0–200 (%). */
    var outputVolume: Int
        get() = sp.getInt("outputVolume", 100)
        set(v) { sp.edit().putInt("outputVolume", v.coerceIn(0, 200)).apply(); changed() }

    /** Volume de uma pessoa, 0–200 (%). */
    fun userVolume(userId: String): Int = sp.getInt("vol:$userId", 100)
    fun setUserVolume(userId: String, v: Int) { sp.edit().putInt("vol:$userId", v.coerceIn(0, 200)).apply(); changed() }

    /** Ganho final de uma pessoa (pessoa × geral), 0.0–4.0. */
    fun gainFor(userId: String): Double = (userVolume(userId) / 100.0) * (outputVolume / 100.0)

    fun onChange(l: () -> Unit) { synchronized(listeners) { listeners += l } }
    private fun changed() { synchronized(listeners) { listeners.toList() }.forEach { runCatching { it() } } }

    companion object {
        @Volatile private var inst: VoicePrefs? = null
        fun get(context: Context): VoicePrefs = inst ?: synchronized(this) { inst ?: VoicePrefs(context).also { inst = it } }
    }
}
