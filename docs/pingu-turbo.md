# Pingu Turbo

Extensão da Fase 9 do Pingu (`@pingu`): respostas ao vivo, bem mais rápidas, e funções novas
(imagens, lembretes, enquetes, explicar/reescrever, memória curta, DM). Nada do que já existia
foi removido: resumo, tradução, quiz, boas-vindas, moderação assistida e a fila única com
prioridades (`askModel` / `postAsPingu` / `sendEphemeral`) continuam iguais.

## Onde está cada coisa

| Arquivo | O que faz |
|---|---|
| `server/src/services/pinguBot.js` | Recebe os pedidos (canal e DM), escolhe o caminho (instantâneo, cache, IA, imagem…), streaming e cancelamento |
| `server/src/services/pingu/prompt.js` | System prompt **fixo** + mensagem do usuário com o contexto que muda + orçamento por tipo |
| `server/src/services/pingu/stream.js` | Leitura do NDJSON do Ollama (`stream:true`) e o acelerador das edições (~500 ms) |
| `server/src/services/pingu/cache.js` | Cache LRU com validade/versão e "carona" (pedidos iguais ao mesmo tempo) |
| `server/src/services/pingu/tools.js` | Respostas instantâneas sem IA (ajuda, hora, contas, conversões, dados, contagem, FAQ da wiki) |
| `server/src/services/pingu/calc.js` | Calculadora com parser próprio (sem `eval`) |
| `server/src/services/pingu/convert.js` | Conversões de unidades de fator fixo (+ moeda só com cotação fixa configurada) |
| `server/src/services/pingu/timeparse.js` | Expressões de tempo em português pros lembretes |
| `server/src/services/pingu/intents.js` | O que a pessoa quer: imagem, de novo, lembrete, enquete, explicar, resumir isso, reescrever, ajuda |
| `server/src/services/pingu/memory.js` | Memória curta (2 trocas por pessoa+sala, 10 min, só em memória) |
| `server/src/services/pingu/safety.js` | Filtro dos pedidos de imagem (PT + EN) |
| `server/src/services/pingu/image.js` | Provedores (Pollinations / local / off), validação, fila e limites |
| `server/src/services/pingu/imageRuntime.js` | Liga o motor de imagens ao banco, B2 e mensagens; painel (listar/apagar) |
| `server/src/services/pingu/actions.js` | Lembrete (serviço `reminders`) e enquete (mesmo formato do `pollController`) |
| `client/src/utils/pinguMessage.js`, `PinguHelpPopover.jsx`, `admin/PinguImagesAdmin.jsx` | Cursor ao vivo, selo/baixar da imagem, comandos, painel |

## 1. Respostas em tempo real (streaming)

1. O pedido chega → o Pingu posta **na hora** uma mensagem `🐧 digitando…` (ou `🐧 Na fila (2º)…`)
   respondendo quem perguntou (`message:new` com `pinguStreaming: true`).
2. A geração usa `/api/chat` com `stream: true`. A cada pedaço, o texto (já limpo com `cleanAnswer`)
   vai pro app pelo evento **`message:update`** que o cliente já trata (`SocketContext` →
   `updateMessage`), no máximo **uma vez a cada 500 ms** (`createThrottle`; a primeira sai em 150 ms).
   Essas edições parciais **não** gravam no banco.
3. No fim: grava a versão final (`cleanAnswer`, corte em frase completa) e manda um `message:update`
   **sem** `pinguStreaming` → o cursor some.
4. Se o streaming falhar antes de começar (proxy sem streaming, HTTP 4xx), cai pro modo normal
   (`stream: false`) e desliga o streaming por 10 min; se cortar no meio com ≥ 40 caracteres, usa o
   que veio.
5. Apagar a mensagem que pediu (ou a resposta sendo escrita) cancela: sai da fila ou aborta o
   `fetch` (`AbortController`) e a mensagem "digitando…" some (`onMessageDeleted` em
   `messageController.deleteMessage`).

## 2. Otimização

### Números medidos na VPS (2 vCPU AMD EPYC, 4 GB)

| | Antes | Agora |
|---|---|---|
| Modelo | `qwen3.5:2b` Q8_0 | `qwen3.5:2b-q4_K_M` (PINGU_MODEL já trocado no servidor) |
| Escrita | 6,7 tokens/s | **9,6–10,2 tokens/s** (~50% mais rápido) |
| Leitura do prompt sem cache | ~33–43 tokens/s | igual |
| Leitura do prompt **com prefixo em cache** | — | **~250–290 tokens/s** (51 tokens: ~1,5 s → ~0,2 s) |
| Flash attention + KV q8_0 | — | ligados (ganho pequeno) |
| Temperatura | 0,5 | **0,3** em perguntas (respostas factuais mais certas); 0,7 só pra coisa criativa |

### O que mudou no código e o ganho esperado

**System prompt byte a byte idêntico.** Antes o trecho da wiki ia **dentro** do system prompt, então
quase toda pergunta mudava o começo do prompt e o Ollama relia tudo (~150 tokens de persona +
instruções da equipe, até ~600, + ~180 da wiki) a ~38 tokens/s → **5 a 20 s só lendo**. Agora o system
prompt é só a persona fixa + as instruções da equipe (`prompt.js`), e o que muda (trecho da wiki,
mensagem respondida, data quando a pergunta fala de tempo, tarefa) vai no **fim**, na mensagem do
usuário. O prefixo sai do cache a ~270 tokens/s (ex.: 600 tokens ≈ 2,2 s em vez de ≈ 16 s) e só o
pedaço novo (~30–200 tokens, 1–5 s) é lido devagar.

**Reaquecimento.** Quando a IA volta (health check), quando a equipe muda as instruções, e quando a
fila fica parada depois de um pedido com OUTRO system prompt (resumo, tradução, moderação, boas-vindas,
quiz), o Pingu manda um pedido de 1 token só com o system prompt das perguntas (prioridade mais baixa
da fila; sai primeiro se lotar). A próxima pergunta já encontra o prefixo em cache. `PINGU_REWARM=0`
desliga o reaquecimento por ociosidade.

**Opções fixas.** `num_ctx` (1024) e `num_thread` (2) **nunca** mudam entre pedidos (mudar qualquer
um faz o Ollama recarregar o modelo — vários segundos). `keep_alive: -1` (modelo sempre carregado;
configurável). `num_predict` muda por tipo (isso não recarrega nada):

| Tipo | num_predict | temperatura | tamanho máx. |
|---|---|---|---|
| pergunta curta (≤ 40 caracteres) | 110 | 0,3 | 600 |
| pergunta | 150 | 0,3 | 600 |
| criativa (piada, poema, história…) | 170 | 0,7 | 600 |
| explicar mensagem | 180 | 0,3 | 700 |
| resumir mensagem | 120 | 0,2 | 500 |
| reescrever | 80–360 (pelo tamanho do texto) | 0,4 | 1500 |
| traduzir pedido de imagem | 60 | 0,2 | — |

**Respostas instantâneas sem IA (zero CPU na VPS)** — `tools.js`: ajuda/comandos, hora e data de
Brasília, calculadora (`15% de 200`, `raiz de 144`, `2,5 x 4`), conversões (comprimento, massa, volume,
velocidade, tempo, dados, área, temperatura; moeda **só** com `PINGU_FX_RATES`), dados (`d20`, `3d6+2`),
cara ou coroa, sorteio (`de 1 a 100`), "escolhe entre A, B ou C", contagem regressiva (natal, ano novo,
`25/12`…) e **FAQ da wiki** quando a melhor seção do BM25 tem nota ≥ 5, ganha da segunda com folga
(≥ 1,15×) e o título dela cobre ≥ 60% das palavras da pergunta (cita o trecho e `/wiki/slug`).
"O que é o Project Club?" tem resposta pronta com as páginas da wiki. Tempo de resposta: só a gravação
da mensagem (dezenas de ms), contra 5–20 s antes.

**Cache de respostas.** LRU de 300 respostas por 30 min, chave = pergunta normalizada (sem acento,
sem "por favor"). Não guarda pergunta que depende de hora/contexto ("hoje", "isso", "ele"…), nem DM,
nem continuação de conversa. A versão do cache = hash do system prompt + versão da wiki (`wiki.version()`
sobe a cada edição) → mudou a wiki ou as instruções, o cache inteiro vale nada.

**Carona.** Duas pessoas perguntando a mesma coisa ao mesmo tempo → **uma** geração; as duas mensagens
do Pingu são preenchidas ao vivo com o mesmo texto. Se uma pessoa apagar o pedido, a geração só para
se ninguém mais estiver esperando.

### Tempo até ver a resposta (estimativa com os números acima)

| Caso | Antes | Agora |
|---|---|---|
| Algo aparece no chat | 5–25 s (resposta inteira) | **< 0,1 s** ("digitando…") |
| Primeira palavra | — | ~0,5–5 s (prefixo em cache + pedaço novo) |
| Resposta de 100 tokens completa | ~20–30 s (Q8, sem cache) | ~11–15 s, aparecendo aos poucos |
| Conta / conversão / hora / dado / FAQ | 5–25 s (IA) | **instantâneo** (sem IA) |
| Pergunta repetida (cache) | 5–25 s | **instantâneo** |

O painel (Painel da Equipe → Pingu) mostra os números reais desde que o servidor ligou: tempo médio
até a 1ª palavra, tempo total, tokens/s lendo e escrevendo, respostas instantâneas, do cache, caronas e
chamadas à IA (`adminState().perf`).

## 3. Imagens

`@pingu desenhe|crie uma imagem de|gere uma imagem|imagem <descrição>` (e `draw` / `create image` /
`generate image`), com "quadrada" (768×768), "paisagem" (1024×576) ou "retrato" (576×1024).
`@pingu de novo` / `outra` (ou responder a imagem com isso) refaz com outra semente. No app: menu **+**
do composer → **Criar imagem com o Pingu** (preenche `@pingu desenhe `).

Fluxo: filtro de segurança (`safety.js`: sexual/nudez; menores em qualquer contexto sexual ou violento,
e termos de abuso sempre; gore; símbolos de ódio; pessoas reais conhecidas + `PINGU_IMAGE_BLOCKED_NAMES`;
automutilação, com o CVV 188) → limites → mensagem `🎨 Criando sua imagem…` (ou "posição N na fila") →
tradução PT→EN pelo dicionário local (a IA só entra, com `num_predict` 60, se mais de 1/3 das palavras
ficou sem tradução; a tradução passa de novo pelo filtro) → provedor com tempo limite de 60 s →
validação por **bytes mágicos** (PNG/JPEG/WebP/GIF) e **≤ 4 MB** (o corpo é lido com teto, sem baixar o
resto) → `fileStorage.storeFile` (B2, ou disco em desenvolvimento) → a mensagem vira a imagem com a
descrição `🎨 "…"`, respondendo quem pediu.

Limites (Painel → Funções do Pingu → Imagens): ligado/desligado, **1 a cada 30 s** por pessoa,
**10 por dia** (Assinante 2×, Super Assinante 3×, pelo `supporterTier`), 1 ou 2 imagens ao mesmo tempo,
fila de até 8. Na DM o Pingu não cria imagens (assim todo pedido fica visível pra equipe).

Registro: tabela `PinguImage` (quem, prompt, prompt final, provedor, semente, tamanho, url, status
`PENDING|DONE|FAILED|BLOCKED|CANCELLED|DELETED`, erro, datas). Painel → Pingu → **Imagens do Pingu**:
estado do provedor, fila, último erro, histórico com miniatura e **Apagar** (apaga a mensagem do canal
e o arquivo do armazenamento).

Provedores (`PINGU_IMAGE_PROVIDER`):

- `pollinations` (padrão): `GET https://image.pollinations.ai/prompt/<prompt>?width&height&seed&model=flux&nologo=true&safe=true&private=true`.
  Grátis e sem chave; o plano anônimo tem limite de ritmo — se começar a falhar com HTTP 429, crie um
  token grátis e ponha em `PINGU_POLLINATIONS_TOKEN` (ou `PINGU_POLLINATIONS_REFERRER`).
- `local`: `POST PINGU_IMAGE_URL` com `Authorization: Bearer PINGU_IMAGE_KEY` e JSON
  `{ prompt, negative_prompt, width, height, steps, seed }`; aceita os bytes da imagem ou JSON com
  base64 (`image`, `images[0]` ou `data[0].b64_json`). Pensado pra um stable-diffusion.cpp próprio no
  futuro (não cabe na VPS da IA).
- `off`: desligado.

## 4. Funções novas

- **Pingu na DM**: mande mensagem direta pro Pingu (miniperfil dele → "Conversar no privado"). Mesmas
  regras e comandos; a conversa **não** passa pela moderação assistida, não entra no cache compartilhado
  nem no histórico de imagens. Só DM 1:1.
- **Lembretes**: `@pingu me lembra em 20 min de tirar o bolo`, `daqui a 2 horas e 30 minutos`,
  `em meia hora`, `amanhã às 9h`, `amanhã de manhã`, `hoje à noite`, `sexta às 10h`, `dia 15 às 14h`,
  `15/12`, `às 18:30`, `ao meio-dia`. Cria um lembrete de verdade (`services/reminders.js` → aviso nas
  Notificações). No canal a confirmação é "só você vê" e o Pingu reage ⏰ na mensagem.
- **Enquetes**: `@pingu enquete Qual o melhor jogo? Minecraft / Terraria / Roblox` (também `:` e `,`/`ou`;
  duração opcional `(4h)`, `por 3 dias`). Enquete real (mesmo formato do `pollController`), postada pelo
  Pingu; quem pediu precisa da permissão **Criar enquetes** no canal.
- **Explicar / resumir / reescrever**: respondendo a mensagem de alguém, `@pingu explica`,
  `@pingu resume isso`, `@pingu melhora esse texto` (corrige, deixa mais formal…).
- **Memória curta**: as 2 últimas trocas por pessoa por canal (10 min, só em memória) entram quando a
  pergunta é curta ou parece continuação ("e o outro?", "explica melhor").
- **Comandos do Pingu**: `@pingu ajuda` (só você vê) e o popover no miniperfil do Pingu
  (`GET /api/pingu/help`).
- A página `/wiki/pingu` da semente antiga é atualizada sozinha se ninguém tiver mexido nela.

## Variáveis de ambiente

| Variável | Padrão | Pra quê |
|---|---|---|
| `PINGU_OLLAMA_URL`, `PINGU_OLLAMA_KEY`, `PINGU_MODEL` | — / — / `qwen3.5:2b` | IA (na VPS: `qwen3.5:2b-q4_K_M`) |
| `PINGU_NUM_CTX` | `1024` | Contexto (fixo pra não recarregar o modelo) |
| `PINGU_NUM_THREAD` | `2` | Threads (= vCPUs da VPS) |
| `PINGU_KEEP_ALIVE` | `-1` | Quanto tempo o modelo fica carregado (`-1` = sempre, ou `24h`) |
| `PINGU_STREAM` | `1` | `0` desliga o streaming |
| `PINGU_REWARM` | `1` | `0` desliga o reaquecimento quando a fila fica parada |
| `PINGU_FX_RATES` | — | Cotações fixas em reais, ex. `{"USD":5.4,"EUR":5.9}` (sem isso o Pingu não converte moeda) |
| `PINGU_IMAGE_PROVIDER` | `pollinations` | `pollinations`, `local` ou `off` |
| `PINGU_IMAGE_URL`, `PINGU_IMAGE_KEY`, `PINGU_IMAGE_STEPS` | — / — / `20` | Provedor `local` |
| `PINGU_IMAGE_MODEL` | `flux` | Modelo do Pollinations |
| `PINGU_POLLINATIONS_URL`, `PINGU_POLLINATIONS_TOKEN`, `PINGU_POLLINATIONS_REFERRER` | — | Opcionais do Pollinations |
| `PINGU_IMAGE_BLOCKED_NAMES` | — | Nomes extras de pessoas reais bloqueados (separados por vírgula) |

Banco: `PinguConfig` ganhou `imageEnabled`, `imageDailyLimit`, `imageCooldownSec`, `imageConcurrency`, e há
a tabela nova `PinguImage` (o `prisma db push` do deploy cria; nada é apagado).

## Configuração recomendada do serviço Ollama na VPS

(Só recomendação — nada disso foi alterado daqui.)

```ini
# systemd: sudo systemctl edit ollama → [Service]
Environment="OLLAMA_FLASH_ATTENTION=1"      # já ligado
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"     # já ligado; metade da RAM do KV, quase sem perda
Environment="OLLAMA_KEEP_ALIVE=-1"          # modelo sempre carregado (o Pingu também manda keep_alive)
Environment="OLLAMA_MAX_LOADED_MODELS=1"    # só cabe um modelo nos 4 GB
Environment="OLLAMA_NUM_PARALLEL=1"         # 2 vCPU: um pedido por vez (o Pingu já faz fila)
Environment="OLLAMA_CONTEXT_LENGTH=1024"    # igual ao num_ctx do Pingu (evita recarregar)
Environment="OLLAMA_MAX_QUEUE=16"
```

- `OLLAMA_NUM_PARALLEL=2` é uma alternativa a testar: guarda **dois** caches de prefixo (um pras
  perguntas e outro pro resumo/tradução/moderação) com custo de RAM pequeno em contexto 1024 com KV q8;
  aí o reaquecimento por ociosidade pode ser desligado (`PINGU_REWARM=0`). Medir antes de adotar.
- **Caddy**: pro streaming chegar aos poucos, o `reverse_proxy` deve repassar sem segurar a resposta:
  `reverse_proxy 127.0.0.1:11434 { flush_interval -1 }` (as rotas continuam só `/api/chat` e
  `/api/tags`). Se o proxy segurar a resposta, o Pingu ainda funciona: o texto aparece de uma vez e,
  se o streaming falhar, ele volta pro modo normal sozinho.
- Manter o modelo `q4_K_M` (o ganho de ~50% na escrita é o maior de todos) e não usar `think`.

## Testes

- Servidor: `server/test/pingu-turbo.test.js` (filtro de segurança, intenções, calculadora e conversões,
  horário dos lembretes, cache/carona, acelerador do streaming com relógio falso, NDJSON, validação de
  imagem, escolha de provedor com `fetch` falso, fluxo de imagens com dependências falsas, prompt fixo,
  memória e o fluxo ao vivo do `pinguBot` com banco/socket de mentira: streaming, cache, carona,
  cancelamento, volta ao modo normal, instantâneas e DM). Nada acessa rede, banco nem Ollama.
- Cliente: `client/test/pingu-turbo.test.mjs`.
