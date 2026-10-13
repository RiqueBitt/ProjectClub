# Atualizações do app Android (sem baixar outro .apk)

## Resumo

- O app Android **não embala o site**: ele abre `https://projectclub.squareweb.app`
  ao vivo (`server.url` em `client/capacitor.config.json`). Todo deploy do site
  (Square Cloud) chega no celular sozinho, sem .apk novo.
- Um **.apk novo só é necessário quando a parte nativa muda**: plugins do
  Capacitor (`client/package.json`), código Java/Manifest/Gradle
  (`client/android/**`), `client/capacitor.config.json` ou a página offline
  embalada (`client/public/app-offline.html`).
- O app só pede o .apk quando a versão nativa instalada é **mais velha que a
  `minNativeVersion`** publicada. Antes, toda release (inclusive as que só
  mudavam o site) pedia um .apk novo.

## Como funciona

```
Celular (app Android)                     Servidor                          GitHub Release vX.Y.Z
---------------------                     --------                          ---------------------
WebView abre o site ao vivo  ─────────►   client/dist (sempre o mais novo)
ao abrir / ao voltar pro app:
GET /api/mobile/update                    lê client/dist/version.json  ◄──  ProjectClub.apk
  ?native=<versionName>                   + releases (appReleases,          android-native.json
  &current=<versão do conteúdo>             cache de 10 min)                { nativeHash, minNativeVersion }
◄── { webUpdate, nativeUpdateRequired,
      minNativeVersion, apkUrl, ... }
```

Resposta de `GET /api/mobile/update`:

| campo | significado |
|---|---|
| `webVersion` | versão do conteúdo publicado (`client/dist/version.json`, gerado no build do Vite) |
| `webUpdate` | `true` se o conteúdo rodando no app é outro (deploy novo desde que a página abriu) |
| `latestNativeVersion` | release mais nova que tem `ProjectClub.apk` |
| `minNativeVersion` | menor .apk que ainda serve |
| `nativeUpdateRequired` | `native < minNativeVersion` → o app baixa e instala o .apk (fluxo antigo, com plano B de link) |
| `nativeUpdateAvailable` | existe .apk mais novo, mas é opcional (não incomoda ninguém) |

No app (`client/src/utils/nativeUpdateCheck.js`):

- **Ao abrir**: checa. Se `nativeUpdateRequired`, baixa e instala o .apk.
- **Ao voltar pro app** (evento `resume`, no máximo a cada 5 min): se houve
  deploy do site, mostra "Atualizando o conteúdo do app…" e recarrega a página.
  **Nunca recarrega durante uma chamada de voz** (fica pra próxima vez).
- **Configurações > Sistema > Sobre este aplicativo**: mostra
  "Versão do app (nativa) X · Conteúdo Y" e o botão **Procurar atualização**.
- **Sem internet / servidor reiniciando**: o WebView mostra
  `app-offline.html` (embalada no .apk via `server.errorPath`), que tenta de
  novo sozinha quando a conexão volta.

## Como as releases fluem (CI — `.github/workflows/build-apps.yml`)

1. `compute-version` calcula `vMAJOR.MINOR.PATCH` (igual antes).
2. `build-android`, passo **"Impressão digital da parte nativa"**, antes de
   qualquer passo que altere arquivos:
   - sha256 dos arquivos versionados de `client/android/**`,
     `client/capacitor.config.json`, `client/public/app-offline.html`
     + a lista de plugins `*capacitor*` declarados no `client/package.json`;
   - baixa o `android-native.json` da release anterior mais recente que tiver um;
   - mesma impressão digital → `minNativeVersion` continua a anterior;
     diferente (ou não existe anterior, ou disparo manual com
     `force_native_update`) → `minNativeVersion` = esta versão
     (`.github/scripts/android_native_manifest.py`).
3. Publica `ProjectClub.apk` **e** `android-native.json` na release.
4. O servidor lê as releases pelo `appReleases` (mesmo cache usado por
   `/api/app-catalog/releases`), escolhe a mais nova **que tem o .apk** (se o
   build do Android falhar numa release, ela é ignorada) e responde o app.

O conteúdo (site) **não** passa pelo GitHub: ele é o que está deployado no
servidor. `client/vite.config.js` grava `dist/version.json` e a constante
`__WEB_VERSION__` (data UTC + commit, ou `WEB_VERSION` do ambiente).

## Operação

**Forçar todo mundo a instalar o .apk** (ex.: correção nativa urgente):
Actions → *Build Apps* → *Run workflow* → marcar **force_native_update**.
Isso gera uma release com `minNativeVersion` = ela mesma.

**Voltar atrás no conteúdo (site)**: reverter o commit e fazer deploy de novo
no Square Cloud. Os apps recarregam o conteúdo ao voltar pro primeiro plano
(ou em "Procurar atualização"). Não envolve .apk.

**Voltar atrás num .apk ruim**: publicar uma nova versão com a correção (o
Android não instala versão mais antiga por cima de uma mais nova). Se o .apk
ruim não é exigido (`minNativeVersion` anterior a ele), ninguém foi obrigado a
instalá-lo. Para "desexigir" uma release, edite o `android-native.json` dela
no GitHub (Releases → editar → trocar o arquivo) colocando o
`minNativeVersion` antigo; o servidor relê as releases a cada 10 min e o
`android-native.json` a cada 30 min (ou na hora, reiniciando o servidor).

**Ver o que o servidor está respondendo**:
`https://projectclub.squareweb.app/api/mobile/update?native=v1.0.0&current=x`

## Primeira vez

- A primeira release gerada com este sistema não tem uma anterior com
  `android-native.json`, então ela **exige** o .apk uma última vez (também
  porque `capacitor.config.json` ganhou `errorPath`, que é nativo). Depois
  disso, só quando a parte nativa mudar de verdade.
- Os apps já instalados passam a usar a lógica nova sozinhos assim que o site
  for deployado, porque o código de checagem é parte do site.

## Por que não "live update" com bundle zipado (ex.: @capgo/capacitor-updater)

Avaliado e descartado por enquanto:

- O app já carrega o site ao vivo; um updater de bundle exigiria passar a
  servir o site **de dentro do app** (`https://localhost`). Todo o client usa
  caminhos relativos (`/api`, `/uploads`, `/socket.io`, sons, mini-jogos), o
  refresh token é um cookie httpOnly da mesma origem e o login OAuth volta pro
  domínio do site. Trocar de origem quebraria login/cookies/CORS/OAuth e
  exigiria reescrever URLs no app inteiro.
- Com bundle embalado, o conteúdo e a API podem ficar fora de sincronia (o
  servidor muda a API num deploy e o celular ainda roda o bundle antigo). Com o
  site ao vivo, os dois sempre andam juntos.
- Ganho real do bundle seria abrir o app inteiro sem internet, mas o Project
  Club é um app online (chat, voz, feed): sem internet ele não faz nada útil.
  A página offline embalada cobre esse caso com uma mensagem clara.
