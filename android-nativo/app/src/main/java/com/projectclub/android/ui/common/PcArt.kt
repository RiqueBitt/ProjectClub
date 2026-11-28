package com.projectclub.android.ui.common

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import com.projectclub.android.R

/*
 * Ícones desenhados do site (client/src/assets/icons e public/progresso),
 * copiados pra res/drawable-nodpi: a moeda "PC", a gema, a estrela de nível,
 * a medalha das conquistas, o troféu do ranking, o presente...
 *
 * `colored = true`: arte colorida, aparece como é (sem tingir).
 * `colored = false`: ícone de traço (PNG preto com transparência), tingido
 * na cor de quem usa, igual aos ícones do Material.
 */
enum class PcArt(@DrawableRes val res: Int, val colored: Boolean) {
    Coin(R.drawable.pc_coin, true),
    Gem(R.drawable.pc_gem, true),
    LevelStar(R.drawable.pc_level_star, true),
    Medal(R.drawable.pc_medal, true),
    Podium(R.drawable.pc_podium, true),
    Achievements(R.drawable.pc_achievements, false),
    Ranks(R.drawable.pc_ranks, false),
    Gift(R.drawable.pc_gift, false),
    Crown(R.drawable.pc_crown, false),
    Star(R.drawable.pc_star, false),
    Mining(R.drawable.pc_mining, false),
    TicketStar(R.drawable.pc_ticket_star, false),
}

/**
 * Desenha um ícone que pode ser [ImageVector] (Material), [PcArt] (arte do
 * site) ou [Painter]. Os componentes do app que recebem "icon: Any" passam
 * por aqui, então dá pra usar a arte do site em qualquer um deles.
 */
@Composable
fun ArtIcon(icon: Any, tint: Color, modifier: Modifier = Modifier, contentDescription: String? = null) {
    when (icon) {
        is PcArt -> if (icon.colored) Image(painterResource(icon.res), contentDescription, modifier)
            else Icon(painterResource(icon.res), contentDescription, modifier, tint = tint)
        is ImageVector -> Icon(icon, contentDescription, modifier, tint = tint)
        is Painter -> Icon(icon, contentDescription, modifier, tint = tint)
        else -> error("Ícone não suportado: $icon")
    }
}

/** Moeda ou gema do site no tamanho pedido. */
@Composable
fun CurrencyArt(gems: Boolean, size: Dp, modifier: Modifier = Modifier) {
    Image(painterResource(if (gems) PcArt.Gem.res else PcArt.Coin.res), if (gems) "Gemas" else "Moedas", modifier.size(size))
}
