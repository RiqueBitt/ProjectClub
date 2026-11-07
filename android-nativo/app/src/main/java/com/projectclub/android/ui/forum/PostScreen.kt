package com.projectclub.android.ui.forum

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.ForumComment
import com.projectclub.android.data.ForumPost
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch

private data class FlatComment(val c: ForumComment, val depth: Int)

private fun flatten(list: List<ForumComment>, depth: Int = 0): List<FlatComment> =
    list.flatMap { listOf(FlatComment(it, depth)) + flatten(it.replies, depth + 1) }

/** Post completo com comentários. */
@Composable
fun PostScreen(repo: Repository, nav: AppNav, postId: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val me by repo.me.collectAsState()
    var post by remember { mutableStateOf<ForumPost?>(null) }
    var comments by remember { mutableStateOf<List<ForumComment>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var text by remember { mutableStateOf("") }
    var replyTo by remember { mutableStateOf<ForumComment?>(null) }
    var sending by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }

    suspend fun load() {
        try {
            post = ForumApi.post(repo, postId) ?: throw IllegalStateException("Post não encontrado.")
            comments = runCatching { ForumApi.comments(repo, postId) }.getOrDefault(comments ?: emptyList())
            error = null
        } catch (e: Exception) { error = errorText(e) }
    }
    LaunchedEffect(postId) { load() }

    fun vote(v: Int) {
        val p = post ?: return
        post = p.withVote(v)
        scope.launch {
            try { val r = ForumApi.vote(repo, p.id, nextVote(p.myVote, v)); post = post?.copy(score = r.score, myVote = r.myVote) }
            catch (e: Exception) { post = p; toast(ctx, errorText(e)) }
        }
    }

    fun send() {
        val t = text.trim()
        if (t.isEmpty() || sending) return
        sending = true
        scope.launch {
            try {
                ForumApi.addComment(repo, postId, t, replyTo?.id)
                text = ""; replyTo = null
                comments = ForumApi.comments(repo, postId)
                post = post?.let { it.copy(commentCount = it.commentCount + 1) }
            } catch (e: Exception) { toast(ctx, errorText(e)) }
            sending = false
        }
    }

    Column(Modifier.fillMaxSize().background(PC.Bg).imePadding()) {
        val p = post
        val mine = p != null && (p.authorId == me?.id || p.author?.id == me?.id)
        PcTopBar(p?.community?.name ?: "Post", Icons.AutoMirrored.Outlined.Article, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } }) {
            if (p != null && isStaff(me)) IconButton(onClick = {
                scope.launch {
                    try { val r = ForumApi.pin(repo, p.id, !p.isPinned); post = p.copy(pinned = r.pinned, pinnedAt = r.pinnedAt) } catch (e: Exception) { toast(ctx, errorText(e)) }
                }
            }) { Icon(Icons.Outlined.PushPin, if (p.isPinned) "Desafixar" else "Fixar", tint = if (p.isPinned) PC.Yellow else PC.Muted) }
            if (mine || isStaff(me)) IconButton(onClick = { confirmDelete = true }) { Icon(Icons.Outlined.DeleteOutline, "Apagar post", tint = PC.Red) }
        }
        when {
            p == null && error != null -> EmptyState(Icons.Outlined.CloudOff, "Não deu pra abrir", error ?: "", Modifier.padding(top = 40.dp)) {
                GhostButton("Tentar de novo", { scope.launch { error = null; load() } })
            }
            p == null -> Column(Modifier.padding(16.dp)) { PostSkeletons(1); ListSkeleton(4, 32.dp) }
            else -> {
                LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    item(key = "post") {
                        Column {
                            if (p.isPinned) { PinnedFlag(); Spacer(Modifier.height(8.dp)) }
                            PostHeader(p, p.community?.slug?.let { s -> { nav.forumCommunity(s) } }, { p.author?.id?.let(nav::profile) })
                            Spacer(Modifier.height(12.dp))
                            Text(p.title, style = MaterialTheme.typography.headlineSmall, color = PC.Header)
                            if (p.tags.isNotEmpty()) Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) { p.tags.forEach { TagChip(it) } }
                            p.content?.takeIf { it.isNotBlank() }?.let {
                                Spacer(Modifier.height(10.dp))
                                Text(it, color = PC.Text, style = MaterialTheme.typography.bodyLarge)
                            }
                            Config.media(p.imageUrl)?.let { img ->
                                Spacer(Modifier.height(12.dp))
                                AsyncImage(img, null, contentScale = ContentScale.FillWidth, modifier = Modifier.fillMaxWidth().heightIn(max = 520.dp).clip(RoundedCornerShape(16.dp)).background(PC.Surface2))
                            }
                            p.linkUrl?.takeIf { it.isNotBlank() }?.let { link ->
                                Spacer(Modifier.height(10.dp))
                                Row(
                                    Modifier.clip(RoundedCornerShape(12.dp)).background(PC.Surface2).clickable { nav.link(link) }.padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(Icons.Outlined.Link, null, tint = PC.Brand, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(8.dp))
                                    Text(link, color = PC.Brand, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            p.poll?.let { poll ->
                                Spacer(Modifier.height(12.dp))
                                ForumPollBlock(poll, onVote = { opt ->
                                    scope.launch { try { ForumApi.pollVote(repo, p.id, opt)?.let { post = post?.copy(poll = it) } } catch (e: Exception) { toast(ctx, errorText(e)) } }
                                })
                            }
                            Spacer(Modifier.height(14.dp))
                            VotePill(p.score, p.myVote, ::vote)
                            Spacer(Modifier.height(18.dp))
                            Text("${p.commentCount} comentário${if (p.commentCount == 1) "" else "s"}", style = MaterialTheme.typography.titleMedium, color = PC.Header)
                        }
                    }
                    val flat = comments?.let { flatten(it) }
                    if (flat == null) item { ListSkeleton(3, 32.dp) }
                    else if (flat.isEmpty()) item { Text("Ninguém comentou ainda. Comece a conversa!", color = PC.Muted, modifier = Modifier.padding(vertical = 8.dp)) }
                    else items(flat, key = { it.c.id }) { fc ->
                        CommentRow(
                            fc, me?.id, isStaff(me),
                            onAuthor = { fc.c.author?.id?.let(nav::profile) },
                            onReply = { replyTo = fc.c },
                            onVote = { v ->
                                scope.launch {
                                    try { ForumApi.voteComment(repo, fc.c.id, nextVote(fc.c.myVote, v)); comments = ForumApi.comments(repo, postId) }
                                    catch (e: Exception) { toast(ctx, errorText(e)) }
                                }
                            },
                            onDelete = {
                                scope.launch {
                                    try { ForumApi.deleteComment(repo, fc.c.id); comments = ForumApi.comments(repo, postId) }
                                    catch (e: Exception) { toast(ctx, errorText(e)) }
                                }
                            },
                        )
                    }
                }
                // Caixa de comentário
                Column(Modifier.fillMaxWidth().background(PC.Bg).navigationBarsPadding().padding(horizontal = 10.dp, vertical = 8.dp)) {
                    replyTo?.let { r ->
                        Row(Modifier.padding(start = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.AutoMirrored.Outlined.Reply, null, tint = PC.Muted, modifier = Modifier.size(16.dp))
                            Text(" Respondendo a ${r.author?.name ?: "comentário"}", color = PC.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                            IconButton(onClick = { replyTo = null }, modifier = Modifier.size(28.dp)) { Icon(Icons.Outlined.Close, "Cancelar", tint = PC.Muted, modifier = Modifier.size(16.dp)) }
                        }
                    }
                    val shape = RoundedCornerShape(24.dp)
                    Row(
                        Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).padding(start = 16.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.weight(1f).padding(vertical = 8.dp)) {
                            if (text.isEmpty()) Text("Escreva um comentário...", color = PC.Faint)
                            BasicTextField(
                                text, { text = it }, maxLines = 5,
                                textStyle = MaterialTheme.typography.bodyLarge.copy(color = PC.Header),
                                cursorBrush = SolidColor(PC.Brand), modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        Box(
                            Modifier.size(42.dp).clip(RoundedCornerShape(14.dp)).background(if (text.isNotBlank()) PC.Brand else PC.BrandSoft)
                                .clickable(enabled = text.isNotBlank() && !sending) { send() },
                            contentAlignment = Alignment.Center,
                        ) {
                            if (sending) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = PC.OnBrand)
                            else Icon(Icons.AutoMirrored.Filled.Send, "Comentar", tint = if (text.isNotBlank()) PC.OnBrand else PC.Brand, modifier = Modifier.size(19.dp))
                        }
                    }
                }
            }
        }
    }

    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        containerColor = PC.Surface2,
        title = { Text("Apagar este post?") },
        text = { Text("Isso não pode ser desfeito.", color = PC.Muted) },
        confirmButton = {
            TextButton(onClick = {
                confirmDelete = false
                scope.launch {
                    try { ForumApi.deletePost(repo, postId); toast(ctx, "Post apagado."); nav.back() } catch (e: Exception) { toast(ctx, errorText(e)) }
                }
            }) { Text("Apagar", color = PC.Red) }
        },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancelar", color = PC.Text) } },
    )
}

@Composable
private fun CommentRow(
    fc: FlatComment, myId: String?, staff: Boolean,
    onAuthor: () -> Unit, onReply: () -> Unit, onVote: (Int) -> Unit, onDelete: () -> Unit,
) {
    val c = fc.c
    Row(Modifier.fillMaxWidth().padding(start = (minOf(fc.depth, 4) * 18).dp)) {
        if (fc.depth > 0) Box(Modifier.width(2.dp).height(56.dp).background(PC.Line))
        Spacer(Modifier.width(if (fc.depth > 0) 10.dp else 0.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable(onClick = onAuthor)) {
                Avatar(c.author, 28.dp)
                Spacer(Modifier.width(8.dp))
                Text(c.author?.name ?: "Alguém", color = PC.Header, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                Text("  ${timeAgo(c.createdAt)}", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
            }
            Text(
                if (c.deleted) "[comentário apagado]" else c.content,
                color = if (c.deleted) PC.Faint else PC.Text, style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(start = 36.dp, top = 2.dp),
            )
            if (!c.deleted) Row(Modifier.padding(start = 30.dp), verticalAlignment = Alignment.CenterVertically) {
                VotePill(c.score, c.myVote, onVote, small = true)
                TextButton(onClick = onReply) { Text("Responder", color = PC.Muted, style = MaterialTheme.typography.labelMedium) }
                if (c.authorId == myId || c.author?.id == myId || staff) TextButton(onClick = onDelete) { Text("Apagar", color = PC.Red, style = MaterialTheme.typography.labelMedium) }
            }
        }
    }
}
