# Mini-Jogos — como modificar um jogo, criar um patch e subir a versão

Cada mini-jogo é um site estático dentro desta pasta
(`client/public/minigames/`), servido na mesma origem do app. Os jogos HTML5
ficam em `<slug>/` (ex.: `pizzatron/`); os jogos em Flash rodam no Ruffle a
partir de `flash/player.html?swf=<slug>/<arquivo>.swf`.

O app abre cada jogo num `<iframe>` e, antes de abrir, lê o
**manifest de versões** (`manifest.json`). Isso permite publicar uma correção
num jogo **sem recompilar o app**: basta mexer nos arquivos do jogo e subir a
versão no manifest.

## 1. `manifest.json` — versão de cada jogo

```json
{
  "schema": 1,
  "updated": "2026-10-12",
  "games": {
    "pizzatron": { "version": "2", "notes": "...", "patches": ["patch.js"] },
    "sledracing": { "version": "1" }
  }
}
```

- `version` (string, `[\w.-]{1,40}`): vai na URL do jogo como `?v=<version>`,
  **furando o cache** do navegador/CDN. Sempre que mudar os arquivos de um
  jogo, **suba a versão** (ex.: `"1"` → `"2"`) para os jogadores receberem a
  mudança na próxima vez que abrirem o jogo.
- `notes` (opcional): lembrete do que mudou.
- `patches` (opcional): lista de scripts injetados no jogo (ver abaixo).

O manifest é lido **sem cache** (`cache: no-cache`) uma vez por sessão
(`src/minijogos/manifest.js`). Se a rede falhar ou demorar, o jogo abre
assim mesmo (o `?v=` só é omitido). Jogos sem entrada no manifest usam
`version: "1"` por padrão.

> Importante: o `?v=` só fura o cache de quem **abre** o jogo (o `index.html`
> / `Game.html` / `.swf` principal). Se você trocar um asset interno (imagem,
> som, script secundário) e quiser garantir cache novo, suba a versão **e**,
> se precisar, referencie o asset já com `?v=` no HTML do jogo.

## 2. Modificar um jogo

1. Edite os arquivos em `client/public/minigames/<slug>/` (HTML5) ou
   `client/public/minigames/flash/<slug>/` (Flash).
2. Mantenha o código e os comentários em **pt-BR** quando escrever algo novo.
3. **Suba a `version`** do jogo no `manifest.json`.
4. Recompile só os assets estáticos — não precisa mexer no app React.

Comentários de alterações do Project Club nos jogos originais começam com
`// Project Club:` para ficar fácil achar o que foi mudado em cima da
recriação original.

## 3. Camada de patch (opcional) — corrigir sem mexer no original

Um **patch** é um script pequeno, da **mesma origem**, injetado na janela do
jogo **depois** que ele carrega. Serve para corrigir/ajustar um jogo sem
editar os arquivos originais (útil quando o original é uma recriação de fã
que você prefere manter intacta).

Como registrar um patch (qualquer um dos dois):

- **No manifest:** `games.<slug>.patches: ["patch.js"]`
- **No catálogo** (`src/minijogos/catalog.js`): adicione `patches: ['patch.js']`
  ao objeto do jogo.

As duas fontes se somam (sem repetir). Os caminhos são **relativos à pasta do
jogo** (`/minigames/<slug>/` nos HTML5, `/minigames/flash/<slug>/` nos Flash),
precisam terminar em `.js` e não podem conter `..` nem começar com `/`.

Onde colocar o arquivo e o que ele recebe:

- Coloque `patch.js` dentro da pasta do jogo.
- Ele roda na **janela onde o jogo vive** (`Game.html` nos HTML5 injetados
  pelo `MiniJogoPlayer`, `player.html` nos Flash) — ou seja, tem acesso ao
  `window`/`document` do jogo e às globais dele (`window.app`, `window.$`, …).
- Antes de rodar, encontra `window.__pcPatch = { slug, version, dir }`.
- É injetado **uma vez por janela** (`win.__pcPatchesInjected`) e carregado
  com o mesmo `?v=` do jogo.

Exemplo (`client/public/minigames/<slug>/patch.js`):

```js
// Project Club — patch do <slug> (ver public/minigames/README.md).
(function () {
  var p = window.__pcPatch || {};
  // Ex.: corrigir uma função do jogo depois que ele carregou.
  if (typeof window.AlgumaCoisaDoJogo === 'function') {
    var orig = window.AlgumaCoisaDoJogo;
    window.AlgumaCoisaDoJogo = function () { /* ... */ return orig.apply(this, arguments); };
  }
})();
```

Depois de criar/alterar um patch, **suba a versão** do jogo para ele chegar
aos jogadores.

## 4. Infra relacionada

- `src/minijogos/manifest.js` — lê o manifest, resolve versão + patches
  (`gameInfoFrom`), monta a URL com `?v=` (`withVersion`) e injeta os patches
  (`injectPatches`).
- `src/minijogos/catalog.js` — lista dos jogos (slug, path, categoria, etc.).
- `_shared/sbd.js` — shim comum dos jogos HTML5 (toque→mouse, mudo, ponte de
  som no celular). Tem `?v=` próprio no `<script>` dos jogos.
- `flash/player.html` + `flash/player.js` — player do Ruffle (Flash), também
  com `?v=` e repasse do `?v=` do manifest pro `.swf`.
