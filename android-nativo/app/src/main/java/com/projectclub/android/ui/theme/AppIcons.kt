package com.projectclub.android.ui.theme

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import com.projectclub.android.R

/**
 * Ícone do app no celular (igual ao "Ícone do app" do site/PC). Cada ícone é
 * um activity-alias no AndroidManifest; trocar liga um e desliga os outros.
 * O launcher pode levar alguns segundos pra atualizar o ícone na tela inicial.
 */
data class AppIcon(val id: String, val name: String, val res: Int)

val APP_ICONS = listOf(
    AppIcon("default", "Padrão", R.mipmap.ic_launcher),
    AppIcon("gotico", "Gótico", R.mipmap.ic_launcher_gotico),
    AppIcon("carvao", "Carvão", R.mipmap.ic_launcher_carvao),
    AppIcon("pastel", "Pastel", R.mipmap.ic_launcher_pastel),
    AppIcon("neon", "Neon", R.mipmap.ic_launcher_neon),
    AppIcon("sakura", "Sakura", R.mipmap.ic_launcher_sakura),
    AppIcon("oceano", "Oceano", R.mipmap.ic_launcher_oceano),
    AppIcon("ouro", "Ouro", R.mipmap.ic_launcher_ouro),
    AppIcon("holograma", "Holograma", R.mipmap.ic_launcher_holograma),
    AppIcon("menta", "Menta", R.mipmap.ic_launcher_menta),
    AppIcon("arcoiris", "Arco-íris", R.mipmap.ic_launcher_arcoiris),
    AppIcon("crepusculo", "Crepúsculo", R.mipmap.ic_launcher_crepusculo),
    AppIcon("uwu", "uwu~", R.mipmap.ic_launcher_uwu),
    AppIcon("tatico", "Tático", R.mipmap.ic_launcher_tatico),
)

object AppIcons {
    private const val PREFS = "app_prefs"
    private const val KEY_PENDING = "pendingAppIcon"

    private fun aliasOf(context: Context, id: String) =
        ComponentName(context, "com.projectclub.android." + if (id == "default") "LauncherDefault" else "Launcher_$id")

    /** Ícone que está ligado na tela inicial agora. */
    private fun applied(context: Context): String {
        val pm = context.packageManager
        val on = APP_ICONS.drop(1).firstOrNull { pm.getComponentEnabledSetting(aliasOf(context, it.id)) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED }
        return on?.id ?: "default"
    }

    /** O escolhido (mesmo que ainda vá ser aplicado quando sair do app). */
    fun current(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_PENDING, null)?.takeIf { id -> APP_ICONS.any { it.id == id } }
            ?: applied(context)

    /**
     * Escolhe o ícone. A troca de verdade acontece quando você sai do app
     * ([applyPending], chamado no App.onStop): trocar com o app aberto faz
     * vários launchers (Samsung, Xiaomi, Motorola) fecharem o app ou não
     * atualizarem a tela inicial.
     */
    fun set(context: Context, id: String) {
        if (APP_ICONS.none { it.id == id }) return
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (id == applied(context)) p.edit().remove(KEY_PENDING).apply()
        else p.edit().putString(KEY_PENDING, id).apply()
    }

    /** Aplica o ícone escolhido (app em segundo plano). */
    fun applyPending(context: Context) {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val id = p.getString(KEY_PENDING, null) ?: return
        p.edit().remove(KEY_PENDING).apply()
        if (APP_ICONS.none { it.id == id }) return
        runCatching {
            val pm = context.packageManager
            // Primeiro liga o novo (nunca fica sem nenhum ícone), depois desliga os outros.
            pm.setComponentEnabledSetting(aliasOf(context, id), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
            APP_ICONS.filter { it.id != id }.forEach {
                val want = PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                if (pm.getComponentEnabledSetting(aliasOf(context, it.id)) != want || it.id == "default") {
                    pm.setComponentEnabledSetting(aliasOf(context, it.id), want, PackageManager.DONT_KILL_APP)
                }
            }
        }
    }

    /** Ícone salvo na conta (extraPrefs.appIcon, o mesmo do site/PC). */
    fun applyServer(context: Context, id: String?) {
        if (id == null || APP_ICONS.none { it.id == id }) return
        if (id != current(context)) set(context, id)
    }
}
