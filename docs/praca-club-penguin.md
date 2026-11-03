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
- **Mídia.** Os ~26 mil SWFs (1,7 GB) ficam no bucket B2, pasta `waddle/`.
  `server/waddle/media-manifest.json` diz quais existem; o servidor baixa cada
  arquivo uma vez pro cache em disco e serve de lá (com `Cache-Control`
  imutável de 7 dias no navegador). Sem bucket configurado, só o cache local
  responde — útil em desenvolvimento com uma cópia completa da pasta `media`.

## Publicar a mídia (uma vez)

```bash
git clone --depth 1 https://github.com/nhaar/Waddle-Forever /tmp/wf   # ou use a cópia que já tem
node scripts/waddle-media.js manifest /tmp/wf/media   # regenera o manifesto (já vem no repo)
node scripts/waddle-media.js upload   /tmp/wf/media   # sobe pro B2 (pula o que já está lá, pode repetir)
node scripts/waddle-media.js check                    # confere
```

O script lê `B2_*` do `server/.env`. Em produção, `WADDLE_MEDIA_URL` pode
ficar vazio: o servidor usa `B2_PUBLIC_URL + "/waddle"`.

## Variáveis (.env)

| Variável | Padrão | Pra quê |
| --- | --- | --- |
| `WADDLE_MEDIA_URL` | `B2_PUBLIC_URL/waddle` | base pública da mídia |
| `WADDLE_MEDIA_DIR` | `server/data/waddle/media` | cache em disco (ou cópia completa) |
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
