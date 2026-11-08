# Guia para escrever telas nativas (app Android do Project Club)

Kotlin + Jetpack Compose (BOM 2024.12.01, Material3), kotlinx.serialization, OkHttp, Coil 2.7.
Pacote base: `com.projectclub.android`. Sem WebView: tudo nativo.

## Dados (servidor)
- `repo: Repository` (data/Repository.kt) — `repo.api`, `repo.me: StateFlow<User?>`, `repo.user(id)`, `repo.presence`.
- `repo.api` (net/Api.kt): `get<T>(path)`, `post<T>(path, body: JsonElement?)`, `patch<T>(...)`,
  `postIgnore(path, body)`, `delete(path, body)`, `postBody(path, RequestBody)` (multipart). Paths começam com `/api/...`.
  Lança `ApiException(status, message)` fora de 2xx (`message` já vem em português do servidor).
- JSON: `AppJson` (ignoreUnknownKeys, explicitNulls=false, coerceInputValues). Monte bodies com
  `buildJsonObject { put("campo", valor) }` (kotlinx.serialization.json).
- Modelos: crie `@Serializable data class` no seu próprio arquivo `data/<Feature>Models.kt`, com TODOS os campos
  opcionais/com padrão (o servidor manda muita coisa). `User` já existe em data/Models.kt (id, username, displayName,
  avatarUrl, bannerUrl, bio, profileColor, status, customStatus, platformRole, accountLevel; `.name`).
- Imagens: `Config.media(url)` transforma "/uploads/..." em URL completa. Use `coil.compose.AsyncImage`.

## Visual (igual ao site, tema escuro)
- Cores: `ui.theme.PC` (Bg, Bar, Surface, Surface2, Surface3, Line, LineStrong, Header, Text, Muted, Faint, Brand,
  BrandSoft, Green, Yellow, Red, Announce, Events, Forum, Store, Purple, Pink, HeroGradient, BannerGradient).
- Fontes: `MaterialTheme.typography` (Inter); `Display` (Bebas Neue) para títulos grandes em maiúsculas.
- Componentes em `ui/common/Kit.kt`: `PcTopBar(title, icon, navigation = { voltar }, actions = {})`, `PcCard(onClick, padding, border)`,
  `PillButton(text, onClick, icon, enabled, busy, light, color)`, `GhostButton`, `PcField(value, onValueChange, placeholder, label, icon)`,
  `CountBadge`, `Chip(text, color, dot)`, `IconTile(icon, color)`, `HeroBox { }`, `ListSkeleton(rows)`, `Bone(rememberShimmer(), modifier)`,
  `EmptyState(icon, title, text, action)`, `LoadingScreen()`. Em `ui/common/Common.kt`: `Avatar(user, size, status)`,
  `formatTime(iso)`, `shortTime(iso)`, `richText(...)`.
- Ícones: `Icons.Outlined.*` / `Icons.AutoMirrored.Outlined.*` (material-icons-extended).
- Toda tela: `Column(Modifier.fillMaxSize().background(PC.Bg))` com `PcTopBar(..., navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar") } })`
  no topo (a PcTopBar já aplica o espaço da barra de status). Listas com `LazyColumn(contentPadding = PaddingValues(16.dp))`.
  Embaixo da lista: `Modifier.navigationBarsPadding()` no último item ou no Column.
- Carregando: esqueleto (`ListSkeleton`/`Bone`), nunca só uma rodinha solta. Vazio: `EmptyState`. Erro: `EmptyState` com botão "Tentar de novo".
- Ações que gastam (compra, apagar): confirmar com `AlertDialog(containerColor = PC.Surface2)`.
- Feedback curto: `android.widget.Toast` ou texto na tela.

## Estado
- Use um `ViewModel` por tela (androidx.lifecycle.viewmodel.compose.viewModel com factory) OU
  `produceState`/`LaunchedEffect` + `rememberCoroutineScope()` para telas simples. Recarregar com `PullToRefreshBox`
  (material3, @OptIn(ExperimentalMaterial3Api::class)).
- Nunca bloqueie a thread principal; `repo.api` já roda em IO.

## Navegação
- Interface `ui/nav/AppNav.kt` (não altere): `nav.back()`, `nav.profile(id)`, `nav.post(id)`, `nav.link("/caminho-do-site")` etc.
- Assinatura das telas: `@Composable fun XxxScreen(repo: Repository, nav: AppNav, /* ids */)`.
- NÃO edite MainActivity, Repository, Api, Kit, Theme nem arquivos de outras telas. Crie só os seus arquivos.

## Servidor
- Rotas em `server/src/routes/*.js`, montadas em `server/src/app.js` (`/api/<nome>`). Leia a rota para saber
  query, corpo e formato da resposta. A versão web de cada tela está em `client/src/pages/*.jsx` e
  `client/src/api/endpoints.js` (bom para ver quais chamadas o site faz e como mostra os dados).
