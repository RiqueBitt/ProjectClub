# Ruffle do Project Club — mudança local

`core.ruffle.*pcei01.js` são os chunks originais do Ruffle com uma troca só,
na função que executa `ExternalInterface.call` (era
`new Function("return (" + nome + ")(...arguments)")`):

- nome simples ou com pontos (`pracaVoiceReady`, `SWFAddress.getValue`) →
  procura a função em `globalThis` e chama, sem `eval`;
- `function() { return (typeof X != "undefined"); }` e
  `function() { return X; }` / `X()` → resolvidos sem `eval`;
- qualquer outra coisa → `new Function` como antes (e avisa no console).

Assim o jogo roda com a CSP normal do site (sem `unsafe-eval`) e a Praça abre
por dentro do site sem recarregar a página. `ruffle.js` aponta pros chunks
novos; os antigos ficam pra quem ainda tem o `ruffle.js` velho em cache. A
página carrega `ruffle.js?v=pcei01`.
