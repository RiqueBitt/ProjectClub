# Praça — Club Penguin (Waddle Forever embutido)

A aba **Praça** do Project Club é um Club Penguin completo (cliente moderno
de 2012 — o ano mais rico da linha do tempo do Waddle Forever): salas, mapa,
roupas e catálogos, puffles, iglus, carimbos, mini-jogos, jornal, festas,
mascotes, EPF, Card-Jitsu. Base: o emulador
[Waddle Forever](https://github.com/nhaar/Waddle-Forever) (MIT), incorporado ao
código em `server/waddle`. O jogo (Flash) roda no navegador pelo Ruffle que o
site já servia pros Mini-Jogos — nada de plugin, nada de iframe, nada vindo do
GitHub em produção.

## O que o Project Club muda no jogo

- **Calendário real.** `WADDLE_VERSION=auto` (padrão): a data do jogo é o dia
  de hoje mapeado no ano 2012 da linha do tempo — Halloween em outubro,
  Operação: Blackout em novembro, Natal em dezembro, Puffle Party em
  fevereiro… e a ilha volta ao normal sozinha fora das festas. O relógio
  interno do jogo é o ano real. O servidor vira a data à meia-noite.
- **Tema sazonal do site.** `/api/plaza/status` informa a festa ativa; o site
  acompanha (Halloween e Blackout escurecem o visual, as outras colorem os
  destaques) e volta ao normal quando a festa acaba
  (`client/src/utils/appearance.js`, `GAME_PARTY_SEASONS`).
- **Um servidor só** ("Project Club", `WADDLE_SERVER_NAME`), população pela
  quantidade real de pinguins online.
- **Entrada automática.** A página aperta os botões e digita o pinguim da
  conta por eventos DOM que o Ruffle entende (`client/src/praca/autoLogin.js`),
  com "Entrando…" por cima; se não bater, devolve o controle à pessoa.
- **PT-BR.** Tudo que o servidor gera ou entrega em JSON (interface do cliente,
  carimbos, itens, salas, chat seguro, mascotes, guia, móveis) passa pelos
  dicionários em `server/waddle/src/server/i18n/pt-BR/*.json`
  (inglês → português). O que está desenhado dentro dos SWFs (letreiros,
  catálogos em imagem, jornal) continua em inglês. `WADDLE_LANG=en` desliga.
- **HUD nítida.** O player é dimensionado em pixels reais (sem ampliar por
  CSS), então o Ruffle desenha os vetores na resolução da tela.

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
| `WADDLE_VERSION` | `auto` | `auto` = calendário real mapeado em `WADDLE_CALENDAR_YEAR` (2012); ou uma data fixa AAAA-MM-DD |
| `WADDLE_CALENDAR_YEAR` | `2012` | ano da linha do tempo usado pelo modo calendário |
| `WADDLE_SERVER_NAME` | `Project Club` | nome do servidor único |
| `WADDLE_LANG` | `pt-BR` | `en` desliga a tradução |

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

- O cliente moderno (AS3) roda no Ruffle com as adaptações daqui (URLs
  relativas, login por ID); alguns mini-jogos AS3 podem ter bugs do emulador.
- O servidor do WF foi feito pra single-player/amigos: não tem anti-cheat. Toda
  entrada já é autenticada e o chat moderado, mas moedas/itens são confiáveis
  só na medida em que o cliente é.
- Mods do WF (`server/data/waddle/mods`) funcionam, mas são por servidor, não
  por usuário.
- O disco do servidor precisa de ~2 GB livres pra mídia (1,7 GB extraídos +
  o pacote temporário durante a extração).

## Eventos da Praça (quests, moeda do evento, loja, códigos, mascotes, advento, Coins for Change)

Pedido do dono (nov/2026), inspirado nos projetos de fãs (Club Penguin
Journey, Legacy e Zero). Tudo usa só a arte do próprio jogo: a loja do evento
vende **itens originais do Club Penguin** (os sprites já estão na mídia) pela
moeda do evento. Código em `server/src/services/waddle/events.js`; modelos
`Plaza*` no `schema.prisma`; rotas em `/api/plaza/events…` (jogador) e
`/api/staff-game/events|codes|visits` (equipe).

- **Jogador** — janela **Festa** dentro do jogo (`client/src/praca/Festa.jsx`,
  botão 🎉 no canto do palco): quests com barra de progresso e botão "Pegar",
  loja do evento, agenda de mascotes (com "Ir" pra sala), amigos na ilha (com
  "Ir até"), resgate de código, calendário do advento e Coins for Change.
- **Equipe** — Painel → Club Penguin → **Eventos da Praça**
  (`client/src/components/admin/PlazaEventsAdmin.jsx`): "Criar a partir da
  festa atual" monta um modelo com as salas decoradas da festa ligada; depois
  é só ajustar quests, loja, advento e metas. Códigos e visitas de mascote
  ficam nas outras abas.
- **Quests** (`type`): `visit` (salas), `gather` (N pinguins na mesma sala),
  `wear` (vestir item), `dance` (dançar — frame 26 — nas salas, com item se
  pedido), `walk_puffle` (passear com o puffle, de um tipo se pedido, até as
  salas), `online` (minutos na ilha), `mascot` (encontrar) e `donate` (Coins
  for Change). Cada quest tem **dificuldade** (fácil 50 · média 120 · difícil
  250 · extrema 500 moedas, quando a quest não define moedas) e o evento pode
  ter **prêmio final** por completar todas (modelo das Island Quests do CP
  Legacy). O progresso é avaliado a cada 15 s e a cada troca de sala; a
  recompensa só sai uma vez, no clique. O `getPresence()` do Waddle foi
  estendido com `frame` e `walking` pra isso (src e dist).
- **Modelos prontos** (`eventPresets.js`): Halloween, Natal (advento + Coins
  for Change), Festival das Luzes, Festa dos Puffles, Dance-A-Thon, Medieval,
  Feira, Copa dos Pinguins, Aniversário do Project Club, Marcos da comunidade
  (códigos) e Pizza Palooza — montados a partir das festas dos projetos de fãs
  (Legacy, Journey, Zero, Rewritten, CPO) só com itens originais do jogo. No
  painel: "Modelos prontos" → Usar (abre pra editar) / Criar códigos.
- **Mascotes com agenda** — a visita marca sala e horário e a **conta que
  veste o mascote** (o Pingu é o mascote oficial; qualquer conta da equipe
  pode vestir outro). Enquanto o pinguim dessa conta está na sala, quem entra
  recebe o brinde (fundo + itens + moedas) uma vez por visita.
- **Códigos** — letras/números, uma vez por pinguim, com limite de usos e
  validade; podem dar moedas, moeda de evento e itens.
- **Advento** — presentes por dia de 1 a 25 de dezembro (fuso do Brasil).
- **Coins for Change** — doações em moedas do Project Club; a cada meta
  batida quem doou pega a recompensa.

### Segunda leva (modelo dos CPPS: Journey, Legacy, Rewritten, NewCP, Zero)

- **Trivia / TourBots** — quest `trivia` com pergunta, opções e resposta; se tiver sala, só responde lá (`POST /api/plaza/events/:slug/trivia/:key`). A resposta certa nunca vai pro cliente.
- **Dica (rima/pista)** — campo `hint` em qualquer quest; na janela Festa a dica aparece no lugar do nome da sala (caça aos ovos do CP Legacy).
- **Rodízio** — `config.rotation = { everyDays, label, quests[] }`: a cada N dias entra a próxima quest, com chave `<key>-r<ciclo>`. Modelo pronto "Pin da semana" com 12 pins originais escondidos em salas. O rodízio não conta pro prêmio final nem pro passe.
- **Party Pass** — `config.pass.levels[]` (pontos, prêmio). Pontos = dificuldade das quests concluídas (ou `points` da quest). `POST …/pass/:index/claim`.
- **Loja** — `limit` por item (compras repetidas, `PlazaEventPurchase.qty`), `seller` (mascote vendedor) e `config.shopMax` (itens diferentes por pinguim — o CP Journey usa 3).
- **Visita surpresa** — `PlazaMascotVisit.surprise`: só aparece na agenda quando começa.
- **Concursos** (`contests.js`, `PlazaContest*`) — iglu, Mural de Arte, fantasia: imagem enviada pela janela Festa (upload normal do site), um voto por pinguim (pode trocar), staff marca vencedores e o prêmio cai na hora. Painel → Eventos da Praça → Concursos.
- **Jigsaw Jam** (`puzzles.js`, `PlazaPuzzle*`, `PlazaSetting.jigsaw`) — quebra-cabeças 3×3/5×5 com artes da comunidade (aprovadas pela staff); moedas por arte/modo e prêmio por montar todas. Janela Festa → Jigsaw.
- **Arquivos da Club Penguin Archives** (`assets.js`, `PlazaAsset`) — a staff cola o link de um arquivo da Archives (página `File:` ou nome) e ele entra na ilha por cima da festa: sala, rota do jogo ou música. Fica em `media/pcarchives/`; `parties.apply` reaplica a camada na hora. Só aceita a Archives e confere os bytes (SWF/MP3/PNG…).

Testes: `node --test server/test/praca-eventos.test.js server/test/praca-concursos.test.js`.
