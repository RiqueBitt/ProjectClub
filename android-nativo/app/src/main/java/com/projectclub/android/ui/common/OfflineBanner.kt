package com.projectclub.android.ui.common

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * Faixa "Sem conexão — mostrando o que foi salvo" no topo de todas as telas.
 * Quando aparece, ela fica com o espaço da barra de status e as telas de
 * baixo deixam de somar esse espaço de novo (consumeWindowInsets).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OfflineFrame(offline: Boolean, text: String, pending: Int, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        AnimatedVisibility(offline, enter = expandVertically(), exit = shrinkVertically()) {
            Row(
                Modifier.fillMaxWidth().background(Color(0xFF3A3A40)).statusBarsPadding()
                    .padding(horizontal = 14.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.CloudOff, null, tint = Color.White, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(8.dp))
                Text(
                    text + if (pending > 0) " · $pending pendente" + (if (pending > 1) "s" else "") else "",
                    color = Color.White, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelMedium,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Box(
            Modifier.weight(1f).fillMaxWidth()
                .then(if (offline) Modifier.consumeWindowInsets(WindowInsets.statusBars) else Modifier),
        ) { content() }
    }
}
