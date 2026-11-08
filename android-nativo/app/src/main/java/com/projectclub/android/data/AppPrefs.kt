package com.projectclub.android.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Preferências de aparência guardadas no aparelho (valem na hora, sem esperar o servidor). */
object AppPrefs {
    private const val FILE = "app_prefs"
    private val _textScale = MutableStateFlow(1f)
    /** Tamanho do texto (0.8–1.5), igual ao "Tamanho da fonte" do PC. */
    val textScale: StateFlow<Float> = _textScale

    fun init(context: Context) {
        _textScale.value = context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getFloat("textScale", 1f).coerceIn(0.8f, 1.5f)
    }

    fun setTextScale(context: Context, v: Float) {
        val x = (Math.round(v * 20) / 20f).coerceIn(0.8f, 1.5f)
        _textScale.value = x
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putFloat("textScale", x).apply()
    }
}
