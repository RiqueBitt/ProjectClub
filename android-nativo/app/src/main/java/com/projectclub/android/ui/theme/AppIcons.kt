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
    private fun aliasOf(context: Context, id: String) =
        ComponentName(context, "com.projectclub.android." + if (id == "default") "LauncherDefault" else "Launcher_$id")

    fun current(context: Context): String {
        val pm = context.packageManager
        return APP_ICONS.firstOrNull { icon ->
            val state = pm.getComponentEnabledSetting(aliasOf(context, icon.id))
            if (icon.id == "default") state != PackageManager.COMPONENT_ENABLED_STATE_DISABLED && APP_ICONS.drop(1).none { other ->
                pm.getComponentEnabledSetting(aliasOf(context, other.id)) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            } else state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        }?.id ?: "default"
    }

    /** Liga o ícone escolhido e desliga os outros (sem fechar o app). */
    fun set(context: Context, id: String) {
        if (APP_ICONS.none { it.id == id }) return
        val pm = context.packageManager
        // Primeiro liga o novo (nunca fica sem nenhum ícone na tela inicial).
        pm.setComponentEnabledSetting(aliasOf(context, id), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
        APP_ICONS.filter { it.id != id }.forEach {
            pm.setComponentEnabledSetting(aliasOf(context, it.id), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
        }
    }
}
