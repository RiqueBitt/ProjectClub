package com.projectclub.android

import android.os.Build

object Config {
    /** Servidor do Project Club (mesmo do site e do app atual). */
    val baseUrl: String = BuildConfig.BASE_URL.trimEnd('/')

    /**
     * User-Agent fixo do app. O servidor guarda o aparelho de cada sessão por
     * ele (lista de sessões mostra "App no Android") e usa pra recuperar a
     * sessão quando o aparelho volta com o cookie anterior — por isso não
     * pode mudar entre aberturas.
     */
    val userAgent: String =
        "ProjectClub/${BuildConfig.VERSION_NAME} (Linux; Android ${Build.VERSION.RELEASE}; ${Build.MODEL}) Nativo"

    /** URLs de mídia vêm relativas ("/media/..."); externas ficam como estão. */
    fun media(url: String?): String? = when {
        url.isNullOrBlank() -> null
        url.startsWith("//") -> "https:$url"
        url.startsWith("/") -> baseUrl + url
        else -> url
    }
}
