# Project Club — Android nativo

App Android feito em Kotlin + Jetpack Compose (sem WebView nas partes principais),
pra fazer o que o app antigo (WebView) não conseguia:

| | App antigo (WebView) | Nativo |
|---|---|---|
| Compartilhar a tela do celular numa call | ❌ | ✅ (MediaProjection + servidor de mídia próprio) |
| Notificação de DM/menção/aviso com o app em 2º plano | ❌ | ✅ |
| Notificação com o app fechado | ❌ | ✅ quando o Firebase for configurado (abaixo) |
| Chamada recebida em tela cheia (Atender/Recusar) | ❌ | ✅ |
| Call continua com a tela desligada / outro app aberto | instável | ✅ (serviço em primeiro plano) |
| Login dura 90 dias no aparelho | ✅ | ✅ |

## Fase 1 (esta)
- Login (com 2FA), sessão de 90 dias.
- Comunidade: categorias, canais de texto e de voz (mostra quem está na call).
- Chat: histórico com rolagem infinita, envio com anexos, responder, editar, apagar, reações, "digitando…", tempo real.
- DMs: lista, nova conversa com amigo, ligar.
- Voz: entrar/sair, mutar, ensurdecer, alto-falante, ver quem fala, **compartilhar a tela**, assistir a tela de outros.
- Avisos: lista, marcar como lido.
- O resto (loja, fórum, eventos, perfil, admin…) abre o site dentro do app, já logado.

Próximas fases trazem essas telas pro nativo, uma por vez.

## Instalar
Baixe `ProjectClub-Nativo.apk` na release **android-nativo** do GitHub.
É um app separado (`com.projectclub.android`): instala ao lado do app antigo.

## Ligar notificações com o app fechado (Firebase) — opcional
1. Em https://console.firebase.google.com crie um projeto (ou use um existente) e adicione um app **Android** com o pacote `com.projectclub.android`.
2. Baixe o `google-services.json`, converta pra base64 (`base64 -w0 google-services.json`) e salve como segredo do repositório **`GOOGLE_SERVICES_NATIVO_JSON_BASE64`**.
3. No Firebase: Configurações do projeto → Contas de serviço → **Gerar nova chave privada**. Cole o JSON inteiro na variável **`FIREBASE_SERVICE_ACCOUNT_JSON`** do servidor (Shard Cloud).
4. O próximo build já sai com push ligado; não precisa mudar código.

## Desenvolvimento
- Android Studio (Ladybug ou mais novo), JDK 17+. Abra a pasta `android-nativo/`.
- `./gradlew testDebugUnitTest assembleDebug`
- O servidor usado é `BuildConfig.BASE_URL` (`app/build.gradle.kts`).

Estrutura:
```
net/        Api (OkHttp + renovação de sessão), cookies persistentes
realtime/   Socket.io
data/       Modelos, Repository (estado do app), ChatLogic (regras puras, testadas)
voice/      VoiceManager (cadeia de provedores + failover), MediasoupEngine (servidor próprio),
            CallAudio (foco/rota do áudio), CallService (serviço da call / tela)
notify/     Notifier, PushService (Firebase), ações de chamada
ui/         Telas em Compose
```
