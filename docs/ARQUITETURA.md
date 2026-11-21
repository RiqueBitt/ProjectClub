## Arquitetura de armazenamento (MySQL + Redis + Backblaze B2)

A plataforma usa três camadas de armazenamento, cada uma com um papel bem
definido — igual o Discord faz:

- **MySQL** — fonte de verdade de TODO dado permanente: contas, perfis,
  canais, mensagens, amizades, cargos, permissões, badges, níveis,
  recompensas, likes, configurações. Nada aqui expira ou some.
- **Redis** — só dado rápido/temporário: quem está online agora
  (`services/presenceStore.js`), quem está em cada canal de voz
  (`services/voiceRoomStore.js`), cache de consultas caras, rate
  limiting. Nunca é a fonte de verdade de nada.
- **Backblaze B2** — todo arquivo enviado por usuário (fotos de perfil,
  banners, anexos de mensagem, GIFs, áudio). O MySQL guarda só os
  METADADOS desses arquivos (`model FileAsset`: dono, nome, tamanho,
  tipo, data, endereço) — o arquivo em si nunca passa pelo banco.

**Como os uploads funcionam por baixo dos panos**: o multer (biblioteca
de upload) foi configurado com um motor de armazenamento customizado
(`middleware/upload.js` → `ManagedStorage`) que sobe cada arquivo pro B2
assim que termina de receber, e registra o metadado — isso significa que
toda rota que já fazia upload de imagem/anexo continua funcionando
exatamente igual, sem precisar mexer rota por rota. Se as variáveis do
B2 (`B2_*`, ver `.env.example`) não estiverem preenchidas, os uploads
caem automaticamente pro disco local — assim o projeto roda sem precisar
de conta no B2 durante desenvolvimento.

### Por que MySQL (e não Postgres)

O projeto já passou pelo Postgres e pelo MongoDB antes de chegar aqui.
Postgres foi descartado depois de um diagnóstico real: o Prisma (ORM que
todo o backend usa) tem uma limitação confirmada conectando com
certificado de cliente (TLS mútuo) em bancos Postgres do Square Cloud —
testei isolado com o driver puro (`pg`, funcionou) e com o Prisma de
verdade (`prisma db push`, falhou sempre com `P1010: acesso negado`) nas
mesmas credenciais, confirmando que o problema era específico do Prisma
com Postgres, não das credenciais nem da configuração. MySQL não tem
essa limitação — testado e confirmado funcionando com Prisma de verdade,
certificado de cliente incluído.

### Migrando os dados reais (SQLite antigo → MySQL novo)

Se você já tem uma base rodando (com usuários/mensagens reais) no SQLite
antigo, NÃO precisa recomeçar do zero:

```bash
# 1. Configure DATABASE_URL no .env apontando pro MySQL novo
# 2. Gere o client do banco antigo (só pra leitura, não mexe nele)
npx prisma generate --schema=prisma/schema.sqlite-legacy.prisma
# 3. Rode a migração (copia tudo, tabela por tabela, na ordem certa)
LEGACY_SQLITE_URL="file:./dev.db" node scripts/migrate-to-postgres.js
```

O script (`scripts/migrate-to-postgres.js` — nome ficou do tempo do
Postgres, mas hoje ele escreve no banco que estiver configurado em
`DATABASE_URL`, que agora é o MySQL) descobre sozinho a ordem segura de
migrar cada tabela (a partir das relações declaradas no schema, sem
precisar listar as 50+ tabelas na mão) e pode ser rodado mais de uma vez
sem duplicar nada.

### Primeira vez rodando contra um MySQL vazio

Os scripts `predev`/`start` do `package.json` já rodam `prisma db push`
sozinhos a cada subida — sincroniza as tabelas direto do `schema.prisma`
sem precisar de nenhum passo manual. Isso é seguro enquanto o banco
ainda não tem dados reais de usuário (é só recriar as tabelas do zero).
**Antes de ter usuários de verdade em produção**, vale trocar pro
sistema de migrações do Prisma (`prisma migrate`), que não corre risco
de perder dado sem querer numa mudança de schema futura:

```bash
npx prisma migrate dev --name init
```

### O que ainda está em memória do processo (não migrado pro Redis)

Só o timer de "período de graça" antes de marcar alguém como offline
(ver `pendingOfflineTimers` em `sockets/index.js`) continua em memória —
DE PROPÓSITO: um handle de `setTimeout` do Node não é um dado
serializável, não existe "salvar um timer no Redis". Isso não
compromete nada — quem está online de verdade é sempre o Redis
(`services/presenceStore.js`); na pior das hipóteses rodando em mais de
uma instância, esse período de graça vira "por instância" em vez de
global, o que é só uma perda pequena de suavidade, não um dado errado.
Presença, canais de voz (`services/voiceRoomStore.js`) e chamadas de DM
já estão 100% no Redis.

## Cancelamento de ruído nos canais de voz (RNNoise)

Além da supressão de ruído nativa do navegador, os canais de voz agora
processam o áudio do microfone com o **RNNoise**
(https://github.com/xiph/rnnoise) — a mesma biblioteca (via
`@jitsi/rnnoise-wasm`, o build WASM mantido pelo Jitsi Meet, que usa
exatamente essa versão em produção) — antes de mandar pra chamada. Roda
inteiro no navegador, numa thread de áudio dedicada (`AudioWorklet`), sem
mandar áudio pra nenhum servidor externo. Tem um botão (🧠) na barra de
chamada pra ligar/desligar. Se o navegador não suportar `AudioWorklet` (ou
o carregamento falhar por qualquer motivo), a chamada continua funcionando
normalmente só com a supressão de ruído nativa do navegador — nunca trava
a chamada por causa disso.

## Canais de voz entre redes diferentes exigem um servidor TURN

Os canais de voz/vídeo usam WebRTC ponto-a-ponto (`client/src/context/VoiceContext.jsx`,
`client/src/components/VoiceChannelView.jsx`) — o servidor só faz a
sinalização (Socket.IO relay de offer/answer/ICE candidate,
`server/src/sockets/index.js`), a mídia em si nunca passa por ele. Isso
funciona sem configuração nenhuma quando os dois participantes conseguem
se alcançar diretamente (mesma rede, NAT permissivo). Entre redes
diferentes com NAT restritivo/simétrico ou CGNAT (bem comum em rede de
operadora de celular) — exatamente o cenário "funciona na mesma rede,
não funciona entre redes diferentes" — STUN sozinho não é suficiente, e
é preciso um servidor **TURN** de retransmissão, preenchendo em
`client/.env`:

```
VITE_TURN_URLS=turn:seu-turn.exemplo.com:3478,turns:seu-turn.exemplo.com:5349
VITE_TURN_USERNAME=
VITE_TURN_CREDENTIAL=
```

Veja `client/.env.example` para instruções completas de onde conseguir um
(coturn próprio ou um provedor gerenciado). Sem essas variáveis, o app
continua funcionando normalmente pra tudo mais — só chamadas de voz nesse
cenário específico de rede é que ficam sem áudio, com um aviso no console
do navegador lembrando disso.


Rede social de **comunidade única**, construída fundindo dois projetos:

## Tickets de Suporte (novo)

Sistema de suporte, acessível pelo ícone 🎫 (`/tickets`) — qualquer membro
pode abrir um ticket com um assunto e mensagem inicial, conversar com a
staff em tempo real, e a staff (aba "🛡️ Todos") vê todos os tickets,
assume e fecha quando resolvido. Substitui o `/ticket` do bot Robbie por
uma versão web mais rica (histórico completo, tempo real via socket).

## Sistemas removidos por pedido do usuário

O sistema de economia foi simplificado: **loja de cores de perfil**,
**empregos** e **cassino** (cara-ou-coroa, roleta, loteria, dados) foram
removidos por completo (schema, backend e frontend) — moedas/gemas e o
**baú diário** continuam. Também removidos vestígios não utilizados: o
tipo de canal "FORUM" (sem interface, só existia na API) e um componente
de soundboard órfão.

- **Visual**: inspirado no `Facebook.zip` (paleta azul, cards brancos bem
  arredondados, tipografia Roboto, sombras suaves) — aplicado como o tema
  `facebook` em `client/src/styles/global.css` (é o tema padrão do app).
- **Sistemas**: todo o backend e os recursos de chat vêm do `EmberCord.zip`
  (auth completo com e-mail/2FA, perfil com banner/avatar/fonte do
  nome/efeitos, amigos, DMs, canais de texto/voz, cargos e permissões,
  emojis customizados, moderação com AutoMod, painel administrativo,
  anúncios da plataforma) — adaptados de "múltiplos servidores" (como o
  Discord) para **uma única comunidade global**: todo mundo que se cadastra
  já entra automaticamente nela, com os mesmos canais e o mesmo mural.

## Estrutura

```
Project Club/
├── server/     Node/Express + Prisma (SQLite) + Socket.IO
└── client/     React + Vite
```

## Como rodar

```bash
npm install          # instala as dependências de server + client (workspaces)
npm run prisma:push  # cria o banco e popula insígnias/cargo padrão/canais iniciais
npm run dev           # sobe server (porta 3000) e client (porta 5173) juntos
```

Copie `server/.env.example` para `server/.env` e preencha as variáveis
(segredo do JWT, credenciais de e-mail para verificação/2FA, etc.) antes de
rodar `npm run dev` pela primeira vez. `server/uploads/` já vem com os
arquivos (avatares, banners, emojis) que existiam no EmberCord original,
reaproveitados como pediu.

## Painel administrativo completo (fusão com o bot Robbie)

O menu de staff (ícone 🛡️ "Painel" na barra lateral, só aparece pra
ADMIN/MODERATOR) agora cobre praticamente todas as configurações que o
painel web do bot Robbie tinha:

- **Economia**: editar empregos (nível mínimo, tempo, recompensa), baús
  diários (chance/moedas/tickets de cada um) e itens da loja — tudo sem
  precisar de deploy novo, direto pelo navegador.
- **Casas e Móveis**: cadastrar/editar/excluir casas do catálogo (nome,
  preço, cor) e móveis (com upload de imagem, preço, categoria).
- **Sistema**: liga/desliga Economia, Casas ou Figurinhas pra toda a
  comunidade de uma vez (equivalente ao "disabled_systems" do bot) — quem
  não é admin vê uma tela de "indisponível" enquanto estiver desligado.
- **Moderação de Recados**: revisar e apagar qualquer recado do livro de
  visitas das casas, de qualquer usuário.
- Nível/XP, Álbum de Figurinhas (posições/fundo), Anúncios, Manutenção,
  Insígnias, Usuários — já cobertos desde fases anteriores.

**Não portado** (infraestrutura de bot Discord, não se aplica a uma
plataforma web): console ao vivo, backup bruto de banco de dados, gestão
de "servidores" Discord, embeds do bot.

## Figurinhas/álbum (fusão com o bot Robbie — fase 4)

Sistema de colecionáveis, acessível pelo ícone 🧷 (`/figurinhas`) — as 10
figurinhas e as 5 raridades (Comum → Ultra Lendária, com pesos de sorteio
idênticos) vêm direto do catálogo original.

- **Coleção**: catálogo agrupado por raridade — figurinha nunca obtida
  aparece como "❔" (não descoberta).
- **Máquina de Cápsulas**: compra 1/5/10 cápsulas por moedas (mesmos preços
  do original: 100/450/800) — a figurinha já é sorteada na hora da compra
  (sorteio ponderado pelo peso de cada raridade) e fica "fechada" até abrir.
- **Álbum**: colar figurinhas soltas do inventário nos espaços do álbum.

**Simplificação desta fase**: o original tem um layout de páginas/slots
totalmente configurável pela staff (dá pra definir a posição exata de cada
figurinha, várias por página); aqui cada figurinha tem uma posição fixa
própria no álbum, o que funciona bem com um catálogo pequeno mas não tem a
flexibilidade de layout do original. Também não incluído: troca de
figurinhas entre jogadores (`sticker_trades`), painel de staff pra
gerenciar o catálogo.

## Casas/decoração (fusão com o bot Robbie — fase 3, atualizada com o
## sistema de grupos real, portado do código-fonte original)

Sistema de casas decoráveis, acessível pelo ícone 🧊 (`/casas`) — o catálogo
de casas (iglus temáticos), categorias e os 20 móveis (com imagens reais)
foram extraídos diretamente do banco de dados do projeto original.

- **Casa inicial grátis**: a staff define qual casa (e qual mapa, se ela
  tiver grupo) toda conta nova ganha automaticamente já ativa, sem precisar
  comprar nada — igual o bot original.
- **Imobiliária**: comprar casas, móveis e fundos com moedas, organizados
  em abas por categoria. Estoque limitado é suportado (staff define; vazio
  = ilimitado).
- **Decorar**: arrastar móveis pra dentro da casa, reposicionar, aumentar/
  diminuir, virar horizontalmente, trazer pra frente/mandar pra trás
  (camadas), remover, salvar.
- **Sistema de grupos** (portado fielmente do código-fonte do bot Robbie
  original, `panel/routes/houseAdmin.js`): uma casa do catálogo OU tem
  fundo próprio embutido (`groupId` vazio), OU pertence a um grupo
  numerado (1-1000) — nesse caso ela só tem a "imagem da casa" (sprite,
  sem fundo), e o fundo de verdade é o mapa que o usuário escolher (também
  comprável). A staff define, por grupo, a posição/tamanho (x, y, largura,
  altura) onde a sprite aparece por cima do mapa — mover ou redimensionar
  um grupo afeta todas as casas ligadas a ele de uma vez (ex.: "Iglu Azul"
  e "Iglu Vermelho" podem compartilhar o grupo 5, mesma vaga visual, só
  trocando a aparência).
- **Galeria**: ver a casa ativa de outros membros, com curtidas e livro de
  visitas, filtrável por qual mapa cada um está usando.

**Diferença deliberada do original**: o bot gerava a casa como um PNG
achatado no servidor (Jimp). Aqui a casa é renderizada ao vivo no
navegador (camadas de `<img>` por z-index) — decisão técnica consciente
pra um app web (edição instantânea, responsivo, sem gerar imagem a cada
salvamento); o *mecanismo* de dados (grupos, casa/mapa inicial, estoque)
é fiel ao original, só a tecnologia de desenho é diferente.

## Nível, XP e Rank (fusão com o bot Robbie — fase 2)

Sistema de progressão adaptado do bot, acessível pelo ícone 🏆 (`/rank`):

- **Ganho de XP**: mandar mensagens em canais concede 25-35 XP (cooldown de
  30s, exige conteúdo com pelo menos 4 caracteres/2 palavras) — mesma faixa
  do bot original. **Simplificado nesta fase**: a detecção de flood/mensagem
  repetida do anti-farm original não foi portada, só o cooldown e o mínimo
  de qualidade.
- **200 níveis**: curva de XP e nomes extraídos 1:1 de `config/levels_roles.json`
  do bot original. Recompensa em moedas mantida; recompensa em tickets
  omitida (não existe esse recurso na economia do Project Club).
- **Rank**: barra de progresso até o próximo nível + posição na comunidade
  + leaderboard dos 50 primeiros.
- **Ferramentas de staff**: no Painel administrativo → Usuários → Ações, dá
  pra definir o nível de alguém direto ou adicionar/remover XP manualmente
  (equivalente aos comandos `!set_level` e `!add_xp` do bot).
- **Auditoria/moderação**: o Project Club já trazia isso desde a fusão com
  o EmberCord (Painel administrativo → Registro de auditoria, bans,
  advertências, AutoMod) — não duplicado nesta fase.

## Economia (fusão com o bot Robbie — fase 1)

A comunidade agora tem um sistema de economia, adaptado do bot Discord
"Robbie" do usuário (moedas, empregos, cassino, loja, recompensa diária).
Acesse pelo ícone 💰 no menu superior (`/economia`).

- **Diário**: baú diário com moedas/tickets por peso de raridade, sequência
  de 5 dias premia com Mega Baú de gemas — mesma tabela de chances do
  `config/chests.json` original.
- **Empregos**: os mesmos 8 empregos do `/empregos` original (Faxineiro até
  Cientista), com nível mínimo, tempo de espera e faixa de recompensa
  idênticos.
- **Cassino**: Cara ou Coroa, Roleta e Loteria — mesmas probabilidades e
  multiplicadores do bot original, com o mesmo motor de aposta atômico
  (transação única: valida saldo, debita aposta, credita prêmio). **Não
  incluído nesta fase**: Blackjack (jogo multi-turno mais complexo do bot).
- **Loja**: versão simplificada — catálogo fixo de cores de perfil
  compráveis com moedas, em vez do ciclo diário/semanal rotativo completo
  de banners/insígnias/temas do `/loja` original.

Próximas fases (ainda não escolhidas pelo usuário): casas/decoração,
figurinhas/álbum, XP/nível/rank + painéis de staff (auditoria, moderação).

## O que mudou do EmberCord original

- **Removido** (conceito de múltiplos servidores, não se aplica a uma
  comunidade única): criar/entrar em servidores, convites, servidor
  público/descoberta, templates de servidor, transferência de dono,
  sistema de Impulsos (boost), tickets de suporte, integração
  (onboarding) por servidor.
- **Adiado para uma fase 2** (por decisão explícita durante a construção):
  canais de fórum, chamadas de voz/vídeo com o roster completo, figurinhas
  e efeitos sonoros (soundboard). O código de voz básico (entrar/sair de
  canal de voz) ainda existe mas não foi o foco desta fase.
- **Mantido e adaptado**: tudo o resto — é a mesma qualidade de sistema do
  EmberCord, só que operando em cima de uma única comunidade global em vez
  de N servidores independentes.

## Validação

Este projeto foi construído e validado num ambiente sem acesso ao registro
de binários do Prisma (`binaries.prisma.sh` estava bloqueado), então:

- **Backend**: todos os 48 arquivos do backend foram carregados com Node
  real (`require()`) para confirmar que não há import quebrado nem erro de
  sintaxe. A camada de banco (Prisma Client) não pôde ser testada
  end-to-end aqui — rode `npm run prisma:push` no seu ambiente pra validar
  isso.
- **Frontend**: todos os 89 arquivos `.jsx`/`.js` foram validados
  individualmente com `esbuild`, e o app inteiro foi compilado a partir de
  `main.jsx` com `--bundle` para confirmar que todo import resolve
  corretamente (zero erros).

Recomendo, ao rodar localmente pela primeira vez, testar o fluxo completo
(cadastro → verificação de e-mail → entrar num canal → mandar mensagem →
abrir o painel admin) pra pegar qualquer detalhe de UI que só apareça em
runtime.
