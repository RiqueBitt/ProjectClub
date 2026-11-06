# Modo offline do app de computador

Quando o app de PC (Windows/Linux) não consegue falar com o servidor do
Project Club — sem internet, servidor fora do ar ou banco caído — a tela
"Project Club · Conexão" vira uma **tela offline** com o que não depende do
servidor. Assim que ele volta, o Project Club reabre sozinho (a tela testa a
cada 5 segundos).

## O que funciona offline

| Seção | O que faz | Precisa de internet? |
|---|---|---|
| **Apps** | Abre os apps do ecossistema já instalados (ProjectMC, PhotoProject, CutProject…). Instalar/atualizar baixa as releases do GitHub. | Só pra instalar/atualizar (nunca do servidor do Project Club) |
| **Navegador** | O navegador do Project Club: abas, bloqueador de anúncios, favoritos e histórico do mesmo perfil. | Sim, mas não do servidor |
| **VPN** | Reconecta nos últimos servidores de VPN usados (a lista completa vem do servidor; sem ele ficam os já usados, até 8). | Sim, mas não do servidor |
| **Praça** | O Club Penguin rodando **no próprio computador**, com o seu pinguim. | Só na primeira vez, pra baixar a mídia do jogo (1,7 GB) do GitHub |

## A cópia do pinguim (arquivo local)

Enquanto você joga a Praça **online** pelo app de PC, o site pede ao servidor
uma cópia do seu pinguim e entrega ao app, que grava em:

```
<pasta de dados do app>/offline/praca/<id da conta>.json
```

(Windows: `%APPDATA%\Project Club\offline\praca\`.)

- Vai **ao entrar na ilha e a cada 5 minutos** enquanto o jogo está aberto
  (`client/src/praca/offlineSync.js` → `GET /api/plaza/offline-snapshot`).
- Tem **tudo** do pinguim: todos os itens por id, roupas vestidas, cor, iglu
  (móveis, piso, música), puffles, carimbos, cartões, amigos e o **saldo de
  moedas do Project Club** na hora da cópia.
- É só **saída**. O que acontece offline (moedas de minijogo, compras) fica
  gravado só neste computador e é **substituído pela próxima cópia** quando
  você voltar a jogar online. Como o arquivo fica no PC da pessoa, nada dele
  volta pro servidor — senão viraria uma fonte de moedas.

Quem está logado também fica guardado (`offline/conta.json`: nome, @ e
avatar) pra tela offline abrir já com a conta certa.

## Como a Praça offline roda

- `desktop/pracaOffline.js` sobe um processo filho (`desktop/praca-offline/host.js`)
  com o **mesmo Waddle Forever do servidor** (`server/waddle/dist`), pinguins
  em arquivo, HTTP + WebSockets em `127.0.0.1` numa porta livre.
- A página do jogo (`praca-offline/praca.html`, Ruffle embutido) abre num
  `<webview>` da tela offline e entra sozinha com o pinguim da cópia.
- Mídia: `offline/praca/media/`. Se faltar algo, o processo baixa os pacotes
  da release `waddle-media` do GitHub (mesmo mecanismo do servidor —
  `media-store.ts`). Depois disso roda 100% do disco.
- Com a Praça offline aberta, a volta pro Project Club **não é automática**
  (pra não derrubar o jogo no meio): a tela avisa "O Project Club voltou" e
  espera a pessoa clicar.

## Empacotamento

`desktop/scripts/prepare-waddle.js` (roda sozinho antes de `build:win` /
`build:linux`) monta `desktop/vendor/waddle/` com o `dist`, o manifesto da
mídia, as traduções e as dependências (`express`, `ws`, `dotenv`, nas mesmas
versões do servidor). Essa pasta e o Ruffle (`client/public/ruffle`) entram
no instalador como `extraResources` (`resources/waddle`, `resources/ruffle`).
A mídia **não** vai no instalador.

A tela offline é servida pelo esquema `pcapp://offline` (`desktop/offlineShell.js`),
uma origem de verdade listada como confiável em `security.js` — por isso os
mesmos handlers de IPC do site (`browser:*`, `vpn:*`, `projectmc:*`) atendem
a ela. Os handlers só dela (`offline-shell:*`) recusam qualquer outra janela.

## Arquivos

- `server/src/routes/plaza.js` — `GET /api/plaza/offline-snapshot`
- `server/src/services/waddle/index.js` — `getOfflineSnapshot()`
- `client/src/praca/offlineSync.js`, `PracaPage.jsx`, `MainApp.jsx`
- `desktop/offlineStore.js` — arquivos em disco (testes em `test/offlineStore.test.js`)
- `desktop/offlineShell.js` — IPC e esquema `pcapp://`
- `desktop/connectionWindow.js` — janela (agora grande, com webviews)
- `desktop/offline/` — a tela (HTML/CSS/JS) · `desktop/offlinePreload.js`
- `desktop/pracaOffline.js`, `desktop/praca-offline/` — Club Penguin local
