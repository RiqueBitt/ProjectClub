package com.projectclub.android.ui.forum

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.AddPhotoAlternate
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Title
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import com.projectclub.android.data.ForumCommunity
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Criar post no Fórum: tema, categoria, título, texto, imagem ou link e até 3 tags. */
@Composable
fun NewPostScreen(repo: Repository, nav: AppNav, communitySlug: String?) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var communities by remember { mutableStateOf<List<ForumCommunity>>(emptyList()) }
    var slug by remember { mutableStateOf(communitySlug) }
    var categoryId by remember { mutableStateOf<String?>(null) }
    var title by remember { mutableStateOf("") }
    var content by remember { mutableStateOf("") }
    var link by remember { mutableStateOf("") }
    var image by remember { mutableStateOf<Uri?>(null) }
    var tags by remember { mutableStateOf(setOf<String>()) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        communities = runCatching { ForumApi.communities(repo) }.getOrDefault(emptyList())
        if (slug == null) slug = communities.firstOrNull()?.slug
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) image = uri }
    val current = communities.firstOrNull { it.slug == slug }

    fun publish() {
        val s = slug ?: return toast(ctx, "Escolha um tema.")
        if (title.isBlank()) return toast(ctx, "Dê um título ao post.")
        busy = true
        scope.launch {
            try {
                val imageUrl = image?.let { ForumApi.uploadImage(repo, ctx, it) }
                val type = when { imageUrl != null -> "IMAGE"; link.isNotBlank() -> "LINK"; else -> "TEXT" }
                val body = buildJsonObject {
                    put("communitySlug", s)
                    categoryId?.let { put("categoryId", it) }
                    put("title", title.trim())
                    put("type", type)
                    if (content.isNotBlank()) put("content", content.trim())
                    imageUrl?.let { put("imageUrl", it) }
                    if (type == "LINK") put("linkUrl", link.trim())
                    if (tags.isNotEmpty()) put("tags", buildJsonArray { tags.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } })
                }
                val post = ForumApi.createPost(repo, body)
                toast(ctx, "Post publicado!")
                nav.back()
                post?.id?.let(nav::post)
            } catch (e: Exception) { toast(ctx, errorText(e)) }
            busy = false
        }
    }

    Column(Modifier.fillMaxSize().background(PC.Bg).imePadding()) {
        PcTopBar("Novo post", Icons.Outlined.EditNote, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("TEMA", style = MaterialTheme.typography.labelMedium, color = PC.Text)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                communities.forEach { c ->
                    SelectPill(c.name, c.slug == slug, { slug = c.slug; categoryId = null; tags = emptySet() }, leading = { ClubIcon(c.iconUrl, c.name, 20.dp) })
                }
            }
            current?.categories?.takeIf { it.isNotEmpty() }?.let { cats ->
                Text("CATEGORIA", style = MaterialTheme.typography.labelMedium, color = PC.Text)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    cats.sortedBy { it.position }.forEach { cat -> SelectPill(cat.name, cat.id == categoryId, { categoryId = if (categoryId == cat.id) null else cat.id }) }
                }
            }
            PcField(title, { title = it.take(300) }, "Sobre o que é o post?", label = "Título", icon = Icons.Outlined.Title)
            PcField(content, { content = it }, "Escreva aqui (opcional)", label = "Texto", singleLine = false, modifier = Modifier.heightIn(min = 120.dp))
            if (image == null) PcField(link, { link = it }, "https://... (opcional)", label = "Link", icon = Icons.Outlined.Link)
            image?.let { uri ->
                Box {
                    AsyncImage(uri, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().height(220.dp).clip(RoundedCornerShape(18.dp)))
                    IconButton(onClick = { image = null }, modifier = Modifier.align(Alignment.TopEnd).padding(8.dp).clip(CircleShape).background(Color(0xAA000000))) {
                        Icon(Icons.Outlined.Close, "Remover imagem", tint = Color.White)
                    }
                }
            } ?: Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).border(1.dp, PC.LineStrong, RoundedCornerShape(18.dp))
                    .clickable { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
            ) {
                Icon(Icons.Outlined.AddPhotoAlternate, null, tint = PC.Brand, modifier = Modifier.size(22.dp))
                Text("  Adicionar imagem", color = PC.Text, style = MaterialTheme.typography.labelLarge)
            }
            current?.postTags?.takeIf { it.isNotEmpty() }?.let { all ->
                Text("TAGS (ATÉ 3)", style = MaterialTheme.typography.labelMedium, color = PC.Text)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    all.forEach { t ->
                        SelectPill(t, t in tags, { tags = if (t in tags) tags - t else if (tags.size < 3) tags + t else tags })
                    }
                }
            }
        }
        PillButton("Publicar", ::publish, Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp), enabled = title.isNotBlank() && slug != null, busy = busy)
    }
}
