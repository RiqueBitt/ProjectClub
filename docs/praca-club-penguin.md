# Praça — Club Penguin (Waddle Forever embutido)

A aba **Praça** do Project Club é um Club Penguin completo (era clássica,
25/10/2010 por padrão): salas, mapa, roupas e catálogos, puffles, iglus,
carimbos, mini-jogos, jornal, festas da época, mascotes. Base: o emulador
[Waddle Forever](https://github.com/nhaar/Waddle-Forever) (MIT), incorporado ao
código em `server/waddle`. O jogo (Flash) roda no navegador pelo Ruffle que o
site já servia pros Mini-Jogos — nada de plugin, nada de iframe, nada vindo do
GitHub em produção.

## Como funciona

```
navegador ──(Ruffle, <ruffle-player> na PracaPage)──┐
   │ GET /boots.swf, /play/v2/…, /setup/…           │ XMLSocket → socketProxy
   ▼                                                 ▼
Express do site ── services/waddle/mountHttp ── wss://site/waddle/ws/login
   │   (só responde ao que é do jogo)                wss://site/waddle/ws/world
   ▼                                                 │ (ticket da conta na URL)
server/waddle/dist (servidor do WF)  ◄───────────────┘
   ├─ pinguins: MySQL (tabela WaddlePenguin, via services/waddle/penguinStore.js)
   └─ mídia: cache em server/data/waddle/media ← bucket B2 (pasta waddle/)
```

- **Conta = pinguim.** Na primeira visita, `GET /api/plaza/config` cria o
  pinguim da conta (nome de exibição, cor do mascote do perfil, membro). O
  `<nick>` que o jogo manda no login é **substituído** no servidor pelo
  pinguim da conta — a tela de login do jogo aceita qualquer coisa. Uma conta
  só pode estar na ilha uma vez (abrir em outro lugar derruba a anterior).
- **Chat** passa pelo automod da comunidade (links de convite, palavras
  bloqueadas): a fala bloqueada simplesmente não sai.
- **Ticket.** O token de acesso do site dura 15 min; o jogo usa um ticket
  próprio (escopo `plaza`, 12 h) só pro WebSocket.
- **Mídia.** Os ~26 mil SWFs (1,7 GB) ficam no **disco do servidor**
  (`server/data/waddle/media`). Na primeira inicialização, se faltar algo, o
  servidor baixa os pacotes `.tar` da release **waddle-media** do repositório
  no GitHub (um por pasta), extrai, confere pelo manifesto
  (`server/waddle/media-manifest.json`) e grava a marca `.complete.json`. A
  Praça mostra "Preparando a ilha no servidor" com progresso enquanto isso
  acontece; depois nada mais é baixado. Os SWFs vão ao navegador com
  `Cache-Control` imutável de 7 dias.

## Publicar a mídia (release waddle-media)

Actions → **Mídia da Praça (release waddle-media)** → *Run workflow*. O
workflow (`.github/workflows/waddle-media.yml`) baixa a pasta `media` do
Waddle Forever, confere contra o manifesto, empacota um `.tar` por pasta e
publica/substitui os assets da release `waddle-media` com o token do próprio
repositório. Releases aceitam arquivos de até 2 GB e não pesam o Git.

Pra mudar a lista de arquivos (nova versão do Waddle Forever):
`node scripts/waddle-media.js manifest /caminho/Waddle-Forever/media`, commite
o manifesto e rode o workflow de novo. O servidor percebe o que falta e baixa
só as pastas afetadas.

## Variáveis (.env)

| Variável | Padrão | Pra quê |
| --- | --- | --- |
| `WADDLE_MEDIA_RELEASE` | release `waddle-media` de RiqueBitt/ProjectClub | de onde baixar os pacotes (vazio = nunca baixa) |
| `WADDLE_MEDIA_DIR` | `server/data/waddle/media` | pasta da mídia no disco (ou cópia completa) |
| `WADDLE_MEDIA_URL` | — | opcional: base pública com os arquivos soltos (reserva arquivo a arquivo) |
| `WADDLE_DATA_DIR` | `server/data/waddle` | settings.json, mods, logs |
| `WADDLE_VERSION` | `2010-10-25` | data do jogo (festas/salas da época). Datas AS3 (2012+) rodam mal no Ruffle |

Ligar/desligar: `plaza` em `server/src/config/features.js` e
`client/src/utils/features.js`.

## Desenvolvimento

```bash
cd server
npm run waddle:build        # recompila server/waddle/src → dist (commite o dist)
npm test                    # inclui test/praca-club-penguin.test.js (sem banco, Prisma em memória)
WADDLE_MEDIA_DIR=/tmp/wf/media npm run waddle:standalone   # só o jogo, porta 24105, pinguins em JSON
```

O banco precisa da tabela nova: `npm run prisma:push` (model `WaddlePenguin`).

## Limites conhecidos

- Ruffle emula AS2 muito bem; a era moderna (AS3, 2012+) ainda trava em várias
  telas — por isso o padrão é 2010.
- O servidor do WF foi feito pra single-player/amigos: não tem anti-cheat. Toda
  entrada já é autenticada e o chat moderado, mas moedas/itens são confiáveis
  só na medida em que o cliente é.
- Mods do WF (`server/data/waddle/mods`) funcionam, mas são por servidor, não
  por usuário.
- O disco do servidor precisa de ~2 GB livres pra mídia (1,7 GB extraídos +
  o pacote temporário durante a extração).
