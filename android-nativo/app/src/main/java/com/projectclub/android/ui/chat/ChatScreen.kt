package com.projectclub.android.ui.chat

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.EmojiEmotions
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Forward
import androidx.compose.material.icons.filled.Alarm
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.MarkChatUnread
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.AppJson
import com.projectclub.android.data.Attachment
import com.projectclub.android.data.ChatLogic
import com.projectclub.android.data.Message
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Room
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.formatTime
import com.projectclub.android.ui.common.richText
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

private val QUICK = listOf("👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(repo: Repository, room: Room, onBack: () -> Unit, onCall: (channelName: String, title: String) -> Unit, onOpenWeb: (String) -> Unit) {
    val vm: ChatViewModel = viewModel(key = "chat-${room.id}", factory = ChatViewModel.Factory(repo, room))
    val state by vm.state.collectAsState()
    val me by repo.me.collectAsState()
    val presence by repo.presence.collectAsState()
    val conversations by repo.conversations.collectAsState()
    val offline by repo.offline.collectAsState()
    val ctx = LocalContext.current
    val channel = room.channelId?.let { repo.channel(it) }
    val conv = room.conversationId?.let { id -> conversations.firstOrNull { it.id == id } }
    val other = conv?.takeIf { !it.isGroup }?.members?.firstOrNull { it.id != me?.id }
    val title = channel?.name ?: conv?.let { repo.conversationTitle(it) } ?: "Conversa"

    // Esta sala está aberta: não notifica as mensagens dela.
    DisposableEffect(room.id) {
        repo.openRoom.value = room.id
        room.conversationId?.let { com.projectclub.android.notify.Notifier.cancelConversation(ctx, it) }
        onDispose { if (repo.openRoom.value == room.id) repo.openRoom.value = null }
    }
    LaunchedEffect(state.toast) {
        state.toast?.let { Toast.makeText(ctx, it, Toast.LENGTH_SHORT).show(); vm.clearToast() }
    }

    var text by remember { mutableStateOf("") }
    var menuFor by remember { mutableStateOf<Message?>(null) }
    var confirmDelete by remember { mutableStateOf<Message?>(null) }
    var viewing by remember { mutableStateOf<String?>(null) }
    var showPinned by remember { mutableStateOf(false) }
    var showSearch by remember { mutableStateOf(false) }
    var forwardFor by remember { mutableStateOf<Message?>(null) }
    var remindFor by remember { mutableStateOf<Message?>(null) }
    var scheduling by remember { mutableStateOf(false) }
    val snack = remember { androidx.compose.material3.SnackbarHostState() }
    val scope = rememberCoroutineScope()
    fun toast(msg: String) { scope.launch { snack.showSnackbar(msg) } }
    val list = rememberLazyListState()
    val reversed = remember(state.messages) { state.messages.asReversed() }

    // Chegou mensagem nova e você estava no fim: continua no fim.
    LaunchedEffect(state.messages.lastOrNull()?.id) {
        if (list.firstVisibleItemIndex <= 2) list.animateScrollToItem(0)
    }
    // Perto do topo da conversa: carrega as mais antigas.
    val nearTop by remember { derivedStateOf { list.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let { it >= reversed.size - 6 } ?: false } }
    LaunchedEffect(nearTop) { if (nearTop) vm.loadOlder() }

    var showPicker by remember { mutableStateOf(false) }
    LaunchedEffect(state.editing?.id) { state.editing?.let { text = it.content.orEmpty() } }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        scope.launch { vm.addFiles(uris.map { repo.describe(it) }) }
    }

    Scaffold(
        containerColor = PC.Bg,
        snackbarHost = { androidx.compose.material3.SnackbarHost(snack) },
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = PC.Bar),
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Voltar") } },
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (other != null) { Avatar(other, 32.dp, presence[other.id] ?: "OFFLINE"); Spacer(Modifier.width(10.dp)) }
                        else if (channel != null) {
                            Box(Modifier.size(34.dp).clip(RoundedCornerShape(10.dp)).background(PC.BrandSoft), contentAlignment = Alignment.Center) {
                                Icon(Icons.Filled.Tag, null, tint = PC.Brand, modifier = Modifier.size(20.dp))
                            }
                            Spacer(Modifier.width(10.dp))
                        }
                        Column {
                            Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                            channel?.topic?.takeIf { it.isNotBlank() }?.let { Text(it, color = PC.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall) }
                        }
                    }
                },
                actions = {
                    IconButton(onClick = { showSearch = true }) { Icon(Icons.Filled.Search, "Buscar mensagens") }
                    IconButton(onClick = { showPinned = true }) { Icon(Icons.Filled.PushPin, "Mensagens fixadas") }
                    if (room.conversationId != null) IconButton(onClick = { onCall("dm:${room.conversationId}", title) }) { Icon(Icons.Filled.Call, "Ligar") }
                },
            )
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().imePadding()) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    state.loading && state.messages.isEmpty() -> com.projectclub.android.ui.common.ListSkeleton(9, 40.dp, Modifier.align(Alignment.BottomStart))
                    state.error != null -> Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(state.error!!, color = PC.Muted)
                        Button(onClick = vm::retry, modifier = Modifier.padding(top = 12.dp)) { Text("Tentar de novo") }
                    }
                    else -> LazyColumn(state = list, reverseLayout = true, modifier = Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp)) {
                        itemsIndexed(reversed, key = { _, m -> m.id }) { i, m ->
                            val prev = reversed.getOrNull(i + 1)
                            MessageItem(
                                m = m, repo = repo, myId = me?.id, myUsername = me?.username,
                                header = ChatLogic.startsGroup(prev, m),
                                pending = m.id.startsWith(ChatViewModel.LOCAL),
                                status = if (m.id.startsWith(ChatViewModel.LOCAL) && m.nonce in state.queued) {
                                    if (offline) "🕓 pendente — sai quando a conexão voltar · segure para cancelar" else "enviando…"
                                } else null,
                                onLongPress = {
                                    if (!m.id.startsWith(ChatViewModel.LOCAL)) menuFor = m
                                    else if (m.nonce in state.queued) confirmDelete = m
                                },
                                onReact = { e -> vm.react(m, e) },
                                onImage = { viewing = it },
                            )
                        }
                        if (state.loadingOlder) item { Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) } }
                        if (state.reachedStart || (!state.loading && state.messages.isEmpty())) item {
                            Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 12.dp)) {
                                if (channel != null) {
                                    Box(Modifier.size(64.dp).clip(RoundedCornerShape(20.dp)).background(PC.BrandSoft), contentAlignment = Alignment.Center) {
                                        Icon(Icons.Filled.Tag, null, tint = PC.Brand, modifier = Modifier.size(34.dp))
                                    }
                                } else Avatar(other, 72.dp)
                                Spacer(Modifier.height(12.dp))
                                Text(
                                    if (channel != null) "Bem-vindo(a) a #${channel.name}" else title,
                                    style = MaterialTheme.typography.headlineSmall, color = PC.Header,
                                )
                                Text(
                                    if (channel != null) "Este é o início do canal #${channel.name}. Diga oi e comece a conversa!"
                                    else "Este é o começo da sua conversa com $title.",
                                    color = PC.Muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp),
                                )
                            }
                        }
                    }
                }
            }
            TypingLine(state.typing.keys.mapNotNull { repo.user(it)?.name })
            Composer(
                text = text, onText = { text = it; vm.onTyping(it) },
                state = state, roomName = title,
                onAttach = { picker.launch("*/*") },
                onRemoveFile = vm::removeFile,
                onCancel = { vm.setReply(null); vm.setEditing(null); if (state.editing != null) text = "" },
                onSend = { val t = text; text = ""; vm.send(t) { failed -> if (text.isBlank()) text = failed } },
                onPicker = { showPicker = true },
                onSchedule = { scheduling = true },
            )
        }
    }

    if (showPicker) PickerSheet(
        repo, onDismiss = { showPicker = false },
        onEmoji = { e -> text = if (text.isEmpty() || text.endsWith(" ")) text + e else "$text $e" },
        onGif = { url -> showPicker = false; vm.send(url) { } },
        onSticker = { url -> showPicker = false; vm.sendSticker(url) },
    )

    menuFor?.let { m ->
        ModalBottomSheet(onDismissRequest = { menuFor = null }, containerColor = PC.Surface) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                QUICK.forEach { e ->
                    Box(Modifier.size(48.dp).clip(RoundedCornerShape(24.dp)).background(PC.Surface2).clickable { vm.react(m, e); menuFor = null }, contentAlignment = Alignment.Center) {
                        Text(e, style = MaterialTheme.typography.titleLarge)
                    }
                }
            }
            HorizontalDivider(Modifier.padding(vertical = 8.dp), color = PC.Line)
            SheetItem(Icons.AutoMirrored.Filled.Reply, "Responder") { vm.setReply(m); menuFor = null }
            SheetItem(Icons.AutoMirrored.Filled.Forward, "Encaminhar") { forwardFor = m; menuFor = null }
            SheetItem(Icons.Filled.Alarm, "Lembrar-me") { remindFor = m; menuFor = null }
            SheetItem(Icons.Filled.PushPin, if (m.pinned) "Desafixar" else "Fixar") {
                menuFor = null
                scope.launch {
                    runCatching { repo.api.postIgnore("/api/messages/${m.id}/pin") }
                        .onSuccess { toast(if (m.pinned) "Mensagem desafixada." else "Mensagem fixada.") }
                        .onFailure { toast(it.message ?: "Você não pode fixar aqui.") }
                }
            }
            SheetItem(Icons.Filled.Bookmark, "Favoritar / desfavoritar") {
                menuFor = null
                scope.launch {
                    runCatching { repo.api.post<kotlinx.serialization.json.JsonObject>("/api/messages/${m.id}/save") }
                        .onSuccess { r -> toast(if ((r["saved"] as? kotlinx.serialization.json.JsonPrimitive)?.content == "true") "Favoritada. Veja em Você → Mensagens favoritas." else "Tirada dos favoritos.") }
                        .onFailure { toast(it.message ?: "Não deu pra favoritar.") }
                }
            }
            SheetItem(Icons.Filled.MarkChatUnread, "Marcar como não lida") {
                menuFor = null
                scope.launch {
                    runCatching { repo.api.postIgnore("/api/messages/${m.id}/unread") }
                        .onSuccess { toast("Marcada como não lida a partir desta mensagem.") }
                        .onFailure { toast(it.message ?: "Não deu pra marcar.") }
                }
            }
            SheetItem(Icons.Filled.Link, "Copiar link da mensagem") {
                val path = repo.roomPath(room) // link bonito (/canal/<nome>, /dm/<@>)
                (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("link", "${com.projectclub.android.Config.baseUrl}$path?m=${m.id}"))
                menuFor = null
                toast("Link copiado.")
            }
            if (!m.content.isNullOrBlank()) SheetItem(Icons.Filled.ContentCopy, "Copiar texto") {
                (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("mensagem", m.content))
                menuFor = null
            }
            if (m.authorId == me?.id) {
                if (!m.content.isNullOrBlank()) SheetItem(Icons.Filled.Edit, "Editar") { vm.setEditing(m); menuFor = null }
                SheetItem(Icons.Filled.Delete, "Apagar", danger = true) { confirmDelete = m; menuFor = null }
            }
            Spacer(Modifier.navigationBarsPadding().padding(bottom = 12.dp))
        }
    }
    confirmDelete?.takeIf { it.id.startsWith(ChatViewModel.LOCAL) }?.let { m ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("Cancelar envio?") },
            text = { Text("Esta mensagem ainda não saiu (está pendente). Ela não será enviada.") },
            confirmButton = { TextButton(onClick = { vm.cancelPending(m); confirmDelete = null }) { Text("Cancelar envio", color = PC.Red) } },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("Manter") } },
        )
    }
    confirmDelete?.takeIf { !it.id.startsWith(ChatViewModel.LOCAL) }?.let { m ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("Apagar mensagem?") },
            text = { Text("Ela some pra todo mundo. Não dá pra desfazer.") },
            confirmButton = { TextButton(onClick = { vm.delete(m); confirmDelete = null }) { Text("Apagar", color = PC.Red) } },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("Cancelar") } },
        )
    }
    viewing?.let { url -> ImageViewer(url) { viewing = null } }
    if (showPinned) PinnedSheet(repo, room) { showPinned = false }
    if (showSearch) SearchSheet(repo, room) { showSearch = false }
    forwardFor?.let { m -> ForwardSheet(repo, m, onDismiss = { forwardFor = null }) { msg -> forwardFor = null; toast(msg) } }
    remindFor?.let { m ->
        WhenDialog(repo, "Lembrar-me", "Lembrar", initialText = m.content?.take(180), textLabel = "Do que lembrar", onDismiss = { remindFor = null }) { whenText, _, t ->
            createReminder(repo, m, room, whenText, t).also { if (it == null) { remindFor = null; toast("Lembrete criado. Você recebe um aviso na hora.") } }
        }
    }
    if (scheduling) {
        WhenDialog(repo, "Enviar depois", "Agendar", initialText = text, textLabel = "Mensagem", onDismiss = { scheduling = false }) { _, at, t ->
            scheduleMessage(repo, room, t, at).also { if (it == null) { scheduling = false; text = ""; toast("Mensagem agendada.") } }
        }
    }
}

@Composable
private fun SheetItem(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, danger: Boolean = false, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = if (danger) PC.Red else PC.Muted)
        Spacer(Modifier.width(16.dp))
        Text(label, color = if (danger) PC.Red else PC.Text)
    }
}

@OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
private fun MessageItem(
    m: Message, repo: Repository, myId: String?, myUsername: String?, header: Boolean, pending: Boolean,
    onLongPress: () -> Unit, onReact: (String) -> Unit, onImage: (String) -> Unit,
    /** "pendente" (fila offline) / "enviando…" embaixo da mensagem. */
    status: String? = null,
) {
    val author = m.author ?: repo.user(m.authorId)
    val uri = LocalUriHandler.current
    val mentionsMe = myUsername != null && (m.content?.contains("@$myUsername", ignoreCase = true) == true)
    Row(
        Modifier.fillMaxWidth()
            .background(if (mentionsMe) PC.Mention else Color.Transparent)
            .combinedClickable(onClick = {}, onLongClick = onLongPress)
            .padding(start = 12.dp, end = 12.dp, top = if (header) 10.dp else 1.dp, bottom = 1.dp)
            .graphicsLayer { alpha = if (pending) 0.6f else 1f },
    ) {
        val openUser = com.projectclub.android.ui.profile.LocalOpenUser.current
        val authorId = author?.id ?: m.authorId
        if (header) Avatar(author, 40.dp, modifier = Modifier.clip(CircleShape).clickable { authorId?.let(openUser) }) else Spacer(Modifier.width(40.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            m.replyTo?.let { r ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 2.dp)) {
                    Icon(Icons.AutoMirrored.Filled.Reply, null, tint = PC.Muted, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(
                        "${r.author?.name ?: "Alguém"}: ${r.content?.replace('\n', ' ') ?: "anexo"}",
                        color = PC.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
            if (header) Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    author?.name ?: "Usuário", fontWeight = FontWeight.Bold, color = nameColor(author?.profileNameColor, author?.id),
                    modifier = Modifier.clickable { authorId?.let(openUser) },
                )
                Spacer(Modifier.width(8.dp))
                Text(formatTime(m.createdAt), color = PC.Muted, style = MaterialTheme.typography.labelSmall)
            }
            val content = m.content
            if (m.contentFiltered) Text("Mensagem escondida pelo seu filtro de conteúdo.", color = PC.Muted)
            else if (!content.isNullOrBlank()) {
                val trimmed = content.trim()
                val isGif = !trimmed.contains(' ') && trimmed.startsWith("http") &&
                    (trimmed.substringBefore('?').let { it.endsWith(".gif") || it.endsWith(".webp") } || trimmed.contains("klipy.com") || trimmed.contains("tenor.com/"))
                if (isGif) {
                    AsyncImage(
                        trimmed, "GIF", imageLoader = com.projectclub.android.ui.store.rememberAnimatedImageLoader(),
                        contentScale = ContentScale.FillWidth,
                        modifier = Modifier.padding(top = 4.dp).widthIn(max = 260.dp).clip(RoundedCornerShape(12.dp)),
                    )
                } else {
                    val emojiList by repo.emojis.collectAsState()
                    val byName = remember(emojiList) { emojiList.associateBy { it.name } }
                    val inline = remember(byName, content) {
                        byName.filterKeys { content.contains(":$it:") }.map { (name, e) ->
                            "emoji:$name" to androidx.compose.foundation.text.InlineTextContent(
                                androidx.compose.ui.text.Placeholder(22.sp, 22.sp, androidx.compose.ui.text.PlaceholderVerticalAlign.Center),
                            ) { AsyncImage(Config.media(e.url), name, modifier = Modifier.fillMaxSize()) }
                        }.toMap()
                    }
                    Text(
                        richText(content, myUsername, byName.keys) { id -> repo.channel(id)?.name },
                        style = MaterialTheme.typography.bodyMedium, color = PC.Text, inlineContent = inline,
                    )
                }
            }
            if (m.edited) Text("(editado)", color = PC.Muted, style = MaterialTheme.typography.labelSmall)
            status?.let { Text(it, color = PC.Yellow, style = MaterialTheme.typography.labelSmall) }
            m.stickerUrl?.let { AsyncImage(Config.media(it), "Figurinha", modifier = Modifier.padding(top = 4.dp).size(140.dp)) }
            m.embed?.let { EmbedCard(it) }
            val images = m.attachments.filter { it.isImage && !it.isSpoiler }
            if (images.isNotEmpty()) FlowRow(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                images.forEach { a ->
                    val url = Config.media(a.url) ?: return@forEach
                    AsyncImage(
                        url, a.filename, contentScale = ContentScale.Crop,
                        modifier = Modifier.widthIn(max = if (images.size == 1) 280.dp else 136.dp).heightIn(max = if (images.size == 1) 320.dp else 136.dp)
                            .clip(RoundedCornerShape(10.dp)).clickable { onImage(url) },
                    )
                }
            }
            m.attachments.filter { !(it.isImage && !it.isSpoiler) }.forEach { a -> FileChip(a) { Config.media(a.url)?.let(uri::openUri) } }
            val groups = ChatLogic.groupReactions(m.reactions, myId)
            if (groups.isNotEmpty()) FlowRow(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                groups.forEach { (emoji, count, mine) ->
                    Row(
                        Modifier.clip(RoundedCornerShape(8.dp))
                            .background(if (mine) PC.Mention else PC.Surface)
                            .border(1.dp, if (mine) PC.Brand else PC.Line, RoundedCornerShape(8.dp))
                            .clickable { onReact(emoji) }.padding(horizontal = 8.dp, vertical = 3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(emojiLabel(emoji))
                        Spacer(Modifier.width(4.dp))
                        Text(count.toString(), color = if (mine) PC.Brand else PC.Muted, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

/** Emoji customizado vem como <:nome:id> ou :nome: — mostra o nome. */
private fun emojiLabel(e: String): String =
    Regex("""^<a?:([A-Za-z0-9_]+):\w+>$""").find(e)?.groupValues?.get(1)?.let { ":$it:" } ?: e

/** Cor do nome escolhida no perfil (a azul padrão antiga vira a cor normal do texto). */
@Suppress("UNUSED_PARAMETER")
private fun nameColor(hex: String?, id: String?): Color =
    hex?.let { runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull() }
        ?.takeIf { it != Color(0xFF1877F2) } ?: PC.Text

@Composable
private fun EmbedCard(raw: String) {
    val o = runCatching { AppJson.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return
    fun s(k: String) = (o[k] as? JsonPrimitive)?.contentOrNull
    val accent = s("color")?.let { runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull() } ?: PC.Brand
    Row(Modifier.padding(top = 6.dp).widthIn(max = 420.dp).clip(RoundedCornerShape(8.dp)).background(PC.Surface)) {
        Box(Modifier.width(4.dp).heightIn(min = 40.dp).background(accent))
        Column(Modifier.padding(10.dp)) {
            (o["author"] as? JsonObject)?.get("name")?.let { (it as? JsonPrimitive)?.contentOrNull }?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = PC.Muted) }
            s("title")?.let { Text(it, fontWeight = FontWeight.Bold) }
            s("description")?.let { Text(it, color = PC.Text, style = MaterialTheme.typography.bodyMedium) }
            s("imageUrl")?.let { AsyncImage(Config.media(it), null, modifier = Modifier.padding(top = 6.dp).widthIn(max = 380.dp).clip(RoundedCornerShape(6.dp))) }
            s("footer")?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = PC.Muted, modifier = Modifier.padding(top = 4.dp)) }
        }
    }
}

@Composable
private fun FileChip(a: Attachment, onOpen: () -> Unit) {
    Row(
        Modifier.padding(top = 6.dp).clip(RoundedCornerShape(10.dp)).background(PC.Surface).border(1.dp, PC.Line, RoundedCornerShape(10.dp))
            .clickable(onClick = onOpen).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.AutoMirrored.Filled.InsertDriveFile, null, tint = PC.Brand)
        Spacer(Modifier.width(10.dp))
        Column {
            Text(if (a.isSpoiler) "Spoiler — toque pra abrir" else a.filename ?: "arquivo", maxLines = 1, overflow = TextOverflow.Ellipsis)
            a.size?.let { Text(sizeLabel(it), color = PC.Muted, style = MaterialTheme.typography.labelSmall) }
        }
    }
}

private fun sizeLabel(b: Long) = when {
    b >= 1_048_576 -> "%.1f MB".format(b / 1_048_576.0)
    b >= 1024 -> "${b / 1024} KB"
    else -> "$b B"
}

@Composable
private fun TypingLine(names: List<String>) {
    if (names.isEmpty()) return
    val text = when (names.size) {
        1 -> "${names[0]} está digitando…"
        2 -> "${names[0]} e ${names[1]} estão digitando…"
        else -> "Várias pessoas estão digitando…"
    }
    Text(text, color = PC.Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp))
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Composer(
    text: String, onText: (String) -> Unit, state: ChatState, roomName: String,
    onAttach: () -> Unit, onRemoveFile: (com.projectclub.android.data.PickedFile) -> Unit, onCancel: () -> Unit, onSend: () -> Unit,
    onPicker: () -> Unit,
    onSchedule: () -> Unit = {},
) {
    Column(Modifier.fillMaxWidth().background(PC.Bg).navigationBarsPadding().padding(horizontal = 10.dp, vertical = 8.dp).clip(RoundedCornerShape(26.dp)).background(PC.Surface).border(1.dp, PC.Line, RoundedCornerShape(26.dp))) {
        val banner = state.editing?.let { "Editando mensagem" } ?: state.replyTo?.let { "Respondendo a ${it.author?.name ?: "mensagem"}" }
        if (banner != null) Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(banner, color = PC.Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.weight(1f))
            IconButton(onClick = onCancel) { Icon(Icons.Filled.Close, "Cancelar", tint = PC.Muted) }
        }
        if (state.files.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            state.files.forEach { f ->
                Box(Modifier.size(72.dp).clip(RoundedCornerShape(10.dp)).background(PC.Surface2)) {
                    if (f.mime.startsWith("image/")) AsyncImage(f.uri, f.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    else Text(f.name, maxLines = 3, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(6.dp))
                    Box(Modifier.align(Alignment.TopEnd).padding(2.dp).size(22.dp).clip(RoundedCornerShape(11.dp)).background(Color(0xCC000000)).clickable { onRemoveFile(f) }, contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.Close, "Remover", tint = Color.White, modifier = Modifier.size(14.dp))
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 6.dp), verticalAlignment = Alignment.Bottom) {
            if (state.editing == null) IconButton(onClick = onAttach) { Icon(Icons.Filled.AddCircle, "Anexar", tint = PC.Muted) }
            TextField(
                value = text, onValueChange = onText, modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                placeholder = { Text("Conversar em $roomName", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                maxLines = 6,
                shape = RoundedCornerShape(22.dp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                ),
            )
            // Emojis, GIFs e figurinhas (o mesmo seletor do PC).
            if (state.editing == null) IconButton(onClick = onPicker) { Icon(Icons.Outlined.EmojiEmotions, "Emojis, GIFs e figurinhas", tint = PC.Muted) }
            val canSend = text.isNotBlank() || state.files.isNotEmpty()
            Box(
                Modifier.padding(start = 4.dp, bottom = 2.dp).size(46.dp).clip(RoundedCornerShape(16.dp))
                    .background(if (canSend) PC.Brand else PC.BrandSoft)
                    // Segurar o Enviar = "Enviar depois" (agendar), igual ao clique direito no PC.
                    .combinedClickable(enabled = canSend && !state.sending, onClick = onSend, onLongClick = { if (text.isNotBlank() && state.editing == null) onSchedule() }),
                contentAlignment = Alignment.Center,
            ) {
                if (state.sending) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = PC.OnBrand)
                else Icon(Icons.AutoMirrored.Filled.Send, "Enviar", tint = if (canSend) PC.OnBrand else PC.Brand.copy(alpha = 0.6f), modifier = Modifier.size(21.dp))
            }
        }
    }
}

@Composable
private fun ImageViewer(url: String, onClose: () -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }
    var offsetY by remember { mutableFloatStateOf(0f) }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            AsyncImage(
                url, null, contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize()
                    .pointerInput(Unit) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            scale = (scale * zoom).coerceIn(1f, 5f)
                            offsetX = if (scale > 1f) offsetX + pan.x else 0f
                            offsetY = if (scale > 1f) offsetY + pan.y else 0f
                        }
                    }
                    .graphicsLayer { scaleX = scale; scaleY = scale; translationX = offsetX; translationY = offsetY },
            )
            IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopEnd).padding(12.dp)) { Icon(Icons.Filled.Close, "Fechar", tint = Color.White) }
        }
    }
}
