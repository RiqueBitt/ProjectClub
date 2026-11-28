package com.projectclub.android.ui.home

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.Box
import com.projectclub.android.data.CommunityInfo
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch

/**
 * Seletor de instância (Pública, Amigos, Empresarial...) no topo da aba
 * Comunidade — igual ao do site. Cada instância tem as próprias categorias,
 * canais e calls. Só aparece pra quem tem acesso a mais de uma.
 */
@Composable
fun InstanceSwitcher(repo: Repository, info: CommunityInfo?) {
    val list = info?.instances.orEmpty()
    if (list.size < 2) return
    val currentId = info?.instance ?: "publica"
    val current = list.firstOrNull { it.id == currentId } ?: list.first()
    var open by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val private = !current.isPublic

    Box {
        Row(
            Modifier
                .padding(end = 4.dp)
                .clip(RoundedCornerShape(8.dp))
                .then(if (private) Modifier.background(PC.Brand.copy(alpha = .16f)).border(1.dp, PC.Brand.copy(alpha = .5f), RoundedCornerShape(8.dp)) else Modifier)
                .clickable { open = true }
                .padding(horizontal = 10.dp, vertical = 6.dp)
                .semantics { contentDescription = "Instância: ${current.name}. Trocar de instância" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            current.icon?.let { Text(it, fontSize = 14.sp); Spacer(Modifier.width(6.dp)) }
            Text(
                current.name, color = if (private) PC.Header else PC.Muted, style = MaterialTheme.typography.labelLarge,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(end = 2.dp),
            )
            Icon(Icons.Outlined.KeyboardArrowDown, null, tint = PC.Muted, modifier = Modifier.size(18.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { if (busy == null) open = false }) {
            Text("INSTÂNCIA", color = PC.Muted, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
            list.forEach { inst ->
                DropdownMenuItem(
                    enabled = busy == null,
                    leadingIcon = { Text(inst.icon ?: "•", fontSize = 18.sp) },
                    text = {
                        Column {
                            Text(inst.name, color = PC.Header, style = MaterialTheme.typography.bodyLarge)
                            Text(if (inst.isPublic) "Todo mundo" else "Privada", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                        }
                    },
                    trailingIcon = {
                        when {
                            busy == inst.id -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = PC.Brand)
                            inst.id == currentId -> Icon(Icons.Outlined.Check, null, tint = PC.Brand)
                        }
                    },
                    onClick = {
                        if (inst.id == currentId) { open = false; return@DropdownMenuItem }
                        busy = inst.id
                        scope.launch {
                            runCatching { repo.switchInstance(inst.id) }
                                .onSuccess { open = false }
                                .onFailure {
                                    repo.report("instance-switch", it)
                                    Toast.makeText(context, "Não deu pra trocar de instância.", Toast.LENGTH_SHORT).show()
                                }
                            busy = null
                        }
                    },
                )
            }
            Spacer(Modifier.height(4.dp))
        }
    }
}
