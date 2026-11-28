package com.projectclub.android.ui.announcements

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.ActiveAnnouncementResponse
import com.projectclub.android.data.PlatformAnnouncement
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Comunicado do Painel da Staff, igual ao do site/PC: aparece em tela cheia
 * ao abrir o app (e enquanto ele está aberto, checando a cada 60s). "OK"
 * marca como visto na conta — não aparece de novo em nenhum aparelho — e já
 * mostra o próximo se tiver mais de um esperando.
 */
@Composable
fun PlatformAnnouncementDialog(repo: Repository, openLink: (String) -> Unit) {
    var current by remember { mutableStateOf<PlatformAnnouncement?>(null) }
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    suspend fun check() {
        runCatching { repo.api.get<ActiveAnnouncementResponse>("/api/platform/announcements/active").announcement }
            .onSuccess { a -> if (current == null && a != null && a.id.isNotBlank()) current = a }
    }

    // Só checa com o app na tela; ao voltar pro app checa na hora.
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                if (current == null) check()
                delay(60_000)
            }
        }
    }

    val a = current ?: return
    fun dismiss() {
        current = null
        scope.launch {
            runCatching { repo.api.postIgnore("/api/platform/announcements/${a.id}/dismiss") }
            check()
        }
    }

    Dialog(onDismissRequest = {}, properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false, usePlatformDefaultWidth = false)) {
        val shape = RoundedCornerShape(24.dp)
        Column(
            Modifier.padding(20.dp).fillMaxWidth().heightIn(max = 640.dp)
                .clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape),
        ) {
            Config.media(a.bannerUrl)?.let {
                AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().heightIn(max = 200.dp))
            }
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 18.dp)) {
                Text(a.title, style = MaterialTheme.typography.headlineSmall, color = PC.Header)
                a.description?.takeIf { it.isNotBlank() }?.let {
                    Spacer(Modifier.height(10.dp))
                    Text(it, style = MaterialTheme.typography.bodyLarge, color = PC.Text)
                }
            }
            Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 20.dp)) {
                a.buttonUrl?.takeIf { it.isNotBlank() }?.let { url ->
                    GhostButton(a.buttonLabel?.takeIf { it.isNotBlank() } ?: "Saiba mais", { openLink(url) }, Modifier.fillMaxWidth())
                    Spacer(Modifier.height(10.dp))
                }
                PillButton("OK", ::dismiss, Modifier.fillMaxWidth())
            }
        }
    }
}
