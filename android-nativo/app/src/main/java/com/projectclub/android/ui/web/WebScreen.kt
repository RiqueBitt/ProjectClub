package com.projectclub.android.ui.web

import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.projectclub.android.ui.theme.PC

/** Partes do Project Club que não são nativas: o site, dentro do app, sem recarregar a cada menu. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WebScreen(host: WebHost, path: String, onBack: () -> Unit) {
    val ctx = LocalContext.current
    val title by host.title.collectAsState()
    val progress by host.progress.collectAsState()
    val booting by host.booting.collectAsState()
    val offline by host.offline.collectAsState()
    var fileCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }

    val chooser = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        fileCallback = null
    }

    LaunchedEffect(path) { host.open(path) }
    DisposableEffect(Unit) {
        host.fileChooser = { cb, params ->
            fileCallback?.onReceiveValue(null)
            fileCallback = cb
            try { chooser.launch(params.createIntent()); true } catch (_: Exception) { fileCallback = null; false }
        }
        onDispose { host.fileChooser = null }
    }
    BackHandler { if (!host.back()) onBack() }

    Scaffold(
        containerColor = PC.Bg,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = PC.Bar),
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Voltar") } },
                title = { Text(if (booting) "Project Club" else title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                actions = { IconButton(onClick = { host.reload() }) { Icon(Icons.Filled.Refresh, "Recarregar") } },
            )
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                // Cada tela tem sua moldura; o WebView (único) muda de moldura.
                factory = { FrameLayout(it).apply { addView(host.attach(ctx), ViewGroup.LayoutParams(-1, -1)) } },
                onRelease = { frame: FrameLayout -> host.detach(frame) },
            )
            // Capa enquanto o site inicia (só na 1ª vez): sem a tela "Carregando..." do site piscando.
            AnimatedVisibility(visible = booting && !offline, exit = fadeOut()) {
                com.projectclub.android.ui.common.LoadingScreen("Abrindo...")
            }
            if (!booting && progress in 0.01f..0.99f) {
                LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth().align(Alignment.TopCenter), color = PC.Brand)
            }
            if (offline) Offline(onRetry = { host.retry() })
        }
    }
}

@Composable
private fun Offline(onRetry: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(PC.Bg).padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Filled.CloudOff, null, tint = PC.Muted, modifier = Modifier.size(48.dp))
        Spacer(Modifier.height(12.dp))
        Text("Não deu pra abrir agora", fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Text("Assim que a internet voltar, a página abre sozinha.", color = PC.Muted, textAlign = TextAlign.Center)
        Spacer(Modifier.height(16.dp))
        Button(onClick = onRetry) { Text("Tentar de novo") }
    }
}
