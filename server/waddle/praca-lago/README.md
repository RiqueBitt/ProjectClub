# Lago — sala própria do Project Club (arte do dono)

Sala nova do Club Penguin da Praça (`room_key: lago`, id 438), feita a partir da
arte do dono (`art/cena.png`, 760×480) — não é um arquivo da Disney/Archives.

## O que a sala tem

- **`background_mc`**: a cena inteira (JPEG) + a **cachoeira animada**
  (`waterfall_mc`, 8 quadros a 12 fps, textura rolando sem emenda).
- **`foreground_mc`**: só a água do lago, com 62% de opacidade e pulsando de
  leve. O engine põe essa camada **por cima dos pinguins** (profundidade
  900001), então quem anda no lago fica "embaixo da água".
- **`block_mc`**: vetor (contornos da máscara `build/bloqueio.png`) com tudo em
  que não dá pra andar — árvores, pedras, lanternas, cerca, céu. Dá pra andar
  na neve, na água, no deque e na escada.
- **`triggers_mc`**: `forest_mc` (topo da escada → Floresta) e `cove_mc`
  (trilha da direita → Enseada). Sai andando.
- **Entrar andando**: `forest.as` e `cove.as` são DoActions injetados pelo
  file-server do WF (`swf-patches.ts`) na Floresta (laguinho da cachoeira) e na
  Enseada (beirada esquerda) que criam o gatilho `lago_mc` no `triggers_mc`.
- **Mapa**: `map.as` + `art/icone.png` viram o símbolo exportado
  `pc_lago_icon` (+ `pc_lago_hit`, só a água é clicável) inseridos no 1º quadro
  do `map.swf`; o script põe o ícone em `MAP.id_0` em cima do laguinho entre as
  árvores (490, 362), com dica `w.map.lago` e clique → `sendJoinRoomFromMap("lago")`.

Como entra no jogo: `server/src/services/waddle/island.js` copia `lago.swf` pra
`media/pcisland/` e põe a sala na camada da ilha (com a música 658); o WF
registra a sala em `game-data/rooms.ts` e `file-generators/rooms.json.ts`.

## Gerar de novo

Precisa de Python 3 (Pillow, numpy, opencv-python-headless) e do
[JPEXS FFDec](https://github.com/jindrapetrik/jpexs-decompiler) (`ffdec.jar`).

```sh
cd server/waddle/praca-lago
python3 build.py                                                   # build/lago-semscript.swf + build/scripts (lago.as)
java -jar ffdec.jar -importScript build/lago-semscript.swf lago.swf build/scripts

python3 build_map.py                                               # build/map-semscript.swf + build/map-scripts (map.as)
java -jar ffdec.jar -importScript build/map-semscript.swf build/map.swf build/map-scripts
python3 extract.py                                                 # → ../src/server/file-server/praca-lago-map-tags.ts

# gatilhos de entrada (Floresta/Enseada): template vazio + script
python3 -c "import swfwriter as S; open('build/template.swf','wb').write(S.swf([S.do_action_empty(), S.show_frame(), S.end()]))"
for r in forest cove; do mkdir -p build/$r-scripts/frame_1 && cp $r.as build/$r-scripts/frame_1/DoAction.as && \
  java -jar ffdec.jar -importScript build/template.swf build/$r.swf build/$r-scripts; done
python3 ../praca-voice/extract.py --swf $PWD/build/forest.swf --out $PWD/../src/server/file-server/praca-lago-forest-action.ts --name PRACA_LAGO_FOREST_DOACTION
python3 ../praca-voice/extract.py --swf $PWD/build/cove.swf   --out $PWD/../src/server/file-server/praca-lago-cove-action.ts   --name PRACA_LAGO_COVE_DOACTION
cd ../.. && npm run waddle:build
```

`build/previa.png` mostra a cena com o bloqueio em vermelho e os gatilhos em
verde — confira antes de publicar. Trocar a arte: substitua `art/cena.png`
(760×480; se for a original 1672×941 o build escala e corta sozinho) e
`art/icone.png` (PNG com transparência) e rode tudo de novo.

`swfwriter.py` é um escritor mínimo de SWF (bitmaps JPEG3/lossless, formas,
sprites, PlaceObject2, ExportAssets) — detalhes que custaram: o RGB do
DefineBitsJPEG3 é premultiplicado pelo alpha; só MovieClip (DefineSprite) tem
nome acessível no AVM1 (forma solta com nome não resolve); no Ruffle um filho
do ícone não recebia o mouse, por isso a área de clique é um símbolo à parte.
