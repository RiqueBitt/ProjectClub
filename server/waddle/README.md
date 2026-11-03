# Waddle Forever embutido

Servidor do [Waddle Forever](https://github.com/nhaar/Waddle-Forever) (MIT) que
dá vida à **Praça** do Project Club — um Club Penguin completo (salas, mapa,
roupas, puffles, iglus, carimbos, mini-jogos, festas) rodando no navegador pelo
Ruffle, sem Flash.

- `src/` — código TypeScript (common + server do WF, com as adaptações do
  Project Club: pinguins no MySQL, mídia em cache + bucket, WebSockets no mesmo
  servidor do site). O cliente Electron do WF não foi trazido: o "cliente" aqui
  é a página React (`client/src/pages/PracaPage.jsx`).
- `dist/` — o mesmo código compilado pra JavaScript (commitado: a hospedagem
  não precisa de TypeScript). Depois de mexer em `src/`, rode
  `npm run waddle:build` dentro de `server/` e commite o `dist/` junto.
- `media-manifest.json` — lista dos ~26 mil arquivos de mídia do jogo; eles
  NÃO ficam no repositório (1,7 GB), ficam no bucket B2 na pasta `waddle/`.
  Ver `docs/praca-club-penguin.md` pra subir/atualizar a mídia.

Licença original em `LICENSE`; créditos em `THIRD_PARTY_NOTICES.md` na raiz.
