package com.projectclub.android.ui.nav

import com.projectclub.android.data.Room

/**
 * Navegação entre as telas nativas. Toda tela recebe um [AppNav] e nunca
 * mexe no NavController direto (MainActivity implementa).
 */
interface AppNav {
    fun back()

    // Conversas e voz
    fun room(room: Room)
    fun dmWith(userId: String)
    fun joinVoice(channelName: String, title: String)

    // Telas nativas
    /** Toque numa pessoa: abre o MINIPERFIL (folha). */
    fun profile(userId: String)
    /** Perfil completo (tela inteira). */
    fun fullProfile(userId: String)
    fun editProfile()
    fun store(tab: String? = null)
    fun economy()
    fun progress(tab: String? = null)   // tab: "ranks" | "conquistas" | "recompensas"
    fun forum()
    fun forumCommunity(slug: String)
    fun post(postId: String)
    fun newPost(communitySlug: String? = null)
    fun events()
    fun event(eventId: String)
    fun announcements()
    fun clubs()
    fun club(clubId: String)
    fun tickets()
    fun ticket(ticketId: String)
    fun gallery()
    fun settings()
    fun activity()
    fun search()
    fun games(userId: String = "me")
    fun trades()

    /** Endereço do site ("/loja", "/u/123", "/posts/abc"...): abre a tela nativa certa ou o Chrome. */
    fun link(pathOrUrl: String)

    /** Abre fora do app (aba do Chrome). Só para o que não tem versão nativa. */
    fun external(url: String)
}
