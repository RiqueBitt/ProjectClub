package com.projectclub.android.ui.profile

import android.content.Context
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.EmojiEmotions
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.AppJson
import com.projectclub.android.data.MeResponse
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

/** Editar o próprio perfil: fotos, nome, pronomes, bio e status. */
@Composable
fun EditProfileScreen(repo: Repository, nav: AppNav) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val me by repo.me.collectAsState()
    var displayName by remember { mutableStateOf(me?.displayName.orEmpty()) }
    var pronouns by remember { mutableStateOf(me?.pronouns.orEmpty()) }
    var bio by remember { mutableStateOf(me?.bio.orEmpty()) }
    var statusText by remember { mutableStateOf(me?.customStatus.orEmpty()) }
    var statusEmoji by remember { mutableStateOf(me?.customStatusEmoji.orEmpty()) }
    var avatar by remember { mutableStateOf<Uri?>(null) }
    var banner by remember { mutableStateOf<Uri?>(null) }
    var busy by remember { mutableStateOf(false) }

    val pickAvatar = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { if (it != null) avatar = it }
    val pickBanner = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { if (it != null) banner = it }
    val images = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)

    fun save() {
        busy = true
        scope.launch {
            try {
                avatar?.let { upload(repo, ctx, it, "/api/users/me/avatar", "avatar")?.let(repo::updateMe) }
                banner?.let { upload(repo, ctx, it, "/api/users/me/banner", "banner")?.let(repo::updateMe) }
                val r = repo.api.patch<MeResponse>("/api/users/me", buildJsonObject {
                    put("displayName", displayName.trim())
                    put("pronouns", pronouns.trim())
                    put("bio", bio.trim())
                })
                repo.updateMe(r.user)
                if (statusText != me?.customStatus.orEmpty() || statusEmoji != me?.customStatusEmoji.orEmpty()) {
                    runCatching {
                        repo.api.patch<MeResponse>("/api/users/me/custom-status", buildJsonObject { put("text", statusText.trim()); put("emoji", statusEmoji.trim()) })
                    }.getOrNull()?.let { repo.updateMe(it.user) }
                }
                Toast.makeText(ctx, "Perfil salvo!", Toast.LENGTH_SHORT).show()
                nav.back()
            } catch (e: Exception) {
                Toast.makeText(ctx, e.message ?: "Não deu pra salvar.", Toast.LENGTH_LONG).show()
            }
            busy = false
        }
    }

    Column(Modifier.fillMaxSize().background(PC.Bg).imePadding()) {
        PcTopBar("Editar perfil", Icons.Outlined.Edit, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            // Banner + avatar (toque para trocar)
            Box(Modifier.fillMaxWidth().height(170.dp)) {
                Box(Modifier.fillMaxWidth().height(130.dp).background(PC.HeroGradient).clickable { pickBanner.launch(images) }) {
                    val b = banner ?: Config.media(me?.bannerUrl)
                    if (b != null) AsyncImage(b, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    Row(
                        Modifier.align(Alignment.TopEnd).padding(10.dp).clip(CircleShape).background(Color(0x99000000)).padding(horizontal = 10.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Outlined.PhotoCamera, null, tint = Color.White, modifier = Modifier.size(16.dp))
                        Text(" Banner", color = Color.White, style = MaterialTheme.typography.labelMedium)
                    }
                }
                Box(
                    Modifier.padding(start = 18.dp, top = 76.dp).size(92.dp).clip(CircleShape).background(PC.Bg).clickable { pickAvatar.launch(images) },
                    contentAlignment = Alignment.Center,
                ) {
                    val a = avatar
                    if (a != null) AsyncImage(a, null, contentScale = ContentScale.Crop, modifier = Modifier.size(82.dp).clip(CircleShape))
                    else Avatar(me, 82.dp)
                    Box(Modifier.align(Alignment.BottomEnd).size(28.dp).clip(CircleShape).background(PC.Brand), contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.PhotoCamera, "Trocar foto", tint = Color.White, modifier = Modifier.size(16.dp))
                    }
                }
            }
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                PcField(displayName, { displayName = it.take(32) }, me?.username ?: "", label = "Nome de exibição", icon = Icons.Outlined.Person)
                PcField(pronouns, { pronouns = it.take(40) }, "ele/dele, ela/dela...", label = "Pronomes", icon = Icons.Outlined.Badge)
                PcField(bio, { bio = it.take(500) }, "Conte um pouco sobre você", label = "Sobre mim", singleLine = false, modifier = Modifier.heightIn(min = 130.dp))
                Text("${bio.length}/500", color = PC.Faint, style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PcField(statusEmoji, { statusEmoji = it.take(8) }, "🎮", label = "Emoji", modifier = Modifier.width(96.dp))
                    PcField(statusText, { statusText = it.take(128) }, "O que você está fazendo?", label = "Status", icon = Icons.Outlined.EmojiEmotions, modifier = Modifier.weight(1f))
                }
            }
        }
        PillButton("Salvar", ::save, Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp), busy = busy)
    }
}

/** Envia avatar/banner (multipart) e devolve o usuário atualizado, se o servidor mandar. */
private suspend fun upload(repo: Repository, ctx: Context, uri: Uri, path: String, field: String): com.projectclub.android.data.User? {
    val picked = repo.describe(uri)
    val bytes = withContext(Dispatchers.IO) { ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } }
        ?: throw java.io.IOException("Não deu pra ler a imagem.")
    val body = MultipartBody.Builder().setType(MultipartBody.FORM)
        .addFormDataPart(field, picked.name, bytes.toRequestBody(picked.mime.toMediaTypeOrNull()))
        .build()
    val text = repo.api.postBody(path, body)
    return runCatching { AppJson.decodeFromString(MeResponse.serializer(), text).user }.getOrNull()
}
