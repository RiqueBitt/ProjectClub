# Jornal do Club Penguin em português

O servidor traduz o jornal (Club Penguin Times) na hora de entregar os SWFs:
`server/src/services/waddle/news/`.

- `layout.js` lê os textos estáticos (DefineText) de cada SWF do jornal em
  parágrafos e troca cada um por um campo de texto (DefineEditText) em
  português, no mesmo lugar, com o mesmo tamanho/cor/alinhamento (encolhe a
  letra um pouco quando o português é mais longo).
- As fontes originais do jornal só têm as letras usadas em inglês. Este
  script gera fontes completas (com acentos) a partir da Proxima Nova das
  webfonts do site antigo do Club Penguin (na mídia do Waddle Forever):
  regular, semibold, condensada (títulos) e itálica.
- Traduções: `pt-seed/<data>.json` (revisadas à mão) e, pras edições novas,
  a IA do Pingu traduz em segundo plano e guarda no banco (WaddleNewsText).

## Gerar as fontes de novo

```sh
pip install fonttools brotli
python3 build_fonts.py <pasta com ProximaNova-Reg-webfont.woff2 e ProximaNova-Bold-webfont.woff2>
# (na mídia: default/websites/modern/sites/default/themes/club_penguin/fonts)
```
